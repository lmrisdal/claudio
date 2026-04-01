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
pub fn list_installed_games() -> Result<Vec<InstalledGame>, String> {
    game_install::list_installed_games()
}

#[tauri::command]
pub fn get_installed_game(remote_game_id: i32) -> Result<Option<InstalledGame>, String> {
    game_install::get_installed_game(remote_game_id)
}

#[tauri::command]
pub fn open_install_folder(remote_game_id: i32) -> Result<(), String> {
    game_install::open_install_folder(remote_game_id)
}

#[tauri::command]
pub fn cancel_install(state: State<'_, InstallState>, game_id: i32) -> Result<(), String> {
    game_install::cancel_install(&state, game_id)
}

#[tauri::command]
pub fn uninstall_game(remote_game_id: i32, delete_files: bool) -> Result<(), String> {
    game_install::uninstall_game(remote_game_id, delete_files)
}
