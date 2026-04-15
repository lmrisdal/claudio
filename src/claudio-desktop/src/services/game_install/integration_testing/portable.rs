use super::super::*;
use super::TestInstallController;

pub async fn install_portable_game<F, G>(
    game: RemoteGame,
    controller: &TestInstallController,
    mut on_progress: F,
    mut on_logged_out: G,
) -> Result<InstalledGame, String>
where
    F: FnMut(InstallProgress),
    G: FnMut() -> Result<(), String>,
{
    emit_progress_with_bytes_to(
        &mut on_progress,
        InstallProgress {
            game_id: game.id,
            status: "starting".to_string(),
            percent: Some(0.0),
            indeterminate: None,
            detail: Some("Preparing install".to_string()),
            bytes_downloaded: None,
            total_bytes: None,
        },
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

    if target_dir.exists() {
        return Err(format!(
            "Install target already exists: {}",
            target_dir.display()
        ));
    }

    let downloads_root = settings::resolve_download_root(&settings)?;
    let temp_root = install_download_root(&downloads_root, &game);
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
            progress_scale: 60.0,
        },
        game.id,
        game.title.as_str(),
        &temp_root,
        &controller.control,
        &mut on_progress,
        &mut on_logged_out,
    )
    .await?;

    emit_progress_with_bytes_to(
        &mut on_progress,
        InstallProgress {
            game_id: game.id,
            status: "extracting".to_string(),
            percent: Some(60.0),
            indeterminate: None,
            detail: Some("Extracting game".to_string()),
            bytes_downloaded: None,
            total_bytes: None,
        },
    );

    let (progress_tx, mut progress_rx) = tokio::sync::mpsc::unbounded_channel::<InstallProgress>();
    let gid = game.id;
    let game_exe_hint = game.game_exe.clone();
    let extract_root = target_dir.with_extension("extracting");
    let target_dir_owned = target_dir.clone();
    let package_path_owned = download_info.file_path.clone();
    let cancel_token = controller.control.cancel_token.clone();
    let progress_task = tokio::task::spawn_blocking(move || -> Result<Option<String>, String> {
        let mut progress_cb = |p: f64| {
            let _ = progress_tx.send(InstallProgress {
                game_id: gid,
                status: "extracting".to_string(),
                percent: Some(60.0 + (p * 35.0)),
                indeterminate: None,
                detail: Some("Extracting game…".to_string()),
                bytes_downloaded: None,
                total_bytes: None,
            });
        };

        if extract_root.exists() {
            fs::remove_dir_all(&extract_root).map_err(|err| err.to_string())?;
        }
        fs::create_dir_all(&extract_root).map_err(|err| err.to_string())?;

        extract_archive_or_copy(
            &package_path_owned,
            &extract_root,
            &cancel_token,
            &mut progress_cb,
        )?;
        let _ = progress_tx.send(InstallProgress {
            game_id: gid,
            status: "extracting".to_string(),
            percent: Some(96.0),
            indeterminate: None,
            detail: Some("Moving files…".to_string()),
            bytes_downloaded: None,
            total_bytes: None,
        });

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
    });

    while let Some(progress) = progress_rx.recv().await {
        on_progress(progress);
    }

    let game_exe = progress_task
        .await
        .map_err(|err| format!("Extract task failed: {err}"))??;

    if controller.control.is_cancelled() {
        let _ = fs::remove_dir_all(&temp_root);
        let _ = fs::remove_dir_all(&target_dir);
        return Err("Install cancelled.".to_string());
    }

    let installed = registry::upsert(InstalledGame {
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
    })?;

    let _ = fs::remove_dir_all(&temp_root);
    emit_progress_with_bytes_to(
        &mut on_progress,
        InstallProgress {
            game_id: game.id,
            status: "completed".to_string(),
            percent: Some(100.0),
            indeterminate: None,
            detail: Some("Install complete".to_string()),
            bytes_downloaded: None,
            total_bytes: None,
        },
    );
    Ok(installed)
}
