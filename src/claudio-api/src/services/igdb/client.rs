use std::time::{Duration, Instant};

use crate::config::ConfigStore;

use super::{
    error::IgdbError,
    models::{IgdbCandidate, IgdbGame, TwitchTokenResponse},
};

pub(super) const IGDB_GAMES_URL: &str = "https://api.igdb.com/v4/games";
const TWITCH_TOKEN_URL: &str = "https://id.twitch.tv/oauth2/token";

pub(super) struct TwitchTokenCache {
    pub(super) access_token: String,
    pub(super) expires_at: Instant,
}

pub(super) async fn fetch_by_id(
    client: &reqwest::Client,
    config_store: &ConfigStore,
    token_cache: &tokio::sync::Mutex<Option<TwitchTokenCache>>,
    igdb_id: i64,
) -> Result<Option<IgdbCandidate>, IgdbError> {
    let query = format!(
        "where id = {igdb_id}; fields name,slug,summary,genres.name,first_release_date,cover.image_id,involved_companies.company.name,involved_companies.developer,involved_companies.publisher,game_modes.name,collection.name,franchises.name,game_engines.name,platforms.name,platforms.slug; limit 1;"
    );
    let response = post_games_query(client, config_store, token_cache, &query).await?;
    Ok(response.into_iter().next().map(IgdbGame::into_candidate))
}

pub(super) async fn search_igdb(
    client: &reqwest::Client,
    config_store: &ConfigStore,
    token_cache: &tokio::sync::Mutex<Option<TwitchTokenCache>>,
    title: &str,
    year: Option<i32>,
) -> Result<Vec<IgdbCandidate>, IgdbError> {
    let escaped_title = title.replace('"', "\\\"");
    let where_clause = year.map_or_else(String::new, |year| {
        let start = chrono::NaiveDate::from_ymd_opt(year, 1, 1)
            .and_then(|date| date.and_hms_opt(0, 0, 0))
            .map(|value| value.and_utc().timestamp())
            .unwrap_or_default();
        let end = chrono::NaiveDate::from_ymd_opt(year, 12, 31)
            .and_then(|date| date.and_hms_opt(23, 59, 59))
            .map(|value| value.and_utc().timestamp())
            .unwrap_or_default();
        format!(" where first_release_date >= {start} & first_release_date <= {end};")
    });
    let query = format!(
        "search \"{escaped_title}\"; fields name,slug,summary,genres.name,first_release_date,cover.image_id,involved_companies.company.name,involved_companies.developer,involved_companies.publisher,game_modes.name,collection.name,franchises.name,game_engines.name,platforms.name,platforms.slug;{where_clause} limit 20;"
    );

    let response = post_games_query(client, config_store, token_cache, &query).await?;
    Ok(response.into_iter().map(IgdbGame::into_candidate).collect())
}

async fn post_games_query(
    client: &reqwest::Client,
    config_store: &ConfigStore,
    token_cache: &tokio::sync::Mutex<Option<TwitchTokenCache>>,
    query: &str,
) -> Result<Vec<IgdbGame>, IgdbError> {
    let token = access_token(client, config_store, token_cache).await?;
    let credentials = config_store.credentials()?;
    let response = client
        .post(IGDB_GAMES_URL)
        .header("Client-ID", credentials.igdb_client_id)
        .bearer_auth(token)
        .body(query.to_string())
        .send()
        .await?;

    if !response.status().is_success() {
        return Err(IgdbError::RequestFailed);
    }

    response.json().await.map_err(IgdbError::from)
}

async fn access_token(
    client: &reqwest::Client,
    config_store: &ConfigStore,
    token_cache: &tokio::sync::Mutex<Option<TwitchTokenCache>>,
) -> Result<String, IgdbError> {
    let mut token_cache = token_cache.lock().await;
    if let Some(cache) = token_cache.as_ref() {
        if Instant::now() < cache.expires_at {
            return Ok(cache.access_token.clone());
        }
    }

    let credentials = config_store.credentials()?;
    let response = client
        .post(TWITCH_TOKEN_URL)
        .query(&[
            ("client_id", credentials.igdb_client_id.as_str()),
            ("client_secret", credentials.igdb_client_secret.as_str()),
            ("grant_type", "client_credentials"),
        ])
        .send()
        .await?;

    if !response.status().is_success() {
        return Err(IgdbError::RequestFailed);
    }

    let token_response: TwitchTokenResponse = response.json().await?;
    let expires_in = token_response.expires_in.saturating_sub(60);
    let access_token = token_response.access_token;
    *token_cache = Some(TwitchTokenCache {
        access_token: access_token.clone(),
        expires_at: Instant::now() + Duration::from_secs(u64::from(expires_in.max(1))),
    });

    Ok(access_token)
}
