mod error;
mod fs;
mod scan;
mod steamgriddb;

use std::sync::{Arc, Mutex};

use sea_orm::DatabaseConnection;
use serde::Serialize;
use tracing::{debug, warn};

use crate::{
    config::{ClaudioConfig, ConfigStore},
    services::{
        compression::CompressionService,
        igdb::{BackgroundTaskStatus, IgdbService},
    },
};

pub use error::LibraryScanError;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub games_found: usize,
    pub games_added: usize,
    pub games_missing: usize,
}

pub struct LibraryScanService {
    db: DatabaseConnection,
    config: Arc<ClaudioConfig>,
    config_store: Arc<ConfigStore>,
    client: reqwest::Client,
    compression_service: Arc<CompressionService>,
    igdb_service: Arc<IgdbService>,
    steam_grid_db_status: Arc<Mutex<BackgroundTaskStatus>>,
}

impl LibraryScanService {
    pub fn new(
        db: DatabaseConnection,
        config: Arc<ClaudioConfig>,
        config_store: Arc<ConfigStore>,
        client: reqwest::Client,
        compression_service: Arc<CompressionService>,
        igdb_service: Arc<IgdbService>,
    ) -> Self {
        Self {
            db,
            config,
            config_store,
            client,
            compression_service,
            igdb_service,
            steam_grid_db_status: Arc::new(Mutex::new(BackgroundTaskStatus::default())),
        }
    }

    #[must_use]
    pub fn steam_grid_db_status(&self) -> BackgroundTaskStatus {
        self.steam_grid_db_status
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    pub async fn scan(&self) -> Result<ScanResult, LibraryScanError> {
        debug!("TEMP_SCAN_DEBUG: scan() called, starting perform_scan()");
        let result = self.perform_scan().await?;
        debug!(
            games_found = result.games_found,
            games_added = result.games_added,
            games_missing = result.games_missing,
            "TEMP_SCAN_DEBUG: perform_scan() returned"
        );

        if result.games_added > 0 && self.igdb_service.is_configured().unwrap_or(false) {
            debug!("TEMP_SCAN_DEBUG: starting IGDB background scan after library scan");
            let _ = self.igdb_service.start_scan_in_background();
        }

        let api_key = self.config_store.credentials()?.steamgriddb_api_key;
        let steamgriddb_worker = self.steamgriddb_worker();
        if !api_key.is_empty() {
            steamgriddb_worker.start();
            debug!("TEMP_SCAN_DEBUG: starting SteamGridDB background worker after library scan");
            tokio::spawn(async move {
                if let Err(error) = steamgriddb_worker.fetch_heroes_streaming(&api_key).await {
                    warn!(error = %error, "SteamGridDB hero fetch failed");
                    steamgriddb_worker.reset_status();
                }
            });
        }

        debug!("TEMP_SCAN_DEBUG: scan() returning result");
        Ok(result)
    }

    pub async fn run_scheduler(self: Arc<Self>) {
        debug!("TEMP_SCAN_DEBUG: run_scheduler() starting startup scan");
        if let Err(error) = self.scan().await {
            warn!(error = %error, "startup library scan failed");
        }
        debug!("TEMP_SCAN_DEBUG: startup scan finished, scheduler entering interval loop");

        loop {
            debug!("TEMP_SCAN_DEBUG: waiting 120 seconds for next scheduled scan");
            tokio::time::sleep(std::time::Duration::from_secs(120)).await;
            debug!("TEMP_SCAN_DEBUG: scheduled scan tick fired, starting scan()");
            if let Err(error) = self.scan().await {
                warn!(error = %error, "scheduled library scan failed");
            }
            debug!("TEMP_SCAN_DEBUG: scheduled scan finished");
        }
    }

    fn steamgriddb_worker(&self) -> steamgriddb::SteamGridDbWorker {
        steamgriddb::SteamGridDbWorker::new(
            self.db.clone(),
            self.client.clone(),
            Arc::clone(&self.igdb_service),
            Arc::clone(&self.steam_grid_db_status),
        )
    }
}
