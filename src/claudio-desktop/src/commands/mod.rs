pub mod games;
pub mod ping;
pub mod server_connection;

use crate::{auth, refresh_auth_state_ui, settings};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

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
pub async fn desktop_open_external_login(
    app: tauri::AppHandle,
    start_url: String,
) -> Result<(), String> {
    let settings = settings::load();
    let server_url = settings
        .server_url
        .as_deref()
        .ok_or_else(|| "Server URL not configured".to_string())?;

    let full_url = if start_url.starts_with("http://") || start_url.starts_with("https://") {
        start_url
    } else {
        format!(
            "{server_url}{}",
            if start_url.starts_with('/') {
                &start_url
            } else {
                return Err("Invalid start URL".to_string());
            }
        )
    };

    if cfg!(debug_assertions) {
        open_external_login_dev(app, &full_url).await
    } else {
        open_external_login_production(app, &full_url)
    }
}

/// Production: use `claudio://` deep link as returnTo. The OS routes
/// the callback to the app via the registered URL scheme in Info.plist.
fn open_external_login_production(app: tauri::AppHandle, full_url: &str) -> Result<(), String> {
    let mut parsed = url::Url::parse(full_url).map_err(|e| format!("Invalid URL: {e}"))?;

    let existing: Vec<(String, String)> = parsed
        .query_pairs()
        .filter(|(key, _)| key != "returnTo")
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect();
    parsed
        .query_pairs_mut()
        .clear()
        .extend_pairs(existing)
        .append_pair("returnTo", "claudio://auth/callback");

    app.opener()
        .open_url(parsed.as_str(), None::<&str>)
        .map_err(|e| format!("Failed to open browser: {e}"))
}

/// Dev mode: deep links don't work without a .app bundle, so we start a
/// one-shot localhost HTTP server to receive the OAuth callback directly.
async fn open_external_login_dev(app: tauri::AppHandle, full_url: &str) -> Result<(), String> {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Failed to bind callback listener: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Failed to get listener address: {e}"))?
        .port();

    let callback_url = format!("http://127.0.0.1:{port}/callback");

    let mut parsed = url::Url::parse(full_url).map_err(|e| format!("Invalid URL: {e}"))?;

    let existing: Vec<(String, String)> = parsed
        .query_pairs()
        .filter(|(key, _)| key != "returnTo")
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect();
    parsed
        .query_pairs_mut()
        .clear()
        .extend_pairs(existing)
        .append_pair("returnTo", &callback_url);

    app.opener()
        .open_url(parsed.as_str(), None::<&str>)
        .map_err(|e| format!("Failed to open browser: {e}"))?;

    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let result = tokio::time::timeout(std::time::Duration::from_secs(300), async {
            let (mut stream, _) = listener.accept().await?;
            let mut buf = vec![0u8; 4096];
            let n = stream.read(&mut buf).await?;
            let request = String::from_utf8_lossy(&buf[..n]);

            let path = request
                .lines()
                .next()
                .and_then(|line| line.split_whitespace().nth(1))
                .unwrap_or("");

            let query = path.split('?').nth(1).unwrap_or("");
            let params: Vec<(String, String)> = url::form_urlencoded::parse(query.as_bytes())
                .map(|(k, v)| (k.into_owned(), v.into_owned()))
                .collect();

            let nonce = params.iter().find(|(k, _)| k == "nonce").map(|(_, v)| v.clone());
            let error = params.iter().find(|(k, _)| k == "error").map(|(_, v)| v.clone());

            let html = "<!DOCTYPE html><html><body style=\"font-family:system-ui;text-align:center;padding:60px;background:#111;color:#fff\">\
                <h2>Login complete</h2><p>You can close this tab and return to Claudio.</p></body></html>";
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                html.len(),
                html
            );
            let _ = stream.write_all(response.as_bytes()).await;
            let _ = stream.shutdown().await;

            Ok::<_, std::io::Error>((nonce, error))
        })
        .await;

        match result {
            Ok(Ok((nonce, error))) => {
                if let Some(error) = error {
                    log::warn!("External login callback returned error: {error}");
                    let _ = handle.emit("deep-link-auth-error", error);
                } else if let Some(nonce) = nonce {
                    match auth::complete_external_login(&settings::load(), &nonce).await {
                        Ok(session) => {
                            let _ = crate::refresh_auth_state_ui(&handle, session.is_logged_in);
                            let _ = handle.emit("deep-link-auth-complete", ());
                        }
                        Err(message) => {
                            log::error!("External login failed: {message}");
                            let _ = handle.emit("deep-link-auth-error", message);
                        }
                    }
                }
                crate::restore_main_window(&handle);
            }
            Ok(Err(e)) => {
                log::error!("Callback listener error: {e}");
                let _ = handle.emit(
                    "deep-link-auth-error",
                    "Callback listener failed".to_string(),
                );
            }
            Err(_) => {
                log::warn!("External login callback timed out after 5 minutes");
            }
        }
    });

    Ok(())
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
