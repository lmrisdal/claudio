//! Narrow, feature-gated helpers for the external desktop integration test crate.

use std::borrow::Cow;
use std::future::Future;
#[cfg(target_os = "windows")]
use std::path::Path;
use std::path::PathBuf;

pub use crate::models::{
    DownloadPackageInput, InstallProgress, InstallType, InstalledGame, RemoteGame, RunningGameInfo,
};
pub use crate::settings::DesktopSettings;
pub use crate::test_support::{TestRequest, TestResponse, TestServer};
pub use tauri::http;

pub struct PlaintextAuthGuard(#[allow(dead_code)] crate::auth::TestAuthGuard);

impl PlaintextAuthGuard {
    pub fn new() -> Self {
        Self(crate::auth::TestAuthGuard::plain_file_secure_storage_unavailable())
    }
}

#[derive(Clone)]
pub struct InstallController(
    crate::services::game_install::integration_testing::TestInstallController,
);

impl Default for InstallController {
    fn default() -> Self {
        Self::new()
    }
}

impl InstallController {
    pub fn new() -> Self {
        Self(crate::services::game_install::integration_testing::TestInstallController::new())
    }

    pub fn cancel(&self) {
        self.0.cancel();
    }

    pub fn request_restart_interactive(&self) {
        self.0.request_restart_interactive();
    }
}

pub use crate::auth::{DesktopSession, StoredTokens};
#[cfg(target_os = "windows")]
pub use crate::services::game_install::integration_testing::{
    TestInstallerAttempt, TestInstallerLaunchKind, TestInstallerOutcome, TestInstallerSimulation,
};
pub use crate::services::game_runtime::RunningGamesState;

pub fn api_available() -> bool {
    true
}

pub fn with_test_data_dir<T>(path: PathBuf, run: impl FnOnce() -> T) -> T {
    crate::settings::with_test_data_dir(path, run)
}

pub async fn with_test_data_dir_async<T, F>(path: PathBuf, run: impl FnOnce() -> F) -> T
where
    F: Future<Output = T>,
{
    crate::settings::with_test_data_dir_async(path, run).await
}

pub fn save_settings(settings: &DesktopSettings) -> Result<(), String> {
    crate::settings::save(settings)
}

pub fn load_settings() -> DesktopSettings {
    crate::settings::load()
}

pub fn data_dir() -> PathBuf {
    crate::settings::data_dir()
}

pub fn list_installed_games() -> Result<Vec<InstalledGame>, String> {
    crate::services::game_install::list_installed_games()
}

pub fn upsert_installed_game(game: InstalledGame) -> Result<InstalledGame, String> {
    crate::registry::upsert(game)
}

pub fn get_installed_game(remote_game_id: i32) -> Result<Option<InstalledGame>, String> {
    crate::services::game_install::get_installed_game(remote_game_id)
}

pub fn uninstall_game(remote_game_id: i32, delete_files: bool) -> Result<(), String> {
    crate::services::game_install::uninstall_game(remote_game_id, delete_files)
}

pub fn set_game_exe(remote_game_id: i32, game_exe: String) -> Result<InstalledGame, String> {
    crate::services::game_install::set_game_exe(remote_game_id, game_exe)
}

pub fn list_game_executables(remote_game_id: i32) -> Result<Vec<String>, String> {
    crate::services::game_install::list_game_executables(remote_game_id)
}

pub fn resolve_install_path(game_title: &str) -> String {
    crate::services::game_install::resolve_install_path(game_title)
}

pub fn resolve_download_path(game_title: &str) -> String {
    crate::services::game_install::resolve_download_path(game_title)
}

pub async fn command_list_installed_games() -> Result<Vec<InstalledGame>, String> {
    crate::commands::games::list_installed_games_command().await
}

pub async fn command_get_installed_game(
    remote_game_id: i32,
) -> Result<Option<InstalledGame>, String> {
    crate::commands::games::get_installed_game_command(remote_game_id).await
}

pub async fn command_uninstall_game(remote_game_id: i32, delete_files: bool) -> Result<(), String> {
    crate::commands::games::uninstall_game_command(remote_game_id, delete_files).await
}

pub fn command_launch_game(state: &RunningGamesState, remote_game_id: i32) -> Result<(), String> {
    crate::commands::games::launch_game_command(state, remote_game_id)
}

pub fn command_stop_game(state: &RunningGamesState, remote_game_id: i32) -> Result<(), String> {
    crate::commands::games::stop_game_command(state, remote_game_id)
}

pub fn command_list_running_games(
    state: &RunningGamesState,
) -> Result<Vec<RunningGameInfo>, String> {
    crate::commands::games::list_running_games_command(state)
}

pub async fn command_set_game_exe(
    remote_game_id: i32,
    game_exe: String,
) -> Result<InstalledGame, String> {
    crate::commands::games::set_game_exe_command(remote_game_id, game_exe).await
}

pub async fn command_list_game_executables(remote_game_id: i32) -> Result<Vec<String>, String> {
    crate::commands::games::list_game_executables_command(remote_game_id).await
}

pub fn command_resolve_install_path(game_title: &str) -> String {
    crate::commands::games::resolve_install_path_command(game_title.to_string())
}

pub fn command_resolve_download_path(game_title: &str) -> String {
    crate::commands::games::resolve_download_path_command(game_title.to_string())
}

pub async fn download_game_package<F, G>(
    input: DownloadPackageInput,
    controller: &InstallController,
    on_progress: F,
    on_logged_out: G,
) -> Result<String, String>
where
    F: FnMut(InstallProgress),
    G: FnMut() -> Result<(), String>,
{
    crate::services::game_install::integration_testing::download_game_package(
        input,
        &controller.0,
        on_progress,
        on_logged_out,
    )
    .await
}

pub async fn install_portable_game<F, G>(
    game: RemoteGame,
    controller: &InstallController,
    on_progress: F,
    on_logged_out: G,
) -> Result<InstalledGame, String>
where
    F: FnMut(InstallProgress),
    G: FnMut() -> Result<(), String>,
{
    crate::services::game_install::integration_testing::install_portable_game(
        game,
        &controller.0,
        on_progress,
        on_logged_out,
    )
    .await
}

pub fn new_running_games_state() -> RunningGamesState {
    RunningGamesState::default()
}

pub fn launch_game(state: &RunningGamesState, remote_game_id: i32) -> Result<(), String> {
    crate::services::game_runtime::launch_game(state, remote_game_id)
}

pub fn stop_game(state: &RunningGamesState, remote_game_id: i32) -> Result<(), String> {
    crate::services::game_runtime::stop_game(state, remote_game_id)
}

pub fn list_running_games(state: &RunningGamesState) -> Result<Vec<RunningGameInfo>, String> {
    state.list_active()
}

pub fn record_running_game_for_test(
    state: &RunningGamesState,
    game: RunningGameInfo,
) -> Result<(), String> {
    crate::services::game_runtime::record_running_game_for_tests(state, game)
}

pub fn store_tokens(settings: &DesktopSettings, tokens: &StoredTokens) -> Result<(), String> {
    crate::auth::store_tokens(settings, tokens)
}

pub fn load_tokens(settings: &DesktopSettings) -> Result<Option<StoredTokens>, String> {
    crate::auth::load_tokens(settings)
}

pub fn clear_tokens(settings: &DesktopSettings) -> Result<(), String> {
    crate::auth::clear_tokens(settings)
}

pub async fn login_with_password(
    settings: &DesktopSettings,
    username: &str,
    password: &str,
) -> Result<DesktopSession, String> {
    crate::auth::login_with_password(settings, username, password).await
}

pub async fn restore_session(settings: &DesktopSettings) -> Result<DesktopSession, String> {
    crate::auth::restore_session(settings).await
}

pub async fn refresh_access_token(settings: &DesktopSettings) -> Result<Option<String>, String> {
    crate::auth::refresh_access_token(settings).await
}

pub async fn forward_protocol_request<F>(
    request: http::Request<Vec<u8>>,
    on_logged_out: F,
) -> Result<http::Response<Cow<'static, [u8]>>, String>
where
    F: FnMut() -> Result<(), String>,
{
    crate::protocol::forward_request_for_tests(request, on_logged_out).await
}

#[cfg(target_os = "windows")]
pub fn cleanup_failed_installer_state(target_dir: &Path, staging_dir: &Path) -> Result<(), String> {
    crate::services::game_install::integration_testing::cleanup_failed_installer_state(
        target_dir,
        staging_dir,
    )
}

#[cfg(target_os = "windows")]
pub fn simulate_windows_installer_session(
    installer_path: &Path,
    requests_elevation: bool,
    initial_run_as_administrator: bool,
    initial_force_interactive: bool,
    outcomes: Vec<TestInstallerOutcome>,
    confirm_elevation_responses: Vec<bool>,
) -> TestInstallerSimulation {
    crate::services::game_install::integration_testing::simulate_installer_session(
        installer_path,
        requests_elevation,
        initial_run_as_administrator,
        initial_force_interactive,
        outcomes,
        confirm_elevation_responses,
    )
}

#[cfg(target_os = "windows")]
pub fn run_windows_innoextract_with_binary(
    bin: &Path,
    installer: &Path,
    target_dir: &Path,
) -> Result<(), String> {
    crate::services::game_install::integration_testing::run_innoextract_with_binary(
        bin, installer, target_dir,
    )
}

#[cfg(target_os = "windows")]
pub fn terminate_windows_tracked_processes(
    seed_pids: &[u32],
    exe_name: Option<&str>,
) -> Result<(), String> {
    crate::windows_integration::terminate_tracked_processes(seed_pids, exe_name)
}

#[cfg(target_os = "windows")]
pub fn with_test_windows_shell_dirs<T>(
    start_menu_dir: PathBuf,
    desktop_dir: PathBuf,
    run: impl FnOnce() -> T,
) -> T {
    crate::windows_integration::with_test_shell_dirs(start_menu_dir, desktop_dir, run)
}

#[cfg(target_os = "windows")]
pub fn register_windows_game_from_resource_dir(
    resource_dir: PathBuf,
    game: &InstalledGame,
    desktop_shortcut: bool,
) {
    crate::windows_integration::register_from_resource_dir(&resource_dir, game, desktop_shortcut)
}

#[cfg(target_os = "windows")]
pub fn deregister_windows_game(game: &InstalledGame) {
    crate::windows_integration::deregister(game)
}

#[cfg(target_os = "windows")]
pub fn windows_registry_key_name(remote_game_id: i32) -> String {
    crate::windows_integration::registry_key_name(remote_game_id)
}

#[cfg(target_os = "windows")]
pub fn windows_start_menu_shortcut_path(title: &str) -> PathBuf {
    crate::windows_integration::start_menu_shortcut_path(title)
}

#[cfg(target_os = "windows")]
pub fn windows_desktop_shortcut_path(title: &str) -> PathBuf {
    crate::windows_integration::desktop_shortcut_path(title)
}

#[cfg(target_os = "windows")]
pub fn windows_uninstall_root() -> &'static str {
    crate::windows_integration::UNINSTALL_ROOT
}
