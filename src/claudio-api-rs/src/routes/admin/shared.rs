use std::{path::Path, sync::Arc};

use axum::{http::StatusCode, response::IntoResponse};
use sea_orm::EntityTrait;

use crate::{entity::game, state::AppState, util::file_browse};

pub(super) async fn find_game(state: &Arc<AppState>, id: i32) -> Result<game::Model, RouteError> {
    game::Entity::find_by_id(id)
        .one(&state.db)
        .await
        .map_err(RouteError::internal)?
        .ok_or_else(|| RouteError::not_found("not found"))
}

pub(super) fn trimmed_option(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let trimmed = value.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_string())
    })
}

pub(super) fn normalize_image_extension(file_name: &str) -> Option<&'static str> {
    match Path::new(file_name)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase())
        .as_deref()
    {
        Some("jpg" | "jpeg") => Some(".jpg"),
        Some("png") => Some(".png"),
        Some("webp") => Some(".webp"),
        Some("gif") => Some(".gif"),
        _ => None,
    }
}

pub(super) struct RouteError {
    status: StatusCode,
    message: String,
}

impl RouteError {
    pub(super) fn bad_request(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message: message.into(),
        }
    }

    pub(super) fn not_found(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            message: message.into(),
        }
    }

    pub(super) fn conflict(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::CONFLICT,
            message: message.into(),
        }
    }

    pub(super) fn bad_gateway(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_GATEWAY,
            message: message.into(),
        }
    }

    pub(super) fn internal(error: impl std::fmt::Display) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: error.to_string(),
        }
    }

    pub(super) fn from_file(error: file_browse::FileBrowseError) -> Self {
        match error {
            file_browse::FileBrowseError::InvalidPath => Self::bad_request("Invalid path."),
            file_browse::FileBrowseError::PathNotFound => Self::not_found("not found"),
            file_browse::FileBrowseError::Io(inner_error) => Self::internal(inner_error),
            file_browse::FileBrowseError::Archive(inner_error) => Self::internal(inner_error),
        }
    }
}

impl IntoResponse for RouteError {
    fn into_response(self) -> axum::response::Response {
        (self.status, self.message).into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::normalize_image_extension;

    #[test]
    fn normalize_image_extension_should_accept_supported_formats() {
        assert_eq!(normalize_image_extension("cover.jpeg"), Some(".jpg"));
        assert_eq!(normalize_image_extension("cover.PNG"), Some(".png"));
        assert_eq!(normalize_image_extension("cover.txt"), None);
    }
}
