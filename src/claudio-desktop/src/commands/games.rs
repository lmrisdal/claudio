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
pub fn get_installed_game(remote_game_id: i32) -> Result<Option<InstalledGame>, String> {
    game_install::get_installed_game(remote_game_id)
}

#[tauri::command]
pub fn open_install_folder(remote_game_id: i32) -> Result<(), String> {
    game_install::open_install_folder(remote_game_id)
}
