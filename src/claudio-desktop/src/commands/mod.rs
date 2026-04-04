pub mod games;
pub mod ping;

use crate::settings;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

#[tauri::command]
pub fn get_settings() -> Result<settings::DesktopSettings, String> {
    Ok(settings::load())
}

#[tauri::command]
pub fn update_settings(settings: settings::DesktopSettings) -> Result<(), String> {
    settings::save(&settings)
}

#[tauri::command]
pub fn restart_app(app: tauri::AppHandle) {
    app.restart();
}

#[tauri::command]
pub fn open_settings_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }

    WebviewWindowBuilder::new(
        &app,
        "settings",
        WebviewUrl::App("index.html?desktop-settings-window=1".into()),
    )
    .title("Desktop Settings")
    .inner_size(760.0, 780.0)
    .min_inner_size(640.0, 620.0)
    .center()
    .resizable(true)
    .build()
    .map(|_| ())
    .map_err(|error| error.to_string())
}
