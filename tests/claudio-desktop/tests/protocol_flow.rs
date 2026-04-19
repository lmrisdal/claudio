use claudio_desktop::integration_test_api::{
    PlaintextAuthGuard, StoredTokens, forward_protocol_request, http, load_tokens, save_settings,
    store_tokens, with_test_data_dir_async,
};
use claudio_desktop_tests::support::fixtures::desktop_settings;
use claudio_desktop_tests::support::fs::TestWorkspace;
use claudio_desktop_tests::support::http::{TestResponse, TestServer};
use serial_test::serial;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

#[tokio::test]
#[serial]
async fn protocol_flow_refreshes_and_retries_authenticated_requests() {
    let _auth_guard = PlaintextAuthGuard::new();
    let workspace = TestWorkspace::new();
    let attempts = Arc::new(AtomicUsize::new(0));
    let attempts_for_server = attempts.clone();
    let server = TestServer::spawn(move |request| match request.path.as_str() {
        "/api/games" => {
            let attempt = attempts_for_server.fetch_add(1, Ordering::SeqCst);
            if attempt == 0 {
                assert_eq!(
                    request.headers.get("authorization").map(String::as_str),
                    Some("Bearer stale-token")
                );
                TestResponse::text(401, "expired")
            } else {
                assert_eq!(
                    request.headers.get("authorization").map(String::as_str),
                    Some("Bearer fresh-token")
                );
                TestResponse::json(200, r#"{"ok":true}"#)
            }
        }
        "/api/auth/token/refresh" => TestResponse::json(
            200,
            r#"{"access_token":"fresh-token","refresh_token":"fresh-refresh"}"#,
        ),
        _ => TestResponse::text(404, "missing"),
    });

    with_test_data_dir_async(workspace.data_dir.clone(), || async {
        let settings = desktop_settings(server.url());
        save_settings(&settings).expect("settings should save");
        store_tokens(
            &settings,
            &StoredTokens {
                access_token: "stale-token".to_string(),
                refresh_token: Some("refresh-token".to_string()),
            },
        )
        .expect("tokens should store");

        let request = http::Request::builder()
            .method(http::Method::GET)
            .uri("claudio://api/games")
            .body(Vec::new())
            .expect("request should build");

        let response = forward_protocol_request(request, || Ok(()))
            .await
            .expect("protocol forward should succeed");

        assert_eq!(response.status(), http::StatusCode::OK);
        assert_eq!(attempts.load(Ordering::SeqCst), 2);
    })
    .await;
}

#[tokio::test]
#[serial]
async fn protocol_flow_clears_tokens_when_refresh_fails() {
    let _auth_guard = PlaintextAuthGuard::new();
    let workspace = TestWorkspace::new();
    let logout_calls = Arc::new(AtomicUsize::new(0));
    let server = TestServer::spawn(|request| match request.path.as_str() {
        "/api/games" => TestResponse::text(401, "expired"),
        "/api/auth/token/refresh" => TestResponse::json(400, r#"{"error":"invalid_grant"}"#),
        _ => TestResponse::text(404, "missing"),
    });

    with_test_data_dir_async(workspace.data_dir.clone(), || async {
        let settings = desktop_settings(server.url());
        save_settings(&settings).expect("settings should save");
        store_tokens(
            &settings,
            &StoredTokens {
                access_token: "stale-token".to_string(),
                refresh_token: Some("refresh-token".to_string()),
            },
        )
        .expect("tokens should store");

        let request = http::Request::builder()
            .method(http::Method::GET)
            .uri("claudio://api/games")
            .body(Vec::new())
            .expect("request should build");

        let logout_counter = logout_calls.clone();
        let response = forward_protocol_request(request, move || {
            logout_counter.fetch_add(1, Ordering::SeqCst);
            Ok(())
        })
        .await
        .expect("protocol forward should succeed");

        assert_eq!(response.status(), http::StatusCode::UNAUTHORIZED);
        assert!(
            load_tokens(&settings)
                .expect("tokens should load")
                .is_none()
        );
        assert_eq!(logout_calls.load(Ordering::SeqCst), 1);
    })
    .await;
}
