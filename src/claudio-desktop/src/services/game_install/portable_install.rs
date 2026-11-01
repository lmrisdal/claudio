use super::*;

pub(super) async fn install_portable(
    app: &Host,
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

    #[cfg(target_os = "linux")]
    let umu_runtime = prepare_portable_umu_runtime(app, game, target_dir, control).await?;
    #[cfg(target_os = "linux")]
    let payload_dir = umu_runtime.payload_dir;
    #[cfg(not(target_os = "linux"))]
    let payload_dir = target_dir.to_path_buf();

    let app_handle = app.clone();
    let gid = game.id;
    let extract_root = target_dir.with_extension("extracting");
    let payload_dir_owned = payload_dir.clone();
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
        finalize_portable_payload(&extract_root, &payload_dir_owned, game_exe_hint.as_deref())
    })
    .await
    .map_err(|err| format!("Extract task failed: {err}"))??;

    #[cfg(target_os = "linux")]
    let (wine_prefix, proton_path) = (Some(umu_runtime.wine_prefix), Some(umu_runtime.proton_path));

    #[cfg(not(target_os = "linux"))]
    let (wine_prefix, proton_path) = (None, None);

    Ok(InstalledGame {
        launch_options: Default::default(),
        remote_game_id: game.id,
        title: game.title.clone(),
        platform: game.platform.clone(),
        install_type: game.install_type.clone(),
        install_path: target_dir.to_string_lossy().into_owned(),
        game_exe,
        wine_prefix,
        proton_path,
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

#[cfg(target_os = "linux")]
struct PreparedUmuPortableRuntime {
    payload_dir: PathBuf,
    wine_prefix: String,
    proton_path: String,
}

#[cfg(target_os = "linux")]
async fn prepare_portable_umu_runtime(
    app: &Host,
    game: &RemoteGame,
    target_dir: &Path,
    control: &InstallControl,
) -> Result<PreparedUmuPortableRuntime, String> {
    let prefix = target_dir.to_path_buf();
    let proton_path =
        crate::services::linux_proton::selected_proton_path(game.proton_path.as_deref());
    let control = control.clone();
    let prefix_for_task = prefix.clone();
    let proton_for_task = proton_path.clone();
    emit_progress_indeterminate(
        app,
        game.id,
        "preparing-prefix",
        Some(60.0),
        Some("Preparing Proton prefix..."),
        true,
    );
    tokio::task::spawn_blocking(move || {
        crate::services::linux_umu::prepare_prefix(&prefix_for_task, &proton_for_task, || {
            control.is_cancelled()
        })
    })
    .await
    .map_err(|err| format!("Prefix setup task failed: {err}"))??;

    let payload_dir = super::prefix_paths::prefix_payload_directory(&prefix, &game.title);
    fs::create_dir_all(&payload_dir).map_err(|err| {
        log_io_failure(
            "create portable game directory in UMU prefix",
            &payload_dir,
            &err,
        );
        format_install_io_error("create the portable game folder", &payload_dir, &err)
    })?;

    Ok(PreparedUmuPortableRuntime {
        payload_dir,
        wine_prefix: prefix.to_string_lossy().into_owned(),
        proton_path,
    })
}

pub(super) fn finalize_portable_payload(
    extract_root: &Path,
    payload_dir: &Path,
    game_exe_hint: Option<&str>,
) -> Result<Option<String>, String> {
    if payload_dir.exists() {
        move_visible_entries_into_dir(extract_root, payload_dir)?;
        fs::remove_dir_all(extract_root).map_err(|err| {
            log_io_failure("remove extraction staging root", &extract_root, &err);
            format_install_io_error("clean the extraction staging folder", &extract_root, &err)
        })?;
    } else {
        normalize_into_final_dir(extract_root, payload_dir)?;
    }

    let exe = game_exe_hint
        .and_then(|entry| {
            let candidate = payload_dir.join(entry);
            candidate
                .exists()
                .then(|| candidate.to_string_lossy().into_owned())
        })
        .or_else(|| {
            detect_windows_executable(payload_dir).map(|path| path.to_string_lossy().into_owned())
        });
    Ok(exe)
}
