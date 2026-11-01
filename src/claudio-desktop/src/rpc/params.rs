use crate::models::{DownloadPackageInput, RemoteGame};
use crate::settings::DesktopSettings;
use serde::Deserialize;
use serde::de::DeserializeOwned;
use serde_json::Value;
use std::collections::HashMap;

pub(super) fn parse<T: DeserializeOwned>(method: &str, params: Value) -> Result<T, String> {
    let params = if params.is_null() {
        Value::Object(serde_json::Map::new())
    } else {
        params
    };
    serde_json::from_value(params)
        .map_err(|error| format!("invalid args for command `{method}`: {error}"))
}

#[derive(Deserialize)]
pub(super) struct GameArgs {
    pub game: RemoteGame,
}

#[derive(Deserialize)]
pub(super) struct DownloadArgs {
    pub input: DownloadPackageInput,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct GameIdArgs {
    pub game_id: i32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RemoteGameIdArgs {
    pub remote_game_id: i32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct UninstallArgs {
    pub remote_game_id: i32,
    pub delete_files: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SetGameExeArgs {
    pub remote_game_id: i32,
    pub game_exe: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct GameTitleArgs {
    pub game_title: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct TargetPathArgs {
    pub target_path: String,
}

#[derive(Deserialize)]
pub(super) struct SettingsArgs {
    pub settings: DesktopSettings,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ConnectionArgs {
    pub server_url: Option<String>,
    pub custom_headers: Option<HashMap<String, String>>,
    pub path: Option<String>,
}

#[derive(Deserialize)]
pub(super) struct LogArgs {
    pub level: String,
    pub message: String,
    pub source: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct GameLaunchSettingsArgs {
    pub remote_game_id: i32,
    pub game_exe: Option<String>,
    pub proton_path: Option<String>,
    pub options: crate::models::GameLaunchOptions,
}
