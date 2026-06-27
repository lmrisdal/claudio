use super::*;

#[cfg(target_os = "linux")]
pub(super) async fn install_installer_linux(
    app: &AppHandle,
    game: &RemoteGame,
    target_dir: &Path,
    package_path: &Path,
    control: &InstallControl,
    allow_existing_runtime: bool,
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
    let runtime_backend = game.linux_runtime_backend.clone().ok_or_else(|| {
        "Choose either Bottles or UMU Launcher as the Linux runtime backend.".to_string()
    })?;
    let prefix = target_dir.to_path_buf();
    let bottle_name = crate::services::linux_bottles::default_bottle_name(game.id, &game.title);
    let proton_path = (runtime_backend == LinuxRuntimeBackend::Umu)
        .then(|| crate::services::linux_proton::selected_proton_path(game.proton_path.as_deref()));
    let control_for_task = control.clone();
    let proton_for_task = proton_path.clone();
    let bottle_for_task = bottle_name.clone();
    let runtime_for_task = runtime_backend.clone();

    let install_output =
        tokio::task::spawn_blocking(move || -> Result<(Option<String>, String), String> {
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
                Some(match runtime_for_task {
                    LinuxRuntimeBackend::Umu => "Running installer through Proton...",
                    LinuxRuntimeBackend::Bottles => "Running installer through Bottles...",
                }),
                true,
            );

            let search_root = match runtime_for_task {
                LinuxRuntimeBackend::Umu => {
                    let proton = proton_for_task
                        .as_deref()
                        .ok_or_else(|| "No Proton version was selected.".to_string())?;
                    crate::services::linux_umu::run_prefix_command_wait(
                        &prefix,
                        proton,
                        &installer,
                        &[],
                        || control_for_task.is_cancelled(),
                    )?;
                    prefix.join("pfx").join("drive_c")
                }
                LinuxRuntimeBackend::Bottles => {
                    let bottle_path = crate::services::linux_bottles::prepare_bottle(
                        &bottle_for_task,
                        allow_existing_runtime,
                        || control_for_task.is_cancelled(),
                    )?;
                    crate::services::linux_bottles::run_bottle_command_wait(
                        &bottle_for_task,
                        &installer,
                        &[],
                        || control_for_task.is_cancelled(),
                    )?;
                    bottle_path.join("drive_c")
                }
            };

            let _ = cleanup_directory(&staging_dir, "installer staging directory");
            let exe = game_exe_hint
                .as_ref()
                .map(|entry| search_root.join(entry))
                .filter(|path| path.exists())
                .or_else(|| detect_windows_executable(&search_root))
                .map(|path| path.to_string_lossy().into_owned());

            let install_path = match runtime_for_task {
                LinuxRuntimeBackend::Umu => prefix.to_string_lossy().into_owned(),
                LinuxRuntimeBackend::Bottles => search_root
                    .parent()
                    .unwrap_or(&search_root)
                    .to_string_lossy()
                    .into_owned(),
            };
            Ok((exe, install_path))
        })
        .await
        .map_err(|err| format!("Linux installer task failed: {err}"))??;

    let (game_exe, install_path) = install_output;
    let (wine_prefix, stored_bottle_name, stored_proton_path) = match runtime_backend {
        LinuxRuntimeBackend::Umu => (
            Some(target_dir.to_string_lossy().into_owned()),
            None,
            proton_path,
        ),
        LinuxRuntimeBackend::Bottles => (None, Some(bottle_name), None),
    };

    Ok(InstalledGame {
        remote_game_id: game.id,
        title: game.title.clone(),
        platform: game.platform.clone(),
        install_type: game.install_type.clone(),
        install_path,
        game_exe,
        wine_prefix,
        linux_runtime_backend: Some(runtime_backend),
        bottle_name: stored_bottle_name,
        proton_path: stored_proton_path,
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
