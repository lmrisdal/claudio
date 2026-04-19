use super::*;
use crate::test_support::{TestResponse, TestServer};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use serde_json::json;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

fn encode_token(payload: Value) -> String {
    let header = URL_SAFE_NO_PAD.encode(r#"{"alg":"none","typ":"JWT"}"#);
    let payload = URL_SAFE_NO_PAD.encode(payload.to_string());
    format!("{header}.{payload}.")
}

fn unique_test_dir(name: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "claudio-auth-{name}-{}-{}",
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
fn parses_valid_session() {
    let token = encode_token(json!({
        "sub": "42",
        "name": "lars",
        "role": "admin",
        "exp": current_timestamp() + 3600,
    }));

    let session = parse_session(&token).expect("session should parse");
    assert!(session.is_logged_in);
    let user = session.user.expect("user should exist");
    assert_eq!(user.id, 42);
    assert_eq!(user.username, "lars");
    assert_eq!(user.role, "admin");
}

#[test]
fn rejects_expired_session() {
    let token = encode_token(json!({
        "sub": "42",
        "name": "lars",
        "role": "admin",
        "exp": current_timestamp() - 1,
    }));

    assert!(parse_session(&token).is_none());
}

#[test]
fn rejects_malformed_session() {
    assert!(parse_session("not-a-jwt").is_none());
}

#[test]
fn parses_numeric_subject_and_role_array() {
    let token = encode_token(json!({
        "sub": 7,
        "name": "alex",
        "role": ["MODERATOR", "ADMIN"],
        "exp": current_timestamp() + 3600,
    }));

    let session = parse_session(&token).expect("session should parse");
    let user = session.user.expect("user should exist");
    assert_eq!(user.id, 7);
    assert_eq!(user.username, "alex");
    assert_eq!(user.role, "moderator");
}

#[test]
fn access_token_without_exp_is_not_treated_as_expired() {
    let token = encode_token(json!({
        "sub": "42",
        "name": "lars",
        "role": "admin",
    }));

    assert!(!access_token_is_expired(&token));
}

#[test]
fn apply_custom_headers_skips_forbidden_headers() {
    let builder = apply_custom_headers(
        reqwest::Client::new().get("https://example.com"),
        &HashMap::from([
            ("X-Test".to_string(), "ok".to_string()),
            ("Authorization".to_string(), "blocked".to_string()),
            ("Cookie".to_string(), "blocked".to_string()),
        ]),
    );

    let request = builder.build().expect("request should build");

    assert_eq!(
        request
            .headers()
            .get("x-test")
            .and_then(|v| v.to_str().ok()),
        Some("ok")
    );
    assert!(!request.headers().contains_key("authorization"));
    assert!(!request.headers().contains_key("cookie"));
}

#[test]
fn server_origin_trims_trailing_slashes() {
    let settings = DesktopSettings {
        server_url: Some(" https://example.com/// ".to_string()),
        ..DesktopSettings::default()
    };

    let origin = network::server_origin(&settings).expect("origin should be built");

    assert_eq!(origin, "https://example.com");
}

#[test]
fn secure_storage_error_prefix_detection_is_exact() {
    assert!(is_secure_storage_error(
        "Secure storage unavailable: locked"
    ));
    assert!(!is_secure_storage_error("storage unavailable: locked"));
}

#[tokio::test]
async fn login_with_password_stores_tokens_in_plaintext_fallback() {
    let _auth_guard = TestAuthGuard::plain_file_secure_storage_unavailable();
    let access_token = encode_token(json!({
        "sub": "42",
        "name": "lars",
        "role": "admin",
        "exp": current_timestamp() + 3600,
    }));
    let token_for_assert = access_token.clone();
    let server = TestServer::spawn(move |request| {
        assert_eq!(request.method, "POST");
        assert_eq!(request.path, "/api/auth/token/login");
        let body = String::from_utf8_lossy(&request.body);
        assert!(body.contains("\"username\":\"lars\""));
        assert!(body.contains("\"password\":\"secret\""));
        TestResponse::json(
            200,
            &json!({
                "access_token": token_for_assert,
                "refresh_token": "refresh-1"
            })
            .to_string(),
        )
    });

    crate::settings::with_test_data_dir_async(unique_test_dir("password-login"), || async {
        let settings = test_settings(server.url());

        let session = login_with_password(&settings, "lars", "secret")
            .await
            .expect("login should succeed");

        assert!(session.is_logged_in);
        let stored = load_tokens(&settings)
            .expect("tokens should load")
            .expect("tokens should be present");
        assert_eq!(stored.refresh_token.as_deref(), Some("refresh-1"));
        assert!(fallback_tokens_path().exists());
    })
    .await;
}

#[tokio::test]
async fn refresh_access_token_clears_tokens_after_rejected_refresh() {
    let _auth_guard = TestAuthGuard::plain_file_secure_storage_unavailable();
    let server = TestServer::spawn(|request| {
        assert_eq!(request.path, "/api/auth/token/refresh");
        TestResponse::json(400, r#"{"error":"invalid_grant"}"#)
    });

    crate::settings::with_test_data_dir_async(unique_test_dir("refresh-rejected"), || async {
        let settings = test_settings(server.url());
        store_tokens(
            &settings,
            &StoredTokens {
                access_token: "expired.token.value".to_string(),
                refresh_token: Some("refresh-1".to_string()),
            },
        )
        .expect("tokens should be stored");

        let refreshed = refresh_access_token(&settings)
            .await
            .expect("refresh should not transport fail");

        assert!(refreshed.is_none());
        assert!(
            load_tokens(&settings)
                .expect("tokens should load")
                .is_none()
        );
        assert!(!fallback_tokens_path().exists());
    })
    .await;
}

#[tokio::test]
async fn restore_session_falls_back_to_me_endpoint_for_non_jwt_access_token() {
    let _auth_guard = TestAuthGuard::plain_file_secure_storage_unavailable();
    let server = TestServer::spawn(|request| match request.path.as_str() {
        "/api/auth/me" => {
            assert_eq!(
                request.headers.get("authorization").map(String::as_str),
                Some("Bearer opaque-token")
            );
            TestResponse::json(200, r#"{"id":5,"username":"lars","role":"ADMIN"}"#)
        }
        _ => TestResponse::text(404, "missing"),
    });

    crate::settings::with_test_data_dir_async(unique_test_dir("restore-session"), || async {
        let settings = test_settings(server.url());
        store_tokens(
            &settings,
            &StoredTokens {
                access_token: "opaque-token".to_string(),
                refresh_token: None,
            },
        )
        .expect("tokens should be stored");

        let session = restore_session(&settings)
            .await
            .expect("session restore should succeed");

        assert!(session.is_logged_in);
        let user = session.user.expect("user should exist");
        assert_eq!(user.id, 5);
        assert_eq!(user.username, "lars");
        assert_eq!(user.role, "admin");
    })
    .await;
}
