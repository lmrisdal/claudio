use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSettings {
    pub server_url: Option<String>,
    pub window_width: f64,
    pub window_height: f64,
    pub window_x: Option<f64>,
    pub window_y: Option<f64>,
    pub default_install_path: Option<String>,
    #[serde(default)]
    pub close_to_tray: bool,
    #[serde(default)]
    pub custom_headers: HashMap<String, String>,
    /// Download speed limit in megabits per second. None or 0 means unlimited.
    #[serde(default)]
    pub download_speed_limit_kbs: Option<f64>,
}

impl Default for DesktopSettings {
    fn default() -> Self {
        Self {
            server_url: None,
            window_width: 1280.0,
            window_height: 800.0,
            window_x: None,
            window_y: None,
            default_install_path: None,
            close_to_tray: false,
            custom_headers: HashMap::new(),
            download_speed_limit_kbs: None,
        }
    }
}

fn settings_path() -> PathBuf {
    data_dir().join("settings.json")
}

pub fn load() -> DesktopSettings {
    let path = settings_path();
    match fs::read_to_string(&path) {
        Ok(contents) => serde_json::from_str(&contents).unwrap_or_default(),
        Err(_) => DesktopSettings::default(),
    }
}

pub async fn load_async() -> DesktopSettings {
    let path = settings_path();
    match tokio::fs::read_to_string(&path).await {
        Ok(contents) => serde_json::from_str(&contents).unwrap_or_default(),
        Err(_) => DesktopSettings::default(),
    }
}

pub fn save(settings: &DesktopSettings) -> Result<(), String> {
    let path = settings_path();
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

pub fn data_dir() -> PathBuf {
    let dir = dirs::data_local_dir()
        .expect("could not determine local data directory")
        .join("claudio");
    fs::create_dir_all(&dir).expect("could not create settings directory");
    dir
}

fn os_default_games_dir() -> PathBuf {
    #[cfg(target_os = "windows")]
    return PathBuf::from("C:\\Games");

    #[cfg(not(target_os = "windows"))]
    return dirs::home_dir()
        .expect("could not determine home directory")
        .join("Games");
}

/// Returns the install root without creating any directories. Used to suggest a
/// default path in the UI.
pub fn default_install_root(settings: &DesktopSettings) -> PathBuf {
    settings
        .default_install_path
        .as_deref()
        .map(PathBuf::from)
        .unwrap_or_else(os_default_games_dir)
}

pub fn resolve_install_root(settings: &DesktopSettings) -> Result<PathBuf, String> {
    let path = default_install_root(settings);
    fs::create_dir_all(&path).map_err(|err| err.to_string())?;
    Ok(path)
}
