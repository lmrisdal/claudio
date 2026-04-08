use super::super::*;
use super::TestInstallController;

pub async fn download_game_package<F, G>(
    input: DownloadPackageInput,
    controller: &TestInstallController,
    mut on_progress: F,
    mut on_logged_out: G,
) -> Result<String, String>
where
    F: FnMut(InstallProgress),
    G: FnMut() -> Result<(), String>,
{
    emit_progress_with_bytes_to(
        &mut on_progress,
        input.id,
        "starting",
        Some(0.0),
        Some("Preparing download"),
        None,
        None,
        None,
    );

    let settings = settings::load();
    let server_url = settings
        .server_url
        .clone()
        .ok_or_else(|| "Desktop server URL is not configured.".to_string())?;

    let target_dir = PathBuf::from(&input.target_dir);
    fs::create_dir_all(&target_dir)
        .map_err(|err| format!("Failed to create target folder: {err}"))?;

    let downloads_root = settings::resolve_download_root(&settings)?;
    let temp_root = download_workspace_root(&downloads_root, input.id, &input.title);
    if temp_root.exists() {
        fs::remove_dir_all(&temp_root).map_err(|err| err.to_string())?;
    }
    fs::create_dir_all(&temp_root).map_err(|err| err.to_string())?;

    let download_info = download_package_with(
        &DownloadOptions {
            settings: &settings,
            server_url: &server_url,
            custom_headers: &settings.custom_headers,
            speed_limit_kbs: settings.download_speed_limit_kbs,
            progress_scale: 100.0,
        },
        input.id,
        input.title.as_str(),
        &temp_root,
        &controller.control,
        &mut on_progress,
        &mut on_logged_out,
    )
    .await?;

    let final_path = if input.extract {
        let staging = if download_info.is_individual {
            emit_progress_with_bytes_to(
                &mut on_progress,
                input.id,
                "extracting",
                None,
                Some("Moving files…"),
                None,
                None,
                None,
            );
            download_info.file_path.clone()
        } else {
            emit_progress_with_bytes_to(
                &mut on_progress,
                input.id,
                "extracting",
                None,
                Some("Extracting archive…"),
                None,
                None,
                None,
            );
            let staging = temp_root.join("extract");
            if staging.exists() {
                fs::remove_dir_all(&staging).map_err(|err| err.to_string())?;
            }
            fs::create_dir_all(&staging).map_err(|err| err.to_string())?;

            extract_archive_subprocess(
                &download_info.file_path,
                &staging,
                &controller.control.cancel_token,
                |_ratio| {
                    emit_progress_with_bytes_to(
                        &mut on_progress,
                        input.id,
                        "extracting",
                        None,
                        Some("Extracting archive…"),
                        None,
                        None,
                        None,
                    );
                },
            )
            .await?;
            staging
        };

        let moved_entries = tokio::task::spawn_blocking({
            let staging_for_move = staging.clone();
            let dest = target_dir.clone();
            move || -> Result<Vec<PathBuf>, String> {
                let entries = visible_entries(&staging_for_move)?;
                let move_source = if entries.len() == 1 && entries[0].is_dir() {
                    entries[0].clone()
                } else {
                    staging_for_move.clone()
                };

                let mut moved = Vec::new();
                for entry in visible_entries(&move_source)? {
                    let target =
                        dest.join(entry.file_name().ok_or_else(|| {
                            "Extracted entry was missing a file name.".to_string()
                        })?);
                    if target.exists() {
                        if target.is_dir() {
                            fs::remove_dir_all(&target).map_err(|err| err.to_string())?;
                        } else {
                            fs::remove_file(&target).map_err(|err| err.to_string())?;
                        }
                    }
                    fs::rename(&entry, &target).map_err(|err| err.to_string())?;
                    moved.push(target);
                }
                Ok(moved)
            }
        })
        .await
        .map_err(|err| format!("Move task failed: {err}"))??;

        if controller.control.is_cancelled() {
            for path in &moved_entries {
                if path.is_dir() {
                    let _ = fs::remove_dir_all(path);
                } else {
                    let _ = fs::remove_file(path);
                }
            }
            let _ = fs::remove_dir_all(&temp_root);
            return Err("Install cancelled.".to_string());
        }

        target_dir.clone()
    } else {
        emit_progress_with_bytes_to(
            &mut on_progress,
            input.id,
            "extracting",
            None,
            Some("Saving archive…"),
            None,
            None,
            None,
        );
        let filename = download_info
            .file_path
            .file_name()
            .ok_or_else(|| "Downloaded package had no file name.".to_string())?;
        let dest_path = target_dir.join(filename);
        if dest_path.exists() {
            fs::remove_file(&dest_path).map_err(|err| err.to_string())?;
        }
        if fs::rename(&download_info.file_path, &dest_path).is_err() {
            fs::copy(&download_info.file_path, &dest_path).map_err(|err| err.to_string())?;
        }
        dest_path
    };

    let _ = fs::remove_dir_all(&temp_root);
    emit_progress_with_bytes_to(
        &mut on_progress,
        input.id,
        "completed",
        Some(100.0),
        Some("Download complete"),
        None,
        None,
        None,
    );
    Ok(final_path.to_string_lossy().into_owned())
}
