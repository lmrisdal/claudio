pub mod ping;

use crate::settings;

#[tauri::command]
pub fn get_settings() -> Result<settings::DesktopSettings, String> {
    Ok(settings::load())
}

#[tauri::command]
pub fn update_settings(settings: settings::DesktopSettings) -> Result<(), String> {
    settings::save(&settings)
}
