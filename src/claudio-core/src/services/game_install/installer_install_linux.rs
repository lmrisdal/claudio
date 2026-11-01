use super::installer_arguments::installer_arguments;
use super::installer_detect::detect_installer_type;
use super::prefix_paths::prefix_install_directory;
use super::*;

#[cfg(target_os = "linux")]
pub(super) async fn install_installer_linux(
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
        Some("Extracting installer"),
    );

    let app_handle = app.clone();
    let gid = game.id;
    let staging_root = package_path
        .parent()
        .map(PathBuf::from)
        .unwrap_or_else(|| target_dir.to_path_buf());
    let staging_dir = installer_staging_dir(&staging_root);
    let package_path_owned = package_path.to_path_buf();
    let installer_exe_hint = game.installer_exe.clone();
    let game_exe_hint = game.game_exe.clone();
    let prefix = target_dir.to_path_buf();
    let install_directory = prefix_install_directory(&game.title);
    let proton_path =
        crate::services::linux_proton::selected_proton_path(game.proton_path.as_deref());
    let control_for_task = control.clone();
    let proton_for_task = proton_path.clone();

    let game_exe = tokio::task::spawn_blocking(move || -> Result<Option<String>, String> {
        let mut progress_cb = |p: f64| {
            emit_progress(
                &app_handle,
                gid,
                "extracting",
                Some(60.0 + (p * 25.0)),
                Some("Extracting installer..."),
            );
        };

        if staging_dir.exists()
            && let Err(error) = cleanup_directory(&staging_dir, "installer staging directory")
        {
            log::warn!(
                "[installer {gid}] failed to clean stale staging directory {}: {}",
                staging_dir.display(),
                error
            );
        }
        fs::create_dir_all(&staging_dir).map_err(|err| {
            log_io_failure("create installer staging directory", &staging_dir, &err);
            format_install_io_error("create the installer staging folder", &staging_dir, &err)
        })?;

        extract_archive_or_copy(
            &package_path_owned,
            &staging_dir,
            &control_for_task.cancel_token,
            &mut progress_cb,
        )?;

        let installer = resolve_installer_path(&staging_dir, installer_exe_hint.as_deref())?;
        emit_progress_indeterminate(
            &app_handle,
            gid,
            "installing-interactive",
            Some(88.0),
            Some("Running installer through Proton..."),
            true,
        );

        let args = installer_arguments(detect_installer_type(&installer), &install_directory, true);
        log::info!(
            "[installer {gid}] running {} with arguments {args:?}",
            installer.display()
        );
        crate::services::linux_umu::run_prefix_command_wait(
            &prefix,
            &proton_for_task,
            &installer,
            &args,
            || control_for_task.is_cancelled(),
        )?;
        let search_root = prefix.join("pfx").join("drive_c");

        let _ = cleanup_directory(&staging_dir, "installer staging directory");
        let exe = resolve_game_exe_hint(&search_root, &install_directory, game_exe_hint.as_deref());

        Ok(exe)
    })
    .await
    .map_err(|err| format!("Linux installer task failed: {err}"))??;

    Ok(InstalledGame {
        launch_options: Default::default(),
        remote_game_id: game.id,
        title: game.title.clone(),
        platform: game.platform.clone(),
        install_type: game.install_type.clone(),
        install_path: target_dir.to_string_lossy().into_owned(),
        game_exe,
        wine_prefix: Some(target_dir.to_string_lossy().into_owned()),
        proton_path: Some(proton_path),
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

pub(super) fn resolve_game_exe_hint(
    drive_c: &Path,
    install_directory: &str,
    hint: Option<&str>,
) -> Option<String> {
    let hint = hint?.replace('\\', "/");
    let destination = install_directory.strip_prefix(r"C:\")?.replace('\\', "/");
    [drive_c.join(&hint), drive_c.join(destination).join(&hint)]
        .into_iter()
        .find(|path| path.is_file())
        .map(|path| path.to_string_lossy().into_owned())
}
