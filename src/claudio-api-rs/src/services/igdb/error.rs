use thiserror::Error;

#[derive(Debug, Error)]
pub enum IgdbError {
    #[error("IGDB client_id and client_secret must be configured.")]
    MissingCredentials,
    #[error("IGDB scan is already running.")]
    ScanAlreadyRunning,
    #[error("Game not found.")]
    GameNotFound,
    #[error("IGDB game not found.")]
    CandidateNotFound,
    #[error("IGDB request failed.")]
    RequestFailed,
    #[error("failed to read IGDB credentials: {0}")]
    Credentials(#[from] crate::config::ConfigError),
    #[error("database error: {0}")]
    Database(#[from] sea_orm::DbErr),
    #[error("http request failed: {0}")]
    Http(#[from] reqwest::Error),
}
