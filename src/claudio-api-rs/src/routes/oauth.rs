use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::Redirect,
    routing::get,
    Router,
};
use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde::Deserialize;

use crate::{
    services::oauth::{self, find_or_create_user, OAuthError},
    state::AppState,
};

fn sanitize_return_to(value: Option<String>) -> String {
    match value {
        // Allow the desktop deep-link scheme
        Some(v) if v.starts_with("claudio://") => v,
        // Allow desktop localhost callback (loopback only)
        Some(v) if v.starts_with("http://127.0.0.1:") => v,
        // Must start with "/" but not "//" (protocol-relative URL)
        Some(v) if v.starts_with('/') && !v.starts_with("//") => v,
        _ => "/".to_string(),
    }
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/auth/github/start", get(github_start))
        .route("/api/auth/github/callback", get(github_callback))
        .route("/api/auth/google/start", get(google_start))
        .route("/api/auth/google/callback", get(google_callback))
        .route("/api/auth/oidc/{slug}/start", get(oidc_start))
        .route("/api/auth/oidc/{slug}/callback", get(oidc_callback))
}

#[derive(Deserialize)]
struct StartQuery {
    #[serde(rename = "returnTo")]
    return_to: Option<String>,
}

#[derive(Deserialize)]
struct CallbackQuery {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

async fn github_start(
    State(state): State<Arc<AppState>>,
    Query(query): Query<StartQuery>,
) -> Result<Redirect, (StatusCode, String)> {
    if !state.config.auth.github.is_configured() {
        return Err((StatusCode::NOT_FOUND, "not found".to_string()));
    }

    let return_to = sanitize_return_to(query.return_to);
    let csrf = state.github_state_store.create(&return_to);
    let url = oauth::github::build_auth_url(&state.config.auth.github, &csrf);

    Ok(Redirect::to(&url))
}

async fn github_callback(
    State(state): State<Arc<AppState>>,
    Query(query): Query<CallbackQuery>,
) -> Result<Redirect, (StatusCode, String)> {
    let csrf = query
        .state
        .ok_or_else(|| (StatusCode::BAD_REQUEST, "missing state".to_string()))?;
    let return_to = state.github_state_store.consume(&csrf).ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            "invalid or expired state".to_string(),
        )
    })?;

    if let Some(ref error) = query.error {
        tracing::warn!(error, "GitHub OAuth provider returned an error");
        let encoded = utf8_percent_encode(error, NON_ALPHANUMERIC).to_string();
        return Ok(Redirect::to(&format!("{return_to}?error={encoded}")));
    }

    let code = query
        .code
        .ok_or_else(|| (StatusCode::BAD_REQUEST, "missing code".to_string()))?;

    let user_info =
        oauth::github::exchange_code(&state.config.auth.github, &state.http_client, &code)
            .await
            .map_err(|e| {
                tracing::warn!("GitHub code exchange failed: {e}");
                (StatusCode::BAD_GATEWAY, "OAuth error".to_string())
            })?;

    let user_id = find_or_create_user(
        &state.db,
        "GitHub",
        &user_info,
        state.config.auth.disable_user_creation,
    )
    .await
    .map_err(|e| match e {
        OAuthError::UserCreationDisabled => (StatusCode::FORBIDDEN, e.to_string()),
        _ => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    })?;

    let nonce = state.external_login_nonce_store.create(user_id);
    let encoded_nonce = utf8_percent_encode(&nonce, NON_ALPHANUMERIC).to_string();

    Ok(Redirect::to(&format!("{return_to}?nonce={encoded_nonce}")))
}

async fn google_start(
    State(state): State<Arc<AppState>>,
    Query(query): Query<StartQuery>,
) -> Result<Redirect, (StatusCode, String)> {
    if !state.config.auth.google.is_configured() {
        return Err((StatusCode::NOT_FOUND, "not found".to_string()));
    }

    let return_to = sanitize_return_to(query.return_to);
    let csrf = state.google_state_store.create(&return_to);
    let url = oauth::google::build_auth_url(&state.config.auth.google, &csrf);

    Ok(Redirect::to(&url))
}

async fn google_callback(
    State(state): State<Arc<AppState>>,
    Query(query): Query<CallbackQuery>,
) -> Result<Redirect, (StatusCode, String)> {
    let csrf = query
        .state
        .ok_or_else(|| (StatusCode::BAD_REQUEST, "missing state".to_string()))?;
    let return_to = state.google_state_store.consume(&csrf).ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            "invalid or expired state".to_string(),
        )
    })?;

    if let Some(ref error) = query.error {
        tracing::warn!(error, "Google OAuth provider returned an error");
        let encoded = utf8_percent_encode(error, NON_ALPHANUMERIC).to_string();
        return Ok(Redirect::to(&format!("{return_to}?error={encoded}")));
    }

    let code = query
        .code
        .ok_or_else(|| (StatusCode::BAD_REQUEST, "missing code".to_string()))?;

    let user_info =
        oauth::google::exchange_code(&state.config.auth.google, &state.http_client, &code)
            .await
            .map_err(|e| {
                tracing::warn!("Google code exchange failed: {e}");
                (StatusCode::BAD_GATEWAY, "OAuth error".to_string())
            })?;

    let user_id = find_or_create_user(
        &state.db,
        "Google",
        &user_info,
        state.config.auth.disable_user_creation,
    )
    .await
    .map_err(|e| match e {
        OAuthError::UserCreationDisabled => (StatusCode::FORBIDDEN, e.to_string()),
        _ => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    })?;

    let nonce = state.external_login_nonce_store.create(user_id);
    let encoded_nonce = utf8_percent_encode(&nonce, NON_ALPHANUMERIC).to_string();

    Ok(Redirect::to(&format!("{return_to}?nonce={encoded_nonce}")))
}

async fn oidc_start(
    State(state): State<Arc<AppState>>,
    Path(slug): Path<String>,
    Query(query): Query<StartQuery>,
) -> Result<Redirect, (StatusCode, String)> {
    let Some(oidc_config) = state.config.auth.find_oidc_provider(&slug) else {
        return Err((StatusCode::NOT_FOUND, "not found".to_string()));
    };

    let return_to = sanitize_return_to(query.return_to);
    let csrf = state.oidc_state_store.create(&return_to);

    let url = oauth::oidc::build_auth_url(oidc_config, &state.http_client, &csrf)
        .await
        .map_err(|e| {
            tracing::warn!("OIDC discovery failed: {e}");
            (
                StatusCode::BAD_GATEWAY,
                "failed to contact OIDC provider".to_string(),
            )
        })?;

    Ok(Redirect::to(&url))
}

async fn oidc_callback(
    State(state): State<Arc<AppState>>,
    Path(slug): Path<String>,
    Query(query): Query<CallbackQuery>,
) -> Result<Redirect, (StatusCode, String)> {
    let Some(oidc_config) = state.config.auth.find_oidc_provider(&slug) else {
        return Err((StatusCode::NOT_FOUND, "not found".to_string()));
    };

    let csrf = query
        .state
        .ok_or_else(|| (StatusCode::BAD_REQUEST, "missing state".to_string()))?;
    let return_to = state.oidc_state_store.consume(&csrf).ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            "invalid or expired state".to_string(),
        )
    })?;

    if let Some(ref error) = query.error {
        tracing::warn!(error, provider_slug = %slug, "OIDC provider returned an error");
        let encoded = utf8_percent_encode(error, NON_ALPHANUMERIC).to_string();
        return Ok(Redirect::to(&format!("{return_to}?error={encoded}")));
    }

    let code = query
        .code
        .ok_or_else(|| (StatusCode::BAD_REQUEST, "missing code".to_string()))?;

    let user_info = oauth::oidc::exchange_code(oidc_config, &state.http_client, &code)
        .await
        .map_err(|e| {
            tracing::warn!("OIDC code exchange failed: {e}");
            (StatusCode::BAD_GATEWAY, "OAuth error".to_string())
        })?;

    let user_id = find_or_create_user(
        &state.db,
        &slug,
        &user_info,
        state.config.auth.disable_user_creation,
    )
    .await
    .map_err(|e| match e {
        OAuthError::UserCreationDisabled => (StatusCode::FORBIDDEN, e.to_string()),
        _ => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    })?;

    let nonce = state.external_login_nonce_store.create(user_id);
    let encoded_nonce = utf8_percent_encode(&nonce, NON_ALPHANUMERIC).to_string();

    Ok(Redirect::to(&format!("{return_to}?nonce={encoded_nonce}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_return_to_allows_relative_paths() {
        assert_eq!(
            sanitize_return_to(Some("/auth/callback".into())),
            "/auth/callback"
        );
    }

    #[test]
    fn sanitize_return_to_allows_claudio_scheme() {
        assert_eq!(
            sanitize_return_to(Some("claudio://auth/callback".into())),
            "claudio://auth/callback"
        );
    }

    #[test]
    fn sanitize_return_to_rejects_protocol_relative() {
        assert_eq!(sanitize_return_to(Some("//evil.com".into())), "/");
    }

    #[test]
    fn sanitize_return_to_allows_loopback() {
        assert_eq!(
            sanitize_return_to(Some("http://127.0.0.1:12345/callback".into())),
            "http://127.0.0.1:12345/callback"
        );
    }

    #[test]
    fn sanitize_return_to_rejects_absolute_http() {
        assert_eq!(sanitize_return_to(Some("https://evil.com".into())), "/");
    }

    #[test]
    fn sanitize_return_to_rejects_non_loopback_http() {
        assert_eq!(
            sanitize_return_to(Some("http://evil.com:12345/callback".into())),
            "/"
        );
    }

    #[test]
    fn sanitize_return_to_defaults_on_none() {
        assert_eq!(sanitize_return_to(None), "/");
    }
}
