use std::sync::Arc;

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    routing::{get, post, put},
    Json, Router,
};
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, PaginatorTrait, QueryFilter,
};
use serde::{Deserialize, Serialize};

use crate::{
    auth::{
        middleware::AuthUser,
        password::{hash_password, verify_password},
    },
    entity::user,
    models::user::{UserDto, UserRole},
    state::AppState,
};

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/auth/providers", get(providers))
        .route("/api/auth/register", post(register))
        .route("/api/auth/remote", post(remote))
        .route("/api/auth/me", get(me))
        .route("/api/auth/change-password", put(change_password))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OAuthProvider {
    slug: String,
    display_name: String,
    logo_url: Option<String>,
    start_url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProvidersResponse {
    providers: Vec<OAuthProvider>,
    auth_disabled: bool,
    local_login_enabled: bool,
    user_creation_enabled: bool,
}

async fn providers(State(state): State<Arc<AppState>>) -> Json<ProvidersResponse> {
    let mut providers = Vec::new();

    if state.config.auth.github.is_configured() {
        providers.push(OAuthProvider {
            slug: "github".to_string(),
            display_name: "GitHub".to_string(),
            logo_url: Some("/provider-logos/github.svg".to_string()),
            start_url: "/api/auth/github/start?returnTo=/auth/callback".to_string(),
        });
    }

    if state.config.auth.google.is_configured() {
        providers.push(OAuthProvider {
            slug: "google".to_string(),
            display_name: "Google".to_string(),
            logo_url: Some("/provider-logos/google.svg".to_string()),
            start_url: "/api/auth/google/start?returnTo=/auth/callback".to_string(),
        });
    }

    for oidc in state.config.auth.oidc_providers() {
        providers.push(OAuthProvider {
            slug: oidc.slug.clone(),
            display_name: oidc.display_name.clone(),
            logo_url: oidc.logo_url.clone(),
            start_url: format!("/api/auth/oidc/{}/start?returnTo=/auth/callback", oidc.slug),
        });
    }

    Json(ProvidersResponse {
        providers,
        auth_disabled: state.config.auth.disable_auth,
        local_login_enabled: !state.config.auth.disable_auth
            && !state.config.auth.disable_local_login,
        user_creation_enabled: !state.config.auth.disable_auth
            && !state.config.auth.disable_user_creation,
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegisterRequest {
    username: String,
    password: String,
}

async fn register(
    State(state): State<Arc<AppState>>,
    Json(body): Json<RegisterRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    if state.config.auth.disable_local_login {
        return Err((StatusCode::NOT_FOUND, "not found".to_string()));
    }

    if state.config.auth.disable_user_creation {
        return Err((StatusCode::NOT_FOUND, "not found".to_string()));
    }

    if body.username.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, "username is required".to_string()));
    }

    if body.password.len() < 8 {
        return Err((
            StatusCode::BAD_REQUEST,
            "password must be at least 8 characters".to_string(),
        ));
    }

    // Check if username already exists.
    let existing = user::Entity::find()
        .filter(user::Column::Username.eq(body.username.trim()))
        .one(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if existing.is_some() {
        return Err((StatusCode::CONFLICT, "username already taken".to_string()));
    }

    // First user becomes admin.
    let count = user::Entity::find()
        .count(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let role = if count == 0 { "admin" } else { "user" };

    let password_hash = hash_password(&body.password)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let now: chrono::DateTime<chrono::FixedOffset> = chrono::Utc::now().fixed_offset();

    let new_user = user::ActiveModel {
        username: ActiveValue::Set(body.username.trim().to_string()),
        password_hash: ActiveValue::Set(Some(password_hash)),
        email: ActiveValue::Set(None),
        role: ActiveValue::Set(role.to_string()),
        created_at: ActiveValue::Set(now),
        ..Default::default()
    };

    new_user
        .insert(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(StatusCode::CREATED)
}

#[derive(Serialize)]
struct RemoteResponse {
    nonce: String,
}

async fn remote(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<RemoteResponse>, (StatusCode, String)> {
    let proxy_header = &state.config.auth.proxy_auth_header;
    if proxy_header.is_empty() {
        return Err((StatusCode::NOT_FOUND, "not found".to_string()));
    }

    let username = headers
        .get(proxy_header.as_str())
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
        .ok_or_else(|| (StatusCode::UNAUTHORIZED, "unauthorized".to_string()))?;

    // Find or create user.
    let existing = user::Entity::find()
        .filter(user::Column::Username.eq(&username))
        .one(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let user_id = if let Some(u) = existing {
        u.id
    } else if state.config.auth.proxy_auth_auto_create {
        let count = user::Entity::find()
            .count(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

        let role = if count == 0 { "admin" } else { "user" };
        let now: chrono::DateTime<chrono::FixedOffset> = chrono::Utc::now().fixed_offset();

        let new_user = user::ActiveModel {
            username: ActiveValue::Set(username.clone()),
            password_hash: ActiveValue::Set(None),
            email: ActiveValue::Set(None),
            role: ActiveValue::Set(role.to_string()),
            created_at: ActiveValue::Set(now),
            ..Default::default()
        };

        let inserted = new_user
            .insert(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

        inserted.id
    } else {
        return Err((StatusCode::UNAUTHORIZED, "user not found".to_string()));
    };

    let nonce = state.proxy_nonce_store.create(user_id);
    Ok(Json(RemoteResponse { nonce }))
}

async fn me(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
) -> Result<Json<UserDto>, (StatusCode, String)> {
    if state.config.auth.disable_auth {
        return Ok(Json(UserDto {
            id: auth_user.id,
            username: auth_user.username,
            role: auth_user.role,
            created_at: chrono::Utc::now().fixed_offset(),
        }));
    }

    let user_model = user::Entity::find_by_id(auth_user.id)
        .one(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or_else(|| (StatusCode::NOT_FOUND, "not found".to_string()))?;

    Ok(Json(UserDto {
        id: user_model.id,
        username: user_model.username.clone(),
        role: UserRole::from_str(&user_model.role),
        created_at: user_model.created_at,
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChangePasswordRequest {
    current_password: String,
    new_password: String,
}

async fn change_password(
    State(state): State<Arc<AppState>>,
    auth_user: AuthUser,
    Json(body): Json<ChangePasswordRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    if state.config.auth.disable_local_login {
        return Err((StatusCode::NOT_FOUND, "not found".to_string()));
    }

    if body.new_password.len() < 8 {
        return Err((
            StatusCode::BAD_REQUEST,
            "new password must be at least 8 characters".to_string(),
        ));
    }

    let user_model = user::Entity::find_by_id(auth_user.id)
        .one(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or_else(|| (StatusCode::NOT_FOUND, "not found".to_string()))?;

    let hash = user_model
        .password_hash
        .as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, "no local password set".to_string()))?;

    let ok = verify_password(&body.current_password, hash)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if !ok {
        return Err((
            StatusCode::BAD_REQUEST,
            "current password is incorrect".to_string(),
        ));
    }

    let new_hash = hash_password(&body.new_password)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let mut active: user::ActiveModel = user_model.into();
    active.password_hash = ActiveValue::Set(Some(new_hash));
    active
        .update(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(StatusCode::NO_CONTENT)
}
