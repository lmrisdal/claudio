mod backend;
mod dispatch;
mod message;
mod params;

use crate::host::Host;
use crate::services::game_install::InstallState;
use crate::services::game_runtime::RunningGamesState;
use backend::RpcBackend;
use message::{Incoming, error_line, parse_line, result_line};
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncWrite, AsyncWriteExt};
use tokio::sync::mpsc::{UnboundedSender, unbounded_channel};

pub(crate) struct ContextInner {
    pub(crate) host: Host,
    pub(crate) install: InstallState,
    pub(crate) running: RunningGamesState,
}

pub(crate) type Context = Arc<ContextInner>;

pub async fn serve<R, W>(reader: R, writer: W, resource_dir: PathBuf)
where
    R: AsyncBufRead + Unpin,
    W: AsyncWrite + Unpin + Send + 'static,
{
    let (output, mut lines) = unbounded_channel::<String>();
    let writer_task = tokio::spawn(async move {
        let mut writer = writer;
        while let Some(line) = lines.recv().await {
            let framed = format!("{line}\n");
            if writer.write_all(framed.as_bytes()).await.is_err() || writer.flush().await.is_err() {
                break;
            }
        }
    });

    let backend = RpcBackend::new(output.clone(), resource_dir);
    let ctx: Context = Arc::new(ContextInner {
        host: Host::new(backend.clone()),
        install: InstallState::default(),
        running: RunningGamesState::default(),
    });

    let mut input = reader.lines();
    loop {
        match input.next_line().await {
            Ok(Some(line)) if line.trim().is_empty() => {}
            Ok(Some(line)) => handle_line(&line, &ctx, &backend, &output),
            Ok(None) => break,
            Err(error) => {
                log::error!("Failed to read from the shell: {error}");
                break;
            }
        }
    }

    backend.cancel_pending_confirms();
    drop(output);
    writer_task.abort();
}

fn handle_line(line: &str, ctx: &Context, backend: &RpcBackend, output: &UnboundedSender<String>) {
    match parse_line(line) {
        Ok(Incoming::Request { id, method, params }) => {
            spawn_request(id, method, params, ctx.clone(), output.clone());
        }
        Ok(Incoming::Response { id, result }) => {
            if let Some(id) = id.as_str() {
                backend.resolve_confirm(id, &result);
            }
        }
        Err(message) => log::warn!("{message}"),
    }
}

fn spawn_request(
    id: Value,
    method: String,
    params: Value,
    ctx: Context,
    output: UnboundedSender<String>,
) {
    tokio::spawn(async move {
        let line = match dispatch::dispatch(&ctx, &method, params).await {
            Ok(result) => result_line(&id, &result),
            Err(message) => {
                log::debug!("command {method} failed: {message}");
                error_line(&id, &message)
            }
        };
        let _ = output.send(line);
    });
}

#[cfg(test)]
mod tests;
