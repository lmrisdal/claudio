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

pub fn resolve_install_root(settings: &DesktopSettings) -> Result<PathBuf, String> {
    let path = settings
        .default_install_path
        .as_deref()
        .map(PathBuf::from)
        .unwrap_or_else(|| data_dir().join("games"));

    fs::create_dir_all(&path).map_err(|err| err.to_string())?;
    Ok(path)
}
