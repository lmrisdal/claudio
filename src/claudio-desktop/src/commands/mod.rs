pub mod games;
pub mod ping;

use crate::{auth, refresh_auth_state_ui, settings};
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
pub async fn desktop_get_session(app: tauri::AppHandle) -> Result<auth::DesktopSession, String> {
    let session = match auth::restore_session(&settings::load()).await {
        Ok(session) => session,
        Err(message) => {
            auth::maybe_show_secure_storage_dialog(&app, &message);
            return Err(message);
        }
    };
    refresh_auth_state_ui(&app, session.is_logged_in)?;
    Ok(session)
}

#[tauri::command]
pub async fn desktop_login(
    app: tauri::AppHandle,
    username: String,
    password: String,
) -> Result<auth::DesktopSession, String> {
    let session = match auth::login_with_password(&settings::load(), &username, &password).await {
        Ok(session) => session,
        Err(message) => {
            auth::maybe_show_secure_storage_dialog(&app, &message);
            return Err(message);
        }
    };
    refresh_auth_state_ui(&app, session.is_logged_in)?;
    Ok(session)
}

#[tauri::command]
pub async fn desktop_complete_external_login(
    app: tauri::AppHandle,
    nonce: String,
) -> Result<auth::DesktopSession, String> {
    let session = match auth::complete_external_login(&settings::load(), &nonce).await {
        Ok(session) => session,
        Err(message) => {
            auth::maybe_show_secure_storage_dialog(&app, &message);
            return Err(message);
        }
    };
    refresh_auth_state_ui(&app, session.is_logged_in)?;
    Ok(session)
}

#[tauri::command]
pub async fn desktop_proxy_login(app: tauri::AppHandle) -> Result<auth::DesktopSession, String> {
    let session = match auth::proxy_login(&settings::load()).await {
        Ok(session) => session,
        Err(message) => {
            auth::maybe_show_secure_storage_dialog(&app, &message);
            return Err(message);
        }
    };
    refresh_auth_state_ui(&app, session.is_logged_in)?;
    Ok(session)
}

#[tauri::command]
pub fn desktop_logout(app: tauri::AppHandle) -> Result<auth::DesktopSession, String> {
    if let Err(message) = auth::clear_tokens(&settings::load()) {
        auth::maybe_show_secure_storage_dialog(&app, &message);
        return Err(message);
    }
    refresh_auth_state_ui(&app, false)?;
    Ok(auth::DesktopSession::logged_out())
}

#[tauri::command]
pub async fn open_settings_window(app: tauri::AppHandle) -> Result<(), String> {
    let session = match auth::restore_session(&settings::load()).await {
        Ok(session) => session,
        Err(message) => {
            auth::maybe_show_secure_storage_dialog(&app, &message);
            return Err(message);
        }
    };
    refresh_auth_state_ui(&app, session.is_logged_in)?;

    if !session.is_logged_in {
        return Err("You must be signed in to open Settings.".to_string());
    }

    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }

    let result = WebviewWindowBuilder::new(&app, "settings", WebviewUrl::App("index.html".into()))
        .title("Desktop Settings")
        .inner_size(640.0, 620.0)
        .min_inner_size(640.0, 620.0)
        .center()
        .resizable(true)
        .visible(false)
        .build()
        .map(|_| ());

    match result {
        Ok(()) => Ok(()),
        Err(error) => {
            log::error!("Failed to create settings window: {error}");
            Err(error.to_string())
        }
    }
}
