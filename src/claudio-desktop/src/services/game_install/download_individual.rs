use super::*;

#[allow(clippy::too_many_arguments)]
pub(super) async fn download_files_individually<F>(
    opts: &DownloadOptions<'_>,
    game_id: i32,
    game_title: &str,
    temp_root: &Path,
    control: &InstallControl,
    on_progress: &mut F,
    auth_headers: &HeaderMap,
    files: &[serde_json::Value],
) -> Result<DownloadInfo, String>
where
    F: FnMut(InstallProgress),
{
    use futures_util::stream::{self, StreamExt as _};
    use std::sync::atomic::{AtomicBool, AtomicU64};
    use tokio::io::AsyncWriteExt;

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
            let headers = auth_headers.clone();
            let dl_bytes = Arc::clone(&downloaded_bytes);
            let progress = progress_tx.clone();
            let cancel_token = control.cancel_token.clone();
            let throttle_window = Arc::clone(&throttle_window);
            let bytes_per_second_limit = Arc::clone(&bytes_per_second_limit);
            async move {
                if cancel_token.load(Ordering::Relaxed) {
                    return Err("Install cancelled.".to_string());
                }
                let client = reqwest::Client::new();
                let response = client
                    .get(&url)
                    .headers(headers)
                    .send()
                    .await
                    .map_err(|e| format!("Failed to download {rel_path}: {e}"))?;

                if !response.status().is_success() {
                    return Err(format!(
                        "Failed to download {rel_path}: HTTP {}",
                        response.status()
                    ));
                }

                if let Some(parent) = dest.parent() {
                    tokio::fs::create_dir_all(parent)
                        .await
                        .map_err(|e| format!("Failed to create directory for {rel_path}: {e}"))?;
                }
                let mut file = tokio::fs::File::create(&dest)
                    .await
                    .map_err(|e| format!("Failed to create {rel_path}: {e}"))?;
                let mut stream = response.bytes_stream();
                while let Some(chunk) = stream.next().await {
                    if cancel_token.load(Ordering::Relaxed) {
                        return Err("Install cancelled.".to_string());
                    }
                    let chunk = chunk.map_err(|e| format!("Failed to read {rel_path}: {e}"))?;
                    file.write_all(&chunk)
                        .await
                        .map_err(|e| format!("Failed to write {rel_path}: {e}"))?;
                    let limit = bytes_per_second_limit.load(Ordering::Relaxed);
                    if limit > 0 {
                        let mut window = throttle_window.lock().await;
                        if window.0.elapsed().as_secs() >= 1 {
                            window.0 = std::time::Instant::now();
                            window.1 = 0;
                        }
                        window.1 += chunk.len() as u64;
                        drop(window);
                        loop {
                            let mut window = throttle_window.lock().await;
                            if window.0.elapsed().as_secs() >= 1 {
                                window.0 = std::time::Instant::now();
                                window.1 = 0;
                            }
                            let current_limit = bytes_per_second_limit.load(Ordering::Relaxed);
                            if current_limit == 0 {
                                drop(window);
                                break;
                            }
                            let elapsed = window.0.elapsed();
                            let expected = std::time::Duration::from_secs_f64(
                                window.1 as f64 / current_limit as f64,
                            );
                            let delay = expected.checked_sub(elapsed);
                            drop(window);
                            let Some(delay) = delay else {
                                break;
                            };
                            tokio::time::sleep(delay.min(std::time::Duration::from_millis(200)))
                                .await;
                        }
                    }
                    dl_bytes.fetch_add(chunk.len() as u64, Ordering::Relaxed);
                    let _ = progress.send(());
                }
                file.flush()
                    .await
                    .map_err(|e| format!("Failed to flush {rel_path}: {e}"))?;
                Ok::<(), String>(())
            }
        })
        .collect();

    let mut completed = 0usize;
    let mut last_progress_emit = std::time::Instant::now()
        .checked_sub(std::time::Duration::from_secs(1))
        .unwrap_or_else(std::time::Instant::now);

    let mut stream = stream::iter(tasks).buffer_unordered(8);
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
