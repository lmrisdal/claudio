use std::sync::Arc;

use axum::{
    extract::FromRequestParts,
    http::{request::Parts, StatusCode},
};

use crate::{models::user::UserRole, state::AppState};

#[derive(Debug, Clone)]
pub struct AuthUser {
    pub id: i32,
    pub username: String,
    pub role: UserRole,
}

#[derive(Debug, Clone)]
pub struct AdminUser(pub AuthUser);

impl FromRequestParts<Arc<AppState>> for AuthUser {
    type Rejection = (StatusCode, String);

    async fn from_request_parts(
        parts: &mut Parts,
        state: &Arc<AppState>,
    ) -> Result<Self, Self::Rejection> {
        // When auth is disabled, inject a virtual admin so that all routes work.
        if state.config.auth.disable_auth {
            return Ok(AuthUser {
                id: 0,
                username: "admin".to_string(),
                role: UserRole::Admin,
            });
        }

        let auth_header = parts
            .headers
            .get(axum::http::header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .ok_or_else(|| {
                (
                    StatusCode::UNAUTHORIZED,
                    "missing authorization header".to_string(),
                )
            })?;

        let token = auth_header.strip_prefix("Bearer ").ok_or_else(|| {
            (
                StatusCode::UNAUTHORIZED,
                "invalid authorization header".to_string(),
            )
        })?;

        let claims = state.jwt.verify(token).map_err(|_| {
            (
                StatusCode::UNAUTHORIZED,
                "invalid or expired token".to_string(),
            )
        })?;

        let id: i32 = claims.sub.parse().map_err(|_| {
            (
                StatusCode::UNAUTHORIZED,
                "invalid token subject".to_string(),
            )
        })?;

        Ok(AuthUser {
            id,
            username: claims.name,
            role: UserRole::from_str(&claims.role),
        })
    }
}

impl FromRequestParts<Arc<AppState>> for AdminUser {
    type Rejection = (StatusCode, String);

    async fn from_request_parts(
        parts: &mut Parts,
        state: &Arc<AppState>,
    ) -> Result<Self, Self::Rejection> {
        let user = AuthUser::from_request_parts(parts, state).await?;
        if user.role != UserRole::Admin {
            return Err((StatusCode::FORBIDDEN, "admin access required".to_string()));
        }
        Ok(AdminUser(user))
    }
}
