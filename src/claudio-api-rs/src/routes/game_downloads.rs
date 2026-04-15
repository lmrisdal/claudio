use std::{path::Path, sync::Arc};

use axum::{
    extract::{FromRequestParts, Path as AxumPath, Query, Request, State},
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use sea_orm::EntityTrait;
use serde::{Deserialize, Serialize};
use tower::ServiceExt;
use tower_http::services::ServeFile;

use crate::{
    auth::middleware::AuthUser,
    entity::game,
    services::download::{
        DownloadFileManifestEntry, DownloadServiceError, DownloadTarget,
        InstallerInspectionResponse,
    },
    state::AppState,
    util::file_browse,
};

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route(
            "/api/games/{id}/download-ticket",
            post(create_download_ticket),
        )
        .route(
            "/api/games/{id}/download",
            get(download_game).head(download_game),
        )
        .route(
            "/api/games/{id}/download-files-manifest",
            get(get_download_files_manifest),
        )
        .route(
            "/api/games/{id}/download-files",
            get(download_game_file).head(download_game_file),
        )
        .route(
            "/api/games/{id}/installer-inspection",
            get(inspect_installer),
        )
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadTicketResponse {
    ticket: String,
    files: Option<Vec<DownloadFileManifestEntry>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadFilesManifestResponse {
    files: Option<Vec<DownloadFileManifestEntry>>,
}

#[derive(Debug, Deserialize)]
struct DownloadQuery {
    ticket: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DownloadFileQuery {
    path: String,
}

#[derive(Debug, Deserialize)]
struct InstallerInspectionQuery {
    path: Option<String>,
}

async fn create_download_ticket(
    State(state): State<Arc<AppState>>,
    _auth_user: AuthUser,
    AxumPath(id): AxumPath<i32>,
) -> Result<Json<DownloadTicketResponse>, RouteError> {
    let game = find_game(&state, id).await?;
    ensure_game_ready(&game)?;

    let files = state
        .download_service
        .build_loose_file_manifest(&game)
        .map_err(RouteError::from_download_service)?;
    let ticket = state.download_ticket_store.create(id);

    Ok(Json(DownloadTicketResponse { ticket, files }))
}

async fn get_download_files_manifest(
    State(state): State<Arc<AppState>>,
    _auth_user: AuthUser,
    AxumPath(id): AxumPath<i32>,
) -> Result<Json<DownloadFilesManifestResponse>, RouteError> {
    let game = find_game(&state, id).await?;
    ensure_game_ready(&game)?;

    let files = state
        .download_service
        .build_loose_file_manifest(&game)
        .map_err(RouteError::from_download_service)?;
    Ok(Json(DownloadFilesManifestResponse { files }))
}

async fn download_game(
    State(state): State<Arc<AppState>>,
    AxumPath(id): AxumPath<i32>,
    Query(query): Query<DownloadQuery>,
    request: Request,
) -> Result<Response, RouteError> {
    let (mut parts, body) = request.into_parts();
    let has_valid_auth = AuthUser::from_request_parts(&mut parts, &state)
        .await
        .is_ok();
    let has_valid_ticket = query
        .ticket
        .as_deref()
        .is_some_and(|ticket| state.download_ticket_store.redeem(ticket, id));
    if !has_valid_auth && !has_valid_ticket {
        return Err(RouteError::unauthorized("unauthorized".to_string()));
    }
    let request = Request::from_parts(parts, body);

    let game = find_game(&state, id).await?;
    ensure_game_files_exist(&game)?;

    let target = state
        .download_service
        .select_download_target(&game)
        .await
        .map_err(RouteError::from_download_service)?;

    match target {
        DownloadTarget::DirectFile {
            path,
            content_type,
            file_name,
        } => serve_file_response(request, &path, content_type, Some(&file_name)).await,
        DownloadTarget::TarFile { path, file_name } => {
            serve_file_response(request, &path, "application/x-tar", Some(&file_name)).await
        }
    }
}

async fn download_game_file(
    State(state): State<Arc<AppState>>,
    _auth_user: AuthUser,
    AxumPath(id): AxumPath<i32>,
    Query(query): Query<DownloadFileQuery>,
    request: Request,
) -> Result<Response, RouteError> {
    let game = find_game(&state, id).await?;
    let path = state
        .download_service
        .resolve_loose_file_path(&game, &query.path)
        .map_err(RouteError::from_download_service)?
        .ok_or_else(|| RouteError::not_found("not found".to_string()))?;

    serve_file_response(request, &path, "application/octet-stream", None).await
}

async fn inspect_installer(
    State(state): State<Arc<AppState>>,
    _auth_user: AuthUser,
    AxumPath(id): AxumPath<i32>,
    Query(query): Query<InstallerInspectionQuery>,
) -> Result<Json<InstallerInspectionResponse>, RouteError> {
    let game = find_game(&state, id).await?;
    ensure_game_files_exist(&game)?;

    let path = query
        .path
        .as_deref()
        .ok_or_else(|| RouteError::bad_request("Invalid installer path.".to_string()))?;
    let inspection = state
        .download_service
        .inspect_installer(&game, path)
        .await
        .map_err(RouteError::from_download_service)?
        .ok_or_else(|| RouteError::not_found("not found".to_string()))?;

    Ok(Json(inspection))
}

async fn serve_file_response(
    request: Request,
    path: &Path,
    content_type: &'static str,
    file_name: Option<&str>,
) -> Result<Response, RouteError> {
    let mut response = ServeFile::new(path)
        .oneshot(request)
        .await
        .map_err(RouteError::internal)?
        .map(axum::body::Body::new);

    if response.status() == StatusCode::OK || response.status() == StatusCode::PARTIAL_CONTENT {
        response
            .headers_mut()
            .insert(header::CONTENT_TYPE, HeaderValue::from_static(content_type));

        if let Some(file_name) = file_name {
            let header_value = HeaderValue::from_str(&content_disposition_value(file_name))
                .map_err(RouteError::internal)?;
            response
                .headers_mut()
                .insert(header::CONTENT_DISPOSITION, header_value);
        }
    }

    Ok(response)
}

fn content_disposition_value(file_name: &str) -> String {
    let escaped = file_name.replace(['\\', '"'], "_");
    format!("attachment; filename=\"{escaped}\"")
}

fn ensure_game_ready(game: &game::Model) -> Result<(), RouteError> {
    if game.is_processing {
        return Err(RouteError::conflict(
            "Game is currently being processed.".to_string(),
        ));
    }

    ensure_game_files_exist(game)
}

fn ensure_game_files_exist(game: &game::Model) -> Result<(), RouteError> {
    if file_browse::exists_on_disk(game) {
        Ok(())
    } else {
        Err(RouteError::internal("Game files not found on disk."))
    }
}

async fn find_game(state: &Arc<AppState>, id: i32) -> Result<game::Model, RouteError> {
    game::Entity::find_by_id(id)
        .one(&state.db)
        .await
        .map_err(RouteError::internal)?
        .ok_or_else(|| RouteError::not_found("not found".to_string()))
}

struct RouteError {
    status: StatusCode,
    message: String,
}

impl RouteError {
    fn bad_request(message: String) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message,
        }
    }

    fn unauthorized(message: String) -> Self {
        Self {
            status: StatusCode::UNAUTHORIZED,
            message,
        }
    }

    fn not_found(message: String) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            message,
        }
    }

    fn conflict(message: String) -> Self {
        Self {
            status: StatusCode::CONFLICT,
            message,
        }
    }

    fn internal(error: impl std::fmt::Display) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: error.to_string(),
        }
    }

    fn from_download_service(error: DownloadServiceError) -> Self {
        match error {
            DownloadServiceError::InvalidPath => {
                Self::bad_request("Invalid file path.".to_string())
            }
            DownloadServiceError::MissingLibraryPath => Self::internal(error),
            DownloadServiceError::Io(inner_error) => Self::internal(inner_error),
            DownloadServiceError::Archive(inner_error) => Self::internal(inner_error),
            DownloadServiceError::TarBuild(inner_error) => Self::internal(inner_error),
        }
    }
}

impl IntoResponse for RouteError {
    fn into_response(self) -> Response {
        (self.status, self.message).into_response()
    }
}
