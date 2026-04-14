use std::{path::PathBuf, sync::Arc};

use sea_orm::DatabaseConnection;

use crate::{
    auth::jwt::JwtKeys,
    config::ClaudioConfig,
    services::{
        compression::CompressionService,
        config_file::ConfigFileService,
        download::DownloadService,
        igdb::IgdbService,
        library_scan::LibraryScanService,
        nonce_store::{ExternalLoginNonceStore, ProxyNonceStore},
        oauth::OAuthStateStore,
        ticket::{DownloadTicketStore, EmulationTicketStore},
    },
};

pub struct AppState {
    pub db: DatabaseConnection,
    pub images_dir: PathBuf,
    pub config: Arc<ClaudioConfig>,
    pub jwt: Arc<JwtKeys>,
    pub http_client: reqwest::Client,
    pub config_file_service: Arc<ConfigFileService>,
    pub proxy_nonce_store: Arc<ProxyNonceStore>,
    pub external_login_nonce_store: Arc<ExternalLoginNonceStore>,
    pub github_state_store: Arc<OAuthStateStore>,
    pub google_state_store: Arc<OAuthStateStore>,
    pub oidc_state_store: Arc<OAuthStateStore>,
    pub emulation_ticket_store: Arc<EmulationTicketStore>,
    pub download_ticket_store: Arc<DownloadTicketStore>,
    pub download_service: Arc<DownloadService>,
    pub compression_service: Arc<CompressionService>,
    pub igdb_service: Arc<IgdbService>,
    pub library_scan_service: Arc<LibraryScanService>,
}
