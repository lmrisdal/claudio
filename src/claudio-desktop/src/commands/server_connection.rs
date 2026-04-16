use crate::auth;
use crate::http_client::desktop_http_client;
use crate::settings;
use serde::Serialize;
use std::collections::HashMap;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopServerConnectionResult {
    pub ok: bool,
    pub status: Option<u16>,
}

#[tauri::command]
pub async fn desktop_check_server_connection(
    server_url: Option<String>,
    custom_headers: Option<HashMap<String, String>>,
    path: Option<String>,
) -> Result<DesktopServerConnectionResult, String> {
    let settings = settings::load();
    let origin = server_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.trim_end_matches('/').to_string())
        .or_else(|| {
            settings
                .server_url
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|value| value.trim_end_matches('/').to_string())
        })
        .ok_or_else(|| "Desktop server URL is not configured.".to_string())?;
    let custom_headers = custom_headers
        .map(|headers| settings::sanitize_custom_headers(&headers))
        .unwrap_or_else(|| settings.custom_headers.clone());
    let path = normalize_path(path.as_deref().unwrap_or("/health"))?;
    let client = desktop_http_client()?;
    let response = auth::apply_custom_headers(client.get(format!("{origin}{path}")), &custom_headers)
        .send()
        .await
        .map_err(|error| error.to_string())?;

    Ok(DesktopServerConnectionResult {
        ok: response.status().is_success(),
        status: Some(response.status().as_u16()),
    })
}

fn normalize_path(path: &str) -> Result<&str, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Connection test path is required.".to_string());
    }
    if !trimmed.starts_with('/') {
        return Err("Connection test path must start with '/'.".to_string());
    }
    Ok(trimmed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::{DesktopSettings, with_test_data_dir_async};
    use crate::test_support::{TestResponse, TestServer};
    use std::collections::HashMap;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_test_dir(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "claudio-server-connection-{name}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time should be after epoch")
                .as_nanos()
        ))
    }

    fn test_settings(server_url: &str) -> DesktopSettings {
        DesktopSettings {
            server_url: Some(server_url.to_string()),
            allow_insecure_auth_storage: true,
            ..DesktopSettings::default()
        }
    }

    #[test]
    fn normalize_path_requires_leading_slash() {
        let error = normalize_path("health").expect_err("path should be rejected");

        assert_eq!(error, "Connection test path must start with '/'.");
    }

    #[tokio::test]
    async fn desktop_check_server_connection_uses_override_headers() {
        let server = TestServer::spawn(|request| {
            assert_eq!(request.path, "/api/auth/providers");
            assert_eq!(request.headers.get("x-test").map(String::as_str), Some("ok"));
            TestResponse::json(200, r#"{"providers":[]}"#)
        });

        with_test_data_dir_async(unique_test_dir("override-headers"), || async {
            let result = desktop_check_server_connection(
                Some(server.url().to_string()),
                Some(HashMap::from([("X-Test".to_string(), "ok".to_string())])),
                Some("/api/auth/providers".to_string()),
            )
            .await
            .expect("connection check should succeed");

            assert!(result.ok);
            assert_eq!(result.status, Some(200));
        })
        .await;
    }

    #[tokio::test]
    async fn desktop_check_server_connection_uses_saved_settings_when_overrides_missing() {
        let server = TestServer::spawn(|request| {
            assert_eq!(request.path, "/health");
            assert_eq!(request.headers.get("x-saved").map(String::as_str), Some("ok"));
            TestResponse::text(200, "ok")
        });

        with_test_data_dir_async(unique_test_dir("saved-settings"), || async {
            let mut saved = test_settings(server.url());
            saved.custom_headers = HashMap::from([("X-Saved".to_string(), "ok".to_string())]);
            crate::settings::save(&saved).expect("settings should save");

            let result = desktop_check_server_connection(None, None, None)
                .await
                .expect("connection check should succeed");

            assert!(result.ok);
            assert_eq!(result.status, Some(200));
        })
        .await;
    }

    #[tokio::test]
    async fn desktop_check_server_connection_reports_http_failure_status() {
        let server = TestServer::spawn(|request| {
            assert_eq!(request.path, "/health");
            TestResponse::text(503, "down")
        });

        with_test_data_dir_async(unique_test_dir("http-failure"), || async {
            let result = desktop_check_server_connection(
                Some(server.url().to_string()),
                Some(HashMap::new()),
                None,
            )
            .await
            .expect("connection check should complete");

            assert!(!result.ok);
            assert_eq!(result.status, Some(503));
        })
        .await;
    }
}
