use crate::models::{DownloadPackageInput, InstalledGame, RemoteGame, RunningGameInfo};
use crate::services::game_install::{self, InstallState};
use crate::services::game_runtime::{self, RunningGamesState};
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn install_game(
    app: AppHandle,
    state: State<'_, InstallState>,
    game: RemoteGame,
) -> Result<InstalledGame, String> {
    game_install::install_game(app, state, game).await
}

#[tauri::command]
pub async fn download_game_package(
    app: AppHandle,
    state: State<'_, InstallState>,
    input: DownloadPackageInput,
) -> Result<String, String> {
    game_install::download_game_package(app, state, input).await
}

#[tauri::command]
pub async fn list_installed_games() -> Result<Vec<InstalledGame>, String> {
    tokio::task::spawn_blocking(game_install::list_installed_games)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_installed_game(remote_game_id: i32) -> Result<Option<InstalledGame>, String> {
    tokio::task::spawn_blocking(move || game_install::get_installed_game(remote_game_id))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn open_install_folder(remote_game_id: i32) -> Result<(), String> {
    tokio::task::spawn_blocking(move || game_install::open_install_folder(remote_game_id))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn cancel_install(
    app: AppHandle,
    state: State<'_, InstallState>,
    game_id: i32,
) -> Result<(), String> {
    game_install::cancel_install(&app, &state, game_id)
}

#[tauri::command]
pub fn restart_install_interactive(
    app: AppHandle,
    state: State<'_, InstallState>,
    game_id: i32,
) -> Result<(), String> {
    game_install::restart_install_interactive(&app, &state, game_id)
}

#[tauri::command]
pub async fn uninstall_game(remote_game_id: i32, delete_files: bool) -> Result<(), String> {
    tokio::task::spawn_blocking(move || game_install::uninstall_game(remote_game_id, delete_files))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn launch_game(state: State<'_, RunningGamesState>, remote_game_id: i32) -> Result<(), String> {
    game_runtime::launch_game(&state, remote_game_id)
}

#[tauri::command]
pub fn stop_game(state: State<'_, RunningGamesState>, remote_game_id: i32) -> Result<(), String> {
    game_runtime::stop_game(&state, remote_game_id)
}

#[tauri::command]
pub fn list_running_games(
    state: State<'_, RunningGamesState>,
) -> Result<Vec<RunningGameInfo>, String> {
    state.list_active()
}

#[tauri::command]
pub async fn set_game_exe(remote_game_id: i32, game_exe: String) -> Result<InstalledGame, String> {
    tokio::task::spawn_blocking(move || game_install::set_game_exe(remote_game_id, game_exe))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn list_game_executables(remote_game_id: i32) -> Result<Vec<String>, String> {
    tokio::task::spawn_blocking(move || game_install::list_game_executables(remote_game_id))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn resolve_install_path(game_title: String) -> String {
    game_install::resolve_install_path(&game_title)
}
