use crate::models::{InstalledGame, RemoteGame};
use crate::services::game_install::{self, InstallState};
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn install_game(
    app: AppHandle,
    state: State<'_, InstallState>,
    game: RemoteGame,
    token: String,
) -> Result<InstalledGame, String> {
    game_install::install_game(app, state, game, token).await
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
pub fn cancel_install(state: State<'_, InstallState>, game_id: i32) -> Result<(), String> {
    game_install::cancel_install(&state, game_id)
}

#[tauri::command]
pub async fn uninstall_game(remote_game_id: i32, delete_files: bool) -> Result<(), String> {
    tokio::task::spawn_blocking(move || game_install::uninstall_game(remote_game_id, delete_files))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn launch_game(remote_game_id: i32) -> Result<(), String> {
    tokio::task::spawn_blocking(move || game_install::launch_game(remote_game_id))
        .await
        .map_err(|e| e.to_string())?
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
