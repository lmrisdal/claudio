use std::sync::Arc;

use axum::{
    extract::{Path as AxumPath, Query, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use tracing::warn;

use crate::{
    auth::middleware::AdminUser,
    models::game::GameDto,
    services::{compression::CompressionError, igdb::IgdbError, library_scan::LibraryScanError},
    state::AppState,
};

use super::shared::RouteError;

pub(super) async fn get_tasks_status(
    State(state): State<Arc<AppState>>,
    _admin_user: AdminUser,
) -> Json<TasksStatusResponse> {
    Json(TasksStatusResponse {
        compression: state.compression_service.status(),
        igdb: state.igdb_service.status(),
        steam_grid_db: state.library_scan_service.steam_grid_db_status(),
    })
}

pub(super) async fn get_compression_status(
    State(state): State<Arc<AppState>>,
    _admin_user: AdminUser,
) -> Json<CompressionStatus> {
    Json(state.compression_service.status())
}

pub(super) async fn get_igdb_scan_status(
    State(state): State<Arc<AppState>>,
    _admin_user: AdminUser,
) -> Json<BackgroundTaskStatus> {
    Json(state.igdb_service.status())
}

pub(super) async fn trigger_scan(
    State(state): State<Arc<AppState>>,
    _admin_user: AdminUser,
) -> Result<Json<ScanResult>, RouteError> {
    state
        .library_scan_service
        .scan()
        .await
        .map(Json)
        .map_err(map_library_scan_error)
}

pub(super) async fn trigger_igdb_scan(
    State(state): State<Arc<AppState>>,
    _admin_user: AdminUser,
) -> Result<StatusCode, RouteError> {
    state
        .igdb_service
        .start_scan_in_background()
        .map(|()| StatusCode::ACCEPTED)
        .map_err(map_igdb_error)
}

pub(super) async fn search_game_igdb(
    State(state): State<Arc<AppState>>,
    _admin_user: AdminUser,
    AxumPath(id): AxumPath<i32>,
) -> Result<Json<Vec<crate::services::igdb::IgdbCandidate>>, RouteError> {
    let game = super::shared::find_game(&state, id).await?;
    state
        .igdb_service
        .search_candidates(&game.folder_name)
        .await
        .map(Json)
        .map_err(map_igdb_error)
}

#[derive(Debug, Deserialize)]
pub(super) struct IgdbSearchRequest {
    query: String,
}

pub(super) async fn search_igdb_free_text(
    State(state): State<Arc<AppState>>,
    _admin_user: AdminUser,
    Json(request): Json<IgdbSearchRequest>,
) -> Result<Json<Vec<crate::services::igdb::IgdbCandidate>>, RouteError> {
    state
        .igdb_service
        .search_candidates(request.query.trim())
        .await
        .map(Json)
        .map_err(map_igdb_error)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct IgdbApplyRequest {
    igdb_id: i64,
}

pub(super) async fn apply_game_igdb(
    State(state): State<Arc<AppState>>,
    _admin_user: AdminUser,
    AxumPath(id): AxumPath<i32>,
    Json(request): Json<IgdbApplyRequest>,
) -> Result<Json<GameDto>, RouteError> {
    let updated = state
        .igdb_service
        .apply_match(id, request.igdb_id)
        .await
        .map_err(map_igdb_error)?;
    Ok(Json(GameDto::from(&updated)))
}

#[derive(Debug, Deserialize)]
pub(super) struct CompressionQuery {
    format: Option<String>,
}

pub(super) async fn queue_compression(
    State(state): State<Arc<AppState>>,
    _admin_user: AdminUser,
    AxumPath(id): AxumPath<i32>,
    Query(query): Query<CompressionQuery>,
) -> Result<StatusCode, RouteError> {
    let format = query.format.as_deref().unwrap_or("zip");
    state
        .compression_service
        .queue_compression(id, format)
        .await
        .map(|()| StatusCode::ACCEPTED)
        .map_err(map_compression_error)
}

pub(super) async fn cancel_compression(
    State(state): State<Arc<AppState>>,
    _admin_user: AdminUser,
    AxumPath(id): AxumPath<i32>,
) -> Result<StatusCode, RouteError> {
    state
        .compression_service
        .cancel_compression(id)
        .await
        .map(|()| StatusCode::NO_CONTENT)
        .map_err(map_compression_error)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct TasksStatusResponse {
    compression: CompressionStatus,
    igdb: BackgroundTaskStatus,
    steam_grid_db: BackgroundTaskStatus,
}

type CompressionStatus = crate::services::compression::CompressionStatus;
type BackgroundTaskStatus = crate::services::igdb::BackgroundTaskStatus;
type ScanResult = crate::services::library_scan::ScanResult;

fn map_library_scan_error(error: LibraryScanError) -> RouteError {
    warn!(error = %error, "library scan request failed");
    RouteError::internal(error)
}

fn map_igdb_error(error: IgdbError) -> RouteError {
    match error {
        IgdbError::MissingCredentials => {
            RouteError::bad_request("IGDB client_id and client_secret must be configured.")
        }
        IgdbError::ScanAlreadyRunning => RouteError::conflict("IGDB scan is already running."),
        IgdbError::GameNotFound => RouteError::not_found("not found"),
        IgdbError::CandidateNotFound => RouteError::not_found("IGDB game not found."),
        IgdbError::RequestFailed => RouteError::bad_gateway("IGDB request failed."),
        IgdbError::Credentials(inner_error) => RouteError::internal(inner_error),
        IgdbError::Database(inner_error) => RouteError::internal(inner_error),
        IgdbError::Http(inner_error) => RouteError::bad_gateway(inner_error.to_string()),
    }
}

fn map_compression_error(error: CompressionError) -> RouteError {
    match error {
        CompressionError::GameNotFound => RouteError::not_found("not found"),
        CompressionError::AlreadyQueued => {
            RouteError::conflict("Game is already queued for compression.")
        }
        CompressionError::GameMissingOnDisk => {
            RouteError::not_found("Game folder not found on disk.")
        }
        CompressionError::StandaloneArchive => {
            RouteError::bad_request("Game is already a standalone archive.")
        }
        CompressionError::SingleArchive => {
            RouteError::bad_request("Game is already a single archive.")
        }
        CompressionError::InvalidFormat => {
            RouteError::bad_request("Format must be 'zip' or 'tar'.")
        }
        CompressionError::Database(inner_error) => RouteError::internal(inner_error),
        CompressionError::Packaging(inner_error) => RouteError::internal(inner_error),
    }
}
