use crate::http_client::desktop_http_client;
use crate::settings;
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
        Err(message) => cors_response(
            &http::Request::new(Vec::new()),
            http::Response::builder()
                .status(http::StatusCode::BAD_GATEWAY)
                .header(http::header::CONTENT_TYPE, "text/plain; charset=utf-8"),
        )
        .body(Cow::Owned(message.into_bytes()))
        .unwrap(),
    }
}

async fn forward_request(
    _app: &AppHandle,
    request: http::Request<Vec<u8>>,
) -> Result<http::Response<Cow<'static, [u8]>>, String> {
    forward_request_with(request, || Ok(())).await
}

async fn forward_request_with<F>(
    request: http::Request<Vec<u8>>,
    _on_logged_out: F,
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
    let mut builder = client.request(method.clone(), &target);
    builder = apply_custom_headers(builder, &settings.custom_headers)?;
    builder = apply_request_headers(builder, request.headers());

    if !request.body().is_empty() {
        builder = builder.body(request.body().clone());
    }

    log::debug!("desktop proxy {} {}", method, target);
    let response = builder.send().await.map_err(|error| error.to_string())?;
    log_proxy_response(&target, response.status(), false);

    let status = http::StatusCode::from_u16(response.status().as_u16())
        .map_err(|error| error.to_string())?;
    let mut builder = http::Response::builder().status(status);

    for (name, value) in response.headers() {
        if should_skip_response_header(name.as_str()) {
            continue;
        }

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
        _ => Err("Unsupported desktop URI target.".to_string()),
    }
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

fn apply_custom_headers(
    builder: reqwest::RequestBuilder,
    custom_headers: &std::collections::HashMap<String, String>,
) -> Result<reqwest::RequestBuilder, String> {
    let mut builder = builder;

    for (name, value) in custom_headers {
        if settings::is_forbidden_custom_header(name) {
            continue;
        }

        builder = builder.header(
            reqwest::header::HeaderName::from_bytes(name.as_bytes())
                .map_err(|error| error.to_string())?,
            reqwest::header::HeaderValue::from_str(value).map_err(|error| error.to_string())?,
        );
    }

    Ok(builder)
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

fn should_skip_response_header(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "access-control-allow-origin"
            | "access-control-allow-methods"
            | "access-control-allow-headers"
            | "access-control-expose-headers"
            | "access-control-allow-credentials"
            | "access-control-max-age"
            | "access-control-allow-private-network"
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
