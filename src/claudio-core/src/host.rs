use serde::Serialize;
use std::path::PathBuf;
use std::sync::Arc;

pub struct ConfirmRequest {
    pub title: String,
    pub message: String,
    pub ok_label: String,
    pub cancel_label: String,
}

pub trait HostBackend: Send + Sync + 'static {
    fn emit(&self, event: &str, payload: serde_json::Value);
    fn confirm(&self, request: ConfirmRequest) -> bool;
    fn resource_dir(&self) -> PathBuf;
}

#[derive(Clone)]
pub struct Host {
    backend: Arc<dyn HostBackend>,
}

impl Host {
    pub fn new(backend: impl HostBackend) -> Self {
        Self {
            backend: Arc::new(backend),
        }
    }

    pub fn emit<P: Serialize>(&self, event: &str, payload: P) {
        match serde_json::to_value(payload) {
            Ok(value) => self.backend.emit(event, value),
            Err(error) => log::warn!("Could not serialize payload for event '{event}': {error}"),
        }
    }

    pub fn confirm(&self, title: &str, message: &str, ok_label: &str, cancel_label: &str) -> bool {
        self.backend.confirm(ConfirmRequest {
            title: title.to_string(),
            message: message.to_string(),
            ok_label: ok_label.to_string(),
            cancel_label: cancel_label.to_string(),
        })
    }

    pub fn resource_dir(&self) -> PathBuf {
        self.backend.resource_dir()
    }
}

#[cfg(any(test, feature = "integration-tests"))]
pub use recording::RecordingHost;

#[cfg(any(test, feature = "integration-tests"))]
mod recording {
    use super::*;
    use std::sync::Mutex;

    #[derive(Clone, Default)]
    pub struct RecordingHost {
        events: Arc<Mutex<Vec<(String, serde_json::Value)>>>,
        confirmations: Arc<Mutex<Vec<ConfirmRequest>>>,
        confirm_answer: Arc<Mutex<bool>>,
        resource_dir: PathBuf,
    }

    impl RecordingHost {
        pub fn new(resource_dir: PathBuf, confirm_answer: bool) -> Self {
            Self {
                resource_dir,
                confirm_answer: Arc::new(Mutex::new(confirm_answer)),
                ..Self::default()
            }
        }

        pub fn host(&self) -> Host {
            Host::new(self.clone())
        }

        pub fn events(&self) -> Vec<(String, serde_json::Value)> {
            self.events.lock().map(|e| e.clone()).unwrap_or_default()
        }

        pub fn confirmation_titles(&self) -> Vec<String> {
            self.confirmations
                .lock()
                .map(|c| c.iter().map(|request| request.title.clone()).collect())
                .unwrap_or_default()
        }
    }

    impl HostBackend for RecordingHost {
        fn emit(&self, event: &str, payload: serde_json::Value) {
            if let Ok(mut events) = self.events.lock() {
                events.push((event.to_string(), payload));
            }
        }

        fn confirm(&self, request: ConfirmRequest) -> bool {
            if let Ok(mut confirmations) = self.confirmations.lock() {
                confirmations.push(request);
            }
            self.confirm_answer.lock().map(|a| *a).unwrap_or(false)
        }

        fn resource_dir(&self) -> PathBuf {
            self.resource_dir.clone()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::InstallProgress;

    #[test]
    fn emit_serializes_payload_with_camel_case_fields() {
        let recorder = RecordingHost::new(PathBuf::new(), true);
        let host = recorder.host();

        host.emit(
            "install-progress",
            InstallProgress {
                game_id: 7,
                status: "downloading".to_string(),
                percent: Some(12.5),
                indeterminate: None,
                detail: None,
                bytes_downloaded: None,
                total_bytes: None,
            },
        );

        let events = recorder.events();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].0, "install-progress");
        assert_eq!(events[0].1["gameId"], 7);
        assert_eq!(events[0].1["percent"], 12.5);
    }

    #[test]
    fn confirm_returns_backend_answer_and_records_request() {
        let accepting = RecordingHost::new(PathBuf::new(), true);
        let declining = RecordingHost::new(PathBuf::new(), false);

        assert!(accepting.host().confirm("Title", "Message", "Ok", "Cancel"));
        assert!(!declining.host().confirm("Other", "Message", "Ok", "Cancel"));
        assert_eq!(accepting.confirmation_titles(), vec!["Title".to_string()]);
    }

    #[test]
    fn resource_dir_comes_from_backend() {
        let recorder = RecordingHost::new(PathBuf::from("/opt/claudio/resources"), true);

        assert_eq!(
            recorder.host().resource_dir(),
            PathBuf::from("/opt/claudio/resources")
        );
    }
}
