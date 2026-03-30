use serde::Serialize;

#[derive(Serialize)]
pub struct PingResponse {
    pub version: String,
    pub platform: String,
}

#[tauri::command]
pub fn ping() -> PingResponse {
    PingResponse {
        version: env!("CARGO_PKG_VERSION").to_string(),
        platform: std::env::consts::OS.to_string(),
    }
}
