use serde::Serialize;

use crate::version;

#[derive(Serialize)]
pub struct PingResponse {
    pub version: String,
    pub platform: String,
}

#[tauri::command]
pub fn ping() -> PingResponse {
    PingResponse {
        version: version::display_version(),
        platform: std::env::consts::OS.to_string(),
    }
}
