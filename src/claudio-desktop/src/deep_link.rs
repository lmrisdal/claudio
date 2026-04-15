use crate::{auth, refresh_auth_state_ui, restore_main_window, settings};
use tauri::{AppHandle, Emitter};
use tauri_plugin_deep_link::DeepLinkExt;
use url::Url;

enum AuthCallback {
    Nonce(String),
    Error(String),
}

fn parse_auth_callback(url: &Url) -> Option<AuthCallback> {
    if url.scheme() != "claudio" || url.host_str() != Some("auth") || url.path() != "/callback" {
        return None;
    }

    if let Some(error) = url
        .query_pairs()
        .find(|(key, _)| key == "error")
        .map(|(_, value)| value.to_string())
    {
        return Some(AuthCallback::Error(error));
    }

    url.query_pairs()
        .find(|(key, _)| key == "nonce")
        .map(|(_, value)| AuthCallback::Nonce(value.to_string()))
}

pub(crate) fn handle_auth_callback_urls<'a>(
    app: &AppHandle,
    urls: impl IntoIterator<Item = &'a Url>,
) -> bool {
    for url in urls {
        let Some(callback) = parse_auth_callback(url) else {
            continue;
        };

        match callback {
            AuthCallback::Error(error) => {
                log::warn!("Deep link auth callback returned error: {error}");
                let _ = app.emit("deep-link-auth-error", error);
                restore_main_window(app);
            }
            AuthCallback::Nonce(nonce) => {
                let handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    match auth::complete_external_login(&settings::load(), &nonce).await {
                        Ok(session) => {
                            let _ = refresh_auth_state_ui(&handle, session.is_logged_in);
                            let _ = handle.emit("deep-link-auth-complete", ());
                        }
                        Err(message) => {
                            log::error!("Deep link login failed: {message}");
                            let _ = handle.emit("deep-link-auth-error", message);
                        }
                    }
                    restore_main_window(&handle);
                });
            }
        }

        return true;
    }

    false
}

pub(crate) fn handle_initial_url(app: &AppHandle) {
    match app.deep_link().get_current() {
        Ok(Some(urls)) => {
            let _ = handle_auth_callback_urls(app, urls.iter());
        }
        Ok(None) => {}
        Err(error) => {
            log::warn!("Failed to read current deep link: {error}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{AuthCallback, parse_auth_callback};

    #[test]
    fn parses_nonce_callback() {
        let url = url::Url::parse("claudio://auth/callback?nonce=abc123").unwrap();

        match parse_auth_callback(&url) {
            Some(AuthCallback::Nonce(nonce)) => assert_eq!(nonce, "abc123"),
            Some(AuthCallback::Error(_)) => panic!("expected nonce callback"),
            None => panic!("expected callback to be parsed"),
        }
    }

    #[test]
    fn parses_error_callback() {
        let url = url::Url::parse("claudio://auth/callback?error=access_denied").unwrap();

        match parse_auth_callback(&url) {
            Some(AuthCallback::Error(error)) => assert_eq!(error, "access_denied"),
            Some(AuthCallback::Nonce(_)) => panic!("expected error callback"),
            None => panic!("expected callback to be parsed"),
        }
    }

    #[test]
    fn ignores_unrelated_urls() {
        let wrong_host = url::Url::parse("claudio://library/open").unwrap();
        let wrong_path = url::Url::parse("claudio://auth/other?nonce=abc123").unwrap();
        let wrong_scheme =
            url::Url::parse("https://example.com/auth/callback?nonce=abc123").unwrap();

        assert!(parse_auth_callback(&wrong_host).is_none());
        assert!(parse_auth_callback(&wrong_path).is_none());
        assert!(parse_auth_callback(&wrong_scheme).is_none());
    }
}
