mod error;
mod fs;
mod scan;
mod steamgriddb;

use std::sync::{Arc, Mutex};

use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter,
};
use serde::Serialize;
use tokio::time::MissedTickBehavior;
use tracing::warn;

use crate::{
    config::ClaudioConfig,
    entity::game,
    services::{
        compression::CompressionService,
        config_file::ConfigFileService,
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
    config_file_service: Arc<ConfigFileService>,
    client: reqwest::Client,
    compression_service: Arc<CompressionService>,
    igdb_service: Arc<IgdbService>,
    steam_grid_db_status: Arc<Mutex<BackgroundTaskStatus>>,
    scan_lock: Arc<tokio::sync::Mutex<()>>,
}

impl LibraryScanService {
    pub fn new(
        db: DatabaseConnection,
        config: Arc<ClaudioConfig>,
        config_file_service: Arc<ConfigFileService>,
        client: reqwest::Client,
        compression_service: Arc<CompressionService>,
        igdb_service: Arc<IgdbService>,
    ) -> Self {
        Self {
            db,
            config,
            config_file_service,
            client,
            compression_service,
            igdb_service,
            steam_grid_db_status: Arc::new(Mutex::new(BackgroundTaskStatus::default())),
            scan_lock: Arc::new(tokio::sync::Mutex::new(())),
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
        let _guard = self.scan_lock.lock().await;
        let result = self.perform_scan().await?;

        if result.games_added > 0 && self.igdb_service.is_configured().unwrap_or(false) {
            let _ = self.igdb_service.start_scan_in_background();
        }

        let api_key = self.config_file_service.credentials()?.steamgriddb_api_key;
        let steamgriddb_worker = self.steamgriddb_worker();
        if !api_key.is_empty() && steamgriddb_worker.try_start() {
            tokio::spawn(async move {
                if let Err(error) = steamgriddb_worker.fetch_heroes_streaming(&api_key).await {
                    warn!(error = %error, "SteamGridDB hero fetch failed");
                    steamgriddb_worker.reset_status();
                }
            });
        }

        Ok(result)
    }

    pub async fn run_scheduler(self: Arc<Self>) {
        if let Err(error) = self.scan().await {
            warn!(error = %error, "startup library scan failed");
        }

        let scan_interval = self.config.library.scan_interval_secs.max(30);
        let mut interval =
            tokio::time::interval(std::time::Duration::from_secs(scan_interval));
        interval.set_missed_tick_behavior(MissedTickBehavior::Delay);
        interval.tick().await;
        loop {
            interval.tick().await;
            if let Err(error) = self.scan().await {
                warn!(error = %error, "scheduled library scan failed");
            }
        }
    }

    async fn upsert_game(
        &self,
        platform: &str,
        folder_name: &str,
        folder_path: String,
        install_type: String,
        size_bytes: i64,
    ) -> Result<bool, LibraryScanError> {
        let existing = game::Entity::find()
            .filter(game::Column::Platform.eq(platform))
            .filter(game::Column::FolderName.eq(folder_name))
            .one(&self.db)
            .await?;

        if let Some(existing_game) = existing {
            let mut active_model: game::ActiveModel = existing_game.into();
            active_model.folder_path = Set(folder_path);
            active_model.install_type = Set(install_type);
            active_model.size_bytes = Set(size_bytes);
            active_model.is_missing = Set(false);
            active_model.update(&self.db).await?;
            return Ok(false);
        }

        game::ActiveModel {
            title: Set(folder_name.to_string()),
            platform: Set(platform.to_string()),
            folder_name: Set(folder_name.to_string()),
            folder_path: Set(folder_path),
            install_type: Set(install_type),
            size_bytes: Set(size_bytes),
            is_missing: Set(false),
            ..Default::default()
        }
        .insert(&self.db)
        .await?;

        Ok(true)
    }

    async fn upsert_archive_game(
        &self,
        platform: &str,
        folder_name: &str,
        title: &str,
        archive_path: std::path::PathBuf,
        size_bytes: i64,
    ) -> Result<bool, LibraryScanError> {
        let existing = game::Entity::find()
            .filter(game::Column::Platform.eq(platform))
            .filter(game::Column::FolderName.eq(folder_name))
            .one(&self.db)
            .await?;

        if let Some(existing_game) = existing {
            let mut active_model: game::ActiveModel = existing_game.into();
            active_model.folder_path = Set(archive_path.to_string_lossy().to_string());
            active_model.size_bytes = Set(size_bytes);
            active_model.is_missing = Set(false);
            active_model.update(&self.db).await?;
            return Ok(false);
        }

        game::ActiveModel {
            title: Set(title.to_string()),
            platform: Set(platform.to_string()),
            folder_name: Set(folder_name.to_string()),
            folder_path: Set(archive_path.to_string_lossy().to_string()),
            install_type: Set("portable".to_string()),
            size_bytes: Set(size_bytes),
            is_missing: Set(false),
            ..Default::default()
        }
        .insert(&self.db)
        .await?;

        Ok(true)
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
