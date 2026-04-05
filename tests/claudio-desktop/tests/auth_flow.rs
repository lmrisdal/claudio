use claudio_desktop::integration_test_api::{
    PlaintextAuthGuard, StoredTokens, load_tokens, login_with_password, refresh_access_token,
    restore_session, save_settings, store_tokens, with_test_data_dir_async,
};
use claudio_desktop_tests::support::fixtures::desktop_settings;
use claudio_desktop_tests::support::fs::TestWorkspace;
use claudio_desktop_tests::support::http::{TestResponse, TestServer};
use serde_json::json;
use serial_test::serial;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

fn jwt(payload: serde_json::Value) -> String {
    use base64::Engine as _;
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;

    let header = URL_SAFE_NO_PAD.encode(r#"{"alg":"none","typ":"JWT"}"#);
    let payload = URL_SAFE_NO_PAD.encode(payload.to_string());
    format!("{header}.{payload}.")
}

#[tokio::test]
#[serial]
async fn auth_flow_logs_in_and_restores_session() {
    let _auth_guard = PlaintextAuthGuard::new();
    let workspace = TestWorkspace::new();
    let access_token = jwt(json!({
        "sub": "42",
        "name": "lars",
        "role": "admin",
        "exp": 4_102_444_800_i64,
    }));
    let access_token_for_server = access_token.clone();
    let server = TestServer::spawn(move |request| match request.path.as_str() {
        "/connect/token" => {
            assert!(String::from_utf8_lossy(&request.body).contains("grant_type=password"));
            TestResponse::json(
                200,
                &json!({
                    "access_token": access_token_for_server,
                    "refresh_token": "refresh-1"
                })
                .to_string(),
            )
        }
        _ => TestResponse::text(404, "missing"),
    });

    with_test_data_dir_async(workspace.data_dir.clone(), || async {
        let settings = desktop_settings(server.url());
        save_settings(&settings).expect("settings should save");

        let session = login_with_password(&settings, "lars", "secret")
            .await
            .expect("login should succeed");
        assert!(session.is_logged_in);

        let restored = restore_session(&settings)
            .await
            .expect("session restore should succeed");
        assert!(restored.is_logged_in);
        assert_eq!(
            load_tokens(&settings)
                .expect("tokens should load")
                .unwrap()
                .refresh_token
                .as_deref(),
            Some("refresh-1")
        );
    })
    .await;
}

#[tokio::test]
#[serial]
async fn auth_flow_refreshes_and_replaces_tokens() {
    let _auth_guard = PlaintextAuthGuard::new();
    let workspace = TestWorkspace::new();
    let refresh_calls = Arc::new(AtomicUsize::new(0));
    let refresh_calls_for_server = refresh_calls.clone();
    let server = TestServer::spawn(move |request| {
        refresh_calls_for_server.fetch_add(1, Ordering::SeqCst);
        match request.path.as_str() {
            "/connect/token" => TestResponse::json(
                200,
                r#"{"access_token":"fresh-token","refresh_token":"fresh-refresh"}"#,
            ),
            _ => TestResponse::text(404, "missing"),
        }
    });

    with_test_data_dir_async(workspace.data_dir.clone(), || async {
        let settings = desktop_settings(server.url());
        save_settings(&settings).expect("settings should save");
        store_tokens(
            &settings,
            &StoredTokens {
                access_token: "expired-token".to_string(),
                refresh_token: Some("refresh-1".to_string()),
            },
        )
        .expect("tokens should store");

        let refreshed = refresh_access_token(&settings)
            .await
            .expect("refresh should succeed");

        assert_eq!(refreshed.as_deref(), Some("fresh-token"));
        let stored = load_tokens(&settings).expect("tokens should load").unwrap();
        assert_eq!(stored.refresh_token.as_deref(), Some("fresh-refresh"));
        assert_eq!(refresh_calls.load(Ordering::SeqCst), 1);
    })
    .await;
}
