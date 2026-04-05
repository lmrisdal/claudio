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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ping_returns_current_platform_and_version() {
        let response = ping();

        assert_eq!(response.platform, std::env::consts::OS);
        assert_eq!(response.version, version::display_version());
    }
}
