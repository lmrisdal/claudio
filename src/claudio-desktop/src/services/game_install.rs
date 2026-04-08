use crate::auth;
use crate::models::{
    DownloadPackageInput, InstallProgress, InstallType, InstalledGame, RemoteGame,
};
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
    let game_title = game.title.clone();
    let result = install_game_inner(&app, game, &control).await;
    if let Err(error) = &result {
        if !control.is_cancelled() {
            emit_progress(
                &app,
                game_id,
                "failed",
                None,
                Some(&format!("Install failed for {game_title}: {error}")),
            );
        }
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
    if let Err(error) = &result {
        if !control.is_cancelled() {
            emit_progress(
                &app,
                game_id,
                "failed",
                None,
                Some(&format!("Download failed for {game_title}: {error}")),
            );
        }
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
    fs::create_dir_all(&target_dir)
        .map_err(|err| format!("Failed to create target folder: {err}"))?;

    let downloads_root = settings::resolve_download_root(&settings)?;
    let temp_root = download_workspace_root(&downloads_root, input.id, &input.title);
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
            // Files already downloaded individually into the staging dir — skip extraction.
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
                fs::remove_dir_all(&staging).map_err(|err| err.to_string())?;
            }
            fs::create_dir_all(&staging).map_err(|err| err.to_string())?;
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
            let entries = visible_entries(&staging_for_move)?;
            let move_source = if entries.len() == 1 && entries[0].is_dir() {
                entries[0].clone()
            } else {
                staging_for_move.clone()
            };
            let mut moved = Vec::new();
            for entry in visible_entries(&move_source)? {
                let target = dest.join(
                    entry
                        .file_name()
                        .ok_or_else(|| "Extracted entry was missing a file name.".to_string())?,
                );
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
            fs::remove_file(&dest_path).map_err(|err| err.to_string())?;
        }
        if fs::rename(&download_info.file_path, &dest_path).is_err() {
            fs::copy(&download_info.file_path, &dest_path).map_err(|err| err.to_string())?;
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

/// Returns the full suggested install path for a game title without creating any
/// directories. Used by the frontend to pre-populate the install dialog.
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

/// Returns the resolved default downloads root without appending a game title.
/// Used by settings UI defaults.
pub fn resolve_default_download_root_path() -> String {
    let settings = settings::load();
    settings::default_download_root(&settings)
        .to_string_lossy()
        .into_owned()
}

/// Returns the full suggested download path for a game title without creating any
/// directories. Used by the frontend to pre-populate the download dialog.
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

#[cfg(feature = "integration-tests")]
pub(crate) mod integration_testing {
    use super::*;

    #[derive(Clone)]
    pub struct TestInstallController {
        control: InstallControl,
    }

    #[cfg(target_os = "windows")]
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub enum TestInstallerLaunchKind {
        Exe,
        Msi,
        Unknown,
    }

    #[cfg(target_os = "windows")]
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub enum TestInstallerOutcome {
        Success,
        RestartInteractiveRequested,
        Cancelled,
        RequiresAdministrator,
        Failed,
    }

    #[cfg(target_os = "windows")]
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub struct TestInstallerAttempt {
        pub force_interactive: bool,
        pub run_as_administrator: bool,
        pub force_run_as_invoker: bool,
    }

    #[cfg(target_os = "windows")]
    #[derive(Clone, Debug, PartialEq, Eq)]
    pub struct TestInstallerSimulation {
        pub launch_kind: TestInstallerLaunchKind,
        pub attempts: Vec<TestInstallerAttempt>,
        pub final_error: Option<String>,
        pub confirm_elevation_calls: usize,
    }

    impl TestInstallController {
        pub fn new() -> Self {
            Self {
                control: InstallControl::new(),
            }
        }

        pub fn cancel(&self) {
            self.control.set_cancelled(true);
        }

        pub fn request_restart_interactive(&self) {
            self.control.request_restart_interactive();
        }
    }

    #[cfg(target_os = "windows")]
    pub fn simulate_installer_session(
        installer_path: &Path,
        requests_elevation: bool,
        initial_run_as_administrator: bool,
        initial_force_interactive: bool,
        outcomes: Vec<TestInstallerOutcome>,
        confirm_elevation_responses: Vec<bool>,
    ) -> TestInstallerSimulation {
        let mut attempts = Vec::new();
        let mut outcome_iter = outcomes.into_iter();
        let mut confirm_iter = confirm_elevation_responses.into_iter();
        let mut confirm_elevation_calls = 0usize;

        let launch_kind = match installer_launch_kind(installer_path) {
            InstallerLaunchKind::Exe => TestInstallerLaunchKind::Exe,
            InstallerLaunchKind::Msi => TestInstallerLaunchKind::Msi,
            InstallerLaunchKind::Unknown => TestInstallerLaunchKind::Unknown,
        };

        let result = run_installer_with_retries(
            installer_attempt_config(
                initial_force_interactive,
                initial_run_as_administrator,
                requests_elevation,
            ),
            |attempt| {
                attempts.push(TestInstallerAttempt {
                    force_interactive: attempt.force_interactive,
                    run_as_administrator: attempt.run_as_administrator,
                    force_run_as_invoker: attempt.force_run_as_invoker,
                });

                match outcome_iter.next().unwrap_or(TestInstallerOutcome::Success) {
                    TestInstallerOutcome::Success => Ok(()),
                    TestInstallerOutcome::RestartInteractiveRequested => {
                        Err(RunInstallerError::RestartInteractiveRequested)
                    }
                    TestInstallerOutcome::Cancelled => Err(RunInstallerError::Cancelled),
                    TestInstallerOutcome::RequiresAdministrator => {
                        Err(RunInstallerError::RequiresAdministrator)
                    }
                    TestInstallerOutcome::Failed => Err(RunInstallerError::Failed(
                        "Installer exited with status 1.".to_string(),
                    )),
                }
            },
            || Ok(()),
            || {
                confirm_elevation_calls += 1;
                confirm_iter.next().unwrap_or(false)
            },
        );

        TestInstallerSimulation {
            launch_kind,
            attempts,
            final_error: result.err(),
            confirm_elevation_calls,
        }
    }

    #[cfg(target_os = "windows")]
    pub fn cleanup_failed_installer_state(
        target_dir: &Path,
        staging_dir: &Path,
    ) -> Result<(), String> {
        super::cleanup_failed_installer_state(target_dir, staging_dir)
    }

    #[cfg(target_os = "windows")]
    pub fn run_innoextract_with_binary(
        bin: &Path,
        installer: &Path,
        target_dir: &Path,
    ) -> Result<(), String> {
        super::run_innoextract_with_binary(bin, installer, target_dir)
    }

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
                        let target = dest.join(entry.file_name().ok_or_else(|| {
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
            game.id,
            "starting",
            Some(0.0),
            Some("Preparing install"),
            None,
            None,
            None,
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
            game.id,
            "extracting",
            Some(60.0),
            Some("Extracting game"),
            None,
            None,
            None,
        );

        let (progress_tx, mut progress_rx) =
            tokio::sync::mpsc::unbounded_channel::<InstallProgress>();
        let gid = game.id;
        let game_exe_hint = game.game_exe.clone();
        let extract_root = target_dir.with_extension("extracting");
        let target_dir_owned = target_dir.clone();
        let package_path_owned = download_info.file_path.clone();
        let cancel_token = controller.control.cancel_token.clone();
        let progress_task =
            tokio::task::spawn_blocking(move || -> Result<Option<String>, String> {
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
            game.id,
            "completed",
            Some(100.0),
            Some("Install complete"),
            None,
            None,
            None,
        );
        Ok(installed)
    }
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
    /// True when files were downloaded individually into `file_path` (which is the temp_root/files dir),
    /// so no archive extraction is needed — the directory can be moved directly to the target.
    is_individual: bool,
}

struct DownloadOptions<'a> {
    settings: &'a settings::DesktopSettings,
    server_url: &'a str,
    custom_headers: &'a HashMap<String, String>,
    speed_limit_kbs: Option<f64>,
    progress_scale: f64,
}

async fn download_package(
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

async fn download_package_with<F, G>(
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
        // Backward compatibility: older servers may not expose the manifest endpoint.
        // Prefer legacy ticket flow in this case to match older server behavior.
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

    // Check if the server provided a file manifest for individual-file download.
    // Use individual-file download when manifest is present and small enough.
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
        // Backward compatibility: servers with manifest but no direct /download may only expose
        // ticket-based /download?ticket=... flow and return 404 for direct /download.
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

/// Downloads loose-folder game files individually in parallel and writes them
/// to `temp_root/files/` preserving relative paths.
/// Returns a `DownloadInfo` with `is_individual: true` so callers skip archive extraction.
#[allow(clippy::too_many_arguments)]
async fn download_files_individually<F>(
    opts: &DownloadOptions<'_>,
    game_id: i32,
    game_title: &str,
    temp_root: &Path,
    control: &InstallControl,
    on_progress: &mut F,
    auth_headers: &HeaderMap,
    files: &[serde_json::Value],
) -> Result<DownloadInfo, String>
where
    F: FnMut(InstallProgress),
{
    use futures_util::stream::{self, StreamExt as _};
    use std::sync::atomic::{AtomicBool, AtomicU64};
    use tokio::io::AsyncWriteExt;

    let staging = temp_root.join("files");
    fs::create_dir_all(&staging).map_err(|err| err.to_string())?;

    let total_bytes: u64 = files
        .iter()
        .filter_map(|f| f.get("size").and_then(|s| s.as_u64()))
        .sum();
    let bytes_per_second_limit = Arc::new(AtomicU64::new(
        opts.speed_limit_kbs
            .filter(|v| *v > 0.0)
            .map(|kbs| (kbs * 1024.0) as u64)
            .unwrap_or(0),
    ));
    let limit_refresh_stop = Arc::new(AtomicBool::new(false));
    let limit_refresh_task = {
        let bytes_per_second_limit = Arc::clone(&bytes_per_second_limit);
        let limit_refresh_stop = Arc::clone(&limit_refresh_stop);
        tokio::spawn(async move {
            while !limit_refresh_stop.load(Ordering::Relaxed) {
                tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                if limit_refresh_stop.load(Ordering::Relaxed) {
                    break;
                }
                let limit = settings::load_async()
                    .await
                    .download_speed_limit_kbs
                    .filter(|v| *v > 0.0)
                    .map(|kbs| (kbs * 1024.0) as u64)
                    .unwrap_or(0);
                bytes_per_second_limit.store(limit, Ordering::Relaxed);
            }
        })
    };
    let throttle_window = Arc::new(tokio::sync::Mutex::new((std::time::Instant::now(), 0_u64)));
    let downloaded_bytes = Arc::new(AtomicU64::new(0));
    let (progress_tx, mut progress_rx) = tokio::sync::mpsc::unbounded_channel::<()>();
    let file_count = files.len();

    emit_progress_with_bytes_to(
        on_progress,
        game_id,
        "downloading",
        Some(0.0),
        Some(&format!("Downloading {game_title}")),
        Some(0),
        Some(total_bytes),
        None,
    );

    let server_url = opts.server_url.to_owned();
    let progress_scale = opts.progress_scale;

    let tasks: Vec<_> = files
        .iter()
        .map(|file| {
            let rel_path = file
                .get("path")
                .and_then(|p| p.as_str())
                .unwrap_or_default()
                .to_owned();
            let url = format!(
                "{server_url}/api/games/{game_id}/download-files?path={}",
                urlencoding_encode(&rel_path)
            );
            let dest = staging.join(
                rel_path
                    .replace('/', std::path::MAIN_SEPARATOR_STR)
                    .trim_start_matches(std::path::MAIN_SEPARATOR),
            );
            let headers = auth_headers.clone();
            let dl_bytes = Arc::clone(&downloaded_bytes);
            let progress = progress_tx.clone();
            let cancel_token = control.cancel_token.clone();
            let throttle_window = Arc::clone(&throttle_window);
            let bytes_per_second_limit = Arc::clone(&bytes_per_second_limit);
            async move {
                if cancel_token.load(Ordering::Relaxed) {
                    return Err("Install cancelled.".to_string());
                }
                let client = reqwest::Client::new();
                let response = client
                    .get(&url)
                    .headers(headers)
                    .send()
                    .await
                    .map_err(|e| format!("Failed to download {rel_path}: {e}"))?;

                if !response.status().is_success() {
                    return Err(format!(
                        "Failed to download {rel_path}: HTTP {}",
                        response.status()
                    ));
                }

                if let Some(parent) = dest.parent() {
                    tokio::fs::create_dir_all(parent)
                        .await
                        .map_err(|e| format!("Failed to create directory for {rel_path}: {e}"))?;
                }
                let mut file = tokio::fs::File::create(&dest)
                    .await
                    .map_err(|e| format!("Failed to create {rel_path}: {e}"))?;
                let mut stream = response.bytes_stream();
                while let Some(chunk) = stream.next().await {
                    if cancel_token.load(Ordering::Relaxed) {
                        return Err("Install cancelled.".to_string());
                    }
                    let chunk = chunk.map_err(|e| format!("Failed to read {rel_path}: {e}"))?;
                    file.write_all(&chunk)
                        .await
                        .map_err(|e| format!("Failed to write {rel_path}: {e}"))?;
                    let limit = bytes_per_second_limit.load(Ordering::Relaxed);
                    if limit > 0 {
                        let mut window = throttle_window.lock().await;
                        if window.0.elapsed().as_secs() >= 1 {
                            window.0 = std::time::Instant::now();
                            window.1 = 0;
                        }
                        window.1 += chunk.len() as u64;
                        drop(window);
                        loop {
                            let mut window = throttle_window.lock().await;
                            if window.0.elapsed().as_secs() >= 1 {
                                window.0 = std::time::Instant::now();
                                window.1 = 0;
                            }
                            let current_limit = bytes_per_second_limit.load(Ordering::Relaxed);
                            if current_limit == 0 {
                                drop(window);
                                break;
                            }
                            let elapsed = window.0.elapsed();
                            let expected = std::time::Duration::from_secs_f64(
                                window.1 as f64 / current_limit as f64,
                            );
                            let delay = expected.checked_sub(elapsed);
                            drop(window);
                            let Some(delay) = delay else {
                                break;
                            };
                            tokio::time::sleep(delay.min(std::time::Duration::from_millis(200)))
                                .await;
                        }
                    }
                    dl_bytes.fetch_add(chunk.len() as u64, Ordering::Relaxed);
                    let _ = progress.send(());
                }
                file.flush()
                    .await
                    .map_err(|e| format!("Failed to flush {rel_path}: {e}"))?;
                Ok::<(), String>(())
            }
        })
        .collect();

    // Process tasks in parallel with a concurrency limit of 8.
    let mut completed = 0usize;
    let mut last_progress_emit = std::time::Instant::now()
        .checked_sub(std::time::Duration::from_secs(1))
        .unwrap_or_else(std::time::Instant::now);

    let mut stream = stream::iter(tasks).buffer_unordered(8);
    drop(progress_tx);
    let mut progress_channel_closed = false;
    let mut first_error: Option<String> = None;
    loop {
        tokio::select! {
            update = progress_rx.recv(), if !progress_channel_closed => {
                if update.is_none() {
                    progress_channel_closed = true;
                    continue;
                }
                let now = std::time::Instant::now();
                if now.duration_since(last_progress_emit).as_millis() >= 200 {
                    last_progress_emit = now;
                    let dl = downloaded_bytes.load(Ordering::Relaxed);
                    let percent = if total_bytes > 0 {
                        Some((dl as f64 / total_bytes as f64) * progress_scale)
                    } else if file_count > 0 {
                        Some((completed as f64 / file_count as f64) * progress_scale)
                    } else {
                        None
                    };
                    emit_progress_with_bytes_to(
                        on_progress,
                        game_id,
                        "downloading",
                        percent,
                        Some(&format!("Downloading {game_title} ({completed}/{file_count})")),
                        Some(dl),
                        Some(total_bytes),
                        None,
                    );
                }
            }
            result = stream.next() => match result {
                Some(result) => {
                    if control.is_cancelled() {
                        first_error = Some("Install cancelled.".to_string());
                        break;
                    }
                    if let Err(error) = result {
                        first_error = Some(error);
                        break;
                    }
                    completed += 1;
                }
                None => break,
            }
        }
    }

    limit_refresh_stop.store(true, Ordering::Relaxed);
    let _ = limit_refresh_task.await;

    if let Some(error) = first_error {
        return Err(error);
    }

    let dl = downloaded_bytes.load(Ordering::Relaxed);
    let percent = if total_bytes > 0 {
        Some((dl as f64 / total_bytes as f64) * progress_scale)
    } else if file_count > 0 {
        Some((completed as f64 / file_count as f64) * progress_scale)
    } else {
        None
    };
    emit_progress_with_bytes_to(
        on_progress,
        game_id,
        "downloading",
        percent,
        Some(&format!(
            "Downloading {game_title} ({completed}/{file_count})"
        )),
        Some(dl),
        Some(total_bytes),
        None,
    );

    Ok(DownloadInfo {
        file_path: staging,
        is_individual: true,
    })
}

fn urlencoding_encode(input: &str) -> String {
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

async fn install_portable(
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
                err.to_string()
            })?;
        }
        fs::create_dir_all(&extract_root).map_err(|err| {
            log_io_failure("create extract staging directory", &extract_root, &err);
            err.to_string()
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

        if staging_dir.exists() {
            if let Err(error) = cleanup_directory(&staging_dir, "installer staging directory") {
                log::warn!(
                    "[installer {gid}] failed to clean stale staging directory {}: {}",
                    staging_dir.display(),
                    error
                );
            }
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
            let requests_elevation = launch_kind == InstallerLaunchKind::Exe
                && file_requests_elevation(&installer)?;
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

async fn authenticated_headers_with<G>(
    settings: &settings::DesktopSettings,
    custom_headers: &HashMap<String, String>,
    mut on_logged_out: G,
) -> Result<HeaderMap, String>
where
    G: FnMut() -> Result<(), String>,
{
    let Some(access_token) = auth::access_token_for_request(settings).await? else {
        let _ = on_logged_out();
        return Err("You need to sign in before installing games.".to_string());
    };

    build_headers(custom_headers, Some(&access_token))
}

async fn refreshed_headers_with<G>(
    settings: &settings::DesktopSettings,
    custom_headers: &HashMap<String, String>,
    mut on_logged_out: G,
) -> Result<Option<HeaderMap>, String>
where
    G: FnMut() -> Result<(), String>,
{
    let Some(access_token) = auth::refresh_access_token(settings).await? else {
        let _ = on_logged_out();
        return Ok(None);
    };

    build_headers(custom_headers, Some(&access_token)).map(Some)
}

fn build_install_dir(install_root: &Path, game: &RemoteGame) -> PathBuf {
    install_root.join(sanitize_segment(&game.title))
}

fn download_workspace_root(download_root: &Path, game_id: i32, game_title: &str) -> PathBuf {
    download_root.join(format!("{}-{game_id}", sanitize_segment(game_title)))
}

fn install_download_root(download_root: &Path, game: &RemoteGame) -> PathBuf {
    download_workspace_root(download_root, game.id, &game.title)
}

fn installer_staging_dir(base_dir: &Path) -> PathBuf {
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    base_dir.join(format!("installer-staging-{now_ms}"))
}

fn install_probe_dir(base_dir: &Path) -> PathBuf {
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    base_dir.join(format!(".claudio-install-probe-{now_ms}"))
}

fn validate_install_target_path(target_dir: &Path) -> Result<(), String> {
    if target_dir.exists() {
        return Err(format!(
            "Install target already exists: {}",
            target_dir.display()
        ));
    }

    let parent = target_dir.parent().unwrap_or(target_dir);
    fs::create_dir_all(parent).map_err(|err| {
        log_io_failure("create install target parent directory", parent, &err);
        format_install_io_error("create the install folder", parent, &err)
    })?;

    let probe_dir = install_probe_dir(parent);
    fs::create_dir(&probe_dir).map_err(|err| {
        log_io_failure(
            "create install permission probe directory",
            &probe_dir,
            &err,
        );
        format_install_io_error("create the install folder", &probe_dir, &err)
    })?;

    let validation = (|| -> Result<(), String> {
        let probe_file = probe_dir.join(".write-test");
        let mut file = fs::File::create(&probe_file).map_err(|err| {
            log_io_failure("create install permission probe file", &probe_file, &err);
            format_install_io_error("write to the install folder", &probe_file, &err)
        })?;
        std::io::Write::write_all(&mut file, b"claudio").map_err(|err| {
            log_io_failure("write install permission probe file", &probe_file, &err);
            format_install_io_error("write to the install folder", &probe_file, &err)
        })?;
        file.sync_all().map_err(|err| {
            log_io_failure("flush install permission probe file", &probe_file, &err);
            format_install_io_error("write to the install folder", &probe_file, &err)
        })?;
        Ok(())
    })();

    if let Err(error) = fs::remove_dir_all(&probe_dir) {
        log_io_failure(
            "remove install permission probe directory",
            &probe_dir,
            &error,
        );
        return Err(format_install_io_error(
            "finish checking the install folder",
            &probe_dir,
            &error,
        ));
    }

    validation
}

fn log_io_failure(operation: &str, path: &Path, error: &io::Error) {
    log::error!(
        "[installer] {operation} failed for {}: {} (raw_os_error={:?})",
        path.display(),
        error,
        error.raw_os_error()
    );
}

fn log_io_failure_pair(operation: &str, source: &Path, destination: &Path, error: &io::Error) {
    log::error!(
        "[installer] {operation} failed from {} to {}: {} (raw_os_error={:?})",
        source.display(),
        destination.display(),
        error,
        error.raw_os_error()
    );
}

fn format_install_io_error(operation: &str, path: &Path, error: &io::Error) -> String {
    if matches!(error.raw_os_error(), Some(740)) {
        return format!(
            "Windows requires administrator privileges to {operation} at {}. Run Claudio as administrator or choose a different install folder.",
            path.display()
        );
    }

    if error.kind() == io::ErrorKind::PermissionDenied || matches!(error.raw_os_error(), Some(5)) {
        return format!(
            "Claudio couldn't write to {} while trying to {operation}. Choose a folder you can write to or run Claudio as administrator.",
            path.display()
        );
    }

    error.to_string()
}

fn format_install_io_error_pair(
    operation: &str,
    source: &Path,
    destination: &Path,
    error: &io::Error,
) -> String {
    if matches!(error.raw_os_error(), Some(740)) {
        return format!(
            "Windows requires administrator privileges to {operation} at {}. Run Claudio as administrator or choose a different install folder.",
            destination.display()
        );
    }

    if error.kind() == io::ErrorKind::PermissionDenied || matches!(error.raw_os_error(), Some(5)) {
        return format!(
            "Claudio couldn't move files from {} to {} while trying to {operation}. Choose a folder you can write to or run Claudio as administrator.",
            source.display(),
            destination.display()
        );
    }

    error.to_string()
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

async fn extract_archive_subprocess<F>(
    source: &Path,
    destination: &Path,
    cancel_token: &Arc<AtomicBool>,
    mut on_progress: F,
) -> Result<(), String>
where
    F: FnMut(Option<f64>),
{
    fs::create_dir_all(destination).map_err(|err| {
        log_io_failure("create extraction destination", destination, &err);
        err.to_string()
    })?;
    let lower = source.to_string_lossy().to_lowercase();

    let mut command = if lower.ends_with(".zip") {
        #[cfg(target_os = "macos")]
        {
            let mut c = tokio::process::Command::new("ditto");
            c.arg("-x").arg("-k").arg(source).arg(destination);
            c
        }
        #[cfg(not(target_os = "macos"))]
        {
            let mut c = tokio::process::Command::new("tar");
            c.arg("-xf").arg(source).arg("-C").arg(destination);
            c
        }
    } else if lower.ends_with(".tar.gz") || lower.ends_with(".tgz") || lower.ends_with(".tar") {
        let mut c = tokio::process::Command::new("tar");
        c.arg("-xf").arg(source).arg("-C").arg(destination);
        c
    } else {
        let target = destination.join(
            source
                .file_name()
                .ok_or_else(|| "Downloaded package had no file name.".to_string())?,
        );
        if cancel_token.load(Ordering::Relaxed) {
            return Err("Install cancelled.".to_string());
        }
        fs::copy(source, target.as_path()).map_err(|err| {
            log_io_failure_pair(
                "copy package into extraction destination",
                source,
                &target,
                &err,
            );
            err.to_string()
        })?;
        return Ok(());
    };

    command.stdout(Stdio::null()).stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|err| format!("Failed to start extractor: {err}"))?;

    loop {
        if cancel_token.load(Ordering::Relaxed) {
            let _ = child.start_kill();
            let _ = child.wait().await;
            return Err("Install cancelled.".to_string());
        }
        tokio::select! {
            exit = child.wait() => {
                let status = exit.map_err(|err| err.to_string())?;
                if status.success() {
                    on_progress(Some(1.0));
                    return Ok(());
                }
                if cancel_token.load(Ordering::Relaxed) {
                    return Err("Install cancelled.".to_string());
                }
                return Err(format!("Extractor exited with status {status}"));
            }
            _ = tokio::time::sleep(std::time::Duration::from_millis(400)) => {
                on_progress(None);
            }
        }
    }
}

fn extract_archive_or_copy<F>(
    source: &Path,
    destination: &Path,
    cancel_token: &Arc<AtomicBool>,
    progress: F,
) -> Result<(), String>
where
    F: FnMut(f64),
{
    let lower = source.to_string_lossy().to_lowercase();

    if lower.ends_with(".zip") {
        extract_zip(source, destination, cancel_token, progress)
    } else if lower.ends_with(".tar.gz") || lower.ends_with(".tgz") {
        extract_targz(source, destination, cancel_token, progress)
    } else if lower.ends_with(".tar") {
        extract_tar(source, destination, cancel_token, progress)
    } else {
        fs::create_dir_all(destination).map_err(|err| err.to_string())?;
        let target = destination.join(
            source
                .file_name()
                .ok_or_else(|| "Downloaded package had no file name.".to_string())?,
        );
        if cancel_token.load(Ordering::Relaxed) {
            return Err("Install cancelled.".to_string());
        }
        fs::copy(source, target).map_err(|err| err.to_string())?;
        let mut progress = progress;
        progress(1.0);
        Ok(())
    }
}

fn extract_zip<F>(
    source: &Path,
    destination: &Path,
    cancel_token: &Arc<AtomicBool>,
    mut progress: F,
) -> Result<(), String>
where
    F: FnMut(f64),
{
    fs::create_dir_all(destination).map_err(|err| {
        log_io_failure("create zip extraction destination", destination, &err);
        err.to_string()
    })?;
    let file = fs::File::open(source).map_err(|err| {
        log_io_failure("open zip archive", source, &err);
        err.to_string()
    })?;
    let mut archive = ZipArchive::new(file).map_err(|err| err.to_string())?;

    let total = archive.len();
    if total == 0 {
        progress(1.0);
        return Ok(());
    }

    let mut last_report = std::time::Instant::now();
    for index in 0..total {
        if cancel_token.load(Ordering::Relaxed) {
            return Err("Install cancelled.".to_string());
        }
        let mut entry = archive.by_index(index).map_err(|err| err.to_string())?;
        let Some(path) = entry.enclosed_name().map(|path| destination.join(path)) else {
            continue;
        };

        if entry.is_dir() {
            fs::create_dir_all(&path).map_err(|err| {
                log_io_failure("create extracted directory", &path, &err);
                err.to_string()
            })?;
            continue;
        }

        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|err| {
                log_io_failure("create parent directory for extracted file", parent, &err);
                err.to_string()
            })?;
        }

        let mut out = fs::File::create(&path).map_err(|err| {
            log_io_failure("create extracted file", &path, &err);
            err.to_string()
        })?;
        let mut buf = [0u8; 64 * 1024];
        loop {
            if cancel_token.load(Ordering::Relaxed) {
                return Err("Install cancelled.".to_string());
            }
            let n = io::Read::read(&mut entry, &mut buf).map_err(|err| err.to_string())?;
            if n == 0 {
                break;
            }
            io::Write::write_all(&mut out, &buf[..n]).map_err(|err| {
                log_io_failure("write extracted file", &path, &err);
                err.to_string()
            })?;
        }

        let now = std::time::Instant::now();
        if now.duration_since(last_report).as_millis() > 100 {
            progress(index as f64 / total as f64);
            last_report = now;
        }
    }

    progress(1.0);
    Ok(())
}

struct ProgressReader<'a, R, F> {
    inner: R,
    callback: F,
    bytes_read: u64,
    total_bytes: u64,
    last_reported: std::time::Instant,
    cancel_token: &'a Arc<AtomicBool>,
}

impl<R: io::Read, F: FnMut(f64)> io::Read for ProgressReader<'_, R, F> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if self.cancel_token.load(Ordering::Relaxed) {
            return Err(io::Error::new(io::ErrorKind::Interrupted, "cancelled"));
        }
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

fn extract_tar<F>(
    source: &Path,
    destination: &Path,
    cancel_token: &Arc<AtomicBool>,
    mut progress: F,
) -> Result<(), String>
where
    F: FnMut(f64),
{
    fs::create_dir_all(destination).map_err(|err| {
        log_io_failure("create tar extraction destination", destination, &err);
        err.to_string()
    })?;
    let file = fs::File::open(source).map_err(|err| {
        log_io_failure("open tar archive", source, &err);
        err.to_string()
    })?;
    let total_bytes = file.metadata().map(|m| m.len()).unwrap_or(0);

    let reader = ProgressReader {
        inner: file,
        callback: &mut progress,
        bytes_read: 0,
        total_bytes,
        last_reported: std::time::Instant::now(),
        cancel_token,
    };

    let mut archive = Archive::new(reader);
    archive.unpack(destination).map_err(|err| {
        if cancel_token.load(Ordering::Relaxed) {
            "Install cancelled.".to_string()
        } else {
            log::error!(
                "[installer] unpack tar archive failed for {} into {}: {}",
                source.display(),
                destination.display(),
                err
            );
            err.to_string()
        }
    })?;
    progress(1.0);
    Ok(())
}

fn extract_targz<F>(
    source: &Path,
    destination: &Path,
    cancel_token: &Arc<AtomicBool>,
    mut progress: F,
) -> Result<(), String>
where
    F: FnMut(f64),
{
    fs::create_dir_all(destination).map_err(|err| {
        log_io_failure("create tar.gz extraction destination", destination, &err);
        err.to_string()
    })?;
    let file = fs::File::open(source).map_err(|err| {
        log_io_failure("open tar.gz archive", source, &err);
        err.to_string()
    })?;
    let total_bytes = file.metadata().map(|m| m.len()).unwrap_or(0);

    let reader = ProgressReader {
        inner: file,
        callback: &mut progress,
        bytes_read: 0,
        total_bytes,
        last_reported: std::time::Instant::now(),
        cancel_token,
    };

    let decoder = GzDecoder::new(reader);
    let mut archive = Archive::new(decoder);
    archive.unpack(destination).map_err(|err| {
        if cancel_token.load(Ordering::Relaxed) {
            "Install cancelled.".to_string()
        } else {
            log::error!(
                "[installer] unpack tar.gz archive failed for {} into {}: {}",
                source.display(),
                destination.display(),
                err
            );
            err.to_string()
        }
    })?;
    progress(1.0);
    Ok(())
}

fn normalize_into_final_dir(staging_root: &Path, final_dir: &Path) -> Result<(), String> {
    let entries = visible_entries(staging_root)?;

    if entries.len() == 1 && entries[0].is_dir() {
        fs::rename(&entries[0], final_dir).map_err(|err| {
            log_io_failure_pair(
                "move extracted root directory",
                &entries[0],
                final_dir,
                &err,
            );
            format_install_io_error_pair("move extracted files", &entries[0], final_dir, &err)
        })?;
        fs::remove_dir_all(staging_root).map_err(|err| {
            log_io_failure("remove extraction staging root", staging_root, &err);
            format_install_io_error("clean the extraction staging folder", staging_root, &err)
        })?;
        return Ok(());
    }

    fs::create_dir_all(final_dir).map_err(|err| {
        log_io_failure("create final install directory", final_dir, &err);
        format_install_io_error("create the install folder", final_dir, &err)
    })?;
    for entry in entries {
        let target = final_dir.join(
            entry
                .file_name()
                .ok_or_else(|| "Extracted entry was missing a file name.".to_string())?,
        );
        fs::rename(&entry, &target).map_err(|err| {
            log_io_failure_pair(
                "move extracted entry into final directory",
                &entry,
                &target,
                &err,
            );
            format_install_io_error_pair("move extracted files", &entry, &target, &err)
        })?;
    }

    fs::remove_dir_all(staging_root).map_err(|err| {
        log_io_failure("remove extraction staging root", staging_root, &err);
        format_install_io_error("clean the extraction staging folder", staging_root, &err)
    })
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
            fs::create_dir_all(&dst_path).map_err(|error| {
                format_install_io_error("create the install folder", &dst_path, &error)
            })?;
            copy_dir_contents(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path).map_err(|error| {
                format_install_io_error_pair("copy extracted files", &src_path, &dst_path, &error)
            })?;
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
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum InstallerLaunchKind {
    Exe,
    Msi,
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct InstallerAttemptConfig {
    force_interactive: bool,
    run_as_administrator: bool,
    force_run_as_invoker: bool,
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

fn installer_attempt_config(
    force_interactive: bool,
    run_as_administrator: bool,
    requests_elevation: bool,
) -> InstallerAttemptConfig {
    InstallerAttemptConfig {
        force_interactive,
        run_as_administrator,
        force_run_as_invoker: requests_elevation && !run_as_administrator,
    }
}

fn run_installer_with_retries<F, G, H>(
    mut attempt: InstallerAttemptConfig,
    mut run_once: F,
    mut on_restart_interactive: G,
    mut confirm_elevation: H,
) -> Result<(), String>
where
    F: FnMut(InstallerAttemptConfig) -> Result<(), RunInstallerError>,
    G: FnMut() -> Result<(), String>,
    H: FnMut() -> bool,
{
    loop {
        match run_once(attempt) {
            Ok(()) => return Ok(()),
            Err(RunInstallerError::RestartInteractiveRequested) => {
                on_restart_interactive()?;
                attempt.force_interactive = true;
            }
            Err(RunInstallerError::Cancelled) => {
                return Err("Install cancelled.".to_string());
            }
            Err(RunInstallerError::RequiresAdministrator) => {
                if confirm_elevation() {
                    attempt.run_as_administrator = true;
                    attempt.force_run_as_invoker = false;
                    continue;
                }

                return Err("Install cancelled.".to_string());
            }
            Err(RunInstallerError::Failed(message)) => return Err(message),
        }
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
    let overlap = patterns
        .iter()
        .map(|pattern| pattern.len())
        .max()
        .unwrap_or(0);
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
            if buffer[..total]
                .windows(pattern.len())
                .any(|window| window == pattern)
            {
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

#[cfg(target_os = "windows")]
fn apply_run_as_invoker_env(cmd: &mut std::process::Command) {
    log::info!("[installer] applying RunAsInvoker compatibility layer for non-admin launch");
    cmd.env("__COMPAT_LAYER", "RunAsInvoker");
}

#[cfg(not(target_os = "windows"))]
fn confirm_installer_elevation(_app: &AppHandle) -> bool {
    false
}

#[cfg(target_os = "windows")]
fn run_installer(
    path: &Path,
    target_dir: &Path,
    force_interactive: bool,
    run_as_administrator: bool,
    force_run_as_invoker: bool,
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
                false,
                control,
            );
        }

        let mut cmd = std::process::Command::new(path);
        if force_run_as_invoker {
            apply_run_as_invoker_env(&mut cmd);
        }
        cmd.current_dir(path.parent().unwrap_or_else(|| Path::new(".")))
            .stdin(Stdio::null());
        return spawn_mute_wait(
            cmd,
            path,
            "",
            run_as_administrator,
            force_run_as_invoker,
            control,
        );
    }

    match installer_type {
        InstallerType::GogInnoSetup => {
            run_innoextract(path, target_dir).or_else(|err| {
                log::warn!("innoextract failed ({err}), falling back to silent InnoSetup install");
                // Clean up any partial output before falling back to the silent installer
                let _ = fs::remove_dir_all(target_dir);
                run_innosetup_silent(
                    path,
                    &target,
                    run_as_administrator,
                    force_run_as_invoker,
                    control,
                )
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
                false,
                control,
            )
        }
        InstallerType::InnoSetup => run_innosetup_silent(
            path,
            &target,
            run_as_administrator,
            force_run_as_invoker,
            control,
        ),
        InstallerType::Nsis => {
            // /D= must be the last argument and cannot be quoted
            let nsis_args = format!("/S /D={target}");
            let mut cmd = std::process::Command::new(path);
            if force_run_as_invoker {
                apply_run_as_invoker_env(&mut cmd);
            }
            cmd.arg("/S")
                .arg(format!("/D={target}"))
                .stdin(Stdio::null());
            spawn_mute_wait(
                cmd,
                path,
                &nsis_args,
                run_as_administrator,
                force_run_as_invoker,
                control,
            )
        }
        InstallerType::Unknown => {
            // Fall back to interactive; user chooses install location
            let mut cmd = std::process::Command::new(path);
            if force_run_as_invoker {
                apply_run_as_invoker_env(&mut cmd);
            }
            cmd.current_dir(path.parent().unwrap_or_else(|| Path::new(".")))
                .stdin(Stdio::null());
            spawn_mute_wait(
                cmd,
                path,
                "",
                run_as_administrator,
                force_run_as_invoker,
                control,
            )
        }
    }
}

#[cfg(target_os = "windows")]
fn run_innosetup_silent(
    path: &Path,
    target: &str,
    run_as_administrator: bool,
    force_run_as_invoker: bool,
    control: &InstallControl,
) -> Result<(), RunInstallerError> {
    // Quote the path so spaces in the install directory are handled correctly.
    // /NOSOUND is added to suppress audio if supported by the installer.
    let args = format!("/VERYSILENT /SUPPRESSMSGBOXES /NOSOUND \"/DIR={target}\"");
    let mut cmd = std::process::Command::new(path);
    if force_run_as_invoker {
        apply_run_as_invoker_env(&mut cmd);
    }
    cmd.arg("/VERYSILENT")
        .arg("/SUPPRESSMSGBOXES")
        .arg("/NOSOUND")
        .arg(format!("/DIR={target}"))
        .stdin(Stdio::null());

    spawn_mute_wait(
        cmd,
        path,
        &args,
        run_as_administrator,
        force_run_as_invoker,
        control,
    )
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
#[derive(Debug)]
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
    for attempt in 1..=20 {
        match fs::remove_dir_all(path) {
            Ok(()) => return Ok(()),
            Err(_error) if !path.exists() => return Ok(()),
            Err(error) => {
                if path.is_file() {
                    match fs::remove_file(path) {
                        Ok(()) => return Ok(()),
                        Err(_file_error) if !path.exists() => return Ok(()),
                        Err(file_error) => {
                            let detail = format!(
                                "{} (raw_os_error={:?})",
                                file_error,
                                file_error.raw_os_error()
                            );
                            last_error = Some(detail.clone());
                            log::warn!(
                                "[installer] {label} file cleanup attempt {attempt} failed for {}: {}",
                                path.display(),
                                detail
                            );
                        }
                    }
                } else {
                    let detail = format!("{} (raw_os_error={:?})", error, error.raw_os_error());
                    last_error = Some(detail.clone());
                    log::warn!(
                        "[installer] {label} cleanup attempt {attempt} failed for {}: {}",
                        path.display(),
                        detail
                    );
                }

                let backoff_ms = (attempt as u64).saturating_mul(200).min(2_000);
                std::thread::sleep(std::time::Duration::from_millis(backoff_ms));
            }
        }
    }

    Err(format!(
        "Failed to remove {label} {}: {}",
        path.display(),
        last_error.unwrap_or_else(|| "unknown error".to_string())
    ))
}

fn cleanup_partial_install_dir(target_dir: &Path) -> Result<(), String> {
    cleanup_directory(target_dir, "partial install directory")
}

fn cleanup_failed_installer_state(target_dir: &Path, staging_dir: &Path) -> Result<(), String> {
    let mut warnings = Vec::new();

    if let Err(error) = cleanup_partial_install_dir(target_dir) {
        warnings.push(error);
    }

    if let Err(error) = cleanup_directory(staging_dir, "installer staging directory") {
        warnings.push(error);
    }

    if warnings.is_empty() {
        return Ok(());
    }

    log::warn!(
        "[installer] cleanup after failed install was incomplete: {}",
        warnings.join(" ")
    );
    Ok(())
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
    force_run_as_invoker: bool,
    control: &InstallControl,
) -> Result<(), RunInstallerError> {
    let exe_name = path.file_name().and_then(|n| n.to_str()).map(String::from);

    if run_as_administrator {
        log::info!(
            "[installer] launching {} with administrator privileges",
            path.display()
        );
        let elevated = launch_elevated_command(path, args).map_err(RunInstallerError::Failed)?;
        return wait_for_elevated_installer(elevated, path, exe_name, control);
    }

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(err) if err.raw_os_error() == Some(740) => {
            log::warn!(
                "[installer] Windows reported elevation required (error 740) for {}",
                path.display()
            );
            return Err(RunInstallerError::RequiresAdministrator);
        }
        Err(err) => return Err(RunInstallerError::Failed(err.to_string())),
    };

    if force_run_as_invoker {
        log::info!(
            "[installer] non-admin launch started successfully for {}; any later UAC prompt is coming from the installer, not Claudio fallback",
            path.display()
        );
    }

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

    run_innoextract_with_binary(&bin, installer, target_dir)
}

#[cfg(target_os = "windows")]
fn run_innoextract_with_binary(
    bin: &Path,
    installer: &Path,
    target_dir: &Path,
) -> Result<(), String> {
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
            let src = entry.path();
            fs::rename(&src, &dest).map_err(|error| {
                format_install_io_error_pair("move extracted files", &src, &dest, &error)
            })?;
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
    let cached = innoextract_cache_path();
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
    _force_run_as_invoker: bool,
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
    emit_progress_with_bytes_to(
        &mut |progress| {
            let _ = app.emit("install-progress", progress);
        },
        game_id,
        status,
        percent,
        detail,
        bytes_downloaded,
        total_bytes,
        indeterminate,
    );
}

fn emit_progress_with_bytes_to<F>(
    on_progress: &mut F,
    game_id: i32,
    status: &str,
    percent: Option<f64>,
    detail: Option<&str>,
    bytes_downloaded: Option<u64>,
    total_bytes: Option<u64>,
    indeterminate: Option<bool>,
) where
    F: FnMut(InstallProgress),
{
    on_progress(InstallProgress {
        game_id,
        status: status.to_string(),
        percent,
        indeterminate,
        detail: detail.map(ToString::to_string),
        bytes_downloaded,
        total_bytes,
    });
}

fn current_timestamp() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

#[cfg(target_os = "windows")]
fn innoextract_cache_path() -> PathBuf {
    settings::tools_dir().join("innoextract.exe")
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
    use crate::auth::{StoredTokens, TestAuthGuard, store_tokens};
    use crate::test_support::{TestResponse, TestServer};
    use flate2::{Compression, write::GzEncoder};
    use reqwest::header::HeaderValue;
    use std::sync::Arc as StdArc;
    use std::sync::atomic::AtomicUsize;
    use zip::write::SimpleFileOptions;

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

    fn installed_game(remote_game_id: i32, title: &str, install_path: &Path) -> InstalledGame {
        InstalledGame {
            remote_game_id,
            title: title.to_string(),
            platform: "windows".to_string(),
            install_type: InstallType::Portable,
            install_path: install_path.to_string_lossy().into_owned(),
            game_exe: None,
            installed_at: "1".to_string(),
            summary: None,
            genre: None,
            release_year: None,
            cover_url: None,
            hero_url: None,
            developer: None,
            publisher: None,
            game_mode: None,
            series: None,
            franchise: None,
            game_engine: None,
        }
    }

    fn download_settings(server_url: &str) -> settings::DesktopSettings {
        settings::DesktopSettings {
            server_url: Some(server_url.to_string()),
            allow_insecure_auth_storage: true,
            ..settings::DesktopSettings::default()
        }
    }

    fn write_zip_archive(path: &Path, entries: &[(&str, &[u8])]) {
        let file = fs::File::create(path).expect("zip file should be created");
        let mut archive = zip::ZipWriter::new(file);
        let options = SimpleFileOptions::default();

        for (name, contents) in entries {
            archive
                .start_file(name, options)
                .expect("zip entry should start");
            std::io::Write::write_all(&mut archive, contents).expect("zip entry should be written");
        }

        archive.finish().expect("zip archive should finish");
    }

    #[cfg(feature = "integration-tests")]
    fn tar_gz_bytes(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut buffer = Vec::new();
        {
            let encoder = GzEncoder::new(&mut buffer, Compression::default());
            let mut archive = tar::Builder::new(encoder);
            for (name, contents) in entries {
                let mut header = tar::Header::new_gnu();
                header.set_size(contents.len() as u64);
                header.set_mode(0o644);
                header.set_cksum();
                archive
                    .append_data(&mut header, name, std::io::Cursor::new(*contents))
                    .expect("tar entry should be written");
            }
            archive.finish().expect("tar archive should finish");
        }
        buffer
    }

    fn write_tar_gz_archive(path: &Path, entries: &[(&str, &[u8])]) {
        let file = fs::File::create(path).expect("tar.gz file should be created");
        let encoder = GzEncoder::new(file, Compression::default());
        let mut archive = tar::Builder::new(encoder);

        for (name, contents) in entries {
            let mut header = tar::Header::new_gnu();
            header.set_size(contents.len() as u64);
            header.set_mode(0o644);
            header.set_cksum();
            archive
                .append_data(&mut header, name, std::io::Cursor::new(*contents))
                .expect("tar entry should be written");
        }

        archive.finish().expect("tar archive should finish");
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

    #[test]
    fn visible_entries_skips_macos_metadata() {
        let root = unique_test_dir("visible-entries");
        fs::create_dir_all(root.join("Game")).expect("game dir should be created");
        fs::create_dir_all(root.join("__MACOSX")).expect("metadata dir should be created");
        fs::write(root.join(".DS_Store"), b"meta").expect("ds_store should be created");

        let entries = visible_entries(&root).expect("entries should load");
        assert_eq!(entries, vec![root.join("Game")]);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn normalize_into_final_dir_flattens_single_extracted_root() {
        let root = unique_test_dir("normalize");
        let staging_root = root.join("extracting");
        let nested_root = staging_root.join("Game");
        let final_dir = root.join("final");

        fs::create_dir_all(&nested_root).expect("nested root should be created");
        fs::write(nested_root.join("game.exe"), b"binary").expect("game file should exist");

        normalize_into_final_dir(&staging_root, &final_dir)
            .expect("single extracted root should be flattened");

        assert!(final_dir.join("game.exe").exists());
        assert!(!staging_root.exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn validate_install_target_path_allows_writable_parent() {
        let root = unique_test_dir("validate-install-target");
        let target = root.join("Game");

        fs::create_dir_all(&root).expect("root directory should be created");

        validate_install_target_path(&target).expect("writable target should validate");

        assert!(
            !target.exists(),
            "validation should not create the target directory"
        );
        assert!(
            fs::read_dir(&root)
                .expect("validation root should still be readable")
                .next()
                .is_none(),
            "validation should clean up probe files"
        );

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn format_install_io_error_maps_access_denied_to_friendly_message() {
        let error = io::Error::from_raw_os_error(5);
        let message =
            format_install_io_error("create the install folder", Path::new("D:\\Games"), &error);

        assert!(message.contains("Claudio couldn't write to"));
        assert!(message.contains("run Claudio as administrator"));
    }

    #[test]
    fn format_install_io_error_maps_elevation_required_to_friendly_message() {
        let error = io::Error::from_raw_os_error(740);
        let message =
            format_install_io_error("create the install folder", Path::new("D:\\Games"), &error);

        assert!(message.contains("requires administrator privileges"));
        assert!(message.contains("choose a different install folder"));
    }

    #[test]
    fn sanitize_segment_replaces_invalid_path_characters() {
        assert_eq!(
            sanitize_segment(" Halo: Reach / GOTY?* "),
            "Halo_ Reach _ GOTY__"
        );
        assert_eq!(sanitize_segment("   "), "game");
    }

    #[test]
    fn infer_filename_prefers_utf8_content_disposition_name() {
        let mut headers = HeaderMap::new();
        headers.insert(
            CONTENT_DISPOSITION,
            HeaderValue::from_static(
                "attachment; filename*=UTF-8''Game%20Pack.zip; filename=ignored.zip",
            ),
        );

        assert_eq!(infer_filename(&headers).as_deref(), Some("Game%20Pack.zip"));
    }

    #[test]
    fn build_headers_ignores_forbidden_custom_headers_and_sets_bearer_token() {
        let headers = build_headers(
            &HashMap::from([
                ("X-Test".to_string(), "ok".to_string()),
                ("Authorization".to_string(), "blocked".to_string()),
            ]),
            Some("token-123"),
        )
        .expect("headers should build");

        assert_eq!(
            headers.get("x-test").and_then(|v| v.to_str().ok()),
            Some("ok")
        );
        assert_eq!(
            headers.get(AUTHORIZATION).and_then(|v| v.to_str().ok()),
            Some("Bearer token-123")
        );
        assert_eq!(headers.len(), 2);
    }

    #[test]
    fn build_install_dir_uses_sanitized_title() {
        let game = RemoteGame {
            id: 1,
            title: "Max Payne: GOTY".to_string(),
            platform: "windows".to_string(),
            install_type: InstallType::Portable,
            installer_exe: None,
            game_exe: None,
            install_path: None,
            desktop_shortcut: None,
            run_as_administrator: None,
            force_interactive: None,
            summary: None,
            genre: None,
            release_year: None,
            cover_url: None,
            hero_url: None,
            developer: None,
            publisher: None,
            game_mode: None,
            series: None,
            franchise: None,
            game_engine: None,
        };

        let path = build_install_dir(Path::new("/games"), &game);

        assert_eq!(path, PathBuf::from("/games/Max Payne_ GOTY"));
    }

    #[test]
    fn install_download_root_uses_configured_download_root_and_sanitized_title() {
        let game = RemoteGame {
            id: 9,
            title: "Max Payne: GOTY".to_string(),
            platform: "windows".to_string(),
            install_type: InstallType::Portable,
            installer_exe: None,
            game_exe: None,
            install_path: None,
            desktop_shortcut: None,
            run_as_administrator: None,
            force_interactive: None,
            summary: None,
            genre: None,
            release_year: None,
            cover_url: None,
            hero_url: None,
            developer: None,
            publisher: None,
            game_mode: None,
            series: None,
            franchise: None,
            game_engine: None,
        };
        let path = install_download_root(Path::new("/games/downloads"), &game);

        assert_eq!(path, PathBuf::from("/games/downloads/Max Payne_ GOTY-9"));
    }

    #[test]
    fn detect_installer_and_windows_executable_find_sorted_matches() {
        let root = unique_test_dir("detectors");
        fs::create_dir_all(root.join("nested")).expect("nested root should be created");
        fs::write(root.join("nested").join("setup.exe"), b"setup").expect("setup should exist");
        fs::write(root.join("aaa.exe"), b"game").expect("exe should exist");

        assert_eq!(
            detect_installer(&root),
            Some(root.join("nested").join("setup.exe"))
        );
        assert_eq!(detect_windows_executable(&root), Some(root.join("aaa.exe")));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn resolve_installer_path_uses_hint_when_present() {
        let root = unique_test_dir("installer-hint");
        fs::create_dir_all(&root).expect("root should be created");
        fs::write(root.join("custom-installer.exe"), b"installer").expect("installer should exist");

        let installer = resolve_installer_path(&root, Some("custom-installer.exe"))
            .expect("hinted installer should resolve");

        assert_eq!(installer, root.join("custom-installer.exe"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn installer_launch_kind_detects_common_extensions() {
        #[cfg(target_os = "windows")]
        {
            assert_eq!(
                installer_launch_kind(Path::new("setup.exe")),
                InstallerLaunchKind::Exe
            );
            assert_eq!(
                installer_launch_kind(Path::new("setup.msi")),
                InstallerLaunchKind::Msi
            );
            assert_eq!(
                installer_launch_kind(Path::new("setup.bin")),
                InstallerLaunchKind::Unknown
            );
        }

        #[cfg(not(target_os = "windows"))]
        {
            assert_eq!(
                installer_launch_kind(Path::new("setup.exe")),
                InstallerLaunchKind::Unknown
            );
            assert_eq!(
                installer_launch_kind(Path::new("setup.msi")),
                InstallerLaunchKind::Unknown
            );
        }
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn run_installer_fails_closed_on_non_windows() {
        let error = run_installer(
            Path::new("setup.exe"),
            Path::new("/tmp/game"),
            false,
            false,
            false,
            &InstallControl::new(),
        )
        .err()
        .expect("non-windows installer should fail");

        match error {
            RunInstallerError::Failed(message) => {
                assert_eq!(
                    message,
                    "Installer-based PC installs are only supported on Windows."
                );
            }
            other => panic!("unexpected installer error: {other:?}"),
        }
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn stream_requests_elevation_detects_ascii_and_utf16_markers() {
        let mut ascii = std::io::Cursor::new(b"prefix requireAdministrator suffix".to_vec());
        let mut utf16 = std::io::Cursor::new(
            b"x\0h\0i\0g\0h\0e\0s\0t\0A\0v\0a\0i\0l\0a\0b\0l\0e\0y\0".to_vec(),
        );

        assert!(stream_requests_elevation(&mut ascii).expect("ascii marker should be read"));
        assert!(stream_requests_elevation(&mut utf16).expect("utf16 marker should be read"));
    }

    #[test]
    fn extract_archive_or_copy_extracts_zip_archives() {
        let root = unique_test_dir("extract-zip");
        let archive_path = root.join("game.zip");
        let destination = root.join("out");
        fs::create_dir_all(&root).expect("root should be created");
        write_zip_archive(&archive_path, &[("Game/game.exe", b"binary")]);

        extract_archive_or_copy(
            &archive_path,
            &destination,
            &Arc::new(AtomicBool::new(false)),
            |_| {},
        )
        .expect("zip archive should extract");

        assert!(destination.join("Game").join("game.exe").exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn extract_archive_or_copy_extracts_tar_gz_archives() {
        let root = unique_test_dir("extract-targz");
        let archive_path = root.join("game.tar.gz");
        let destination = root.join("out");
        fs::create_dir_all(&root).expect("root should be created");
        write_tar_gz_archive(&archive_path, &[("Game/readme.txt", b"hello")]);

        extract_archive_or_copy(
            &archive_path,
            &destination,
            &Arc::new(AtomicBool::new(false)),
            |_| {},
        )
        .expect("tar.gz archive should extract");

        assert!(destination.join("Game").join("readme.txt").exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn extract_archive_or_copy_respects_pre_cancelled_copy_requests() {
        let root = unique_test_dir("extract-copy-cancelled");
        let source = root.join("game.bin");
        let destination = root.join("out");
        fs::create_dir_all(&root).expect("root should be created");
        fs::write(&source, b"binary").expect("source should exist");

        let error = extract_archive_or_copy(
            &source,
            &destination,
            &Arc::new(AtomicBool::new(true)),
            |_| {},
        )
        .expect_err("pre-cancelled copy should fail");

        assert_eq!(error, "Install cancelled.");
        assert!(destination.exists());
        assert!(!destination.join("game.bin").exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn uninstall_game_can_preserve_or_delete_install_files() {
        crate::settings::with_test_data_dir(unique_test_dir("uninstall"), || {
            let keep_dir = crate::settings::data_dir().join("keep");
            let delete_dir = crate::settings::data_dir().join("delete");
            fs::create_dir_all(&keep_dir).expect("keep dir should exist");
            fs::create_dir_all(&delete_dir).expect("delete dir should exist");

            crate::registry::upsert(installed_game(1, "Keep", &keep_dir))
                .expect("keep game should be saved");
            crate::registry::upsert(installed_game(2, "Delete", &delete_dir))
                .expect("delete game should be saved");

            uninstall_game(1, false).expect("keep uninstall should succeed");
            uninstall_game(2, true).expect("delete uninstall should succeed");

            assert!(keep_dir.exists());
            assert!(!delete_dir.exists());
            assert!(
                crate::registry::get(1)
                    .expect("registry should load")
                    .is_none()
            );
            assert!(
                crate::registry::get(2)
                    .expect("registry should load")
                    .is_none()
            );
        });
    }

    #[tokio::test]
    async fn download_package_with_downloads_file_and_uses_filename_header() {
        let _auth_guard = TestAuthGuard::plain_file_secure_storage_unavailable();
        let server = TestServer::spawn(|request| match request.path.as_str() {
            "/api/games/5/download-files-manifest" => TestResponse::json(200, r#"{"files":null}"#),
            "/api/games/5/download" => TestResponse {
                status: 200,
                headers: vec![(
                    "content-disposition".to_string(),
                    "attachment; filename=game-package.zip".to_string(),
                )],
                body: b"payload".to_vec(),
            },
            _ => TestResponse::text(404, "missing"),
        });

        crate::settings::with_test_data_dir_async(unique_test_dir("download-success"), || async {
            let settings = download_settings(server.url());
            store_tokens(
                &settings,
                &StoredTokens {
                    access_token: "access-token".to_string(),
                    refresh_token: Some("refresh-token".to_string()),
                },
            )
            .expect("tokens should store");

            let control = InstallControl::new();
            let temp_root = crate::settings::data_dir().join("download-success");
            fs::create_dir_all(&temp_root).expect("temp root should exist");
            let mut progress = Vec::new();

            let download = download_package_with(
                &DownloadOptions {
                    settings: &settings,
                    server_url: server.url(),
                    custom_headers: &settings.custom_headers,
                    speed_limit_kbs: None,
                    progress_scale: 100.0,
                },
                5,
                "Game",
                &temp_root,
                &control,
                |event| progress.push(event),
                || Ok(()),
            )
            .await
            .expect("download should succeed");

            assert_eq!(download.file_path, temp_root.join("game-package.zip"));
            assert_eq!(
                fs::read(&download.file_path).expect("downloaded file should exist"),
                b"payload"
            );
            assert!(
                progress
                    .iter()
                    .any(|event| event.status == "requestingManifest")
            );
            assert!(progress.iter().any(|event| event.status == "downloading"));
            let max_download_percent = progress
                .iter()
                .filter(|event| event.status == "downloading")
                .filter_map(|event| event.percent)
                .fold(0.0_f64, f64::max);
            assert_eq!(
                max_download_percent, 100.0,
                "download progress should use full 0-100 range"
            );
        })
        .await;
    }

    #[tokio::test]
    async fn download_package_with_refreshes_when_manifest_and_download_require_reauth() {
        let _auth_guard = TestAuthGuard::plain_file_secure_storage_unavailable();
        let fresh_count = StdArc::new(AtomicUsize::new(0));
        let fresh_count_for_server = fresh_count.clone();
        let server = TestServer::spawn(move |request| {
            let auth = request
                .headers
                .get("authorization")
                .cloned()
                .unwrap_or_default();
            match request.path.as_str() {
                "/api/games/7/download-files-manifest" if auth == "Bearer stale-token" => {
                    TestResponse::text(401, "expired")
                }
                "/api/games/7/download-files-manifest" if auth == "Bearer fresh-token" => {
                    fresh_count_for_server.fetch_add(1, Ordering::SeqCst);
                    TestResponse::json(200, r#"{"files":null}"#)
                }
                "/api/games/7/download" if auth == "Bearer stale-token" => {
                    TestResponse::text(401, "expired")
                }
                "/api/games/7/download" if auth == "Bearer fresh-token" => {
                    fresh_count_for_server.fetch_add(1, Ordering::SeqCst);
                    TestResponse::text(200, "ok")
                }
                "/connect/token" => TestResponse::json(
                    200,
                    r#"{"access_token":"fresh-token","refresh_token":"fresh-refresh"}"#,
                ),
                _ => TestResponse::text(404, "missing"),
            }
        });

        crate::settings::with_test_data_dir_async(unique_test_dir("download-refresh"), || async {
            let settings = download_settings(server.url());
            store_tokens(
                &settings,
                &StoredTokens {
                    access_token: "stale-token".to_string(),
                    refresh_token: Some("refresh-token".to_string()),
                },
            )
            .expect("tokens should store");

            let control = InstallControl::new();
            let temp_root = crate::settings::data_dir().join("download-refresh");
            fs::create_dir_all(&temp_root).expect("temp root should exist");

            let download = download_package_with(
                &DownloadOptions {
                    settings: &settings,
                    server_url: server.url(),
                    custom_headers: &settings.custom_headers,
                    speed_limit_kbs: None,
                    progress_scale: 100.0,
                },
                7,
                "Game",
                &temp_root,
                &control,
                |_| {},
                || Ok(()),
            )
            .await
            .expect("download should succeed after refresh");

            assert_eq!(
                fs::read(&download.file_path).expect("downloaded file should exist"),
                b"ok"
            );
            assert_eq!(fresh_count.load(Ordering::SeqCst), 2);
            let stored = crate::auth::load_tokens(&settings)
                .expect("tokens should load")
                .expect("tokens should exist");
            assert_eq!(stored.access_token, "fresh-token");
        })
        .await;
    }

    #[tokio::test]
    async fn download_package_with_cleans_temp_root_when_cancelled() {
        let _auth_guard = TestAuthGuard::plain_file_secure_storage_unavailable();
        let server = TestServer::spawn(|request| match request.path.as_str() {
            "/api/games/9/download-files-manifest" => TestResponse::json(200, r#"{"files":null}"#),
            "/api/games/9/download" => TestResponse::text(200, "ok"),
            _ => TestResponse::text(404, "missing"),
        });

        crate::settings::with_test_data_dir_async(unique_test_dir("download-cancel"), || async {
            let settings = download_settings(server.url());
            store_tokens(
                &settings,
                &StoredTokens {
                    access_token: "access-token".to_string(),
                    refresh_token: Some("refresh-token".to_string()),
                },
            )
            .expect("tokens should store");

            let control = InstallControl::new();
            control.set_cancelled(true);
            let temp_root = crate::settings::data_dir().join("download-cancel");
            fs::create_dir_all(&temp_root).expect("temp root should exist");

            let error = download_package_with(
                &DownloadOptions {
                    settings: &settings,
                    server_url: server.url(),
                    custom_headers: &settings.custom_headers,
                    speed_limit_kbs: None,
                    progress_scale: 100.0,
                },
                9,
                "Game",
                &temp_root,
                &control,
                |_| {},
                || Ok(()),
            )
            .await
            .err()
            .expect("cancelled download should fail");

            assert_eq!(error, "Install cancelled.");
            assert!(!temp_root.exists());
        })
        .await;
    }

    #[tokio::test]
    async fn download_package_with_uses_legacy_ticket_when_manifest_endpoint_missing() {
        let _auth_guard = TestAuthGuard::plain_file_secure_storage_unavailable();
        let server = TestServer::spawn(|request| match request.path.as_str() {
            "/api/games/12/download-files-manifest" => TestResponse::text(404, "missing"),
            "/api/games/12/download-ticket" => TestResponse::json(200, r#"{"ticket":"fallback"}"#),
            "/api/games/12/download?ticket=fallback" => TestResponse {
                status: 200,
                headers: vec![(
                    "content-disposition".to_string(),
                    "attachment; filename=fallback.tar".to_string(),
                )],
                body: b"fallback-payload".to_vec(),
            },
            _ => TestResponse::text(404, "missing"),
        });

        crate::settings::with_test_data_dir_async(
            unique_test_dir("download-manifest-fallback"),
            || async {
                let settings = download_settings(server.url());
                store_tokens(
                    &settings,
                    &StoredTokens {
                        access_token: "access-token".to_string(),
                        refresh_token: Some("refresh-token".to_string()),
                    },
                )
                .expect("tokens should store");

                let control = InstallControl::new();
                let temp_root = crate::settings::data_dir().join("download-manifest-fallback");
                fs::create_dir_all(&temp_root).expect("temp root should exist");
                let download = download_package_with(
                    &DownloadOptions {
                        settings: &settings,
                        server_url: server.url(),
                        custom_headers: &settings.custom_headers,
                        speed_limit_kbs: None,
                        progress_scale: 100.0,
                    },
                    12,
                    "Fallback",
                    &temp_root,
                    &control,
                    |_| {},
                    || Ok(()),
                )
                .await
                .expect("download should succeed using legacy ticket fallback");

                assert_eq!(download.file_path, temp_root.join("fallback.tar"));
                assert_eq!(
                    fs::read(&download.file_path).expect("downloaded file should exist"),
                    b"fallback-payload"
                );
            },
        )
        .await;
    }

    #[tokio::test]
    async fn download_package_with_falls_back_to_legacy_ticket_when_direct_download_missing() {
        let _auth_guard = TestAuthGuard::plain_file_secure_storage_unavailable();
        let server = TestServer::spawn(|request| match request.path.as_str() {
            "/api/games/13/download-files-manifest" => TestResponse::json(200, r#"{"files":null}"#),
            "/api/games/13/download" => TestResponse::text(404, "missing"),
            "/api/games/13/download-ticket" => TestResponse::json(200, r#"{"ticket":"legacy"}"#),
            "/api/games/13/download?ticket=legacy" => TestResponse {
                status: 200,
                headers: vec![(
                    "content-disposition".to_string(),
                    "attachment; filename=legacy.tar".to_string(),
                )],
                body: b"legacy-payload".to_vec(),
            },
            _ => TestResponse::text(404, "missing"),
        });

        crate::settings::with_test_data_dir_async(
            unique_test_dir("download-legacy-fallback"),
            || async {
                let settings = download_settings(server.url());
                store_tokens(
                    &settings,
                    &StoredTokens {
                        access_token: "access-token".to_string(),
                        refresh_token: Some("refresh-token".to_string()),
                    },
                )
                .expect("tokens should store");

                let control = InstallControl::new();
                let temp_root = crate::settings::data_dir().join("download-legacy-fallback");
                fs::create_dir_all(&temp_root).expect("temp root should exist");
                let download = download_package_with(
                    &DownloadOptions {
                        settings: &settings,
                        server_url: server.url(),
                        custom_headers: &settings.custom_headers,
                        speed_limit_kbs: None,
                        progress_scale: 100.0,
                    },
                    13,
                    "LegacyFallback",
                    &temp_root,
                    &control,
                    |_| {},
                    || Ok(()),
                )
                .await
                .expect("download should succeed through legacy ticket fallback");

                assert_eq!(download.file_path, temp_root.join("legacy.tar"));
                assert_eq!(
                    fs::read(&download.file_path).expect("downloaded file should exist"),
                    b"legacy-payload"
                );
            },
        )
        .await;
    }

    #[tokio::test]
    async fn download_package_with_individual_mode_reports_partial_byte_progress() {
        let _auth_guard = TestAuthGuard::plain_file_secure_storage_unavailable();
        let payload = vec![b'x'; 512 * 1024];
        let payload_for_server = payload.clone();
        let server = TestServer::spawn(move |request| match request.path.as_str() {
            "/api/games/11/download-files-manifest" => {
                TestResponse::json(200, r#"{"files":[{"path":"Game/data.bin","size":524288}]}"#)
            }
            "/api/games/11/download-files?path=Game/data.bin" => TestResponse {
                status: 200,
                headers: vec![(
                    "content-type".to_string(),
                    "application/octet-stream".to_string(),
                )],
                body: payload_for_server.clone(),
            },
            _ => TestResponse::text(404, "missing"),
        });

        crate::settings::with_test_data_dir_async(
            unique_test_dir("download-individual-progress"),
            || async {
                let settings = download_settings(server.url());
                store_tokens(
                    &settings,
                    &StoredTokens {
                        access_token: "access-token".to_string(),
                        refresh_token: Some("refresh-token".to_string()),
                    },
                )
                .expect("tokens should store");

                let control = InstallControl::new();
                let temp_root = crate::settings::data_dir().join("download-individual-progress");
                fs::create_dir_all(&temp_root).expect("temp root should exist");
                let mut progress = Vec::new();

                let download = download_package_with(
                    &DownloadOptions {
                        settings: &settings,
                        server_url: server.url(),
                        custom_headers: &settings.custom_headers,
                        speed_limit_kbs: None,
                        progress_scale: 100.0,
                    },
                    11,
                    "Game",
                    &temp_root,
                    &control,
                    |event| progress.push(event),
                    || Ok(()),
                )
                .await
                .expect("download should succeed");

                let downloaded_file = download.file_path.join("Game").join("data.bin");
                assert_eq!(
                    fs::read(downloaded_file).expect("downloaded file should exist"),
                    payload
                );
                assert!(
                    progress.iter().any(|event| {
                        event.status == "downloading"
                            && matches!(
                                (event.bytes_downloaded, event.total_bytes),
                                (Some(downloaded), Some(total))
                                    if downloaded > 0 && downloaded < total
                            )
                    }),
                    "expected at least one partial downloading update before completion"
                );
            },
        )
        .await;
    }

    #[cfg(feature = "integration-tests")]
    #[tokio::test]
    async fn download_package_with_individual_mode_respects_speed_limit() {
        let _auth_guard = TestAuthGuard::plain_file_secure_storage_unavailable();
        let payload = "a".repeat(1024);
        let payload_for_server = payload.clone();
        let server = TestServer::spawn(move |request| match request.path.as_str() {
            "/api/games/16/download-files-manifest" => {
                TestResponse::json(200, r#"{"files":[{"path":"Game/data.bin","size":1024}]}"#)
            }
            "/api/games/16/download-files?path=Game/data.bin" => {
                TestResponse::text(200, &payload_for_server)
            }
            _ => TestResponse::text(404, "missing"),
        });

        crate::settings::with_test_data_dir_async(
            unique_test_dir("download-individual-speed-limit"),
            || async {
                let settings = download_settings(server.url());
                crate::settings::save(&settings).expect("settings should save");
                store_tokens(
                    &settings,
                    &StoredTokens {
                        access_token: "access-token".to_string(),
                        refresh_token: Some("refresh-token".to_string()),
                    },
                )
                .expect("tokens should store");

                let temp_root = crate::settings::data_dir().join("speed-limit-test");
                fs::create_dir_all(&temp_root).expect("temp root should be created");
                let controller = InstallControl::new();
                let mut progress = Vec::new();
                let started = std::time::Instant::now();
                let download = download_package_with(
                    &DownloadOptions {
                        settings: &settings,
                        server_url: server.url(),
                        custom_headers: &settings.custom_headers,
                        speed_limit_kbs: Some(0.5),
                        progress_scale: 100.0,
                    },
                    16,
                    "Rate Limited Individual Download",
                    &temp_root,
                    &controller,
                    |event| progress.push(event),
                    || Ok(()),
                )
                .await
                .expect("individual download should succeed");
                let elapsed = started.elapsed();

                assert!(download.file_path.exists());
                assert!(
                    elapsed >= std::time::Duration::from_millis(900),
                    "speed limit should delay individual-file downloads; elapsed={elapsed:?}"
                );
                assert!(
                    progress
                        .iter()
                        .filter(|event| event.status == "downloading")
                        .any(|event| event.bytes_downloaded.unwrap_or(0) > 0),
                    "should report downloading bytes while throttled"
                );
            },
        )
        .await;
    }

    #[cfg(feature = "integration-tests")]
    #[tokio::test]
    async fn download_package_with_individual_mode_picks_up_speed_limit_updates() {
        let _auth_guard = TestAuthGuard::plain_file_secure_storage_unavailable();
        let payload = "a".repeat(2048);
        let payload_for_server = payload.clone();
        let server = TestServer::spawn(move |request| match request.path.as_str() {
            "/api/games/17/download-files-manifest" => {
                TestResponse::json(200, r#"{"files":[{"path":"Game/data.bin","size":2048}]}"#)
            }
            "/api/games/17/download-files?path=Game/data.bin" => {
                TestResponse::text(200, &payload_for_server)
            }
            _ => TestResponse::text(404, "missing"),
        });

        crate::settings::with_test_data_dir_async(unique_test_dir("download-individual-speed-update"), || async {
            let mut settings = download_settings(server.url());
            settings.download_speed_limit_kbs = Some(0.5);
            crate::settings::save(&settings).expect("settings should save");
            store_tokens(
                &settings,
                &StoredTokens {
                    access_token: "access-token".to_string(),
                    refresh_token: Some("refresh-token".to_string()),
                },
            )
            .expect("tokens should store");

            let temp_root = crate::settings::data_dir().join("speed-limit-update-test");
            fs::create_dir_all(&temp_root).expect("temp root should be created");
            let controller = InstallControl::new();
            let mut progress = Vec::new();

            let updater_url = server.url().to_string();
            tokio::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(1200)).await;
                let mut updated = download_settings(&updater_url);
                updated.download_speed_limit_kbs = Some(2048.0);
                let _ = crate::settings::save(&updated);
            });

            let started = std::time::Instant::now();
            let download = download_package_with(
                &DownloadOptions {
                    settings: &settings,
                    server_url: server.url(),
                    custom_headers: &settings.custom_headers,
                    speed_limit_kbs: settings.download_speed_limit_kbs,
                    progress_scale: 100.0,
                },
                17,
                "Dynamic Rate Limit Individual Download",
                &temp_root,
                &controller,
                |event| progress.push(event),
                || Ok(()),
            )
            .await
            .expect("individual download should succeed");
            let elapsed = started.elapsed();

            assert!(download.file_path.exists());
            assert!(
                elapsed < std::time::Duration::from_millis(3200),
                "updated speed limit should accelerate ongoing individual-file downloads; elapsed={elapsed:?}"
            );
            assert!(
                progress
                    .iter()
                    .filter(|event| event.status == "downloading")
                    .any(|event| event.bytes_downloaded.unwrap_or(0) > 0),
                "should report downloading bytes while speed limit updates are applied"
            );
        })
        .await;
    }

    #[cfg(feature = "integration-tests")]
    #[tokio::test]
    async fn download_game_package_extract_archive_keeps_download_progress_full_range() {
        let _auth_guard = TestAuthGuard::plain_file_secure_storage_unavailable();
        let archive_payload = tar_gz_bytes(&[("Game/game.exe", b"binary")]);
        let archive_payload_for_server = archive_payload.clone();
        let server = TestServer::spawn(move |request| match request.path.as_str() {
            "/api/games/21/download-files-manifest" => TestResponse::json(200, r#"{"files":null}"#),
            "/api/games/21/download" => TestResponse {
                status: 200,
                headers: vec![(
                    "content-disposition".to_string(),
                    "attachment; filename=game-package.tar.gz".to_string(),
                )],
                body: archive_payload_for_server.clone(),
            },
            _ => TestResponse::text(404, "missing"),
        });

        crate::settings::with_test_data_dir_async(
            unique_test_dir("extract-archive-progress"),
            || async {
                let settings = download_settings(server.url());
                crate::settings::save(&settings).expect("settings should save");
                store_tokens(
                    &settings,
                    &StoredTokens {
                        access_token: "access-token".to_string(),
                        refresh_token: Some("refresh-token".to_string()),
                    },
                )
                .expect("tokens should store");

                let controller =
                    crate::services::game_install::integration_testing::TestInstallController::new(
                    );
                let target_dir = crate::settings::data_dir().join("extract-archive-target");
                let mut progress = Vec::new();

                let final_path =
                    crate::services::game_install::integration_testing::download_game_package(
                        DownloadPackageInput {
                            id: 21,
                            title: "Archive Game".to_string(),
                            target_dir: target_dir.to_string_lossy().into_owned(),
                            extract: true,
                        },
                        &controller,
                        |event| progress.push(event),
                        || Ok(()),
                    )
                    .await
                    .expect("package download should succeed");

                assert_eq!(PathBuf::from(final_path), target_dir);
                assert!(target_dir.join("game.exe").exists());

                let max_download_percent = progress
                    .iter()
                    .filter(|event| event.status == "downloading")
                    .filter_map(|event| event.percent)
                    .fold(0.0_f64, f64::max);
                assert_eq!(max_download_percent, 100.0);
                assert!(
                    progress
                        .iter()
                        .filter(|event| event.status == "extracting")
                        .all(|event| event.percent.is_none()),
                    "extracting events should not lower completed download percent"
                );
            },
        )
        .await;
    }

    #[cfg(feature = "integration-tests")]
    #[tokio::test]
    async fn download_game_package_extract_individual_files_keeps_download_progress_full_range() {
        let _auth_guard = TestAuthGuard::plain_file_secure_storage_unavailable();
        let server = TestServer::spawn(|request| match request.path.as_str() {
            "/api/games/22/download-files-manifest" => {
                TestResponse::json(200, r#"{"files":[{"path":"Game/data.bin","size":6}]}"#)
            }
            "/api/games/22/download-files?path=Game/data.bin" => TestResponse::text(200, "binary"),
            _ => TestResponse::text(404, "missing"),
        });

        crate::settings::with_test_data_dir_async(
            unique_test_dir("extract-individual-progress"),
            || async {
                let settings = download_settings(server.url());
                crate::settings::save(&settings).expect("settings should save");
                store_tokens(
                    &settings,
                    &StoredTokens {
                        access_token: "access-token".to_string(),
                        refresh_token: Some("refresh-token".to_string()),
                    },
                )
                .expect("tokens should store");

                let controller =
                    crate::services::game_install::integration_testing::TestInstallController::new(
                    );
                let target_dir = crate::settings::data_dir().join("extract-individual-target");
                let mut progress = Vec::new();

                let final_path =
                    crate::services::game_install::integration_testing::download_game_package(
                        DownloadPackageInput {
                            id: 22,
                            title: "Individual Game".to_string(),
                            target_dir: target_dir.to_string_lossy().into_owned(),
                            extract: true,
                        },
                        &controller,
                        |event| progress.push(event),
                        || Ok(()),
                    )
                    .await
                    .expect("package download should succeed");

                assert_eq!(PathBuf::from(final_path), target_dir);
                assert!(target_dir.join("data.bin").exists());

                let max_download_percent = progress
                    .iter()
                    .filter(|event| event.status == "downloading")
                    .filter_map(|event| event.percent)
                    .fold(0.0_f64, f64::max);
                assert_eq!(max_download_percent, 100.0);
                assert!(
                    progress
                        .iter()
                        .filter(|event| event.status == "extracting")
                        .all(|event| event.percent.is_none()),
                    "extracting events should not lower completed download percent"
                );
            },
        )
        .await;
    }

    #[cfg(feature = "integration-tests")]
    #[tokio::test]
    async fn install_portable_game_uses_configured_download_root_workspace() {
        let _auth_guard = TestAuthGuard::plain_file_secure_storage_unavailable();
        let archive_payload = tar_gz_bytes(&[("Game/game.exe", b"binary")]);
        let archive_payload_for_server = archive_payload.clone();
        let server = TestServer::spawn(move |request| match request.path.as_str() {
            "/api/games/31/download-files-manifest" => TestResponse::json(200, r#"{"files":null}"#),
            "/api/games/31/download" => TestResponse {
                status: 200,
                headers: vec![(
                    "content-disposition".to_string(),
                    "attachment; filename=portable-game.tar.gz".to_string(),
                )],
                body: archive_payload_for_server.clone(),
            },
            _ => TestResponse::text(404, "missing"),
        });

        crate::settings::with_test_data_dir_async(
            unique_test_dir("portable-download-root"),
            || async {
                let install_root = crate::settings::data_dir().join("install-root");
                let download_root = crate::settings::data_dir().join("custom-downloads");
                let settings = settings::DesktopSettings {
                    server_url: Some(server.url().to_string()),
                    default_install_path: Some(install_root.to_string_lossy().into_owned()),
                    default_download_path: Some(download_root.to_string_lossy().into_owned()),
                    allow_insecure_auth_storage: true,
                    ..settings::DesktopSettings::default()
                };
                crate::settings::save(&settings).expect("settings should save");
                store_tokens(
                    &settings,
                    &StoredTokens {
                        access_token: "access-token".to_string(),
                        refresh_token: Some("refresh-token".to_string()),
                    },
                )
                .expect("tokens should store");

                let controller =
                    crate::services::game_install::integration_testing::TestInstallController::new(
                    );
                let game = RemoteGame {
                    id: 31,
                    title: "Portable Download Root Game".to_string(),
                    platform: "windows".to_string(),
                    install_type: InstallType::Portable,
                    installer_exe: None,
                    game_exe: Some("game.exe".to_string()),
                    install_path: None,
                    desktop_shortcut: None,
                    run_as_administrator: None,
                    force_interactive: None,
                    summary: None,
                    genre: None,
                    release_year: None,
                    cover_url: None,
                    hero_url: None,
                    developer: None,
                    publisher: None,
                    game_mode: None,
                    series: None,
                    franchise: None,
                    game_engine: None,
                };
                let expected_install_dir = install_root.join("Portable Download Root Game");
                let legacy_install_temp_root = crate::settings::data_dir().join("install-31");

                let installed =
                    crate::services::game_install::integration_testing::install_portable_game(
                        game,
                        &controller,
                        |_| {},
                        || Ok(()),
                    )
                    .await
                    .expect("portable install should succeed");

                assert_eq!(PathBuf::from(installed.install_path), expected_install_dir);
                assert!(expected_install_dir.join("game.exe").exists());
                assert!(
                    download_root.exists(),
                    "configured downloads root should be used"
                );
                assert!(
                    !legacy_install_temp_root.exists(),
                    "legacy temp install root should not be used for downloaded artifacts"
                );
            },
        )
        .await;
    }

    #[test]
    fn cleanup_failed_installer_state_is_non_fatal_when_staging_cleanup_fails() {
        let root = unique_test_dir("cleanup-non-fatal");
        let staging_file = root.join("Hades II.installing");
        fs::create_dir_all(&root).expect("root should be created");
        fs::write(&staging_file, b"locked").expect("staging file should be created");

        let result = cleanup_failed_installer_state(&root.join("missing-target"), &staging_file);

        assert!(result.is_ok(), "cleanup failure should be non-fatal");
        let _ = fs::remove_file(&staging_file);
        let _ = fs::remove_dir_all(&root);
    }
}
