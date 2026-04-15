use thiserror::Error;

#[derive(Debug, Error)]
pub enum LibraryScanError {
    #[error("database error: {0}")]
    Database(#[from] sea_orm::DbErr),
    #[error("failed to read SteamGridDB credentials: {0}")]
    Credentials(#[from] crate::services::config_file::ConfigFileError),
    #[error("http request failed: {0}")]
    Http(#[from] reqwest::Error),
    #[error("scan failed: {0}")]
    Scan(String),
}
