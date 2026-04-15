use std::{path::Path, sync::Arc};

use axum::{
    extract::{Multipart, Path as AxumPath, Query, State},
    http::StatusCode,
    Json,
};
use sea_orm::{ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, QueryFilter};
use serde::{Deserialize, Serialize};
use tracing::{info, warn};

use crate::{
    auth::middleware::AdminUser, entity::game, models::game::GameDto, state::AppState,
    util::file_browse,
};

use super::shared::{find_game, normalize_image_extension, trimmed_option, RouteError};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct GameUpdateRequest {
    title: String,
    summary: Option<String>,
    genre: Option<String>,
    release_year: Option<i32>,
    cover_url: Option<String>,
    hero_url: Option<String>,
    install_type: String,
    installer_exe: Option<String>,
    game_exe: Option<String>,
    developer: Option<String>,
    publisher: Option<String>,
    game_mode: Option<String>,
    series: Option<String>,
    franchise: Option<String>,
    game_engine: Option<String>,
    igdb_id: Option<i64>,
    igdb_slug: Option<String>,
}

pub(super) async fn update_game(
    State(state): State<Arc<AppState>>,
    _admin_user: AdminUser,
    AxumPath(id): AxumPath<i32>,
    Json(request): Json<GameUpdateRequest>,
) -> Result<Json<GameDto>, RouteError> {
    if request.title.trim().is_empty() {
        return Err(RouteError::bad_request("Title is required."));
    }

    if request.install_type != "portable" && request.install_type != "installer" {
        return Err(RouteError::bad_request(
            "Install type must be 'portable' or 'installer'.",
        ));
    }

    let game_model = find_game(&state, id).await?;
    if game_model.is_processing {
        return Err(RouteError::conflict("Game is currently being processed."));
    }

    let mut active_model: game::ActiveModel = game_model.into();
    active_model.title = ActiveValue::Set(request.title.trim().to_string());
    active_model.summary = ActiveValue::Set(trimmed_option(request.summary));
    active_model.genre = ActiveValue::Set(trimmed_option(request.genre));
    active_model.release_year = ActiveValue::Set(request.release_year);
    active_model.cover_url = ActiveValue::Set(trimmed_option(request.cover_url));
    active_model.hero_url = ActiveValue::Set(trimmed_option(request.hero_url));
    active_model.install_type = ActiveValue::Set(request.install_type);
    active_model.installer_exe = ActiveValue::Set(trimmed_option(request.installer_exe));
    active_model.game_exe = ActiveValue::Set(trimmed_option(request.game_exe));
    active_model.developer = ActiveValue::Set(trimmed_option(request.developer));
    active_model.publisher = ActiveValue::Set(trimmed_option(request.publisher));
    active_model.game_mode = ActiveValue::Set(trimmed_option(request.game_mode));
    active_model.series = ActiveValue::Set(trimmed_option(request.series));
    active_model.franchise = ActiveValue::Set(trimmed_option(request.franchise));
    active_model.game_engine = ActiveValue::Set(trimmed_option(request.game_engine));
    active_model.igdb_id = ActiveValue::Set(request.igdb_id);
    active_model.igdb_slug = ActiveValue::Set(
        request
            .igdb_id
            .and_then(|_| trimmed_option(request.igdb_slug)),
    );

    let updated = active_model
        .update(&state.db)
        .await
        .map_err(RouteError::internal)?;
    Ok(Json(GameDto::from(&updated)))
}

#[derive(Debug, Deserialize)]
pub(super) struct DeleteGameQuery {
    #[serde(rename = "deleteFiles")]
    #[serde(default)]
    delete_files: bool,
}

pub(super) async fn delete_game(
    State(state): State<Arc<AppState>>,
    _admin_user: AdminUser,
    AxumPath(id): AxumPath<i32>,
    Query(query): Query<DeleteGameQuery>,
) -> Result<StatusCode, RouteError> {
    let game_model = find_game(&state, id).await?;

    if query.delete_files && file_browse::exists_on_disk(&game_model) {
        warn!(path = %game_model.folder_path, "deleting game files from disk");
        if file_browse::is_standalone_archive(&game_model) {
            tokio::fs::remove_file(&game_model.folder_path)
                .await
                .map_err(RouteError::internal)?;
        } else {
            tokio::fs::remove_dir_all(&game_model.folder_path)
                .await
                .map_err(RouteError::internal)?;
        }
    }

    let active_model: game::ActiveModel = game_model.into();
    active_model
        .delete(&state.db)
        .await
        .map_err(RouteError::internal)?;
    Ok(StatusCode::NO_CONTENT)
}

pub(super) async fn delete_missing_games(
    State(state): State<Arc<AppState>>,
    _admin_user: AdminUser,
) -> Result<Json<DeleteMissingGamesResponse>, RouteError> {
    let result = game::Entity::delete_many()
        .filter(game::Column::IsMissing.eq(true))
        .exec(&state.db)
        .await
        .map_err(RouteError::internal)?;

    Ok(Json(DeleteMissingGamesResponse {
        removed: result.rows_affected as usize,
    }))
}

#[derive(Debug, Serialize)]
pub(super) struct DeleteMissingGamesResponse {
    removed: usize,
}

pub(super) async fn list_game_executables(
    State(state): State<Arc<AppState>>,
    _admin_user: AdminUser,
    AxumPath(id): AxumPath<i32>,
) -> Result<Json<Vec<String>>, RouteError> {
    let game_model = find_game(&state, id).await?;
    if !file_browse::exists_on_disk(&game_model) {
        return Ok(Json(Vec::new()));
    }

    let executables = file_browse::list_executables(&game_model).map_err(RouteError::from_file)?;
    Ok(Json(executables))
}

#[derive(Debug, Deserialize)]
pub(super) struct UploadImageQuery {
    r#type: String,
}

pub(super) async fn upload_image(
    State(state): State<Arc<AppState>>,
    _admin_user: AdminUser,
    AxumPath(id): AxumPath<i32>,
    Query(query): Query<UploadImageQuery>,
    mut multipart: Multipart,
) -> Result<Json<UploadImageResponse>, RouteError> {
    if query.r#type != "cover" && query.r#type != "hero" {
        return Err(RouteError::bad_request("Type must be 'cover' or 'hero'."));
    }

    let _game_model = find_game(&state, id).await?;

    let Some(field) = multipart.next_field().await.map_err(RouteError::internal)? else {
        return Err(RouteError::bad_request("File is required."));
    };

    if field.name() != Some("file") {
        return Err(RouteError::bad_request("File is required."));
    }

    let content_type = field
        .content_type()
        .map(ToString::to_string)
        .unwrap_or_default();
    if !content_type.starts_with("image/") {
        return Err(RouteError::bad_request("File must be an image."));
    }

    let file_name = field
        .file_name()
        .ok_or_else(|| RouteError::bad_request("File name is required."))?;
    let extension = normalize_image_extension(file_name)
        .ok_or_else(|| RouteError::bad_request("Supported formats: jpg, png, webp, gif."))?;
    let bytes = field.bytes().await.map_err(RouteError::internal)?;

    if bytes.len() > 10 * 1024 * 1024 {
        return Err(RouteError::bad_request("File must be under 10 MB."));
    }

    tokio::fs::create_dir_all(&state.images_dir)
        .await
        .map_err(RouteError::internal)?;

    let file_name = format!("{id}-{}{}", query.r#type, extension);
    let file_path = state.images_dir.join(&file_name);

    let mut existing_entries = tokio::fs::read_dir(&state.images_dir)
        .await
        .map_err(RouteError::internal)?;
    while let Some(entry) = existing_entries
        .next_entry()
        .await
        .map_err(RouteError::internal)?
    {
        let existing_name = entry.file_name();
        let existing_name = existing_name.to_string_lossy();
        let prefix = format!("{id}-{}.", query.r#type);
        if existing_name.starts_with(&prefix) && entry.path() != file_path {
            tokio::fs::remove_file(entry.path())
                .await
                .map_err(RouteError::internal)?;
        }
    }

    tokio::fs::write(&file_path, &bytes)
        .await
        .map_err(RouteError::internal)?;

    Ok(Json(UploadImageResponse {
        url: format!("/images/{file_name}"),
    }))
}

#[derive(Debug, Serialize)]
pub(super) struct UploadImageResponse {
    url: String,
}

pub(super) async fn tag_folder(
    State(state): State<Arc<AppState>>,
    _admin_user: AdminUser,
    AxumPath(id): AxumPath<i32>,
) -> Result<Json<GameDto>, RouteError> {
    let game_model = find_game(&state, id).await?;
    let Some(igdb_id) = game_model.igdb_id else {
        return Err(RouteError::bad_request("Game has no IGDB match."));
    };

    let tag = format!("(igdb-{igdb_id})");
    if game_model
        .folder_name
        .to_ascii_lowercase()
        .contains(&tag.to_ascii_lowercase())
    {
        return Ok(Json(GameDto::from(&game_model)));
    }

    if !file_browse::exists_on_disk(&game_model) {
        return Err(RouteError::not_found("Game not found on disk."));
    }

    let folder_path = Path::new(&game_model.folder_path);
    let parent_dir = folder_path
        .parent()
        .ok_or_else(|| RouteError::internal("Game folder parent directory is missing."))?;
    let is_file = file_browse::is_standalone_archive(&game_model);

    let new_folder_name = if is_file {
        let extension = folder_path
            .extension()
            .map(|extension| format!(".{}", extension.to_string_lossy()))
            .unwrap_or_default();
        let base_name = folder_path
            .file_stem()
            .map(|stem| stem.to_string_lossy().to_string())
            .ok_or_else(|| RouteError::internal("Game file name is invalid."))?;
        format!("{base_name} {tag}{extension}")
    } else {
        format!("{} {tag}", game_model.folder_name)
    };

    let new_folder_path = parent_dir.join(&new_folder_name);
    if tokio::fs::try_exists(&new_folder_path)
        .await
        .map_err(RouteError::internal)?
    {
        return Err(RouteError::conflict("Target already exists."));
    }

    tokio::fs::rename(&game_model.folder_path, &new_folder_path)
        .await
        .map_err(RouteError::internal)?;

    info!(
        old_name = %game_model.folder_name,
        new_name = %new_folder_name,
        "tagged game folder"
    );

    let mut active_model: game::ActiveModel = game_model.into();
    active_model.folder_name = ActiveValue::Set(new_folder_name);
    active_model.folder_path = ActiveValue::Set(new_folder_path.to_string_lossy().to_string());

    let updated = active_model
        .update(&state.db)
        .await
        .map_err(RouteError::internal)?;
    Ok(Json(GameDto::from(&updated)))
}
