use std::sync::Arc;

use axum::{
    extract::{Path as AxumPath, Query, State},
    Json,
};
use chrono::Datelike;
use serde::{Deserialize, Serialize};

use crate::{auth::middleware::AdminUser, state::AppState};

use super::shared::RouteError;

#[derive(Debug, Deserialize)]
pub(super) struct SteamGridDbSearchQuery {
    query: String,
}

pub(super) async fn search_steamgriddb(
    State(state): State<Arc<AppState>>,
    _admin_user: AdminUser,
    Query(query): Query<SteamGridDbSearchQuery>,
) -> Result<Json<Vec<SteamGridDbGameResult>>, RouteError> {
    let api_key = steamgriddb_api_key(&state)?;
    if query.query.trim().is_empty() {
        return Ok(Json(Vec::new()));
    }

    let url = format!(
        "https://www.steamgriddb.com/api/v2/search/autocomplete/{}",
        percent_encoding::utf8_percent_encode(
            query.query.trim(),
            percent_encoding::NON_ALPHANUMERIC,
        )
    );
    let response = steamgriddb_get::<Vec<SteamGridDbGame>>(&api_key, &url).await?;

    Ok(Json(
        response
            .data
            .unwrap_or_default()
            .into_iter()
            .map(|game_result| SteamGridDbGameResult {
                id: game_result.id,
                name: game_result.name.unwrap_or_default(),
                year: game_result.release_date.and_then(unix_timestamp_year),
            })
            .collect(),
    ))
}

pub(super) async fn get_steamgriddb_covers(
    State(state): State<Arc<AppState>>,
    _admin_user: AdminUser,
    AxumPath(sgdb_game_id): AxumPath<i64>,
) -> Result<Json<Vec<String>>, RouteError> {
    get_steamgriddb_images(
        &state,
        sgdb_game_id,
        "https://www.steamgriddb.com/api/v2/grids/game/{sgdb_game_id}?dimensions=600x900&types=static,animated",
    )
    .await
}

pub(super) async fn get_steamgriddb_heroes(
    State(state): State<Arc<AppState>>,
    _admin_user: AdminUser,
    AxumPath(sgdb_game_id): AxumPath<i64>,
) -> Result<Json<Vec<String>>, RouteError> {
    get_steamgriddb_images(
        &state,
        sgdb_game_id,
        "https://www.steamgriddb.com/api/v2/heroes/game/{sgdb_game_id}?types=static,animated",
    )
    .await
}

async fn get_steamgriddb_images(
    state: &Arc<AppState>,
    sgdb_game_id: i64,
    template: &str,
) -> Result<Json<Vec<String>>, RouteError> {
    let api_key = steamgriddb_api_key(state)?;
    let url = template.replace("{sgdb_game_id}", &sgdb_game_id.to_string());
    let response = steamgriddb_get::<Vec<SteamGridDbImage>>(&api_key, &url).await?;

    Ok(Json(
        response
            .data
            .unwrap_or_default()
            .into_iter()
            .filter_map(|image| image.url)
            .collect(),
    ))
}

fn steamgriddb_api_key(state: &Arc<AppState>) -> Result<String, RouteError> {
    let credentials = state
        .config_store
        .credentials()
        .map_err(RouteError::internal)?;

    if credentials.steamgriddb_api_key.is_empty() {
        return Err(RouteError::bad_request(
            "SteamGridDB API key not configured.",
        ));
    }

    Ok(credentials.steamgriddb_api_key)
}

#[derive(Debug, Deserialize)]
struct SteamGridDbEnvelope<T> {
    data: Option<T>,
}

#[derive(Debug, Deserialize)]
struct SteamGridDbGame {
    id: i64,
    name: Option<String>,
    release_date: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SteamGridDbGameResult {
    id: i64,
    name: String,
    year: Option<i32>,
}

#[derive(Debug, Deserialize)]
struct SteamGridDbImage {
    url: Option<String>,
}

async fn steamgriddb_get<T>(api_key: &str, url: &str) -> Result<SteamGridDbEnvelope<T>, RouteError>
where
    T: for<'de> Deserialize<'de>,
{
    let response = reqwest::Client::new()
        .get(url)
        .bearer_auth(api_key)
        .send()
        .await
        .map_err(RouteError::internal)?;

    if !response.status().is_success() {
        if url.contains("/grids/") || url.contains("/heroes/") {
            return Ok(SteamGridDbEnvelope { data: None });
        }

        return Err(RouteError::bad_gateway("SteamGridDB request failed."));
    }

    response.json().await.map_err(RouteError::internal)
}

fn unix_timestamp_year(timestamp: i64) -> Option<i32> {
    chrono::DateTime::from_timestamp(timestamp, 0).map(|date| date.year())
}
