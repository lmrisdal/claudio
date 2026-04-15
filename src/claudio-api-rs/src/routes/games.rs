use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use percent_encoding::{utf8_percent_encode, AsciiSet, CONTROLS};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, QueryOrder};
use serde::Deserialize;

use crate::{
    auth::middleware::AuthUser,
    entity::game,
    models::game::GameDto,
    state::AppState,
    util::{emulation, file_browse},
};

const URI_PATH_SEGMENT_ENCODE_SET: &AsciiSet = &CONTROLS
    .add(b' ')
    .add(b'"')
    .add(b'#')
    .add(b'%')
    .add(b'/')
    .add(b'<')
    .add(b'>')
    .add(b'?')
    .add(b'[')
    .add(b'\\')
    .add(b']')
    .add(b'^')
    .add(b'`')
    .add(b'{')
    .add(b'|')
    .add(b'}');

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/games", get(list_games))
        .route("/api/games/{id}", get(get_game))
        .route("/api/games/{id}/executables", get(list_executables))
        .route("/api/games/{id}/browse", get(browse_game_files))
        .route("/api/games/{id}/emulation", get(get_emulation_info))
        .route(
            "/api/games/{id}/emulation/session",
            post(create_emulation_session),
        )
        .route(
            "/api/games/{id}/emulation/files/{ticket}/{*path}",
            get(get_emulation_file).head(get_emulation_file),
        )
}

#[derive(Debug, Deserialize)]
struct GamesQuery {
    platform: Option<String>,
    search: Option<String>,
}

async fn list_games(
    State(state): State<Arc<AppState>>,
    _auth_user: AuthUser,
    Query(query): Query<GamesQuery>,
) -> Result<Json<Vec<GameDto>>, RouteError> {
    let mut game_query = game::Entity::find().order_by_asc(game::Column::Title);

    if let Some(platform) = query
        .platform
        .as_deref()
        .filter(|platform| !platform.trim().is_empty())
    {
        game_query = game_query.filter(game::Column::Platform.eq(platform));
    }

    if let Some(search) = query
        .search
        .as_deref()
        .filter(|search| !search.trim().is_empty())
    {
        game_query = game_query.filter(game::Column::Title.contains(search));
    }

    let games = game_query
        .all(&state.db)
        .await
        .map_err(RouteError::internal)?;
    Ok(Json(games.iter().map(GameDto::from).collect()))
}

async fn get_game(
    State(state): State<Arc<AppState>>,
    _auth_user: AuthUser,
    Path(id): Path<i32>,
) -> Result<Json<GameDto>, RouteError> {
    let game = find_game(&state, id).await?;
    Ok(Json(GameDto::from(&game)))
}

async fn list_executables(
    State(state): State<Arc<AppState>>,
    _auth_user: AuthUser,
    Path(id): Path<i32>,
) -> Result<Json<Vec<String>>, RouteError> {
    let game = find_game(&state, id).await?;
    if !file_browse::exists_on_disk(&game) {
        return Ok(Json(Vec::new()));
    }

    let executables = file_browse::list_executables(&game).map_err(RouteError::from_file_browse)?;
    Ok(Json(executables))
}

#[derive(Debug, Deserialize)]
struct BrowseQuery {
    path: Option<String>,
}

async fn browse_game_files(
    State(state): State<Arc<AppState>>,
    _auth_user: AuthUser,
    Path(id): Path<i32>,
    Query(query): Query<BrowseQuery>,
) -> Result<Json<file_browse::BrowseResult>, RouteError> {
    let game = find_game(&state, id).await?;
    if !file_browse::exists_on_disk(&game) {
        return Err(RouteError::not_found(
            "Game folder not found on disk.".to_string(),
        ));
    }

    let result =
        file_browse::browse(&game, query.path.as_deref()).map_err(|error| match error {
            file_browse::FileBrowseError::PathNotFound => {
                RouteError::bad_request("Path not found.".to_string())
            }
            other => RouteError::from_file_browse(other),
        })?;
    Ok(Json(result))
}

async fn get_emulation_info(
    State(state): State<Arc<AppState>>,
    _auth_user: AuthUser,
    Path(id): Path<i32>,
) -> Result<Json<emulation::EmulationInfoResponse>, RouteError> {
    let game = find_game(&state, id).await?;
    Ok(Json(emulation::build_info(&game)))
}

async fn create_emulation_session(
    State(state): State<Arc<AppState>>,
    _auth_user: AuthUser,
    Path(id): Path<i32>,
    Json(request): Json<emulation::EmulationSessionRequest>,
) -> Result<Json<emulation::EmulationSessionResponse>, RouteError> {
    let game = find_game(&state, id).await?;
    let info = emulation::build_info(&game);

    if !info.supported {
        return Err(RouteError::bad_request(info.reason.unwrap_or_else(|| {
            "This game cannot be emulated in the browser.".to_string()
        })));
    }

    let normalized_path = file_browse::normalize_relative_path(&request.path)
        .ok_or_else(|| RouteError::bad_request("Invalid ROM path.".to_string()))?;
    if !info
        .candidates
        .iter()
        .any(|candidate| candidate.eq_ignore_ascii_case(&normalized_path))
    {
        return Err(RouteError::bad_request("Invalid ROM path.".to_string()));
    }

    let ticket = state.emulation_ticket_store.create(id);
    let game_url = build_emulation_game_url(id, &ticket, &normalized_path);

    Ok(Json(emulation::EmulationSessionResponse {
        ticket,
        game_url,
    }))
}

async fn get_emulation_file(
    State(state): State<Arc<AppState>>,
    Path((id, ticket, path)): Path<(i32, String, String)>,
    headers: HeaderMap,
) -> Result<Response, RouteError> {
    let has_valid_auth = authenticate_request(&state, &headers);
    if !has_valid_auth && !state.emulation_ticket_store.is_valid(&ticket, id) {
        return Err(RouteError::unauthorized("unauthorized".to_string()));
    }

    let game = find_game(&state, id).await?;
    let info = emulation::build_info(&game);
    if !info.supported {
        return Err(RouteError::bad_request(info.reason.unwrap_or_else(|| {
            "This game cannot be emulated in the browser.".to_string()
        })));
    }

    let bytes = file_browse::read_game_file(&game, &path)
        .await
        .map_err(RouteError::from_file_browse)?
        .ok_or_else(|| RouteError::not_found("not found".to_string()))?;

    let mut response = bytes.into_response();
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/octet-stream"),
    );
    Ok(response)
}

fn authenticate_request(state: &Arc<AppState>, headers: &HeaderMap) -> bool {
    if state.config.auth.disable_auth {
        return true;
    }

    let Some(authorization) = headers.get(header::AUTHORIZATION) else {
        return false;
    };

    let Ok(authorization) = authorization.to_str() else {
        return false;
    };

    let Some(token) = authorization.strip_prefix("Bearer ") else {
        return false;
    };

    state.jwt.verify(token).is_ok()
}

fn build_emulation_game_url(id: i32, ticket: &str, path: &str) -> String {
    let encoded_segments = path
        .split('/')
        .filter(|segment| !segment.is_empty())
        .map(|segment| utf8_percent_encode(segment, URI_PATH_SEGMENT_ENCODE_SET).to_string())
        .collect::<Vec<_>>();

    format!(
        "/api/games/{id}/emulation/files/{}/{path}",
        utf8_percent_encode(ticket, URI_PATH_SEGMENT_ENCODE_SET),
        path = encoded_segments.join("/")
    )
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

    fn internal(error: impl std::fmt::Display) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: error.to_string(),
        }
    }

    fn from_file_browse(error: file_browse::FileBrowseError) -> Self {
        match error {
            file_browse::FileBrowseError::InvalidPath => {
                Self::bad_request("Invalid path.".to_string())
            }
            file_browse::FileBrowseError::PathNotFound => Self::not_found("not found".to_string()),
            file_browse::FileBrowseError::Io(inner_error) => Self::internal(inner_error),
            file_browse::FileBrowseError::Archive(inner_error) => Self::internal(inner_error),
        }
    }
}

impl IntoResponse for RouteError {
    fn into_response(self) -> Response {
        (self.status, self.message).into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::build_emulation_game_url;

    #[test]
    fn emulation_game_url_encodes_each_path_segment() {
        let url = build_emulation_game_url(7, "ticket+/=", "disc 1/game.bin");
        assert_eq!(
            url,
            "/api/games/7/emulation/files/ticket+%2F=/disc%201/game.bin"
        );
    }
}
