use super::*;

pub(super) async fn install_installer(
    app: &AppHandle,
    game: &RemoteGame,
    target_dir: &Path,
    package_path: &Path,
    control: &InstallControl,
) -> Result<InstalledGame, String> {
    if !cfg!(target_os = "windows") {
        return Err("Installer-based PC installs are only supported on Windows.".to_string());
    }

    emit_progress(
        app,
        game.id,
        "extracting",
        Some(60.0),
        Some("Extracting game"),
    );

    let app_handle = app.clone();
    let gid = game.id;
    let staging_root = package_path
        .parent()
        .map(PathBuf::from)
        .unwrap_or_else(|| target_dir.to_path_buf());
    let staging_dir = installer_staging_dir(&staging_root);
    let target_dir_owned = target_dir.to_path_buf();
    let package_path_owned = package_path.to_path_buf();
    let installer_exe_hint = game.installer_exe.clone();
    let game_exe_hint = game.game_exe.clone();
    let initial_run_as_administrator = game.run_as_administrator.unwrap_or(false);
    let initial_force_interactive = game.force_interactive.unwrap_or(false);
    let control = control.clone();

    let game_exe = tokio::task::spawn_blocking(move || -> Result<Option<String>, String> {
        let mut progress_cb = |p: f64| {
            emit_progress(
                &app_handle,
                gid,
                "extracting",
                Some(60.0 + (p * 25.0)),
                Some("Extracting game…"),
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
            let install_result = (|| -> Result<Option<String>, String> {
            extract_archive_or_copy(
                &package_path_owned,
                &staging_dir,
                &control.cancel_token,
                &mut progress_cb,
            )?;
            emit_progress(
                &app_handle,
                gid,
                "extracting",
                Some(86.0),
                Some("Extracting game…"),
            );

            let installer = resolve_installer_path(&staging_dir, installer_exe_hint.as_deref())?;
            let launch_kind = installer_launch_kind(&installer);
            let requests_elevation =
                launch_kind == InstallerLaunchKind::Exe && file_requests_elevation(&installer)?;
            if requests_elevation {
                log::info!(
                    "[installer {gid}] detected embedded elevation request in {}",
                    installer.display()
                );
            }
            let initial_attempt = installer_attempt_config(
                initial_force_interactive,
                initial_run_as_administrator,
                requests_elevation,
            );
            if initial_attempt.force_run_as_invoker {
                log::info!(
                    "[installer {gid}] trying non-admin launch with RunAsInvoker for {}",
                    installer.display()
                );
            }
            log::info!(
                "[installer {gid}] starting {} installer from {}",
                if initial_attempt.force_interactive {
                    "interactive"
                } else {
                    "silent"
                },
                installer.display()
            );

            run_installer_with_retries(
                initial_attempt,
                |attempt| {
                    let detail = if attempt.force_interactive {
                        "Installing… The installer may ask for administrator permission."
                    } else {
                        "Installing… The installer may ask for administrator permission. This may take a while…"
                    };
                    let install_status = if attempt.force_interactive {
                        "installing-interactive"
                    } else {
                        "installing"
                    };
                    emit_progress_indeterminate(
                        &app_handle,
                        gid,
                        install_status,
                        Some(87.0),
                        Some(detail),
                        true,
                    );

                    run_installer(
                        &installer,
                        &target_dir_owned,
                        attempt.force_interactive,
                        attempt.run_as_administrator,
                        attempt.force_run_as_invoker,
                        &control,
                    )
                },
                || {
                    log::info!("[installer {gid}] restarting interactively after forced stop");
                    cleanup_partial_install_dir(&target_dir_owned)?;
                    emit_progress_indeterminate(
                        &app_handle,
                        gid,
                        "stopping",
                        Some(87.0),
                        Some("Restarting installer in interactive mode…"),
                        true,
                    );
                    Ok(())
                },
                || {
                    log::warn!(
                        "[installer {gid}] installer still required administrator privileges after non-admin attempt"
                    );
                    if confirm_installer_elevation(&app_handle) {
                        log::info!(
                            "[installer {gid}] retrying installer launch as administrator after fallback prompt"
                        );
                        emit_progress_indeterminate(
                            &app_handle,
                            gid,
                            "stopping",
                            Some(87.0),
                            Some("Restarting installer as administrator…"),
                            true,
                        );
                        return true;
                    }

                    log::info!(
                        "[installer {gid}] user declined administrator prompt after non-admin attempt"
                    );
                    false
                },
            )?;
            emit_progress_indeterminate(
                &app_handle,
                gid,
                "installing",
                Some(97.0),
                Some("Applying patches…"),
                false,
            );
            let installer_dir = installer.parent().unwrap_or(&staging_dir);
            apply_scene_overrides(installer_dir, &target_dir_owned)?;

            let _ = cleanup_directory(&staging_dir, "installer staging directory");

            let exe = game_exe_hint
                .as_ref()
                .map(|entry| target_dir_owned.join(entry))
                .filter(|path| path.exists())
                .map(|path| path.to_string_lossy().into_owned());
            Ok(exe)
        })();

        match install_result {
            Ok(exe) => Ok(exe),
            Err(install_error) => {
                if let Err(cleanup_error) = cleanup_partial_install_dir(&target_dir_owned) {
                    return Err(format!("{install_error} Cleanup also failed: {cleanup_error}"));
                }

                Err(install_error)
            }
        }
    })
    .await
    .map_err(|err| format!("Install task failed: {err}"))??;

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
