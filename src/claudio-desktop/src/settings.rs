use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
#[cfg(any(test, feature = "integration-tests"))]
use std::future::Future;
use std::path::PathBuf;
use std::sync::{LazyLock, Mutex};

static DATA_DIR_OVERRIDE: LazyLock<Mutex<Option<PathBuf>>> = LazyLock::new(|| Mutex::new(None));

#[cfg(any(test, feature = "integration-tests"))]
static TEST_DATA_DIR_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

fn default_log_level() -> String {
    "info".to_string()
}

fn normalize_log_level(value: &str) -> String {
    match value.trim().to_ascii_lowercase().as_str() {
        "error" => "error",
        "warn" | "warning" => "warn",
        "info" => "info",
        "debug" => "debug",
        "trace" => "trace",
        _ => "info",
    }
    .to_string()
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSettings {
    pub server_url: Option<String>,
    #[serde(default = "default_log_level")]
    pub log_level: String,
    pub window_width: f64,
    pub window_height: f64,
    pub window_x: Option<f64>,
    pub window_y: Option<f64>,
    pub default_install_path: Option<String>,
    pub default_download_path: Option<String>,
    #[serde(default)]
    pub close_to_tray: bool,
    #[serde(default)]
    pub hide_dock_icon: bool,
    #[serde(default)]
    pub custom_headers: HashMap<String, String>,
    #[serde(default)]
    pub allow_insecure_auth_storage: bool,
    #[serde(default)]
    pub download_speed_limit_kbs: Option<f64>,
}

impl Default for DesktopSettings {
    fn default() -> Self {
        Self {
            server_url: None,
            log_level: default_log_level(),
            window_width: 1280.0,
            window_height: 800.0,
            window_x: None,
            window_y: None,
            default_install_path: None,
            default_download_path: None,
            close_to_tray: false,
            hide_dock_icon: false,
            custom_headers: HashMap::new(),
            allow_insecure_auth_storage: false,
            download_speed_limit_kbs: None,
        }
    }
}

pub fn is_forbidden_custom_header(name: &str) -> bool {
    matches!(
        name.trim().to_ascii_lowercase().as_str(),
        "authorization" | "cookie" | "proxy-authorization"
    )
}

pub fn sanitize_custom_headers(headers: &HashMap<String, String>) -> HashMap<String, String> {
    headers
        .iter()
        .filter_map(|(name, value)| {
            if is_forbidden_custom_header(name) {
                return None;
            }

            Some((name.clone(), value.clone()))
        })
        .collect()
}

fn sanitize_settings(settings: &mut DesktopSettings) {
    settings.log_level = normalize_log_level(&settings.log_level);
    settings.custom_headers = sanitize_custom_headers(&settings.custom_headers);
}

pub fn log_level_filter(settings: &DesktopSettings) -> log::LevelFilter {
    match settings.log_level.as_str() {
        "error" => log::LevelFilter::Error,
        "warn" => log::LevelFilter::Warn,
        "info" => log::LevelFilter::Info,
        "debug" => log::LevelFilter::Debug,
        "trace" => log::LevelFilter::Trace,
        _ => log::LevelFilter::Info,
    }
}

pub(crate) fn settings_path() -> PathBuf {
    data_dir().join("settings.json")
}

pub(crate) fn registry_path() -> PathBuf {
    data_dir().join("installed-games.json")
}

pub(crate) fn auth_fallback_tokens_path() -> PathBuf {
    data_dir().join("auth-fallback.json")
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub(crate) fn tools_dir() -> PathBuf {
    let dir = data_dir().join("tools");
    fs::create_dir_all(&dir).expect("could not create tools directory");
    dir
}

pub fn load() -> DesktopSettings {
    let path = settings_path();
    match fs::read_to_string(&path) {
        Ok(contents) => {
            let mut settings: DesktopSettings = serde_json::from_str(&contents).unwrap_or_default();
            sanitize_settings(&mut settings);
            settings
        }
        Err(_) => DesktopSettings::default(),
    }
}

pub async fn load_async() -> DesktopSettings {
    let path = settings_path();
    match tokio::fs::read_to_string(&path).await {
        Ok(contents) => {
            let mut settings: DesktopSettings = serde_json::from_str(&contents).unwrap_or_default();
            sanitize_settings(&mut settings);
            settings
        }
        Err(_) => DesktopSettings::default(),
    }
}

pub fn save(settings: &DesktopSettings) -> Result<(), String> {
    let path = settings_path();
    let mut settings = settings.clone();
    sanitize_settings(&mut settings);
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

fn default_data_dir() -> PathBuf {
    let folder = if cfg!(any(target_os = "windows", target_os = "macos")) {
        "Claudio"
    } else {
        "claudio"
    };
    dirs::data_local_dir()
        .expect("could not determine local data directory")
        .join(folder)
}

pub fn data_dir() -> PathBuf {
    let dir = DATA_DIR_OVERRIDE
        .lock()
        .ok()
        .and_then(|path| path.clone())
        .unwrap_or_else(default_data_dir);
    fs::create_dir_all(&dir).expect("could not create settings directory");
    dir
}

#[cfg(any(test, feature = "integration-tests"))]
struct TestDataDirGuard {
    path: PathBuf,
    _lock: std::sync::MutexGuard<'static, ()>,
}

#[cfg(any(test, feature = "integration-tests"))]
impl TestDataDirGuard {
    fn new(path: PathBuf) -> Self {
        let lock = TEST_DATA_DIR_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).expect("test data dir should be created");

        let mut override_path = DATA_DIR_OVERRIDE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *override_path = Some(path.clone());
        drop(override_path);

        Self { path, _lock: lock }
    }
}

#[cfg(any(test, feature = "integration-tests"))]
impl Drop for TestDataDirGuard {
    fn drop(&mut self) {
        if let Ok(mut override_path) = DATA_DIR_OVERRIDE.lock() {
            *override_path = None;
        }
        let _ = fs::remove_dir_all(&self.path);
    }
}

#[cfg(any(test, feature = "integration-tests"))]
pub(crate) fn with_test_data_dir<T>(path: PathBuf, run: impl FnOnce() -> T) -> T {
    let _guard = TestDataDirGuard::new(path);
    run()
}

#[cfg(any(test, feature = "integration-tests"))]
pub(crate) async fn with_test_data_dir_async<T, F>(path: PathBuf, run: impl FnOnce() -> F) -> T
where
    F: Future<Output = T>,
{
    let _guard = TestDataDirGuard::new(path);
    run().await
}

fn os_default_games_dir() -> PathBuf {
    #[cfg(target_os = "windows")]
    return PathBuf::from("C:\\Games");

    #[cfg(not(target_os = "windows"))]
    return dirs::home_dir()
        .expect("could not determine home directory")
        .join("Games");
}

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

pub fn default_download_root(settings: &DesktopSettings) -> PathBuf {
    settings
        .default_download_path
        .as_deref()
        .map(PathBuf::from)
        .unwrap_or_else(|| data_dir().join("downloads"))
}

pub fn resolve_download_root(settings: &DesktopSettings) -> Result<PathBuf, String> {
    let path = default_download_root(settings);
    fs::create_dir_all(&path).map_err(|err| err.to_string())?;
    Ok(path)
}

#[cfg(test)]
mod tests;
