use std::sync::Arc;

use axum::{
    extract::{Form, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use sea_orm::{ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, QueryFilter};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{
    auth::{jwt::make_access_token_claims, middleware::AuthUser, password::verify_password},
    entity::{refresh_token, user},
    state::AppState,
};

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/connect/token", post(token))
        .route("/connect/userinfo", get(userinfo))
}

#[derive(Deserialize)]
struct TokenForm {
    grant_type: Option<String>,
    username: Option<String>,
    password: Option<String>,
    refresh_token: Option<String>,
    nonce: Option<String>,
    scope: Option<String>,
}

#[derive(Serialize)]
struct TokenResponse {
    access_token: String,
    token_type: String,
    expires_in: u64,
    refresh_token: String,
    scope: String,
}

async fn token(
    State(state): State<Arc<AppState>>,
    Form(form): Form<TokenForm>,
) -> Result<Json<TokenResponse>, (StatusCode, String)> {
    let grant_type = form.grant_type.as_deref().unwrap_or("");
    let scope = form
        .scope
        .as_deref()
        .unwrap_or("openid offline_access roles");

    let user_model = match grant_type {
        "password" => {
            if state.config.auth.disable_local_login {
                return Err((
                    StatusCode::BAD_REQUEST,
                    "Username/password login is disabled.".to_string(),
                ));
            }

            let username = form
                .username
                .as_deref()
                .ok_or_else(|| (StatusCode::BAD_REQUEST, "missing username".to_string()))?;
            let password = form
                .password
                .as_deref()
                .ok_or_else(|| (StatusCode::BAD_REQUEST, "missing password".to_string()))?;

            let user = user::Entity::find()
                .filter(user::Column::Username.eq(username))
                .one(&state.db)
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
                .ok_or_else(|| (StatusCode::BAD_REQUEST, "invalid credentials".to_string()))?;

            let hash = user
                .password_hash
                .as_deref()
                .ok_or_else(|| (StatusCode::BAD_REQUEST, "invalid credentials".to_string()))?;

            let ok = verify_password(password, hash)
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

            if !ok {
                return Err((StatusCode::BAD_REQUEST, "invalid credentials".to_string()));
            }

            user
        }

        "refresh_token" => {
            let raw = form
                .refresh_token
                .as_deref()
                .ok_or_else(|| (StatusCode::BAD_REQUEST, "missing refresh_token".to_string()))?;

            let hash = token_hash(raw);

            let rt = refresh_token::Entity::find_by_id(&hash)
                .one(&state.db)
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
                .ok_or_else(|| (StatusCode::BAD_REQUEST, "invalid refresh token".to_string()))?;

            let now = chrono::Utc::now();
            if rt.expires_at < now {
                // Remove expired token.
                refresh_token::Entity::delete_by_id(&hash)
                    .exec(&state.db)
                    .await
                    .ok();
                return Err((StatusCode::BAD_REQUEST, "refresh token expired".to_string()));
            }

            // Rotate: delete old token.
            refresh_token::Entity::delete_by_id(&hash)
                .exec(&state.db)
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

            user::Entity::find_by_id(rt.user_id)
                .one(&state.db)
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
                .ok_or_else(|| (StatusCode::BAD_REQUEST, "user not found".to_string()))?
        }

        "urn:claudio:proxy_nonce" => {
            let nonce = form
                .nonce
                .as_deref()
                .ok_or_else(|| (StatusCode::BAD_REQUEST, "missing nonce".to_string()))?;

            let user_id = state.proxy_nonce_store.consume(nonce).ok_or_else(|| {
                (
                    StatusCode::BAD_REQUEST,
                    "invalid or expired nonce".to_string(),
                )
            })?;

            user::Entity::find_by_id(user_id)
                .one(&state.db)
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
                .ok_or_else(|| (StatusCode::BAD_REQUEST, "user not found".to_string()))?
        }

        "urn:claudio:external_login_nonce" => {
            let nonce = form
                .nonce
                .as_deref()
                .ok_or_else(|| (StatusCode::BAD_REQUEST, "missing nonce".to_string()))?;

            let user_id = state
                .external_login_nonce_store
                .consume(nonce)
                .ok_or_else(|| {
                    (
                        StatusCode::BAD_REQUEST,
                        "invalid or expired nonce".to_string(),
                    )
                })?;

            user::Entity::find_by_id(user_id)
                .one(&state.db)
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
                .ok_or_else(|| (StatusCode::BAD_REQUEST, "user not found".to_string()))?
        }

        _ => {
            return Err((
                StatusCode::BAD_REQUEST,
                format!("unsupported grant_type: {grant_type}"),
            ));
        }
    };

    let claims = make_access_token_claims(user_model.id, &user_model.username, &user_model.role);
    let access_token = state
        .jwt
        .sign(claims)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let raw_refresh = generate_raw_token();
    let hash = token_hash(&raw_refresh);

    let expires_at = chrono::Utc::now() + chrono::Duration::days(30);
    let expires_at_fixed: chrono::DateTime<chrono::FixedOffset> = expires_at.fixed_offset();

    let rt_model = refresh_token::ActiveModel {
        token_hash: ActiveValue::Set(hash),
        user_id: ActiveValue::Set(user_model.id),
        expires_at: ActiveValue::Set(expires_at_fixed),
    };
    rt_model
        .insert(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(TokenResponse {
        access_token,
        token_type: "Bearer".to_string(),
        expires_in: 3600,
        refresh_token: raw_refresh,
        scope: scope.to_string(),
    }))
}

#[derive(Serialize)]
struct UserinfoResponse {
    sub: String,
    name: String,
    role: String,
}

async fn userinfo(auth_user: AuthUser) -> Json<UserinfoResponse> {
    Json(UserinfoResponse {
        sub: auth_user.id.to_string(),
        name: auth_user.username.clone(),
        role: auth_user.role.as_str().to_string(),
    })
}

fn token_hash(raw: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(raw.as_bytes());
    STANDARD.encode(hasher.finalize())
}

fn generate_raw_token() -> String {
    let mut bytes = [0u8; 32];
    rand_core::RngCore::fill_bytes(&mut rand_core::OsRng, &mut bytes);
    STANDARD.encode(bytes)
}
