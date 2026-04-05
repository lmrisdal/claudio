use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum InstallType {
    Portable,
    Installer,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteGame {
    pub id: i32,
    pub title: String,
    pub platform: String,
    pub install_type: InstallType,
    pub installer_exe: Option<String>,
    pub game_exe: Option<String>,
    pub install_path: Option<String>,
    pub desktop_shortcut: Option<bool>,
    pub run_as_administrator: Option<bool>,
    pub force_interactive: Option<bool>,
    pub summary: Option<String>,
    pub genre: Option<String>,
    pub release_year: Option<i32>,
    pub cover_url: Option<String>,
    pub hero_url: Option<String>,
    pub developer: Option<String>,
    pub publisher: Option<String>,
    pub game_mode: Option<String>,
    pub series: Option<String>,
    pub franchise: Option<String>,
    pub game_engine: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledGame {
    pub remote_game_id: i32,
    pub title: String,
    pub platform: String,
    pub install_type: InstallType,
    pub install_path: String,
    pub game_exe: Option<String>,
    pub installed_at: String,
    pub summary: Option<String>,
    pub genre: Option<String>,
    pub release_year: Option<i32>,
    pub cover_url: Option<String>,
    pub hero_url: Option<String>,
    pub developer: Option<String>,
    pub publisher: Option<String>,
    pub game_mode: Option<String>,
    pub series: Option<String>,
    pub franchise: Option<String>,
    pub game_engine: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallProgress {
    pub game_id: i32,
    pub status: String,
    pub percent: Option<f64>,
    pub indeterminate: Option<bool>,
    pub detail: Option<String>,
    pub bytes_downloaded: Option<u64>,
    pub total_bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadPackageInput {
    pub id: i32,
    pub title: String,
    pub target_dir: String,
    pub extract: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunningGameInfo {
    pub game_id: i32,
    pub pid: u32,
    pub exe_path: String,
    pub started_at: String,
}
