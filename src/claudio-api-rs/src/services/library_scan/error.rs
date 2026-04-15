use thiserror::Error;

#[derive(Debug, Error)]
pub enum LibraryScanError {
    #[error("database error: {0}")]
    Database(#[from] sea_orm::DbErr),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("archive error: {0}")]
    Archive(#[from] crate::util::archive::ArchiveError),
    #[error("failed to read SteamGridDB credentials: {0}")]
    Credentials(#[from] crate::config::ConfigError),
    #[error("http request failed: {0}")]
    Http(#[from] reqwest::Error),
    #[error("scan failed: {0}")]
    Scan(String),
}
