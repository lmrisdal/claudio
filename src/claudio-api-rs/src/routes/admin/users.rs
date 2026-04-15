use std::sync::Arc;

use axum::{
    extract::{Path as AxumPath, State},
    http::StatusCode,
    Json,
};
use sea_orm::{ActiveModelTrait, ActiveValue, EntityTrait, QueryOrder};
use serde::Deserialize;

use crate::{
    auth::middleware::AdminUser,
    entity::user,
    models::user::{UserDto, UserRole},
    state::AppState,
};

use super::shared::RouteError;

pub(super) async fn list_users(
    State(state): State<Arc<AppState>>,
    _admin_user: AdminUser,
) -> Result<Json<Vec<UserDto>>, RouteError> {
    let users = user::Entity::find()
        .order_by_asc(user::Column::Username)
        .all(&state.db)
        .await
        .map_err(RouteError::internal)?;

    Ok(Json(
        users
            .into_iter()
            .map(|user_model| UserDto {
                id: user_model.id,
                username: user_model.username,
                role: UserRole::from_str(&user_model.role),
                created_at: user_model.created_at,
            })
            .collect(),
    ))
}

pub(super) async fn delete_user(
    State(state): State<Arc<AppState>>,
    _admin_user: AdminUser,
    AxumPath(id): AxumPath<i32>,
) -> Result<StatusCode, RouteError> {
    let user_model = user::Entity::find_by_id(id)
        .one(&state.db)
        .await
        .map_err(RouteError::internal)?
        .ok_or_else(|| RouteError::not_found("not found"))?;

    let active_model: user::ActiveModel = user_model.into();
    active_model
        .delete(&state.db)
        .await
        .map_err(RouteError::internal)?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
pub(super) struct RoleUpdateRequest {
    role: UserRole,
}

pub(super) async fn update_user_role(
    State(state): State<Arc<AppState>>,
    _admin_user: AdminUser,
    AxumPath(id): AxumPath<i32>,
    Json(request): Json<RoleUpdateRequest>,
) -> Result<StatusCode, RouteError> {
    let user_model = user::Entity::find_by_id(id)
        .one(&state.db)
        .await
        .map_err(RouteError::internal)?
        .ok_or_else(|| RouteError::not_found("not found"))?;

    let mut active_model: user::ActiveModel = user_model.into();
    active_model.role = ActiveValue::Set(request.role.as_str().to_string());
    active_model
        .update(&state.db)
        .await
        .map_err(RouteError::internal)?;

    Ok(StatusCode::NO_CONTENT)
}
