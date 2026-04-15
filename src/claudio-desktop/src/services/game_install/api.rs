use super::*;

pub async fn install_game(
    app: AppHandle,
    state: State<'_, InstallState>,
    game: RemoteGame,
) -> Result<InstalledGame, String> {
    let control = state.start(game.id)?;
    let game_id = game.id;
    let game_title = game.title.clone();
    let result = install_game_inner(&app, game, &control).await;
    if let Err(error) = &result
        && !control.is_cancelled()
    {
        emit_progress(
            &app,
            game_id,
            "failed",
            None,
            Some(&format!("Install failed for {game_title}: {error}")),
        );
    }
    state.finish(game_id);
    if control.is_cancelled() {
        return Err("Install cancelled.".to_string());
    }
    result
}

pub async fn download_game_package(
    app: AppHandle,
    state: State<'_, InstallState>,
    input: DownloadPackageInput,
) -> Result<String, String> {
    let control = state.start(input.id)?;
    let game_id = input.id;
    let game_title = input.title.clone();
    let target_dir = PathBuf::from(&input.target_dir);
    let target_existed = target_dir.exists();
    let result = download_game_package_inner(&app, &input, &control).await;
    if let Err(error) = &result
        && !control.is_cancelled()
    {
        emit_progress(
            &app,
            game_id,
            "failed",
            None,
            Some(&format!("Download failed for {game_title}: {error}")),
        );
    }
    state.finish(game_id);
    if let Ok(download_root) = settings::resolve_download_root(&settings::load()) {
        let workspace = download_workspace_root(&download_root, input.id, &input.title);
        let _ = fs::remove_dir_all(workspace);
    }
    if control.is_cancelled() {
        if !target_existed {
            let _ = fs::remove_dir(&target_dir);
        }
        return Err("Download cancelled.".to_string());
    }
    result
}

async fn download_game_package_inner(
    app: &AppHandle,
    input: &DownloadPackageInput,
    control: &InstallControl,
) -> Result<String, String> {
    log::info!(
        "Starting package download for '{}' (id={}, target_dir={}, extract={})",
        input.title,
        input.id,
        input.target_dir,
        input.extract
    );
    emit_progress(
        app,
        input.id,
        "starting",
        Some(0.0),
        Some("Preparing download"),
    );

    let settings = settings::load();
    let server_url = settings
        .server_url
        .clone()
        .ok_or_else(|| "Desktop server URL is not configured.".to_string())?;

    let target_dir = PathBuf::from(&input.target_dir);
    fs::create_dir_all(&target_dir).map_err(|err| {
        log_io_failure(
            "create target folder for package download",
            &target_dir,
            &err,
        );
        format_install_io_error("create the target folder", &target_dir, &err)
    })?;

    let downloads_root = settings::resolve_download_root(&settings)?;
    let temp_root = download_workspace_root(&downloads_root, input.id, &input.title);
    if temp_root.exists() {
        fs::remove_dir_all(&temp_root).map_err(|err| {
            log_io_failure("remove stale package download workspace", &temp_root, &err);
            format_install_io_error("clean the package download workspace", &temp_root, &err)
        })?;
    }
    fs::create_dir_all(&temp_root).map_err(|err| {
        log_io_failure("create package download workspace", &temp_root, &err);
        format_install_io_error("create the package download workspace", &temp_root, &err)
    })?;

    let download_info = download_package(
        app,
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
        control,
    )
    .await?;

    let final_path = if input.extract {
        let staging = if download_info.is_individual {
            emit_progress(app, input.id, "extracting", None, Some("Moving files…"));
            download_info.file_path.clone()
        } else {
            emit_progress(
                app,
                input.id,
                "extracting",
                None,
                Some("Extracting archive…"),
            );
            let staging = temp_root.join("extract");
            if staging.exists() {
                fs::remove_dir_all(&staging).map_err(|err| {
                    log_io_failure(
                        "remove package extraction staging directory",
                        &staging,
                        &err,
                    );
                    format_install_io_error(
                        "clean the package extraction staging directory",
                        &staging,
                        &err,
                    )
                })?;
            }
            fs::create_dir_all(&staging).map_err(|err| {
                log_io_failure(
                    "create package extraction staging directory",
                    &staging,
                    &err,
                );
                format_install_io_error(
                    "create the package extraction staging directory",
                    &staging,
                    &err,
                )
            })?;
            let extract_app = app.clone();
            let extract_gid = input.id;
            extract_archive_subprocess(
                &download_info.file_path,
                &staging,
                &control.cancel_token,
                move |_ratio| {
                    emit_progress(
                        &extract_app,
                        extract_gid,
                        "extracting",
                        None,
                        Some("Extracting archive…"),
                    );
                },
            )
            .await?;
            staging
        };

        let dest = target_dir.clone();
        let staging_for_move = staging.clone();
        let moved_entries = tokio::task::spawn_blocking(move || -> Result<Vec<PathBuf>, String> {
            move_visible_entries_into_dir(&staging_for_move, &dest)
        })
        .await
        .map_err(|err| format!("Move task failed: {err}"))??;

        if control.is_cancelled() {
            for path in &moved_entries {
                if path.is_dir() {
                    let _ = fs::remove_dir_all(path);
                } else {
                    let _ = fs::remove_file(path);
                }
            }
            return Err("Install cancelled.".to_string());
        }
        target_dir.clone()
    } else {
        emit_progress(app, input.id, "extracting", None, Some("Saving archive…"));
        let filename = download_info
            .file_path
            .file_name()
            .ok_or_else(|| "Downloaded package had no file name.".to_string())?;
        let dest_path = target_dir.join(filename);
        if dest_path.exists() {
            clear_existing_path(&dest_path)?;
        }
        if fs::rename(&download_info.file_path, &dest_path).is_err() {
            fs::copy(&download_info.file_path, &dest_path).map_err(|err| {
                log_io_failure_pair(
                    "copy downloaded package into target directory",
                    &download_info.file_path,
                    &dest_path,
                    &err,
                );
                format_install_io_error_pair(
                    "copy the downloaded package into the target directory",
                    &download_info.file_path,
                    &dest_path,
                    &err,
                )
            })?;
        }
        dest_path
    };

    let _ = fs::remove_dir_all(&temp_root);
    emit_progress(
        app,
        input.id,
        "completed",
        Some(100.0),
        Some("Download complete"),
    );
    log::info!(
        "Package download complete for '{}': {}",
        input.title,
        final_path.display()
    );
    Ok(final_path.to_string_lossy().into_owned())
}

pub fn resolve_install_path(game_title: &str) -> String {
    let settings = settings::load();
    let root = settings::default_install_root(&settings);
    root.join(sanitize_segment(game_title))
        .to_string_lossy()
        .into_owned()
}

pub fn validate_install_target(target_path: &str) -> Result<(), String> {
    let trimmed = target_path.trim();
    if trimmed.is_empty() {
        return Err("Please choose an install location.".to_string());
    }

    validate_install_target_path(Path::new(trimmed))
}

pub fn resolve_default_download_root_path() -> String {
    let settings = settings::load();
    settings::default_download_root(&settings)
        .to_string_lossy()
        .into_owned()
}

pub fn resolve_download_path(game_title: &str) -> String {
    let settings = settings::load();
    let root = settings::default_download_root(&settings);
    root.join(sanitize_segment(game_title))
        .to_string_lossy()
        .into_owned()
}

pub fn list_installed_games() -> Result<Vec<InstalledGame>, String> {
    registry::list()
}

pub fn get_installed_game(remote_game_id: i32) -> Result<Option<InstalledGame>, String> {
    registry::get(remote_game_id)
}

pub fn cancel_install(app: &AppHandle, state: &InstallState, game_id: i32) -> Result<(), String> {
    state.cancel(app, game_id)
}

pub fn restart_install_interactive(
    app: &AppHandle,
    state: &InstallState,
    game_id: i32,
) -> Result<(), String> {
    state.restart_interactive(app, game_id)
}

pub fn cleanup_failed_install(game: &RemoteGame) -> Result<(), String> {
    let settings = settings::load();
    let downloads_root = settings::resolve_download_root(&settings)?;
    let temp_root = install_download_root(&downloads_root, game);
    if temp_root.exists() {
        fs::remove_dir_all(&temp_root).map_err(|err| {
            log_io_failure("remove failed install workspace", &temp_root, &err);
            format_install_io_error("clean the failed install workspace", &temp_root, &err)
        })?;
    }

    Ok(())
}

pub fn uninstall_game(remote_game_id: i32, delete_files: bool) -> Result<(), String> {
    let removed = registry::remove(remote_game_id)?;

    #[cfg(target_os = "windows")]
    if let Some(game) = &removed {
        crate::windows_integration::deregister(game);
    }

    if delete_files && let Some(installed) = removed {
        let path = PathBuf::from(&installed.install_path);
        if path.exists() {
            fs::remove_dir_all(&path)
                .map_err(|err| format!("Failed to delete install folder: {err}"))?;
        }
    }
    Ok(())
}

pub fn open_install_folder(remote_game_id: i32) -> Result<(), String> {
    let installed =
        registry::get(remote_game_id)?.ok_or_else(|| "Game is not installed.".to_string())?;

    let path = PathBuf::from(installed.install_path);
    if !path.exists() {
        return Err("Installed path no longer exists.".to_string());
    }

    let mut command = open_path_command(&path);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|err| err.to_string())?;

    Ok(())
}

pub fn set_game_exe(remote_game_id: i32, game_exe: String) -> Result<InstalledGame, String> {
    let mut game =
        registry::get(remote_game_id)?.ok_or_else(|| "Game is not installed.".to_string())?;
    game.game_exe = Some(game_exe);
    registry::upsert(game)
}

pub fn list_game_executables(remote_game_id: i32) -> Result<Vec<String>, String> {
    let game =
        registry::get(remote_game_id)?.ok_or_else(|| "Game is not installed.".to_string())?;
    let root = PathBuf::from(&game.install_path);

    let mut exes = Vec::new();
    collect_matching_files(&root, &mut exes, |path| {
        path.extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.eq_ignore_ascii_case("exe"))
            .unwrap_or(false)
    });
    exes.sort();

    Ok(exes
        .into_iter()
        .filter_map(|path| {
            path.strip_prefix(&root)
                .ok()
                .map(|rel| rel.to_string_lossy().into_owned())
        })
        .collect())
}

fn open_path_command(path: &Path) -> std::process::Command {
    #[cfg(target_os = "macos")]
    let mut command = std::process::Command::new("open");
    #[cfg(target_os = "linux")]
    let mut command = std::process::Command::new("xdg-open");
    #[cfg(target_os = "windows")]
    let command = {
        let mut cmd = std::process::Command::new("explorer");
        cmd.arg(path);
        cmd
    };

    #[cfg(not(target_os = "windows"))]
    command.arg(path);

    command
}
