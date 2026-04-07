use crate::http_client::desktop_http_client;
use crate::{auth, refresh_auth_state_ui, settings};
use reqwest::Method;
use std::borrow::Cow;
use tauri::AppHandle;
use tauri::http;

pub async fn handle_request(
    app: &AppHandle,
    request: http::Request<Vec<u8>>,
) -> http::Response<Cow<'static, [u8]>> {
    if request.method() == http::Method::OPTIONS {
        return cors_response(
            &request,
            http::Response::builder().status(http::StatusCode::NO_CONTENT),
        )
        .body(Cow::Borrowed(&[] as &[u8]))
        .unwrap();
    }

    match forward_request(app, request).await {
        Ok(response) => response,
        Err(message) => {
            auth::maybe_show_secure_storage_dialog(app, &message);
            cors_response(
                &http::Request::new(Vec::new()),
                http::Response::builder()
                    .status(http::StatusCode::BAD_GATEWAY)
                    .header(http::header::CONTENT_TYPE, "text/plain; charset=utf-8"),
            )
            .body(Cow::Owned(message.into_bytes()))
            .unwrap()
        }
    }
}

async fn forward_request(
    app: &AppHandle,
    request: http::Request<Vec<u8>>,
) -> Result<http::Response<Cow<'static, [u8]>>, String> {
    forward_request_with(request, || refresh_auth_state_ui(app, false)).await
}

async fn forward_request_with<F>(
    request: http::Request<Vec<u8>>,
    mut on_logged_out: F,
) -> Result<http::Response<Cow<'static, [u8]>>, String>
where
    F: FnMut() -> Result<(), String>,
{
    let settings = settings::load();
    let origin = settings
        .server_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.trim_end_matches('/').to_string())
        .ok_or_else(|| "Desktop server URL is not configured.".to_string())?;
    let target = target_url(&origin, request.uri())?;
    let method = Method::from_bytes(request.method().as_str().as_bytes())
        .map_err(|error| error.to_string())?;
    let client = desktop_http_client()?;
    let mut attached_auth = false;

    let mut builder = client.request(method.clone(), &target);
    builder = auth::apply_custom_headers(builder, &settings.custom_headers);
    builder = apply_request_headers(builder, request.headers());

    if !request.body().is_empty() {
        builder = builder.body(request.body().clone());
    }

    let builder_with_auth = if is_authenticated_route(request.uri()) {
        let had_tokens = auth::load_tokens(&settings)?.is_some();
        if let Some(access_token) = auth::access_token_for_request(&settings).await? {
            attached_auth = true;
            builder.bearer_auth(access_token)
        } else {
            if had_tokens {
                let _ = on_logged_out();
            }
            builder
        }
    } else {
        builder
    };

    let retry_builder = builder_with_auth.try_clone();
    log::debug!(
        "desktop proxy {} {} auth_attached={}",
        method,
        target,
        attached_auth
    );
    let response = builder_with_auth
        .send()
        .await
        .map_err(|error| error.to_string())?;
    log_proxy_response(&target, response.status(), false);

    let response = if response.status() == reqwest::StatusCode::UNAUTHORIZED
        && is_authenticated_route(request.uri())
    {
        log::warn!(
            "desktop proxy unauthorized for {}, attempting refresh",
            target
        );
        match (retry_builder, auth::refresh_access_token(&settings).await?) {
            (Some(retry_builder), Some(access_token)) => {
                let retried = retry_builder
                    .bearer_auth(access_token)
                    .send()
                    .await
                    .map_err(|error| error.to_string())?;
                log_proxy_response(&target, retried.status(), true);
                retried
            }
            _ => {
                let _ = on_logged_out();
                response
            }
        }
    } else {
        response
    };

    let status = http::StatusCode::from_u16(response.status().as_u16())
        .map_err(|error| error.to_string())?;
    let mut builder = http::Response::builder().status(status);

    for (name, value) in response.headers() {
        builder = builder.header(name.as_str(), value.as_bytes());
    }

    let body = response.bytes().await.map_err(|error| error.to_string())?;

    cors_response(&request, builder)
        .body(Cow::Owned(body.to_vec()))
        .map_err(|error| error.to_string())
}

#[cfg(feature = "integration-tests")]
pub(crate) async fn forward_request_for_tests<F>(
    request: http::Request<Vec<u8>>,
    on_logged_out: F,
) -> Result<http::Response<Cow<'static, [u8]>>, String>
where
    F: FnMut() -> Result<(), String>,
{
    forward_request_with(request, on_logged_out).await
}

fn target_url(origin: &str, uri: &http::Uri) -> Result<String, String> {
    let path_and_query = uri
        .path_and_query()
        .map(http::uri::PathAndQuery::as_str)
        .unwrap_or("/");

    match uri.host() {
        Some("api") => Ok(format!("{origin}/api{path_and_query}")),
        Some("connect") => Ok(format!("{origin}/connect{path_and_query}")),
        _ => Err("Unsupported desktop URI target.".to_string()),
    }
}

fn is_authenticated_route(uri: &http::Uri) -> bool {
    matches!(uri.host(), Some("api") | Some("connect"))
        && !matches!(uri.host(), Some("connect") if uri.path() == "/token")
}

fn apply_request_headers(
    builder: reqwest::RequestBuilder,
    headers: &http::HeaderMap,
) -> reqwest::RequestBuilder {
    let mut builder = builder;

    for (name, value) in headers {
        if should_skip_request_header(name.as_str()) {
            continue;
        }

        builder = builder.header(name.as_str(), value.as_bytes());
    }

    builder
}

fn should_skip_request_header(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "authorization"
            | "host"
            | "origin"
            | "referer"
            | "content-length"
            | "access-control-request-method"
            | "access-control-request-headers"
    )
}

fn log_proxy_response(target: &str, status: reqwest::StatusCode, is_retry: bool) {
    let label = if is_retry {
        "desktop proxy retry response"
    } else {
        "desktop proxy response"
    };

    if status.as_u16() == 526 {
        log::warn!(
            "{label} {target} {status} (origin TLS/certificate issue while using upstream proxy)"
        );
    } else if status.is_server_error() {
        log::warn!("{label} {target} {status}");
    } else if status.is_client_error() {
        log::info!("{label} {target} {status}");
    } else {
        log::debug!("{label} {target} {status}");
    }
}

fn cors_response(
    request: &http::Request<Vec<u8>>,
    mut builder: http::response::Builder,
) -> http::response::Builder {
    let allow_origin = request
        .headers()
        .get(http::header::ORIGIN)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("*");
    let allow_headers = request
        .headers()
        .get("access-control-request-headers")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("content-type");

    builder = builder
        .header(http::header::ACCESS_CONTROL_ALLOW_ORIGIN, allow_origin)
        .header(
            http::header::ACCESS_CONTROL_ALLOW_METHODS,
            "GET, POST, PUT, DELETE, OPTIONS",
        )
        .header(http::header::ACCESS_CONTROL_ALLOW_HEADERS, allow_headers)
        .header(http::header::ACCESS_CONTROL_EXPOSE_HEADERS, "*");

    builder
}

#[cfg(test)]
mod tests {
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
    fn target_url_maps_connect_requests() {
        let uri: http::Uri = "claudio://connect/token".parse().expect("uri should parse");

        let target = target_url("https://example.com", &uri).expect("target should build");

        assert_eq!(target, "https://example.com/connect/token");
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
        let token_uri: http::Uri = "claudio://connect/token".parse().expect("uri should parse");
        let userinfo_uri: http::Uri = "claudio://connect/userinfo"
            .parse()
            .expect("uri should parse");

        assert!(is_authenticated_route(&api_uri));
        assert!(!is_authenticated_route(&token_uri));
        assert!(is_authenticated_route(&userinfo_uri));
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
            "/connect/token" => TestResponse::json(
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
            "/connect/token" => TestResponse::json(400, r#"{"error":"invalid_grant"}"#),
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
                let _ = stream.write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok",
                );
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

            assert!(forwarded.is_ok(), "proxy request should fail fast when origin stalls");
        })
        .await;

        let _ = handle.join();
    }
}
