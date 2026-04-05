use crate::auth;
use crate::models::{InstallProgress, InstallType, InstalledGame, RemoteGame};
use crate::refresh_auth_state_ui;
use crate::registry;
use crate::settings;
use flate2::read::GzDecoder;
use futures_util::StreamExt;
use reqwest::header::{AUTHORIZATION, CONTENT_DISPOSITION, HeaderMap, HeaderName, HeaderValue};
use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::io;
#[cfg(target_os = "windows")]
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tar::Archive;
use tauri::{AppHandle, Emitter, State};
#[cfg(target_os = "windows")]
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use zip::read::ZipArchive;

pub struct InstallState {
    installs: Mutex<HashMap<i32, InstallControl>>,
}

impl Default for InstallState {
    fn default() -> Self {
        Self {
            installs: Mutex::new(HashMap::new()),
        }
    }
}

#[derive(Clone)]
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
struct InstallControl {
    cancel_token: Arc<AtomicBool>,
    restart_interactive: Arc<AtomicBool>,
    tracked_installer: Arc<Mutex<TrackedInstallerState>>,
}

#[derive(Default)]
struct TrackedInstallerState {
    pids: BTreeSet<u32>,
    exe_name: Option<String>,
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
impl InstallControl {
    fn new() -> Self {
        Self {
            cancel_token: Arc::new(AtomicBool::new(false)),
            restart_interactive: Arc::new(AtomicBool::new(false)),
            tracked_installer: Arc::new(Mutex::new(TrackedInstallerState::default())),
        }
    }

    fn is_cancelled(&self) -> bool {
        self.cancel_token.load(Ordering::Relaxed)
    }

    fn set_cancelled(&self, value: bool) {
        self.cancel_token.store(value, Ordering::Relaxed);
    }

    fn request_restart_interactive(&self) {
        self.restart_interactive.store(true, Ordering::Relaxed);
        self.cancel_token.store(true, Ordering::Relaxed);
    }

    fn take_restart_interactive_request(&self) -> bool {
        self.restart_interactive.swap(false, Ordering::Relaxed)
    }

    fn set_installer_process(&self, pid: u32, exe_name: Option<String>) {
        if let Ok(mut tracked) = self.tracked_installer.lock() {
            tracked.pids.clear();
            if pid != 0 {
                tracked.pids.insert(pid);
            }
            tracked.exe_name = exe_name;
        }
    }

    fn refresh_tracked_processes(&self) {
        #[cfg(target_os = "windows")]
        if let Ok(mut tracked) = self.tracked_installer.lock() {
            let current: Vec<u32> = tracked.pids.iter().copied().collect();
            tracked.pids = crate::windows_integration::collect_tracked_processes(
                &current,
                tracked.exe_name.as_deref(),
            )
            .into_iter()
            .collect();
        }
    }

    fn clear_installer_processes(&self) {
        if let Ok(mut tracked) = self.tracked_installer.lock() {
            tracked.pids.clear();
            tracked.exe_name = None;
        }
    }

    fn installer_snapshot(&self) -> (Vec<u32>, Option<String>) {
        self.tracked_installer
            .lock()
            .map(|tracked| {
                (
                    tracked.pids.iter().copied().collect(),
                    tracked.exe_name.clone(),
                )
            })
            .unwrap_or_else(|_| (Vec::new(), None))
    }
}

impl InstallState {
    fn start(&self, game_id: i32) -> Result<InstallControl, String> {
        let mut installs = self
            .installs
            .lock()
            .map_err(|_| "Install state lock poisoned.".to_string())?;
        if installs.contains_key(&game_id) {
            return Err("This game is already being installed.".to_string());
        }
        let control = InstallControl::new();
        installs.insert(game_id, control.clone());
        Ok(control)
    }

    fn finish(&self, game_id: i32) {
        if let Ok(mut installs) = self.installs.lock() {
            installs.remove(&game_id);
        }
    }

    pub fn cancel(&self, app: &AppHandle, game_id: i32) -> Result<(), String> {
        let installs = self
            .installs
            .lock()
            .map_err(|_| "Install state lock poisoned.".to_string())?;
        if let Some(control) = installs.get(&game_id) {
            log::info!("[installer {game_id}] stop requested");
            control.set_cancelled(true);
            emit_progress_indeterminate(
                app,
                game_id,
                "stopping",
                None,
                Some("Stopping installation..."),
                true,
            );
            terminate_external_installer(control);
            Ok(())
        } else {
            Err("No active install for this game.".to_string())
        }
    }

    pub fn restart_interactive(&self, app: &AppHandle, game_id: i32) -> Result<(), String> {
        let installs = self
            .installs
            .lock()
            .map_err(|_| "Install state lock poisoned.".to_string())?;
        if let Some(control) = installs.get(&game_id) {
            log::info!("[installer {game_id}] restart interactive requested");
            control.request_restart_interactive();
            emit_progress_indeterminate(
                app,
                game_id,
                "stopping",
                None,
                Some("Stopping installation to restart interactively..."),
                true,
            );
            terminate_external_installer(control);
            Ok(())
        } else {
            Err("No active install for this game.".to_string())
        }
    }
}

#[cfg(target_os = "windows")]
fn terminate_external_installer(control: &InstallControl) {
    control.refresh_tracked_processes();
    let (pids, exe_name) = control.installer_snapshot();
    log::info!(
        "[installer] force terminating tracked processes {:?} (exe_name={:?})",
        pids,
        exe_name
    );
    let _ = crate::windows_integration::terminate_tracked_processes(&pids, exe_name.as_deref());
}

#[cfg(not(target_os = "windows"))]
fn terminate_external_installer(_control: &InstallControl) {}

pub async fn install_game(
    app: AppHandle,
    state: State<'_, InstallState>,
    game: RemoteGame,
) -> Result<InstalledGame, String> {
    let control = state.start(game.id)?;
    let game_id = game.id;
    let result = install_game_inner(&app, game, &control).await;
    state.finish(game_id);
    if control.is_cancelled() {
        return Err("Install cancelled.".to_string());
    }
    result
}

/// Returns the full suggested install path for a game title without creating any
/// directories. Used by the frontend to pre-populate the install dialog.
pub fn resolve_install_path(game_title: &str) -> String {
    let settings = settings::load();
    let root = settings::default_install_root(&settings);
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

pub fn uninstall_game(remote_game_id: i32, delete_files: bool) -> Result<(), String> {
    let removed = registry::remove(remote_game_id)?;

    #[cfg(target_os = "windows")]
    if let Some(game) = &removed {
        crate::windows_integration::deregister(game);
    }

    if delete_files {
        if let Some(installed) = removed {
            let path = PathBuf::from(&installed.install_path);
            if path.exists() {
                fs::remove_dir_all(&path)
                    .map_err(|err| format!("Failed to delete install folder: {err}"))?;
            }
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

    open_path(&path)
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
            // Return paths relative to the install root so they're shorter in the UI
            path.strip_prefix(&root)
                .ok()
                .map(|rel| rel.to_string_lossy().into_owned())
        })
        .collect())
}

async fn install_game_inner(
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

    let temp_root = settings::data_dir()
        .join("tmp")
        .join(format!("install-{}", game.id));
    if temp_root.exists() {
        fs::remove_dir_all(&temp_root).map_err(|err| err.to_string())?;
    }
    fs::create_dir_all(&temp_root).map_err(|err| err.to_string())?;

    let download_info = download_package(
        app,
        &DownloadOptions {
            settings: &settings,
            server_url: &server_url,
            custom_headers: &settings.custom_headers,
            speed_limit_kbs: settings.download_speed_limit_kbs,
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
            install_portable(app, &game, &target_dir, &download_info.file_path).await
        }
        InstallType::Installer => {
            install_installer(app, &game, &target_dir, &download_info.file_path, control).await
        }
    };

    if let Err(ref err) = install_result {
        log::error!("Install failed for '{}': {}", game.title, err);
        let _ = fs::remove_dir_all(&temp_root);
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

struct DownloadInfo {
    file_path: PathBuf,
}

struct DownloadOptions<'a> {
    settings: &'a settings::DesktopSettings,
    server_url: &'a str,
    custom_headers: &'a HashMap<String, String>,
    speed_limit_kbs: Option<f64>,
}

async fn download_package(
    app: &AppHandle,
    opts: &DownloadOptions<'_>,
    game_id: i32,
    game_title: &str,
    temp_root: &Path,
    control: &InstallControl,
) -> Result<DownloadInfo, String> {
    let DownloadOptions {
        settings,
        server_url,
        custom_headers,
        speed_limit_kbs,
    } = opts;
    let client = reqwest::Client::new();
    emit_progress(
        app,
        game_id,
        "requestingTicket",
        Some(0.0),
        Some("Requesting download"),
    );

    let auth_headers = authenticated_headers(app, settings, custom_headers).await?;
    let mut ticket_response = client
        .post(format!("{server_url}/api/games/{game_id}/download-ticket"))
        .headers(auth_headers.clone())
        .send()
        .await
        .map_err(|err| err.to_string())?;

    if ticket_response.status() == reqwest::StatusCode::UNAUTHORIZED {
        if let Some(refreshed_headers) = refreshed_headers(app, settings, custom_headers).await? {
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
        .ok_or_else(|| "Download ticket response was missing the ticket.".to_string())?;

    let mut response = client
        .get(format!(
            "{server_url}/api/games/{game_id}/download?ticket={ticket}"
        ))
        .headers(auth_headers)
        .send()
        .await
        .map_err(|err| err.to_string())?;

    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        if let Some(refreshed_headers) = refreshed_headers(app, settings, custom_headers).await? {
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

    if !response.status().is_success() {
        return Err(format!(
            "Failed to download game package: {}",
            response.status()
        ));
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

    // Dedicated writer thread: receives chunks via channel and writes them with
    // a 4 MB BufWriter so we get one spawn_blocking thread for the entire download
    // instead of one per chunk (which was saturating the tokio blocking pool).
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
                .map(|total| (downloaded as f64 / total as f64) * 60.0);
            emit_progress_with_bytes(
                app,
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
    })
}

async fn install_portable(
    app: &AppHandle,
    game: &RemoteGame,
    target_dir: &Path,
    package_path: &Path,
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
            fs::remove_dir_all(&extract_root).map_err(|err| err.to_string())?;
        }
        fs::create_dir_all(&extract_root).map_err(|err| err.to_string())?;

        extract_archive_or_copy(&package_path_owned, &extract_root, &mut progress_cb)?;
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

async fn install_installer(
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
    let staging_dir = target_dir.with_extension("installing");
    let target_dir_owned = target_dir.to_path_buf();
    let package_path_owned = package_path.to_path_buf();
    let installer_exe_hint = game.installer_exe.clone();
    let game_exe_hint = game.game_exe.clone();
    let initial_run_as_administrator = game.run_as_administrator.unwrap_or(false);
    let initial_force_interactive = game.force_interactive.unwrap_or(false);
    let control = control.clone();

    let game_exe = tokio::task::spawn_blocking(move || -> Result<Option<String>, String> {
        let mut run_as_administrator = initial_run_as_administrator;
        let mut force_interactive = initial_force_interactive;
        let mut progress_cb = |p: f64| {
            emit_progress(
                &app_handle,
                gid,
                "extracting",
                Some(60.0 + (p * 25.0)),
                Some("Extracting game…"),
            );
        };

        if staging_dir.exists() {
            cleanup_directory(&staging_dir, "installer staging directory")?;
        }
        fs::create_dir_all(&staging_dir).map_err(|err| err.to_string())?;
        let install_result = (|| -> Result<Option<String>, String> {
            extract_archive_or_copy(&package_path_owned, &staging_dir, &mut progress_cb)?;
            emit_progress(
                &app_handle,
                gid,
                "extracting",
                Some(86.0),
                Some("Extracting game…"),
            );

            let installer = resolve_installer_path(&staging_dir, installer_exe_hint.as_deref())?;
            let launch_kind = installer_launch_kind(&installer);
            let requests_elevation = launch_kind == InstallerLaunchKind::Exe
                && file_requests_elevation(&installer)?;
            let non_admin_installer = if run_as_administrator {
                None
            } else {
                match prepare_non_admin_installer_copy(&installer, launch_kind, requests_elevation) {
                    Ok(path) => path,
                    Err(error) => {
                        log::warn!(
                            "[installer {gid}] failed to prepare non-admin installer copy for {}: {error}",
                            installer.display()
                        );
                        if confirm_installer_elevation(&app_handle) {
                            run_as_administrator = true;
                            None
                        } else {
                            return Err("Install cancelled.".to_string());
                        }
                    }
                }
            };
            log::info!(
                "[installer {gid}] starting {} installer from {}",
                if force_interactive {
                    "interactive"
                } else {
                    "silent"
                },
                installer.display()
            );

            loop {
                let active_installer = if run_as_administrator {
                    &installer
                } else {
                    non_admin_installer.as_deref().unwrap_or(&installer)
                };
                let detail = if force_interactive {
                    if run_as_administrator {
                        "Running installer interactively as administrator…"
                    } else {
                        "Running installer interactively…"
                    }
                } else if run_as_administrator {
                    "Running installer silently as administrator. This may take a while…"
                } else {
                    "Running installer silently. This may take a while…"
                };
                let install_status = if force_interactive {
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
                match run_installer(
                    active_installer,
                    &target_dir_owned,
                    force_interactive,
                    run_as_administrator,
                    &control,
                ) {
                    Ok(()) => break,
                    Err(RunInstallerError::RestartInteractiveRequested) => {
                        log::info!("[installer {gid}] restarting interactively after forced stop");
                        cleanup_partial_install_dir(&target_dir_owned)?;
                        force_interactive = true;
                        emit_progress_indeterminate(
                            &app_handle,
                            gid,
                            "stopping",
                            Some(87.0),
                            Some("Restarting installer in interactive mode…"),
                            true,
                        );
                    }
                    Err(RunInstallerError::Cancelled) => {
                        log::info!("[installer {gid}] install cancelled during installer phase");
                        return Err("Install cancelled.".to_string());
                    }
                    Err(RunInstallerError::RequiresAdministrator) => {
                        if confirm_installer_elevation(&app_handle) {
                            run_as_administrator = true;
                            emit_progress_indeterminate(
                                &app_handle,
                                gid,
                                "stopping",
                                Some(87.0),
                                Some("Restarting installer as administrator…"),
                                true,
                            );
                            continue;
                        }

                        return Err("Install cancelled.".to_string());
                    }
                    Err(RunInstallerError::Failed(message)) => return Err(message),
                }
            }
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
                if let Err(cleanup_error) =
                    cleanup_failed_installer_state(&target_dir_owned, &staging_dir)
                {
                    return Err(format!(
                        "{install_error} Cleanup also failed: {cleanup_error}"
                    ));
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

fn build_headers(
    custom_headers: &HashMap<String, String>,
    token: Option<&str>,
) -> Result<HeaderMap, String> {
    let mut headers = HeaderMap::new();
    for (name, value) in custom_headers {
        if settings::is_forbidden_custom_header(name) {
            continue;
        }

        let header_name = HeaderName::from_bytes(name.as_bytes()).map_err(|err| err.to_string())?;
        let header_value = HeaderValue::from_str(value).map_err(|err| err.to_string())?;
        headers.insert(header_name, header_value);
    }

    if let Some(token) = token {
        let auth_value =
            HeaderValue::from_str(&format!("Bearer {token}")).map_err(|err| err.to_string())?;
        headers.insert(AUTHORIZATION, auth_value);
    }

    Ok(headers)
}

async fn authenticated_headers(
    app: &AppHandle,
    settings: &settings::DesktopSettings,
    custom_headers: &HashMap<String, String>,
) -> Result<HeaderMap, String> {
    let Some(access_token) = auth::access_token_for_request(settings).await? else {
        let _ = refresh_auth_state_ui(app, false);
        return Err("You need to sign in before installing games.".to_string());
    };

    build_headers(custom_headers, Some(&access_token))
}

async fn refreshed_headers(
    app: &AppHandle,
    settings: &settings::DesktopSettings,
    custom_headers: &HashMap<String, String>,
) -> Result<Option<HeaderMap>, String> {
    let Some(access_token) = auth::refresh_access_token(settings).await? else {
        let _ = refresh_auth_state_ui(app, false);
        return Ok(None);
    };

    build_headers(custom_headers, Some(&access_token)).map(Some)
}

fn build_install_dir(install_root: &Path, game: &RemoteGame) -> PathBuf {
    install_root.join(sanitize_segment(&game.title))
}

fn infer_filename(headers: &HeaderMap) -> Option<String> {
    let disposition = headers.get(CONTENT_DISPOSITION)?.to_str().ok()?;

    disposition.split(';').map(str::trim).find_map(|part| {
        if let Some(value) = part.strip_prefix("filename*=UTF-8''") {
            return Some(value.to_string());
        }

        part.strip_prefix("filename=")
            .map(|value| value.trim_matches('"').to_string())
    })
}

fn extract_archive_or_copy<F>(
    source: &Path,
    destination: &Path,
    mut progress: F,
) -> Result<(), String>
where
    F: FnMut(f64),
{
    let lower = source.to_string_lossy().to_lowercase();

    if lower.ends_with(".zip") {
        extract_zip(source, destination, progress)
    } else if lower.ends_with(".tar.gz") || lower.ends_with(".tgz") {
        extract_targz(source, destination, progress)
    } else if lower.ends_with(".tar") {
        extract_tar(source, destination, progress)
    } else {
        fs::create_dir_all(destination).map_err(|err| err.to_string())?;
        let target = destination.join(
            source
                .file_name()
                .ok_or_else(|| "Downloaded package had no file name.".to_string())?,
        );
        fs::copy(source, target).map_err(|err| err.to_string())?;
        progress(1.0);
        Ok(())
    }
}

fn extract_zip<F>(source: &Path, destination: &Path, mut progress: F) -> Result<(), String>
where
    F: FnMut(f64),
{
    fs::create_dir_all(destination).map_err(|err| err.to_string())?;
    let file = fs::File::open(source).map_err(|err| err.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|err| err.to_string())?;

    let total = archive.len();
    if total == 0 {
        progress(1.0);
        return Ok(());
    }

    let mut last_report = std::time::Instant::now();
    for index in 0..total {
        let mut entry = archive.by_index(index).map_err(|err| err.to_string())?;
        let Some(path) = entry.enclosed_name().map(|path| destination.join(path)) else {
            continue;
        };

        if entry.is_dir() {
            fs::create_dir_all(&path).map_err(|err| err.to_string())?;
            continue;
        }

        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }

        let mut out = fs::File::create(&path).map_err(|err| err.to_string())?;
        io::copy(&mut entry, &mut out).map_err(|err| err.to_string())?;

        let now = std::time::Instant::now();
        if now.duration_since(last_report).as_millis() > 100 {
            progress(index as f64 / total as f64);
            last_report = now;
        }
    }

    progress(1.0);
    Ok(())
}

struct ProgressReader<R, F> {
    inner: R,
    callback: F,
    bytes_read: u64,
    total_bytes: u64,
    last_reported: std::time::Instant,
}

impl<R: io::Read, F: FnMut(f64)> io::Read for ProgressReader<R, F> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let n = self.inner.read(buf)?;
        self.bytes_read += n as u64;
        let now = std::time::Instant::now();
        if now.duration_since(self.last_reported).as_millis() > 100 {
            if self.total_bytes > 0 {
                (self.callback)(self.bytes_read as f64 / self.total_bytes as f64);
            }
            self.last_reported = now;
        }
        Ok(n)
    }
}

fn extract_tar<F>(source: &Path, destination: &Path, mut progress: F) -> Result<(), String>
where
    F: FnMut(f64),
{
    fs::create_dir_all(destination).map_err(|err| err.to_string())?;
    let file = fs::File::open(source).map_err(|err| err.to_string())?;
    let total_bytes = file.metadata().map(|m| m.len()).unwrap_or(0);

    let reader = ProgressReader {
        inner: file,
        callback: &mut progress,
        bytes_read: 0,
        total_bytes,
        last_reported: std::time::Instant::now(),
    };

    let mut archive = Archive::new(reader);
    archive.unpack(destination).map_err(|err| err.to_string())?;
    progress(1.0);
    Ok(())
}

fn extract_targz<F>(source: &Path, destination: &Path, mut progress: F) -> Result<(), String>
where
    F: FnMut(f64),
{
    fs::create_dir_all(destination).map_err(|err| err.to_string())?;
    let file = fs::File::open(source).map_err(|err| err.to_string())?;
    let total_bytes = file.metadata().map(|m| m.len()).unwrap_or(0);

    let reader = ProgressReader {
        inner: file,
        callback: &mut progress,
        bytes_read: 0,
        total_bytes,
        last_reported: std::time::Instant::now(),
    };

    let decoder = GzDecoder::new(reader);
    let mut archive = Archive::new(decoder);
    archive.unpack(destination).map_err(|err| err.to_string())?;
    progress(1.0);
    Ok(())
}

fn normalize_into_final_dir(staging_root: &Path, final_dir: &Path) -> Result<(), String> {
    let entries = visible_entries(staging_root)?;

    if entries.len() == 1 && entries[0].is_dir() {
        fs::rename(&entries[0], final_dir).map_err(|err| err.to_string())?;
        fs::remove_dir_all(staging_root).map_err(|err| err.to_string())?;
        return Ok(());
    }

    fs::create_dir_all(final_dir).map_err(|err| err.to_string())?;
    for entry in entries {
        let target = final_dir.join(
            entry
                .file_name()
                .ok_or_else(|| "Extracted entry was missing a file name.".to_string())?,
        );
        fs::rename(&entry, &target).map_err(|err| err.to_string())?;
    }

    fs::remove_dir_all(staging_root).map_err(|err| err.to_string())
}

fn visible_entries(root: &Path) -> Result<Vec<PathBuf>, String> {
    let mut entries = Vec::new();
    for entry in fs::read_dir(root).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        let path = entry.path();
        let hidden = path
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| name == "__MACOSX" || name == ".DS_Store")
            .unwrap_or(false);
        if !hidden {
            entries.push(path);
        }
    }
    Ok(entries)
}

const SCENE_GROUP_FOLDERS: &[&str] = &[
    "SKIDROW",
    "CODEX",
    "CPY",
    "PLAZA",
    "RELOADED",
    "RUNE",
    "EMPRESS",
    "VOKSI",
    "FLT",
    "BAT",
    "PROPHET",
    "DARKSIDERS",
    "DODI",
    "HOODLUM",
    "RAZOR1911",
    "FAIRLIGHT",
    "voices38",
];

/// Scans `source_dir` for known scene group subdirectories (SKIDROW, CODEX, etc.).
/// For each found, copies its contents into `target_dir` (overwriting existing files),
/// then removes the scene group subdirectory from `source_dir`.
fn apply_scene_overrides(source_dir: &Path, target_dir: &Path) -> Result<(), String> {
    let entries = match fs::read_dir(source_dir) {
        Ok(e) => e,
        Err(_) => return Ok(()),
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default();
        if SCENE_GROUP_FOLDERS
            .iter()
            .any(|g| g.eq_ignore_ascii_case(name))
        {
            log::info!(
                "Applying scene group overrides from '{}' to {}",
                name,
                target_dir.display()
            );
            copy_dir_contents(&path, target_dir)?;
        }
    }
    Ok(())
}

fn copy_dir_contents(src: &Path, dst: &Path) -> Result<(), String> {
    for entry in fs::read_dir(src).map_err(|e| e.to_string())?.flatten() {
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if src_path.is_dir() {
            fs::create_dir_all(&dst_path).map_err(|e| e.to_string())?;
            copy_dir_contents(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

pub(crate) fn sanitize_segment(value: &str) -> String {
    let sanitized: String = value
        .chars()
        .map(|ch| match ch {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => ch,
        })
        .collect();

    let trimmed = sanitized.trim();
    if trimmed.is_empty() {
        "game".to_string()
    } else {
        trimmed.to_string()
    }
}

fn resolve_installer_path(root: &Path, installer_hint: Option<&str>) -> Result<PathBuf, String> {
    if let Some(hint) = installer_hint {
        let hinted = root.join(hint);
        if hinted.exists() {
            return Ok(hinted);
        }
    }

    detect_installer(root)
        .ok_or_else(|| "Could not find an installer executable in the extracted files.".to_string())
}

fn detect_installer(root: &Path) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    collect_matching_files(root, &mut candidates, |path| {
        let Some(extension) = path.extension().and_then(|ext| ext.to_str()) else {
            return false;
        };

        if !extension.eq_ignore_ascii_case("exe") && !extension.eq_ignore_ascii_case("msi") {
            return false;
        }

        let stem = path
            .file_stem()
            .and_then(|name| name.to_str())
            .unwrap_or_default();
        stem.eq_ignore_ascii_case("setup") || stem.eq_ignore_ascii_case("install")
    });

    candidates.sort();
    candidates.into_iter().next()
}

fn detect_windows_executable(root: &Path) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    collect_matching_files(root, &mut candidates, |path| {
        path.extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.eq_ignore_ascii_case("exe"))
            .unwrap_or(false)
    });

    candidates.sort();
    candidates.into_iter().next()
}

fn collect_matching_files<F>(root: &Path, matches: &mut Vec<PathBuf>, predicate: F)
where
    F: Copy + Fn(&Path) -> bool,
{
    if let Ok(entries) = fs::read_dir(root) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                collect_matching_files(&path, matches, predicate);
            } else if predicate(&path) {
                matches.push(path);
            }
        }
    }
}

#[cfg(target_os = "windows")]
enum InstallerType {
    Msi,
    GogInnoSetup,
    InnoSetup,
    Nsis,
    Unknown,
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
#[derive(Clone, Copy, PartialEq, Eq)]
enum InstallerLaunchKind {
    Exe,
    Msi,
    Unknown,
}

#[cfg(target_os = "windows")]
fn detect_installer_type(path: &Path) -> InstallerType {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or_default();
    if ext.eq_ignore_ascii_case("msi") {
        return InstallerType::Msi;
    }
    // Scan the first 2 MB for known installer signatures
    if let Ok(mut file) = fs::File::open(path) {
        use std::io::Read;
        let mut buf = vec![0u8; 2 * 1024 * 1024];
        let n = file.read(&mut buf).unwrap_or(0);
        let slice = &buf[..n];
        let is_inno = slice.windows(10).any(|w| w == b"Inno Setup");
        let is_gog = slice.windows(7).any(|w| w == b"GOG.com");
        if is_inno && is_gog {
            return InstallerType::GogInnoSetup;
        }
        if is_inno {
            return InstallerType::InnoSetup;
        }
        if slice.windows(8).any(|w| w == b"Nullsoft") {
            return InstallerType::Nsis;
        }
    }
    InstallerType::Unknown
}

#[cfg(target_os = "windows")]
fn installer_launch_kind(path: &Path) -> InstallerLaunchKind {
    match path.extension().and_then(|ext| ext.to_str()) {
        Some(ext) if ext.eq_ignore_ascii_case("exe") => InstallerLaunchKind::Exe,
        Some(ext) if ext.eq_ignore_ascii_case("msi") => InstallerLaunchKind::Msi,
        _ => InstallerLaunchKind::Unknown,
    }
}

#[cfg(not(target_os = "windows"))]
fn installer_launch_kind(_path: &Path) -> InstallerLaunchKind {
    InstallerLaunchKind::Unknown
}

#[cfg(target_os = "windows")]
fn file_requests_elevation(path: &Path) -> Result<bool, String> {
    let mut file = fs::File::open(path).map_err(|error| error.to_string())?;
    stream_requests_elevation(&mut file)
}

#[cfg(target_os = "windows")]
fn stream_requests_elevation(reader: &mut impl Read) -> Result<bool, String> {
    const BUFFER_SIZE: usize = 8192;
    let patterns = [
        b"requireAdministrator".as_slice(),
        b"highestAvailable".as_slice(),
        b"r\0e\0q\0u\0i\0r\0e\0A\0d\0m\0i\0n\0i\0s\0t\0r\0a\0t\0o\0r\0".as_slice(),
        b"h\0i\0g\0h\0e\0s\0t\0A\0v\0a\0i\0l\0a\0b\0l\0e\0".as_slice(),
    ];
    let overlap = patterns.iter().map(|pattern| pattern.len()).max().unwrap_or(0);
    let mut buffer = vec![0u8; BUFFER_SIZE + overlap];
    let mut carried = 0usize;

    loop {
        let read = reader
            .read(&mut buffer[carried..])
            .map_err(|error| error.to_string())?;
        if read == 0 {
            return Ok(false);
        }

        let total = carried + read;
        for pattern in patterns {
            if buffer[..total].windows(pattern.len()).any(|window| window == pattern) {
                return Ok(true);
            }
        }

        carried = overlap.min(total);
        if carried > 0 {
            buffer.copy_within(total - carried..total, 0);
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn file_requests_elevation(_path: &Path) -> Result<bool, String> {
    Ok(false)
}

#[cfg(target_os = "windows")]
fn prepare_non_admin_installer_copy(
    path: &Path,
    launch_kind: InstallerLaunchKind,
    requests_elevation: bool,
) -> Result<Option<PathBuf>, String> {
    if launch_kind != InstallerLaunchKind::Exe || !requests_elevation {
        return Ok(None);
    }

    let copy_path = non_admin_copy_path(path);
    fs::copy(path, &copy_path).map_err(|error| {
        format!(
            "Failed to copy installer for non-admin launch from {} to {}: {error}",
            path.display(),
            copy_path.display()
        )
    })?;

    patch_manifest_as_invoker(&copy_path)?;
    Ok(Some(copy_path))
}

#[cfg(not(target_os = "windows"))]
fn prepare_non_admin_installer_copy(
    _path: &Path,
    _launch_kind: InstallerLaunchKind,
    _requests_elevation: bool,
) -> Result<Option<PathBuf>, String> {
    Ok(None)
}

#[cfg(target_os = "windows")]
fn non_admin_copy_path(path: &Path) -> PathBuf {
    let stem = path.file_stem().and_then(|value| value.to_str()).unwrap_or("setup");
    let extension = path.extension().and_then(|value| value.to_str()).unwrap_or("exe");
    path.with_file_name(format!("{stem}.claudio-nonadmin.{extension}"))
}

#[cfg(target_os = "windows")]
fn confirm_installer_elevation(app: &AppHandle) -> bool {
    app.dialog()
        .message("This installer requires administrator privileges. Continue?")
        .title("Administrator Privileges Required")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Continue".to_string(),
            "Cancel".to_string(),
        ))
        .blocking_show()
}

#[cfg(not(target_os = "windows"))]
fn confirm_installer_elevation(_app: &AppHandle) -> bool {
    false
}

#[cfg(target_os = "windows")]
fn patch_manifest_as_invoker(path: &Path) -> Result<(), String> {
    use std::ffi::OsStr;
    use std::iter;
    use std::os::windows::ffi::OsStrExt;
    use windows::Win32::Foundation::{BOOL, FreeLibrary, HANDLE, HMODULE};
    use windows::Win32::System::LibraryLoader::{
        BeginUpdateResourceW, EndUpdateResourceW, EnumResourceLanguagesW, EnumResourceNamesW,
        LOAD_LIBRARY_AS_DATAFILE, LoadLibraryExW, UpdateResourceW,
    };
    use windows::core::PCWSTR;

    #[derive(Clone)]
    struct ManifestResource {
        name: usize,
        languages: Vec<u16>,
    }

    unsafe extern "system" fn enum_manifest_names(
        _module: HMODULE,
        _resource_type: PCWSTR,
        name: PCWSTR,
        param: isize,
    ) -> BOOL {
        let names = unsafe { &mut *(param as *mut Vec<usize>) };
        names.push(name.0 as usize);
        BOOL(1)
    }

    unsafe extern "system" fn enum_manifest_languages(
        _module: HMODULE,
        _resource_type: PCWSTR,
        _name: PCWSTR,
        language: u16,
        param: isize,
    ) -> BOOL {
        let languages = unsafe { &mut *(param as *mut Vec<u16>) };
        languages.push(language);
        BOOL(1)
    }

    fn wide(value: &OsStr) -> Vec<u16> {
        value.encode_wide().chain(iter::once(0)).collect()
    }

    fn make_int_resource(id: u16) -> PCWSTR {
        PCWSTR(id as usize as *const u16)
    }

    let manifest_bytes = br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
    <security>
      <requestedPrivileges>
        <requestedExecutionLevel level="asInvoker" uiAccess="false"/>
      </requestedPrivileges>
    </security>
  </trustInfo>
</assembly>
"#;
    let wide_path = wide(path.as_os_str());
    let manifest_type = make_int_resource(24);

    let module = unsafe {
        LoadLibraryExW(
            PCWSTR(wide_path.as_ptr()),
            HANDLE::default(),
            LOAD_LIBRARY_AS_DATAFILE,
        )
        .map_err(|error| error.to_string())?
    };

    let manifest_resources = (|| -> Result<Vec<ManifestResource>, String> {
        let mut names = Vec::new();
        let names_ok = unsafe {
            EnumResourceNamesW(
                module,
                manifest_type,
                Some(enum_manifest_names),
                (&mut names as *mut Vec<usize>) as isize,
            )
        };
        if !names_ok.as_bool() {
            return Err(windows::core::Error::from_win32().to_string());
        }

        let mut resources = Vec::new();
        for name in names {
            let mut languages = Vec::new();
            unsafe {
                EnumResourceLanguagesW(
                    module,
                    manifest_type,
                    PCWSTR(name as *const u16),
                    Some(enum_manifest_languages),
                    (&mut languages as *mut Vec<u16>) as isize,
                )
                .map_err(|error| error.to_string())?;
            }
            if languages.is_empty() {
                languages.push(0);
            }
            resources.push(ManifestResource { name, languages });
        }

        if resources.is_empty() {
            return Err("Installer manifest resource not found in copied executable.".to_string());
        }

        Ok(resources)
    })();

    unsafe {
        FreeLibrary(module).map_err(|error| error.to_string())?;
    }

    let manifest_resources = manifest_resources?;
    let update_handle = unsafe {
        BeginUpdateResourceW(PCWSTR(wide_path.as_ptr()), false).map_err(|error| error.to_string())?
    };

    let update_result = (|| -> Result<(), String> {
        for resource in manifest_resources {
            for language in resource.languages {
                unsafe {
                    UpdateResourceW(
                        update_handle,
                        manifest_type,
                        PCWSTR(resource.name as *const u16),
                        language,
                        Some(manifest_bytes.as_ptr().cast()),
                        manifest_bytes.len() as u32,
                    )
                    .map_err(|error| error.to_string())?;
                }
            }
        }

        Ok(())
    })();

    match update_result {
        Ok(()) => unsafe {
            EndUpdateResourceW(update_handle, false).map_err(|error| error.to_string())
        },
        Err(error) => {
            let _ = unsafe { EndUpdateResourceW(update_handle, true) };
            Err(error)
        }
    }
}

#[cfg(target_os = "windows")]
fn run_installer(
    path: &Path,
    target_dir: &Path,
    force_interactive: bool,
    run_as_administrator: bool,
    control: &InstallControl,
) -> Result<(), RunInstallerError> {
    let target = target_dir.to_string_lossy();
    let installer_type = detect_installer_type(path);
    log::info!(
        "Detected installer type: {} for {}",
        match &installer_type {
            InstallerType::GogInnoSetup => "GOG InnoSetup",
            InstallerType::InnoSetup => "InnoSetup",
            InstallerType::Nsis => "NSIS",
            InstallerType::Msi => "MSI",
            InstallerType::Unknown => "Unknown",
        },
        path.display()
    );

    if force_interactive {
        if matches!(installer_type, InstallerType::Msi) {
            let msi_args = format!("/i \"{}\"", path.to_string_lossy());
            let mut cmd = std::process::Command::new("msiexec");
            cmd.arg("/i").arg(path).stdin(Stdio::null());
            return spawn_mute_wait(
                cmd,
                Path::new("msiexec"),
                &msi_args,
                run_as_administrator,
                control,
            );
        }

        let mut cmd = std::process::Command::new(path);
        cmd.current_dir(path.parent().unwrap_or_else(|| Path::new(".")))
            .stdin(Stdio::null());
        return spawn_mute_wait(cmd, path, "", run_as_administrator, control);
    }

    match installer_type {
        InstallerType::GogInnoSetup => {
            run_innoextract(path, target_dir).or_else(|err| {
                log::warn!("innoextract failed ({err}), falling back to silent InnoSetup install");
                // Clean up any partial output before falling back to the silent installer
                let _ = fs::remove_dir_all(target_dir);
                run_innosetup_silent(path, &target, run_as_administrator, control)
            })
        }
        InstallerType::Msi => {
            let msi_args = format!(
                "/i \"{}\" /qn TARGETDIR=\"{}\"",
                path.to_string_lossy(),
                target
            );
            let mut cmd = std::process::Command::new("msiexec");
            cmd.arg("/i")
                .arg(path)
                .arg("/qn")
                .arg(format!("TARGETDIR={target}"))
                .stdin(Stdio::null());
            spawn_mute_wait(
                cmd,
                Path::new("msiexec"),
                &msi_args,
                run_as_administrator,
                control,
            )
        }
        InstallerType::InnoSetup => run_innosetup_silent(path, &target, run_as_administrator, control),
        InstallerType::Nsis => {
            // /D= must be the last argument and cannot be quoted
            let nsis_args = format!("/S /D={target}");
            let mut cmd = std::process::Command::new(path);
            cmd.arg("/S")
                .arg(format!("/D={target}"))
                .stdin(Stdio::null());
            spawn_mute_wait(cmd, path, &nsis_args, run_as_administrator, control)
        }
        InstallerType::Unknown => {
            // Fall back to interactive; user chooses install location
            let mut cmd = std::process::Command::new(path);
            cmd.current_dir(path.parent().unwrap_or_else(|| Path::new(".")))
                .stdin(Stdio::null());
            spawn_mute_wait(cmd, path, "", run_as_administrator, control)
        }
    }
}

#[cfg(target_os = "windows")]
fn run_innosetup_silent(
    path: &Path,
    target: &str,
    run_as_administrator: bool,
    control: &InstallControl,
) -> Result<(), RunInstallerError> {
    // Quote the path so spaces in the install directory are handled correctly.
    // /NOSOUND is added to suppress audio if supported by the installer.
    let args = format!("/VERYSILENT /SUPPRESSMSGBOXES /NOSOUND \"/DIR={target}\"");
    let mut cmd = std::process::Command::new(path);
    cmd.arg("/VERYSILENT")
        .arg("/SUPPRESSMSGBOXES")
        .arg("/NOSOUND")
        .arg(format!("/DIR={target}"))
        .stdin(Stdio::null());

    spawn_mute_wait(cmd, path, &args, run_as_administrator, control)
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
enum RunInstallerError {
    Cancelled,
    RestartInteractiveRequested,
    RequiresAdministrator,
    Failed(String),
}

fn cleanup_directory(path: &Path, label: &str) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }

    log::info!("[installer] removing {label} {}", path.display());

    let mut last_error = None;
    for attempt in 1..=10 {
        match fs::remove_dir_all(path) {
            Ok(()) => return Ok(()),
            Err(_error) if !path.exists() => return Ok(()),
            Err(error) => {
                last_error = Some(error.to_string());
                log::info!(
                    "[installer] {label} cleanup attempt {attempt} failed for {}",
                    path.display()
                );
                std::thread::sleep(std::time::Duration::from_millis(200));
            }
        }
    }

    Err(format!(
        "Failed to remove {label}: {}",
        last_error.unwrap_or_else(|| "unknown error".to_string())
    ))
}

fn cleanup_partial_install_dir(target_dir: &Path) -> Result<(), String> {
    cleanup_directory(target_dir, "partial install directory")
}

fn cleanup_failed_installer_state(target_dir: &Path, staging_dir: &Path) -> Result<(), String> {
    let mut errors = Vec::new();

    if let Err(error) = cleanup_partial_install_dir(target_dir) {
        errors.push(error);
    }

    if let Err(error) = cleanup_directory(staging_dir, "installer staging directory") {
        errors.push(error);
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join(" "))
    }
}

#[cfg(target_os = "windows")]
struct ElevatedInstallerProcess {
    handle: windows::Win32::Foundation::HANDLE,
    pid: u32,
}

#[cfg(target_os = "windows")]
impl ElevatedInstallerProcess {
    fn pid(&self) -> u32 {
        self.pid
    }

    fn try_wait(&self) -> Result<Option<u32>, String> {
        use windows::Win32::Foundation::{WAIT_OBJECT_0, WAIT_TIMEOUT};
        use windows::Win32::System::Threading::{GetExitCodeProcess, WaitForSingleObject};

        unsafe {
            match WaitForSingleObject(self.handle, 0) {
                WAIT_TIMEOUT => Ok(None),
                WAIT_OBJECT_0 => {
                    let mut code = 0u32;
                    GetExitCodeProcess(self.handle, &mut code)
                        .map_err(|error| error.to_string())?;
                    Ok(Some(code))
                }
                other => Err(format!(
                    "WaitForSingleObject returned unexpected status {other:?}"
                )),
            }
        }
    }

    fn terminate(&self) {
        use windows::Win32::System::Threading::{TerminateProcess, WaitForSingleObject};

        unsafe {
            let _ = TerminateProcess(self.handle, 1);
            let _ = WaitForSingleObject(self.handle, 2_000);
        }
    }
}

#[cfg(target_os = "windows")]
impl Drop for ElevatedInstallerProcess {
    fn drop(&mut self) {
        unsafe {
            let _ = windows::Win32::Foundation::CloseHandle(self.handle);
        }
    }
}

/// Spawns a process, attempts to mute its audio on Windows, and waits for it to exit.
/// Handles UAC elevation (Error 740) by falling back to PowerShell's RunAs.
#[cfg(target_os = "windows")]
fn spawn_mute_wait(
    mut cmd: std::process::Command,
    path: &Path,
    args: &str,
    run_as_administrator: bool,
    control: &InstallControl,
) -> Result<(), RunInstallerError> {
    let exe_name = path.file_name().and_then(|n| n.to_str()).map(String::from);

    if run_as_administrator {
        let elevated = launch_elevated_command(path, args).map_err(RunInstallerError::Failed)?;
        return wait_for_elevated_installer(elevated, path, exe_name, control);
    }

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(err) if err.raw_os_error() == Some(740) => return Err(RunInstallerError::RequiresAdministrator),
        Err(err) => return Err(RunInstallerError::Failed(err.to_string())),
    };

    log::info!(
        "[installer] launched installer {} with PID {}",
        path.display(),
        child.id()
    );
    control.set_installer_process(child.id(), exe_name.clone());
    crate::windows_integration::mute_process_audio(child.id(), exe_name);
    loop {
        control.refresh_tracked_processes();
        if control.take_restart_interactive_request() {
            log::info!("[installer] stopping installer to relaunch interactively");
            terminate_external_installer(control);
            control.clear_installer_processes();
            control.set_cancelled(false);
            return Err(RunInstallerError::RestartInteractiveRequested);
        }

        if control.is_cancelled() {
            log::info!("[installer] stopping installer after cancel request");
            terminate_external_installer(control);
            control.clear_installer_processes();
            return Err(RunInstallerError::Cancelled);
        }

        match child
            .try_wait()
            .map_err(|err| RunInstallerError::Failed(err.to_string()))?
        {
            Some(status) => {
                control.clear_installer_processes();
                return if status.success() {
                    Ok(())
                } else {
                    Err(RunInstallerError::Failed(format!(
                        "Installer exited with status {status}."
                    )))
                };
            }
            None => std::thread::sleep(std::time::Duration::from_millis(120)),
        }
    }
}

#[cfg(target_os = "windows")]
fn wait_for_elevated_installer(
    elevated: ElevatedInstallerProcess,
    path: &Path,
    exe_name: Option<String>,
    control: &InstallControl,
) -> Result<(), RunInstallerError> {
    log::info!(
        "[installer] launched elevated installer {} with PID {}",
        path.display(),
        elevated.pid()
    );
    control.set_installer_process(elevated.pid(), exe_name.clone());
    crate::windows_integration::mute_process_audio(elevated.pid(), exe_name);

    loop {
        control.refresh_tracked_processes();
        if control.take_restart_interactive_request() {
            log::info!("[installer] stopping elevated installer to relaunch interactively");
            elevated.terminate();
            terminate_external_installer(control);
            control.clear_installer_processes();
            control.set_cancelled(false);
            return Err(RunInstallerError::RestartInteractiveRequested);
        }

        if control.is_cancelled() {
            log::info!("[installer] stopping elevated installer after cancel request");
            elevated.terminate();
            terminate_external_installer(control);
            control.clear_installer_processes();
            return Err(RunInstallerError::Cancelled);
        }

        match elevated.try_wait() {
            Ok(Some(0)) => {
                control.clear_installer_processes();
                return Ok(());
            }
            Ok(Some(code)) => {
                control.clear_installer_processes();
                return Err(RunInstallerError::Failed(format!(
                    "Installer exited with status code {code}."
                )));
            }
            Ok(None) => std::thread::sleep(std::time::Duration::from_millis(120)),
            Err(error) => {
                control.clear_installer_processes();
                return Err(RunInstallerError::Failed(error));
            }
        }
    }
}

/// Re-launches `path` with elevated privileges via a UAC prompt and returns the
/// real installer PID so Claudio can poll and terminate it directly.
#[cfg(target_os = "windows")]
fn launch_elevated_command(path: &Path, args: &str) -> Result<ElevatedInstallerProcess, String> {
    use std::ffi::OsStr;
    use std::iter;
    use std::os::windows::ffi::OsStrExt;
    use windows::Win32::System::Threading::GetProcessId;
    use windows::Win32::UI::Shell::{SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW, ShellExecuteExW};
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
    use windows::core::PCWSTR;

    log::info!(
        "Installer requires elevation, requesting UAC prompt for {}",
        path.display()
    );

    let wide = |value: &OsStr| -> Vec<u16> { value.encode_wide().chain(iter::once(0)).collect() };

    let verb = wide(OsStr::new("runas"));
    let file = wide(path.as_os_str());
    let parameters = (!args.is_empty()).then(|| wide(OsStr::new(args)));
    let directory = path.parent().map(|parent| wide(parent.as_os_str()));

    let mut exec_info = SHELLEXECUTEINFOW::default();
    exec_info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
    exec_info.fMask = SEE_MASK_NOCLOSEPROCESS;
    exec_info.lpVerb = PCWSTR(verb.as_ptr());
    exec_info.lpFile = PCWSTR(file.as_ptr());
    exec_info.lpParameters = parameters
        .as_ref()
        .map_or(PCWSTR::null(), |value| PCWSTR(value.as_ptr()));
    exec_info.lpDirectory = directory
        .as_ref()
        .map_or(PCWSTR::null(), |value| PCWSTR(value.as_ptr()));
    exec_info.nShow = SW_SHOWNORMAL.0;

    unsafe {
        ShellExecuteExW(&mut exec_info).map_err(|error| error.to_string())?;
        if exec_info.hProcess.is_invalid() {
            return Err("Elevated installer launch did not return a process handle.".to_string());
        }

        let pid = GetProcessId(exec_info.hProcess);
        if pid == 0 {
            let _ = windows::Win32::Foundation::CloseHandle(exec_info.hProcess);
            return Err("Elevated installer launch did not return a valid PID.".to_string());
        }

        Ok(ElevatedInstallerProcess {
            handle: exec_info.hProcess,
            pid,
        })
    }
}

#[cfg(target_os = "windows")]
fn run_innoextract(installer: &Path, target_dir: &Path) -> Result<(), String> {
    log::info!("Running innoextract for {}", installer.display());
    let bin = ensure_innoextract()?;
    log::info!("Using innoextract binary: {}", bin.display());

    let status = std::process::Command::new(&bin)
        .arg("-d")
        .arg(target_dir)
        .arg("--gog")
        .arg(installer)
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status()
        .map_err(|err| format!("Failed to run innoextract: {err}"))?;

    if !status.success() {
        return Err(format!("innoextract exited with status {status}."));
    }
    log::info!("innoextract succeeded");

    // innoextract places game files under <target_dir>/app/ — flatten into target_dir
    let app_dir = target_dir.join("app");
    if app_dir.is_dir() {
        for entry in fs::read_dir(&app_dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let dest = target_dir.join(entry.file_name());
            fs::rename(entry.path(), dest).map_err(|e| e.to_string())?;
        }
        let _ = fs::remove_dir_all(&app_dir);
    }

    // Remove leftover innoextract temp directory
    let tmp_dir = target_dir.join("tmp");
    if tmp_dir.is_dir() {
        let _ = fs::remove_dir_all(&tmp_dir);
    }

    Ok(())
}

#[cfg(target_os = "windows")]
fn ensure_innoextract() -> Result<PathBuf, String> {
    // Check PATH first
    if std::process::Command::new("innoextract")
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
    {
        return Ok(PathBuf::from("innoextract"));
    }

    // Check cached copy in the app's data dir
    let cached = settings::data_dir().join("tools").join("innoextract.exe");
    if cached.exists() {
        log::info!("Using cached innoextract: {}", cached.display());
        return Ok(cached);
    }

    // Download from GitHub releases on first use
    log::info!("innoextract not found, downloading from GitHub releases");
    download_innoextract(&cached)?;
    log::info!("innoextract downloaded to {}", cached.display());
    Ok(cached)
}

#[cfg(target_os = "windows")]
fn download_innoextract(target: &Path) -> Result<(), String> {
    let client = reqwest::blocking::Client::builder()
        .user_agent("Claudio/1.0")
        .build()
        .map_err(|e| e.to_string())?;

    let release: serde_json::Value = client
        .get("https://api.github.com/repos/dscharrer/innoextract/releases/latest")
        .send()
        .map_err(|e| format!("Failed to fetch innoextract release info: {e}"))?
        .json()
        .map_err(|e| e.to_string())?;

    let download_url = release["assets"]
        .as_array()
        .ok_or("No assets found in innoextract release")?
        .iter()
        .find(|asset| {
            asset["name"]
                .as_str()
                .map(|name| name.contains("windows") && name.ends_with(".zip"))
                .unwrap_or(false)
        })
        .and_then(|asset| asset["browser_download_url"].as_str())
        .ok_or("Could not find Windows innoextract release asset")?
        .to_string();

    let bytes = client
        .get(&download_url)
        .send()
        .map_err(|e| format!("Failed to download innoextract: {e}"))?
        .bytes()
        .map_err(|e| e.to_string())?;

    let cursor = std::io::Cursor::new(bytes.as_ref());
    let mut archive = ZipArchive::new(cursor).map_err(|e| e.to_string())?;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        if entry.name().ends_with("innoextract.exe") {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut out = fs::File::create(target).map_err(|e| e.to_string())?;
            io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
            return Ok(());
        }
    }

    Err("innoextract.exe not found in downloaded release zip".to_string())
}

#[cfg(not(target_os = "windows"))]
fn run_installer(
    _path: &Path,
    _target_dir: &Path,
    _force_interactive: bool,
    _run_as_administrator: bool,
    _control: &InstallControl,
) -> Result<(), RunInstallerError> {
    Err(RunInstallerError::Failed(
        "Installer-based PC installs are only supported on Windows.".to_string(),
    ))
}

fn emit_progress(
    app: &AppHandle,
    game_id: i32,
    status: &str,
    percent: Option<f64>,
    detail: Option<&str>,
) {
    emit_progress_with_bytes(app, game_id, status, percent, detail, None, None, None);
}

fn emit_progress_indeterminate(
    app: &AppHandle,
    game_id: i32,
    status: &str,
    percent: Option<f64>,
    detail: Option<&str>,
    indeterminate: bool,
) {
    emit_progress_with_bytes(
        app,
        game_id,
        status,
        percent,
        detail,
        None,
        None,
        Some(indeterminate),
    );
}

fn emit_progress_with_bytes(
    app: &AppHandle,
    game_id: i32,
    status: &str,
    percent: Option<f64>,
    detail: Option<&str>,
    bytes_downloaded: Option<u64>,
    total_bytes: Option<u64>,
    indeterminate: Option<bool>,
) {
    let _ = app.emit(
        "install-progress",
        InstallProgress {
            game_id,
            status: status.to_string(),
            percent,
            indeterminate,
            detail: detail.map(ToString::to_string),
            bytes_downloaded,
            total_bytes,
        },
    );
}

fn current_timestamp() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

fn open_path(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut command = std::process::Command::new("open");
    #[cfg(target_os = "linux")]
    let mut command = std::process::Command::new("xdg-open");
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut cmd = std::process::Command::new("explorer");
        cmd.arg(path);
        cmd
    };

    #[cfg(not(target_os = "windows"))]
    command.arg(path);

    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|err| err.to_string())?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unique_test_dir(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "claudio-game-install-{name}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time should be after epoch")
                .as_nanos()
        ))
    }

    #[test]
    fn cleanup_failed_installer_state_removes_target_and_staging_dirs() {
        let root = unique_test_dir("cleanup");
        let target_dir = root.join("Hades II");
        let staging_dir = root.join("Hades II.installing");

        fs::create_dir_all(&target_dir).expect("target dir should be created");
        fs::create_dir_all(&staging_dir).expect("staging dir should be created");
        fs::write(target_dir.join("game.exe"), b"binary").expect("target file should be created");
        fs::write(staging_dir.join("setup.exe"), b"installer")
            .expect("staging file should be created");

        cleanup_failed_installer_state(&target_dir, &staging_dir)
            .expect("cleanup should remove target and staging dirs");

        assert!(!target_dir.exists());
        assert!(!staging_dir.exists());
        let _ = fs::remove_dir_all(root);
    }
}
