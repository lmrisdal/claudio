use super::*;

/// Number of files downloaded concurrently. Kept low on purpose: the server
/// frequently reads from spinning disks (e.g. a NAS), where many concurrent
/// reads turn sequential I/O into seek thrashing and collapse throughput. Two
/// gives a little pipelining without punishing the source disk.
const DOWNLOAD_CONCURRENCY: usize = 2;

/// How many times a single file is retried (resuming from where it stopped)
/// before the install is failed.
const MAX_FILE_ATTEMPTS: u32 = 5;

/// Outcome of one attempt to stream a file to disk.
enum AttemptError {
    /// The user cancelled the install.
    Cancelled,
    /// A permanent error (e.g. HTTP 404/400) — retrying will not help.
    Fatal(String),
    /// A transient error (connection drop, timeout, 5xx) — retry with `Range`.
    Retryable(String),
}

#[allow(clippy::too_many_arguments)]
pub(super) async fn download_files_individually<F>(
    opts: &DownloadOptions<'_>,
    game_id: i32,
    game_title: &str,
    temp_root: &Path,
    control: &InstallControl,
    on_progress: &mut F,
    request_headers: &HeaderMap,
    files: &[serde_json::Value],
) -> Result<DownloadInfo, String>
where
    F: FnMut(InstallProgress),
{
    use futures_util::stream::{self, StreamExt as _};
    use std::sync::atomic::{AtomicBool, AtomicU64};

    let staging = temp_root.join("files");
    fs::create_dir_all(&staging).map_err(|err| err.to_string())?;

    let total_bytes: u64 = files
        .iter()
        .filter_map(|f| f.get("size").and_then(|s| s.as_u64()))
        .sum();
    let bytes_per_second_limit = Arc::new(AtomicU64::new(
        opts.speed_limit_kbs
            .filter(|v| *v > 0.0)
            .map(|kbs| (kbs * 1024.0) as u64)
            .unwrap_or(0),
    ));
    let limit_refresh_stop = Arc::new(AtomicBool::new(false));
    let limit_refresh_task = {
        let bytes_per_second_limit = Arc::clone(&bytes_per_second_limit);
        let limit_refresh_stop = Arc::clone(&limit_refresh_stop);
        tokio::spawn(async move {
            while !limit_refresh_stop.load(Ordering::Relaxed) {
                tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                if limit_refresh_stop.load(Ordering::Relaxed) {
                    break;
                }
                let limit = settings::load_async()
                    .await
                    .download_speed_limit_kbs
                    .filter(|v| *v > 0.0)
                    .map(|kbs| (kbs * 1024.0) as u64)
                    .unwrap_or(0);
                bytes_per_second_limit.store(limit, Ordering::Relaxed);
            }
        })
    };
    let throttle_window = Arc::new(tokio::sync::Mutex::new((std::time::Instant::now(), 0_u64)));
    let downloaded_bytes = Arc::new(AtomicU64::new(0));
    let (progress_tx, mut progress_rx) = tokio::sync::mpsc::unbounded_channel::<()>();
    let file_count = files.len();

    emit_progress_with_bytes_to(
        on_progress,
        InstallProgress {
            game_id,
            status: "downloading".to_string(),
            percent: Some(0.0),
            indeterminate: None,
            detail: Some(format!("Downloading {game_title}")),
            bytes_downloaded: Some(0),
            total_bytes: Some(total_bytes),
        },
    );

    let server_url = opts.server_url.to_owned();
    let progress_scale = opts.progress_scale;

    // A single shared client so connections can be reused across files instead
    // of paying a fresh TCP+TLS handshake per file.
    let client = reqwest::Client::new();

    let tasks: Vec<_> = files
        .iter()
        .map(|file| {
            let rel_path = file
                .get("path")
                .and_then(|p| p.as_str())
                .unwrap_or_default()
                .to_owned();
            let url = format!(
                "{server_url}/api/games/{game_id}/download-files?path={}",
                urlencoding_encode(&rel_path)
            );
            let dest = staging.join(
                rel_path
                    .replace('/', std::path::MAIN_SEPARATOR_STR)
                    .trim_start_matches(std::path::MAIN_SEPARATOR),
            );
            let headers = request_headers.clone();
            let client = client.clone();
            let dl_bytes = Arc::clone(&downloaded_bytes);
            let progress = progress_tx.clone();
            let cancel_token = control.cancel_token.clone();
            let throttle_window = Arc::clone(&throttle_window);
            let bytes_per_second_limit = Arc::clone(&bytes_per_second_limit);
            async move {
                download_one_file(
                    &client,
                    &url,
                    &headers,
                    &dest,
                    &rel_path,
                    &cancel_token,
                    &dl_bytes,
                    &progress,
                    &throttle_window,
                    &bytes_per_second_limit,
                )
                .await
            }
        })
        .collect();

    let mut completed = 0usize;
    let mut last_progress_emit = std::time::Instant::now()
        .checked_sub(std::time::Duration::from_secs(1))
        .unwrap_or_else(std::time::Instant::now);

    let mut stream = stream::iter(tasks).buffer_unordered(DOWNLOAD_CONCURRENCY);
    drop(progress_tx);
    let mut progress_channel_closed = false;
    let mut first_error: Option<String> = None;
    loop {
        tokio::select! {
            update = progress_rx.recv(), if !progress_channel_closed => {
                if update.is_none() {
                    progress_channel_closed = true;
                    continue;
                }
                let now = std::time::Instant::now();
                if now.duration_since(last_progress_emit).as_millis() >= 200 {
                    last_progress_emit = now;
                    let dl = downloaded_bytes.load(Ordering::Relaxed);
                    let percent = if total_bytes > 0 {
                        Some((dl as f64 / total_bytes as f64) * progress_scale)
                    } else if file_count > 0 {
                        Some((completed as f64 / file_count as f64) * progress_scale)
                    } else {
                        None
                    };
                    emit_progress_with_bytes_to(
                        on_progress,
                        InstallProgress {
                            game_id,
                            status: "downloading".to_string(),
                            percent,
                            indeterminate: None,
                            detail: Some(format!("Downloading {game_title}")),
                            bytes_downloaded: Some(dl),
                            total_bytes: Some(total_bytes),
                        },
                    );
                }
            }
            result = stream.next() => match result {
                Some(result) => {
                    if control.is_cancelled() {
                        first_error = Some("Install cancelled.".to_string());
                        break;
                    }
                    if let Err(error) = result {
                        first_error = Some(error);
                        break;
                    }
                    completed += 1;
                }
                None => break,
            }
        }
    }

    limit_refresh_stop.store(true, Ordering::Relaxed);
    let _ = limit_refresh_task.await;

    if let Some(error) = first_error {
        return Err(error);
    }

    let dl = downloaded_bytes.load(Ordering::Relaxed);
    let percent = if total_bytes > 0 {
        Some((dl as f64 / total_bytes as f64) * progress_scale)
    } else if file_count > 0 {
        Some((completed as f64 / file_count as f64) * progress_scale)
    } else {
        None
    };
    emit_progress_with_bytes_to(
        on_progress,
        InstallProgress {
            game_id,
            status: "downloading".to_string(),
            percent,
            indeterminate: None,
            detail: Some(format!("Downloading {game_title}")),
            bytes_downloaded: Some(dl),
            total_bytes: Some(total_bytes),
        },
    );

    Ok(DownloadInfo {
        file_path: staging,
        is_individual: true,
    })
}

/// Downloads a single file, retrying transient failures by resuming from the
/// bytes already on disk via an HTTP `Range` request.
#[allow(clippy::too_many_arguments)]
async fn download_one_file(
    client: &reqwest::Client,
    url: &str,
    headers: &HeaderMap,
    dest: &Path,
    rel_path: &str,
    cancel_token: &Arc<std::sync::atomic::AtomicBool>,
    downloaded_bytes: &Arc<std::sync::atomic::AtomicU64>,
    progress: &tokio::sync::mpsc::UnboundedSender<()>,
    throttle_window: &Arc<tokio::sync::Mutex<(std::time::Instant, u64)>>,
    bytes_per_second_limit: &Arc<std::sync::atomic::AtomicU64>,
) -> Result<(), String> {
    let mut attempt = 0u32;
    loop {
        attempt += 1;
        if cancel_token.load(Ordering::Relaxed) {
            return Err("Install cancelled.".to_string());
        }

        // Resume from whatever is already on disk from a previous attempt.
        let resume_from = tokio::fs::metadata(dest)
            .await
            .map(|m| m.len())
            .unwrap_or(0);

        let mut request = client.get(url).headers(headers.clone());
        if resume_from > 0 {
            request = request.header(reqwest::header::RANGE, format!("bytes={resume_from}-"));
        }

        match stream_attempt(
            request,
            dest,
            rel_path,
            resume_from,
            cancel_token,
            downloaded_bytes,
            progress,
            throttle_window,
            bytes_per_second_limit,
        )
        .await
        {
            Ok(()) => return Ok(()),
            Err(AttemptError::Cancelled) => return Err("Install cancelled.".to_string()),
            Err(AttemptError::Fatal(msg)) => {
                return Err(format!("Failed to download {rel_path}: {msg}"));
            }
            Err(AttemptError::Retryable(msg)) => {
                if attempt >= MAX_FILE_ATTEMPTS {
                    return Err(format!(
                        "Failed to download {rel_path} after {attempt} attempts: {msg}"
                    ));
                }
                // Exponential backoff, capped, so a flaky source gets a moment to recover.
                let backoff =
                    std::time::Duration::from_millis(500u64.saturating_mul(1 << (attempt - 1)));
                tokio::time::sleep(backoff.min(std::time::Duration::from_secs(10))).await;
            }
        }
    }
}

/// Streams one HTTP response to `dest`. Disk writes happen on a dedicated task
/// fed by a bounded channel, so a slow flush on the target disk cannot stall
/// reads from the socket (and so cannot trip the server's write timeout).
#[allow(clippy::too_many_arguments)]
async fn stream_attempt(
    request: reqwest::RequestBuilder,
    dest: &Path,
    rel_path: &str,
    resume_from: u64,
    cancel_token: &Arc<std::sync::atomic::AtomicBool>,
    downloaded_bytes: &Arc<std::sync::atomic::AtomicU64>,
    progress: &tokio::sync::mpsc::UnboundedSender<()>,
    throttle_window: &Arc<tokio::sync::Mutex<(std::time::Instant, u64)>>,
    bytes_per_second_limit: &Arc<std::sync::atomic::AtomicU64>,
) -> Result<(), AttemptError> {
    use futures_util::stream::StreamExt as _;
    use tokio::io::AsyncWriteExt as _;

    let response = request
        .send()
        .await
        .map_err(|e| AttemptError::Retryable(format!("request failed: {e}")))?;

    let status = response.status();
    if !status.is_success() {
        if status.is_server_error() || status == reqwest::StatusCode::TOO_MANY_REQUESTS {
            return Err(AttemptError::Retryable(format!("HTTP {status}")));
        }
        return Err(AttemptError::Fatal(format!("HTTP {status}")));
    }

    // We resume only when the server honours the range with 206 Partial Content.
    // If it returned 200 despite our Range header, it is sending the whole file,
    // so we must rewrite from scratch and undo the progress we previously counted.
    let append = resume_from > 0 && status == reqwest::StatusCode::PARTIAL_CONTENT;
    if !append && resume_from > 0 {
        let prev = downloaded_bytes.load(Ordering::Relaxed);
        downloaded_bytes.fetch_sub(resume_from.min(prev), Ordering::Relaxed);
    }

    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| AttemptError::Fatal(format!("failed to create directory: {e}")))?;
    }

    let (chunk_tx, mut chunk_rx) = tokio::sync::mpsc::channel::<Vec<u8>>(16);
    let writer_dest = dest.to_path_buf();
    let writer = tokio::spawn(async move {
        let mut file = if append {
            tokio::fs::OpenOptions::new()
                .append(true)
                .open(&writer_dest)
                .await
                .map_err(|e| format!("failed to open file: {e}"))?
        } else {
            tokio::fs::File::create(&writer_dest)
                .await
                .map_err(|e| format!("failed to create file: {e}"))?
        };
        while let Some(chunk) = chunk_rx.recv().await {
            file.write_all(&chunk)
                .await
                .map_err(|e| format!("failed to write file: {e}"))?;
        }
        file.flush()
            .await
            .map_err(|e| format!("failed to flush file: {e}"))?;
        Ok::<(), String>(())
    });

    let mut stream = response.bytes_stream();
    let mut read_error: Option<AttemptError> = None;
    while let Some(chunk) = stream.next().await {
        if cancel_token.load(Ordering::Relaxed) {
            read_error = Some(AttemptError::Cancelled);
            break;
        }
        let chunk = match chunk {
            Ok(chunk) => chunk,
            Err(e) => {
                read_error = Some(AttemptError::Retryable(format!("read failed: {e}")));
                break;
            }
        };
        let chunk_len = chunk.len() as u64;

        apply_throttle(throttle_window, bytes_per_second_limit, chunk_len).await;

        if chunk_tx.send(chunk.to_vec()).await.is_err() {
            // The writer task ended early (it hit an error); surface it below.
            read_error = Some(AttemptError::Retryable("writer task ended".to_string()));
            break;
        }
        downloaded_bytes.fetch_add(chunk_len, Ordering::Relaxed);
        let _ = progress.send(());
    }

    drop(chunk_tx);
    let writer_result = writer.await;

    if let Some(error) = read_error {
        // Drain whatever the writer reported but prefer the read-side error.
        let _ = writer_result;
        return Err(error);
    }

    match writer_result {
        Ok(Ok(())) => Ok(()),
        Ok(Err(msg)) => Err(AttemptError::Retryable(format!("{rel_path}: {msg}"))),
        Err(join) => Err(AttemptError::Fatal(format!("writer task panicked: {join}"))),
    }
}

/// Applies the shared download speed limit, if any, for a chunk of `chunk_len`
/// bytes. No-op when the limit is unset.
async fn apply_throttle(
    throttle_window: &Arc<tokio::sync::Mutex<(std::time::Instant, u64)>>,
    bytes_per_second_limit: &Arc<std::sync::atomic::AtomicU64>,
    chunk_len: u64,
) {
    let limit = bytes_per_second_limit.load(Ordering::Relaxed);
    if limit == 0 {
        return;
    }
    {
        let mut window = throttle_window.lock().await;
        if window.0.elapsed().as_secs() >= 1 {
            window.0 = std::time::Instant::now();
            window.1 = 0;
        }
        window.1 += chunk_len;
    }
    loop {
        let window = throttle_window.lock().await;
        if window.0.elapsed().as_secs() >= 1 {
            drop(window);
            break;
        }
        let current_limit = bytes_per_second_limit.load(Ordering::Relaxed);
        if current_limit == 0 {
            drop(window);
            break;
        }
        let elapsed = window.0.elapsed();
        let expected = std::time::Duration::from_secs_f64(window.1 as f64 / current_limit as f64);
        let delay = expected.checked_sub(elapsed);
        drop(window);
        let Some(delay) = delay else {
            break;
        };
        tokio::time::sleep(delay.min(std::time::Duration::from_millis(200))).await;
    }
}
