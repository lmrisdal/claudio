use super::*;
use crate::auth::{StoredTokens, TestAuthGuard, store_tokens};
use crate::settings::{DesktopSettings, with_test_data_dir_async};
use crate::test_support::{TestResponse, TestServer};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::thread;
use std::time::Duration;
use std::time::{SystemTime, UNIX_EPOCH};

fn unique_test_dir(name: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "claudio-protocol-{name}-{}-{}",
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
fn target_url_maps_api_requests() {
    let uri: http::Uri = "claudio://api/library?page=2"
        .parse()
        .expect("uri should parse");

    let target = target_url("https://example.com", &uri).expect("target should build");

    assert_eq!(target, "https://example.com/api/library?page=2");
}

#[test]
fn target_url_maps_auth_token_requests() {
    let uri: http::Uri = "claudio://api/auth/token/refresh"
        .parse()
        .expect("uri should parse");

    let target = target_url("https://example.com", &uri).expect("target should build");

    assert_eq!(target, "https://example.com/api/auth/token/refresh");
}

#[test]
fn target_url_rejects_unsupported_hosts() {
    let uri: http::Uri = "claudio://assets/file".parse().expect("uri should parse");

    let error = target_url("https://example.com", &uri).expect_err("host should be rejected");

    assert_eq!(error, "Unsupported desktop URI target.");
}

#[test]
fn authenticated_route_excludes_token_exchange() {
    let api_uri: http::Uri = "claudio://api/games".parse().expect("uri should parse");
    let token_uri: http::Uri = "claudio://api/auth/token/refresh"
        .parse()
        .expect("uri should parse");
    let providers_uri: http::Uri = "claudio://api/auth/providers".parse().expect("uri should parse");

    assert!(is_authenticated_route(&api_uri));
    assert!(!is_authenticated_route(&token_uri));
    assert!(!is_authenticated_route(&providers_uri));
}

#[test]
fn apply_request_headers_skips_blocked_headers() {
    let mut headers = http::HeaderMap::new();
    headers.insert("x-test", http::HeaderValue::from_static("ok"));
    headers.insert(
        http::header::AUTHORIZATION,
        http::HeaderValue::from_static("secret"),
    );
    headers.insert(
        http::header::ORIGIN,
        http::HeaderValue::from_static("https://client"),
    );

    let request =
        apply_request_headers(reqwest::Client::new().get("https://example.com"), &headers)
            .build()
            .expect("request should build");

    assert_eq!(
        request
            .headers()
            .get("x-test")
            .and_then(|v| v.to_str().ok()),
        Some("ok")
    );
    assert!(
        !request
            .headers()
            .contains_key(http::header::AUTHORIZATION.as_str())
    );
    assert!(
        !request
            .headers()
            .contains_key(http::header::ORIGIN.as_str())
    );
}

#[test]
fn should_skip_response_header_blocks_upstream_cors_headers() {
    assert!(should_skip_response_header("Access-Control-Allow-Origin"));
    assert!(should_skip_response_header("access-control-allow-methods"));
    assert!(should_skip_response_header("ACCESS-CONTROL-EXPOSE-HEADERS"));
    assert!(!should_skip_response_header("content-type"));
}

#[test]
fn cors_response_reflects_origin_and_requested_headers() {
    let request = http::Request::builder()
        .uri("claudio://api/games")
        .header(http::header::ORIGIN, "https://client.example")
        .header("access-control-request-headers", "content-type,x-test")
        .body(Vec::new())
        .expect("request should build");

    let response = cors_response(
        &request,
        http::Response::builder().status(http::StatusCode::OK),
    )
    .body(Vec::<u8>::new())
    .expect("response should build");

    assert_eq!(
        response
            .headers()
            .get(http::header::ACCESS_CONTROL_ALLOW_ORIGIN)
            .and_then(|v| v.to_str().ok()),
        Some("https://client.example")
    );
    assert_eq!(
        response
            .headers()
            .get(http::header::ACCESS_CONTROL_ALLOW_HEADERS)
            .and_then(|v| v.to_str().ok()),
        Some("content-type,x-test")
    );
}

#[tokio::test]
async fn forward_request_attaches_bearer_token_for_authenticated_routes() {
    let _auth_guard = TestAuthGuard::plain_file_secure_storage_unavailable();
    let server = TestServer::spawn(|request| {
        assert_eq!(
            request.headers.get("authorization").map(String::as_str),
            Some("Bearer access-token")
        );
        TestResponse::json(200, r#"{"ok":true}"#)
    });

    with_test_data_dir_async(unique_test_dir("auth-route"), || async {
        let settings = test_settings(server.url());
        crate::settings::save(&settings).expect("settings should save");
        store_tokens(
            &settings,
            &StoredTokens {
                access_token: "access-token".to_string(),
                refresh_token: Some("refresh-token".to_string()),
            },
        )
        .expect("tokens should store");

        let request = http::Request::builder()
            .method(http::Method::GET)
            .uri("claudio://api/games")
            .body(Vec::new())
            .expect("request should build");

        let response = forward_request_with(request, || Ok(()))
            .await
            .expect("request should forward");

        assert_eq!(response.status(), http::StatusCode::OK);
    })
    .await;
}

#[tokio::test]
async fn forward_request_refreshes_after_unauthorized_response() {
    let _auth_guard = TestAuthGuard::plain_file_secure_storage_unavailable();
    let api_attempts = Arc::new(AtomicUsize::new(0));
    let api_attempts_for_server = api_attempts.clone();
    let server = TestServer::spawn(move |request| match request.path.as_str() {
        "/api/games" => {
            let attempt = api_attempts_for_server.fetch_add(1, Ordering::SeqCst);
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
                TestResponse::json(200, r#"{"retried":true}"#)
            }
        }
        "/api/auth/token/refresh" => TestResponse::json(
            200,
            r#"{"access_token":"fresh-token","refresh_token":"fresh-refresh"}"#,
        ),
        _ => TestResponse::text(404, "missing"),
    });

    with_test_data_dir_async(unique_test_dir("refresh"), || async {
        let settings = test_settings(server.url());
        crate::settings::save(&settings).expect("settings should save");
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

        let response = forward_request_with(request, || Ok(()))
            .await
            .expect("request should forward");

        assert_eq!(response.status(), http::StatusCode::OK);
        let stored = crate::auth::load_tokens(&settings)
            .expect("tokens should load")
            .expect("tokens should exist");
        assert_eq!(stored.access_token, "fresh-token");
        assert_eq!(stored.refresh_token.as_deref(), Some("fresh-refresh"));
    })
    .await;
}

#[tokio::test]
async fn forward_request_notifies_logout_when_refresh_fails() {
    let _auth_guard = TestAuthGuard::plain_file_secure_storage_unavailable();
    let logout_calls = Arc::new(AtomicUsize::new(0));
    let server = TestServer::spawn(|request| match request.path.as_str() {
        "/api/games" => TestResponse::text(401, "expired"),
        "/api/auth/token/refresh" => TestResponse::json(400, r#"{"error":"invalid_grant"}"#),
        _ => TestResponse::text(404, "missing"),
    });

    with_test_data_dir_async(unique_test_dir("logout"), || async {
        let settings = test_settings(server.url());
        crate::settings::save(&settings).expect("settings should save");
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
        let response = forward_request_with(request, move || {
            logout_counter.fetch_add(1, Ordering::SeqCst);
            Ok(())
        })
        .await
        .expect("request should forward");

        assert_eq!(response.status(), http::StatusCode::UNAUTHORIZED);
        assert_eq!(logout_calls.load(Ordering::SeqCst), 1);
        assert!(
            crate::auth::load_tokens(&settings)
                .expect("tokens should load")
                .is_none()
        );
    })
    .await;
}

#[tokio::test]
async fn forward_request_passes_through_unknown_5xx_statuses() {
    let _auth_guard = TestAuthGuard::plain_file_secure_storage_unavailable();
    let server = TestServer::spawn(|request| match request.path.as_str() {
        "/api/games" => TestResponse::text(526, "invalid certificate"),
        _ => TestResponse::text(404, "missing"),
    });

    with_test_data_dir_async(unique_test_dir("proxy-526"), || async {
        let settings = test_settings(server.url());
        crate::settings::save(&settings).expect("settings should save");
        store_tokens(
            &settings,
            &StoredTokens {
                access_token: "access-token".to_string(),
                refresh_token: Some("refresh-token".to_string()),
            },
        )
        .expect("tokens should store");

        let request = http::Request::builder()
            .method(http::Method::GET)
            .uri("claudio://api/games")
            .body(Vec::new())
            .expect("request should build");

        let response = forward_request_with(request, || Ok(()))
            .await
            .expect("proxy request should complete");

        assert_eq!(response.status().as_u16(), 526);
    })
    .await;
}

#[tokio::test]
async fn forward_request_rewrites_upstream_cors_headers() {
    let _auth_guard = TestAuthGuard::plain_file_secure_storage_unavailable();
    let server = TestServer::spawn(|request| match request.path.as_str() {
        "/api/games" => TestResponse {
            status: 200,
            headers: vec![
                ("access-control-allow-origin".to_string(), "*".to_string()),
                (
                    "access-control-expose-headers".to_string(),
                    "x-upstream".to_string(),
                ),
                ("content-type".to_string(), "application/json".to_string()),
            ],
            body: br#"{"ok":true}"#.to_vec(),
        },
        _ => TestResponse::text(404, "missing"),
    });

    with_test_data_dir_async(unique_test_dir("proxy-cors-rewrite"), || async {
        let settings = test_settings(server.url());
        crate::settings::save(&settings).expect("settings should save");
        store_tokens(
            &settings,
            &StoredTokens {
                access_token: "access-token".to_string(),
                refresh_token: Some("refresh-token".to_string()),
            },
        )
        .expect("tokens should store");

        let request = http::Request::builder()
            .method(http::Method::GET)
            .uri("claudio://api/games")
            .header(http::header::ORIGIN, "http://tauri.localhost")
            .header("access-control-request-headers", "content-type")
            .body(Vec::new())
            .expect("request should build");

        let response = forward_request_with(request, || Ok(()))
            .await
            .expect("proxy request should complete");

        assert_eq!(response.status(), http::StatusCode::OK);
        assert_eq!(
            response
                .headers()
                .get(http::header::ACCESS_CONTROL_ALLOW_ORIGIN)
                .and_then(|value| value.to_str().ok()),
            Some("http://tauri.localhost")
        );
        assert_eq!(
            response
                .headers()
                .get_all(http::header::ACCESS_CONTROL_ALLOW_ORIGIN)
                .iter()
                .count(),
            1
        );
        assert_eq!(
            response
                .headers()
                .get(http::header::ACCESS_CONTROL_EXPOSE_HEADERS)
                .and_then(|value| value.to_str().ok()),
            Some("*")
        );
    })
    .await;
}

#[tokio::test]
async fn forward_request_times_out_when_origin_stalls() {
    let _auth_guard = TestAuthGuard::plain_file_secure_storage_unavailable();
    let listener = TcpListener::bind("127.0.0.1:0").expect("stall server should bind");
    let address = listener
        .local_addr()
        .expect("stall server should have an address");
    let handle = thread::spawn(move || {
        if let Ok((mut stream, _)) = listener.accept() {
            let mut buffer = [0_u8; 1024];
            let _ = stream.read(&mut buffer);
            thread::sleep(Duration::from_secs(8));
            let _ = stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok");
        }
    });

    with_test_data_dir_async(unique_test_dir("proxy-timeout"), || async move {
        let settings = test_settings(&format!("http://{address}"));
        crate::settings::save(&settings).expect("settings should save");
        store_tokens(
            &settings,
            &StoredTokens {
                access_token: "access-token".to_string(),
                refresh_token: Some("refresh-token".to_string()),
            },
        )
        .expect("tokens should store");

        let request = http::Request::builder()
            .method(http::Method::GET)
            .uri("claudio://api/games")
            .body(Vec::new())
            .expect("request should build");

        let forwarded = tokio::time::timeout(
            Duration::from_secs(5),
            forward_request_with(request, || Ok(())),
        )
        .await;

        assert!(
            forwarded.is_ok(),
            "proxy request should fail fast when origin stalls"
        );
    })
    .await;

    let _ = handle.join();
}
