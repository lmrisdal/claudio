pub mod games;
pub mod ping;
pub mod server_connection;

use crate::settings;

pub fn get_settings() -> Result<settings::DesktopSettings, String> {
    Ok(settings::load())
}

pub fn update_settings(settings: settings::DesktopSettings) -> Result<(), String> {
    settings::save(&settings)
}
