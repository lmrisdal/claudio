use super::*;

pub(super) async fn install_game_inner(
    app: &AppHandle,
    game: RemoteGame,
    control: &InstallControl,
) -> Result<InstalledGame, String> {
    log::info!(
        "Starting install for '{}' (id={}, install_type={:?})",
        game.title,
        game.id,
        game.install_type
    );
    emit_progress(
        app,
        game.id,
        "starting",
        Some(0.0),
        Some("Preparing install"),
    );

    let settings = settings::load();
    let server_url = settings
        .server_url
        .clone()
        .ok_or_else(|| "Desktop server URL is not configured.".to_string())?;

    let target_dir = match game.install_path.as_deref() {
        Some(path) => PathBuf::from(path),
        None => {
            let install_root = settings::resolve_install_root(&settings)?;
            build_install_dir(&install_root, &game)
        }
    };
    log::info!("Install target: {}", target_dir.display());

    if target_dir.exists() {
        return Err(format!(
            "Install target already exists: {}",
            target_dir.display()
        ));
    }

    validate_install_target_path(&target_dir)?;

    let downloads_root = settings::resolve_download_root(&settings)?;
    let temp_root = install_download_root(&downloads_root, &game);
    if temp_root.exists() {
        fs::remove_dir_all(&temp_root).map_err(|err| {
            log_io_failure("remove stale install download directory", &temp_root, &err);
            format_install_io_error("clean the temporary download directory", &temp_root, &err)
        })?;
    }
    fs::create_dir_all(&temp_root).map_err(|err| {
        log_io_failure("create install download directory", &temp_root, &err);
        format_install_io_error("create the temporary download directory", &temp_root, &err)
    })?;

    let download_info = download_package(
        app,
        &DownloadOptions {
            settings: &settings,
            server_url: &server_url,
            custom_headers: &settings.custom_headers,
            speed_limit_kbs: settings.download_speed_limit_kbs,
            progress_scale: 60.0,
        },
        game.id,
        game.title.as_str(),
        &temp_root,
        control,
    )
    .await?;
    log::info!("Download complete: {}", download_info.file_path.display());

    let install_result = match game.install_type {
        InstallType::Portable => {
            install_portable(app, &game, &target_dir, &download_info.file_path, control).await
        }
        InstallType::Installer => {
            install_installer(app, &game, &target_dir, &download_info.file_path, control).await
        }
    };

    if let Err(ref err) = install_result {
        log::error!("Install failed for '{}': {}", game.title, err);
        if !matches!(game.install_type, InstallType::Installer) {
            let _ = fs::remove_dir_all(&temp_root);
        }
    }

    let installed = install_result?;
    let installed = registry::upsert(installed)?;

    #[cfg(target_os = "windows")]
    crate::windows_integration::register(app, &installed, game.desktop_shortcut.unwrap_or(false));

    let _ = fs::remove_dir_all(&temp_root);
    log::info!(
        "Install complete for '{}': {}",
        game.title,
        installed.install_path
    );
    emit_progress(
        app,
        game.id,
        "completed",
        Some(100.0),
        Some("Install complete"),
    );
    Ok(installed)
}

pub(super) fn urlencoding_encode(input: &str) -> String {
    let mut encoded = String::with_capacity(input.len());
    for byte in input.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(byte as char);
            }
            b'/' => encoded.push('/'),
            other => {
                encoded.push('%');
                encoded.push(
                    char::from_digit((other >> 4) as u32, 16)
                        .unwrap()
                        .to_ascii_uppercase(),
                );
                encoded.push(
                    char::from_digit((other & 0xf) as u32, 16)
                        .unwrap()
                        .to_ascii_uppercase(),
                );
            }
        }
    }
    encoded
}

pub(super) async fn install_portable(
    app: &AppHandle,
    game: &RemoteGame,
    target_dir: &Path,
    package_path: &Path,
    control: &InstallControl,
) -> Result<InstalledGame, String> {
    emit_progress(
        app,
        game.id,
        "extracting",
        Some(60.0),
        Some("Extracting game"),
    );

    let app_handle = app.clone();
    let gid = game.id;
    let extract_root = target_dir.with_extension("extracting");
    let target_dir_owned = target_dir.to_path_buf();
    let package_path_owned = package_path.to_path_buf();
    let game_exe_hint = game.game_exe.clone();
    let cancel_token = control.cancel_token.clone();

    let game_exe = tokio::task::spawn_blocking(move || -> Result<Option<String>, String> {
        let mut progress_cb = |p: f64| {
            emit_progress(
                &app_handle,
                gid,
                "extracting",
                Some(60.0 + (p * 35.0)),
                Some("Extracting game…"),
            );
        };

        if extract_root.exists() {
            fs::remove_dir_all(&extract_root).map_err(|err| {
                log_io_failure(
                    "remove existing extract staging directory",
                    &extract_root,
                    &err,
                );
                format_install_io_error("clean the extract staging directory", &extract_root, &err)
            })?;
        }
        fs::create_dir_all(&extract_root).map_err(|err| {
            log_io_failure("create extract staging directory", &extract_root, &err);
            format_install_io_error("create the extract staging directory", &extract_root, &err)
        })?;

        extract_archive_or_copy(
            &package_path_owned,
            &extract_root,
            &cancel_token,
            &mut progress_cb,
        )?;
        emit_progress(
            &app_handle,
            gid,
            "extracting",
            Some(96.0),
            Some("Moving files…"),
        );
        normalize_into_final_dir(&extract_root, &target_dir_owned)?;

        let exe = game_exe_hint
            .as_ref()
            .and_then(|entry| {
                let candidate = target_dir_owned.join(entry);
                candidate
                    .exists()
                    .then(|| candidate.to_string_lossy().into_owned())
            })
            .or_else(|| {
                detect_windows_executable(&target_dir_owned)
                    .map(|path| path.to_string_lossy().into_owned())
            });
        Ok(exe)
    })
    .await
    .map_err(|err| format!("Extract task failed: {err}"))??;

    Ok(InstalledGame {
        remote_game_id: game.id,
        title: game.title.clone(),
        platform: game.platform.clone(),
        install_type: game.install_type.clone(),
        install_path: target_dir.to_string_lossy().into_owned(),
        game_exe,
        installed_at: current_timestamp(),
        summary: game.summary.clone(),
        genre: game.genre.clone(),
        release_year: game.release_year,
        cover_url: game.cover_url.clone(),
        hero_url: game.hero_url.clone(),
        developer: game.developer.clone(),
        publisher: game.publisher.clone(),
        game_mode: game.game_mode.clone(),
        series: game.series.clone(),
        franchise: game.franchise.clone(),
        game_engine: game.game_engine.clone(),
    })
}
