use super::*;

pub(super) struct DownloadInfo {
    pub(super) file_path: PathBuf,
    pub(super) is_individual: bool,
}

pub(super) struct DownloadOptions<'a> {
    pub(super) settings: &'a settings::DesktopSettings,
    pub(super) server_url: &'a str,
    pub(super) custom_headers: &'a HashMap<String, String>,
    pub(super) speed_limit_kbs: Option<f64>,
    pub(super) progress_scale: f64,
}

pub(super) async fn download_package(
    app: &AppHandle,
    opts: &DownloadOptions<'_>,
    game_id: i32,
    game_title: &str,
    temp_root: &Path,
    control: &InstallControl,
) -> Result<DownloadInfo, String> {
    download_package_with(
        opts,
        game_id,
        game_title,
        temp_root,
        control,
        |progress| {
            let _ = app.emit("install-progress", progress);
        },
        || refresh_auth_state_ui(app, false),
    )
    .await
}

pub(super) async fn download_package_with<F, G>(
    opts: &DownloadOptions<'_>,
    game_id: i32,
    game_title: &str,
    temp_root: &Path,
    control: &InstallControl,
    mut on_progress: F,
    mut on_logged_out: G,
) -> Result<DownloadInfo, String>
where
    F: FnMut(InstallProgress),
    G: FnMut() -> Result<(), String>,
{
    let DownloadOptions {
        settings,
        server_url,
        custom_headers,
        speed_limit_kbs,
        progress_scale,
    } = opts;
    let progress_scale = *progress_scale;
    let client = reqwest::Client::new();
    emit_progress_with_bytes_to(
        &mut on_progress,
        game_id,
        "requestingManifest",
        Some(0.0),
        Some("Preparing download"),
        None,
        None,
        None,
    );

    let auth_headers =
        authenticated_headers_with(settings, custom_headers, &mut on_logged_out).await?;
    let mut manifest_response = client
        .get(format!(
            "{server_url}/api/games/{game_id}/download-files-manifest"
        ))
        .headers(auth_headers.clone())
        .send()
        .await
        .map_err(|err| err.to_string())?;

    if manifest_response.status() == reqwest::StatusCode::UNAUTHORIZED {
        if let Some(refreshed_headers) =
            refreshed_headers_with(settings, custom_headers, &mut on_logged_out).await?
        {
            manifest_response = client
                .get(format!(
                    "{server_url}/api/games/{game_id}/download-files-manifest"
                ))
                .headers(refreshed_headers.clone())
                .send()
                .await
                .map_err(|err| err.to_string())?;
        }
    }

    let manifest_missing = manifest_response.status() == reqwest::StatusCode::NOT_FOUND;
    let file_manifest: Option<Vec<serde_json::Value>> = if manifest_missing {
        None
    } else if !manifest_response.status().is_success() {
        return Err(format!(
            "Failed to load download file manifest: {}",
            manifest_response.status()
        ));
    } else {
        let manifest_json: serde_json::Value = manifest_response
            .json()
            .await
            .map_err(|err| err.to_string())?;
        manifest_json
            .get("files")
            .and_then(|v| v.as_array())
            .cloned()
    };

    const INDIVIDUAL_FILE_THRESHOLD: usize = 50;
    if let Some(ref files) = file_manifest {
        if files.len() < INDIVIDUAL_FILE_THRESHOLD {
            return download_files_individually(
                opts,
                game_id,
                game_title,
                temp_root,
                control,
                &mut on_progress,
                &auth_headers,
                files,
            )
            .await;
        }
    }

    let mut response = if manifest_missing {
        let mut ticket_response = client
            .post(format!("{server_url}/api/games/{game_id}/download-ticket"))
            .headers(auth_headers.clone())
            .send()
            .await
            .map_err(|err| err.to_string())?;

        if ticket_response.status() == reqwest::StatusCode::UNAUTHORIZED {
            if let Some(refreshed_headers) =
                refreshed_headers_with(settings, custom_headers, &mut on_logged_out).await?
            {
                ticket_response = client
                    .post(format!("{server_url}/api/games/{game_id}/download-ticket"))
                    .headers(refreshed_headers.clone())
                    .send()
                    .await
                    .map_err(|err| err.to_string())?;
            }
        }

        if !ticket_response.status().is_success() {
            return Err(format!(
                "Failed to create download ticket: {}",
                ticket_response.status()
            ));
        }

        let ticket_json: serde_json::Value = ticket_response
            .json()
            .await
            .map_err(|err| err.to_string())?;
        let ticket = ticket_json
            .get("ticket")
            .and_then(|value| value.as_str())
            .ok_or_else(|| "Download ticket response was missing the ticket.".to_string())?
            .to_owned();

        let mut response = client
            .get(format!(
                "{server_url}/api/games/{game_id}/download?ticket={ticket}"
            ))
            .headers(auth_headers.clone())
            .send()
            .await
            .map_err(|err| err.to_string())?;

        if response.status() == reqwest::StatusCode::UNAUTHORIZED {
            if let Some(refreshed_headers) =
                refreshed_headers_with(settings, custom_headers, &mut on_logged_out).await?
            {
                response = client
                    .get(format!(
                        "{server_url}/api/games/{game_id}/download?ticket={ticket}"
                    ))
                    .headers(refreshed_headers)
                    .send()
                    .await
                    .map_err(|err| err.to_string())?;
            }
        }
        response
    } else {
        client
            .get(format!("{server_url}/api/games/{game_id}/download"))
            .headers(auth_headers.clone())
            .send()
            .await
            .map_err(|err| err.to_string())?
    };

    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        if let Some(refreshed_headers) =
            refreshed_headers_with(settings, custom_headers, &mut on_logged_out).await?
        {
            response = client
                .get(format!("{server_url}/api/games/{game_id}/download"))
                .headers(refreshed_headers)
                .send()
                .await
                .map_err(|err| err.to_string())?;
        }
    }

    if !response.status().is_success() {
        if response.status() == reqwest::StatusCode::NOT_FOUND {
            let mut ticket_response = client
                .post(format!("{server_url}/api/games/{game_id}/download-ticket"))
                .headers(auth_headers.clone())
                .send()
                .await
                .map_err(|err| err.to_string())?;

            if ticket_response.status() == reqwest::StatusCode::UNAUTHORIZED {
                if let Some(refreshed_headers) =
                    refreshed_headers_with(settings, custom_headers, &mut on_logged_out).await?
                {
                    ticket_response = client
                        .post(format!("{server_url}/api/games/{game_id}/download-ticket"))
                        .headers(refreshed_headers.clone())
                        .send()
                        .await
                        .map_err(|err| err.to_string())?;
                }
            }

            if !ticket_response.status().is_success() {
                return Err(format!(
                    "Failed to create download ticket: {}",
                    ticket_response.status()
                ));
            }

            let ticket_json: serde_json::Value = ticket_response
                .json()
                .await
                .map_err(|err| err.to_string())?;
            let ticket = ticket_json
                .get("ticket")
                .and_then(|value| value.as_str())
                .ok_or_else(|| "Download ticket response was missing the ticket.".to_string())?
                .to_owned();

            response = client
                .get(format!(
                    "{server_url}/api/games/{game_id}/download?ticket={ticket}"
                ))
                .headers(auth_headers.clone())
                .send()
                .await
                .map_err(|err| err.to_string())?;

            if response.status() == reqwest::StatusCode::UNAUTHORIZED {
                if let Some(refreshed_headers) =
                    refreshed_headers_with(settings, custom_headers, &mut on_logged_out).await?
                {
                    response = client
                        .get(format!(
                            "{server_url}/api/games/{game_id}/download?ticket={ticket}"
                        ))
                        .headers(refreshed_headers)
                        .send()
                        .await
                        .map_err(|err| err.to_string())?;
                }
            }
        }

        if !response.status().is_success() {
            return Err(format!(
                "Failed to download game package: {}",
                response.status()
            ));
        }
    }

    let filename =
        infer_filename(response.headers()).unwrap_or_else(|| format!("game-{game_id}.tar"));
    let download_path = temp_root.join(filename);
    let total_bytes = response.content_length();
    let mut downloaded = 0_u64;
    let mut stream = response.bytes_stream();
    let mut last_progress_emit = std::time::Instant::now()
        .checked_sub(std::time::Duration::from_secs(1))
        .unwrap_or_else(std::time::Instant::now);

    let mut bytes_per_second_limit: Option<u64> = speed_limit_kbs
        .filter(|v| *v > 0.0)
        .map(|kbs| (kbs * 1024.0) as u64);
    let mut window_start = std::time::Instant::now();
    let mut window_bytes = 0_u64;

    let (chunk_tx, mut chunk_rx) = tokio::sync::mpsc::channel::<Vec<u8>>(32);
    let writer_path = download_path.clone();
    let writer_handle = tokio::task::spawn_blocking(move || -> Result<(), String> {
        let file = std::fs::File::create(&writer_path)
            .map_err(|e| format!("Failed to create download file: {e}"))?;
        let mut writer = io::BufWriter::with_capacity(4 * 1024 * 1024, file);
        while let Some(chunk) = chunk_rx.blocking_recv() {
            io::Write::write_all(&mut writer, &chunk)
                .map_err(|e| format!("Failed to write download chunk: {e}"))?;
        }
        io::Write::flush(&mut writer).map_err(|e| format!("Failed to flush download file: {e}"))?;
        Ok(())
    });

    while let Some(chunk) = stream.next().await {
        if control.is_cancelled() {
            drop(chunk_tx);
            let _ = writer_handle.await;
            let _ = fs::remove_dir_all(temp_root);
            return Err("Install cancelled.".to_string());
        }
        let chunk = chunk.map_err(|err| err.to_string())?;
        let chunk_len = chunk.len() as u64;
        chunk_tx
            .send(chunk.to_vec())
            .await
            .map_err(|_| "Writer thread died unexpectedly.".to_string())?;
        downloaded += chunk_len;
        window_bytes += chunk_len;

        if window_start.elapsed().as_secs() >= 1 {
            let new_limit = settings::load_async().await.download_speed_limit_kbs;
            bytes_per_second_limit = new_limit
                .filter(|v| *v > 0.0)
                .map(|kbs| (kbs * 1024.0) as u64);
            window_start = std::time::Instant::now();
            window_bytes = 0;
        }
        if let Some(limit) = bytes_per_second_limit {
            let elapsed = window_start.elapsed();
            let expected = std::time::Duration::from_secs_f64(window_bytes as f64 / limit as f64);
            if expected > elapsed {
                tokio::time::sleep(expected - elapsed).await;
            }
        }

        let now = std::time::Instant::now();
        if now.duration_since(last_progress_emit).as_millis() >= 200 {
            last_progress_emit = now;
            let percent = total_bytes
                .filter(|total| *total > 0)
                .map(|total| (downloaded as f64 / total as f64) * progress_scale);
            emit_progress_with_bytes_to(
                &mut on_progress,
                game_id,
                "downloading",
                percent,
                Some(&format!("Downloading {}", game_title)),
                Some(downloaded),
                total_bytes,
                None,
            );
        }
    }

    drop(chunk_tx);
    writer_handle
        .await
        .map_err(|e| format!("Writer thread panicked: {e}"))??;
    Ok(DownloadInfo {
        file_path: download_path,
        is_individual: false,
    })
}
