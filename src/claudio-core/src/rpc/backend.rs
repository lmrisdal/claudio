use super::message::{confirm_request_line, event_line};
use crate::host::{ConfirmRequest, HostBackend};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{Sender, channel};
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc::UnboundedSender;

type PendingConfirms = Arc<Mutex<HashMap<String, Sender<bool>>>>;

#[derive(Clone)]
pub(super) struct RpcBackend {
    output: UnboundedSender<String>,
    pending: PendingConfirms,
    next_confirm_id: Arc<AtomicU64>,
    resource_dir: PathBuf,
}

impl RpcBackend {
    pub(super) fn new(output: UnboundedSender<String>, resource_dir: PathBuf) -> Self {
        Self {
            output,
            pending: Arc::new(Mutex::new(HashMap::new())),
            next_confirm_id: Arc::new(AtomicU64::new(1)),
            resource_dir,
        }
    }

    pub(super) fn resolve_confirm(&self, id: &str, answer: &Value) {
        let sender = self
            .pending
            .lock()
            .ok()
            .and_then(|mut pending| pending.remove(id));
        if let Some(sender) = sender {
            let _ = sender.send(answer.as_bool().unwrap_or(false));
        }
    }

    pub(super) fn cancel_pending_confirms(&self) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.clear();
        }
    }
}

impl HostBackend for RpcBackend {
    fn emit(&self, event: &str, payload: Value) {
        let _ = self.output.send(event_line(event, &payload));
    }

    fn confirm(&self, request: ConfirmRequest) -> bool {
        let id = format!("c{}", self.next_confirm_id.fetch_add(1, Ordering::Relaxed));
        let (sender, receiver) = channel();
        match self.pending.lock() {
            Ok(mut pending) => pending.insert(id.clone(), sender),
            Err(_) => return false,
        };
        let params = json!({
            "title": request.title,
            "message": request.message,
            "okLabel": request.ok_label,
            "cancelLabel": request.cancel_label,
        });
        if self
            .output
            .send(confirm_request_line(&id, &params))
            .is_err()
        {
            return false;
        }
        receiver.recv().unwrap_or(false)
    }

    fn resource_dir(&self) -> PathBuf {
        self.resource_dir.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::host::Host;
    use tokio::sync::mpsc::unbounded_channel;

    fn start_confirm(backend: &RpcBackend) -> std::thread::JoinHandle<bool> {
        let host = Host::new(backend.clone());
        std::thread::spawn(move || host.confirm("Title", "Message", "Ok", "Cancel"))
    }

    fn next_request_id(receiver: &mut tokio::sync::mpsc::UnboundedReceiver<String>) -> String {
        loop {
            if let Ok(line) = receiver.try_recv() {
                let value: Value = serde_json::from_str(&line).unwrap_or(Value::Null);
                assert_eq!(value["request"], "confirm");
                assert_eq!(value["params"]["okLabel"], "Ok");
                return value["id"].as_str().unwrap_or_default().to_string();
            }
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
    }

    #[test]
    fn confirm_round_trip_returns_the_shell_answer() {
        let (output, mut receiver) = unbounded_channel();
        let backend = RpcBackend::new(output, PathBuf::new());
        let waiting = start_confirm(&backend);

        let id = next_request_id(&mut receiver);
        backend.resolve_confirm(&id, &json!(true));

        assert!(waiting.join().unwrap_or(false));
    }

    #[test]
    fn confirm_returns_false_when_declined() {
        let (output, mut receiver) = unbounded_channel();
        let backend = RpcBackend::new(output, PathBuf::new());
        let waiting = start_confirm(&backend);

        let id = next_request_id(&mut receiver);
        backend.resolve_confirm(&id, &json!(false));

        assert!(!waiting.join().unwrap_or(true));
    }

    #[test]
    fn confirm_returns_false_when_the_shell_goes_away() {
        let (output, mut receiver) = unbounded_channel();
        let backend = RpcBackend::new(output, PathBuf::new());
        let waiting = start_confirm(&backend);

        next_request_id(&mut receiver);
        backend.cancel_pending_confirms();

        assert!(!waiting.join().unwrap_or(true));
    }

    #[test]
    fn confirm_ids_are_unique_per_request() {
        let (output, mut receiver) = unbounded_channel();
        let backend = RpcBackend::new(output, PathBuf::new());
        let first = start_confirm(&backend);
        let first_id = next_request_id(&mut receiver);
        let second = start_confirm(&backend);
        let second_id = next_request_id(&mut receiver);

        backend.resolve_confirm(&second_id, &json!(true));
        backend.resolve_confirm(&first_id, &json!(false));

        assert_ne!(first_id, second_id);
        assert!(second.join().unwrap_or(false));
        assert!(!first.join().unwrap_or(true));
    }
}
