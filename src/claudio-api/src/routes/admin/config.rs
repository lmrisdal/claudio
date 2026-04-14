use std::sync::Arc;

use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};

use crate::{auth::middleware::AdminUser, services::config_file::ApiCredentials, state::AppState};

use super::shared::RouteError;

pub(super) async fn get_config(
    State(state): State<Arc<AppState>>,
    _admin_user: AdminUser,
) -> Result<Json<ConfigResponse>, RouteError> {
    let credentials = state
        .config_file_service
        .credentials()
        .map_err(RouteError::internal)?;
    Ok(Json(ConfigResponse::from(credentials)))
}

#[derive(Debug, Deserialize)]
pub(super) struct ConfigUpdateRequest {
    igdb: Option<IgdbConfigUpdate>,
    steamgriddb: Option<SteamGridDbConfigUpdate>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct IgdbConfigUpdate {
    client_id: Option<String>,
    client_secret: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SteamGridDbConfigUpdate {
    api_key: Option<String>,
}

pub(super) async fn update_config(
    State(state): State<Arc<AppState>>,
    _admin_user: AdminUser,
    Json(request): Json<ConfigUpdateRequest>,
) -> Result<Json<ConfigResponse>, RouteError> {
    let igdb = request.igdb;
    let steamgriddb = request.steamgriddb;
    let credentials = state
        .config_file_service
        .update_api_credentials(
            igdb.as_ref().and_then(|igdb| igdb.client_id.clone()),
            igdb.and_then(|igdb| igdb.client_secret),
            steamgriddb.and_then(|steamgriddb| steamgriddb.api_key),
        )
        .map_err(RouteError::internal)?;

    Ok(Json(ConfigResponse::from(credentials)))
}

#[derive(Debug, Serialize)]
pub(super) struct ConfigResponse {
    igdb: MaskedIgdbConfig,
    steamgriddb: MaskedSteamGridDbConfig,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct MaskedIgdbConfig {
    client_id: String,
    client_secret: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct MaskedSteamGridDbConfig {
    api_key: String,
}

impl From<ApiCredentials> for ConfigResponse {
    fn from(credentials: ApiCredentials) -> Self {
        Self {
            igdb: MaskedIgdbConfig {
                client_id: credentials.igdb_client_id,
                client_secret: mask_secret(&credentials.igdb_client_secret),
            },
            steamgriddb: MaskedSteamGridDbConfig {
                api_key: mask_secret(&credentials.steamgriddb_api_key),
            },
        }
    }
}

fn mask_secret(value: &str) -> String {
    if value.trim().is_empty() {
        return String::new();
    }

    let chars = value.chars().collect::<Vec<_>>();
    if chars.len() <= 6 {
        return "••••••".to_string();
    }

    let prefix = chars.iter().take(3).collect::<String>();
    let suffix = chars
        .iter()
        .skip(chars.len().saturating_sub(3))
        .collect::<String>();
    format!("{prefix}••••••{suffix}")
}

#[cfg(test)]
mod tests {
    use super::mask_secret;

    #[test]
    fn mask_secret_should_preserve_edges_for_long_values() {
        assert_eq!(mask_secret("abcdefghi"), "abc••••••ghi");
    }
}
