mod client;
mod error;
mod matcher;
mod models;

use std::{
    sync::{Arc, Mutex},
    time::Duration,
};

use sea_orm::{ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter};
use tokio::time::sleep;
use tracing::{error, info, warn};

use crate::{config::ConfigStore, entity::game};

pub use error::IgdbError;
pub use models::{BackgroundTaskStatus, IgdbCandidate};

const RATE_LIMIT_DELAY: Duration = Duration::from_millis(300);

pub struct IgdbService {
    db: DatabaseConnection,
    client: reqwest::Client,
    config_store: Arc<ConfigStore>,
    status: Mutex<BackgroundTaskStatus>,
    token_cache: tokio::sync::Mutex<Option<client::TwitchTokenCache>>,
}

impl IgdbService {
    pub fn new(
        db: DatabaseConnection,
        client: reqwest::Client,
        config_store: Arc<ConfigStore>,
    ) -> Self {
        Self {
            db,
            client,
            config_store,
            status: Mutex::new(BackgroundTaskStatus::default()),
            token_cache: tokio::sync::Mutex::new(None),
        }
    }

    #[must_use]
    pub fn status(&self) -> BackgroundTaskStatus {
        self.status
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    pub fn is_configured(&self) -> Result<bool, IgdbError> {
        let credentials = self.config_store.credentials()?;
        Ok(!credentials.igdb_client_id.is_empty() && !credentials.igdb_client_secret.is_empty())
    }

    pub fn start_scan_in_background(self: &Arc<Self>) -> Result<(), IgdbError> {
        {
            let mut status = self
                .status
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if status.is_running {
                return Err(IgdbError::ScanAlreadyRunning);
            }

            status.is_running = true;
            status.current_game = None;
            status.total = 0;
            status.processed = 0;
            status.matched = 0;
        }

        let service = Arc::clone(self);
        tokio::spawn(async move {
            if let Err(error) = service.scan_unmatched_games().await {
                error!(error = %error, "background IGDB scan failed");
                service.reset_status();
            }
        });

        Ok(())
    }

    pub async fn search_candidates(&self, query: &str) -> Result<Vec<IgdbCandidate>, IgdbError> {
        self.ensure_configured()?;
        let (title, year, _) = matcher::parse_folder_name(query);
        if title.is_empty() {
            return Ok(Vec::new());
        }

        client::search_igdb(
            &self.client,
            &self.config_store,
            &self.token_cache,
            &title,
            year,
        )
        .await
    }

    pub async fn apply_match(&self, game_id: i32, igdb_id: i64) -> Result<game::Model, IgdbError> {
        self.ensure_configured()?;

        let game_model = game::Entity::find_by_id(game_id)
            .one(&self.db)
            .await?
            .ok_or(IgdbError::GameNotFound)?;
        let candidate =
            client::fetch_by_id(&self.client, &self.config_store, &self.token_cache, igdb_id)
                .await?
                .ok_or(IgdbError::CandidateNotFound)?;

        let active_model = matcher::apply_candidate(game_model, &candidate);
        let updated = active_model.update(&self.db).await?;
        info!(game_id, igdb_id, title = %updated.title, "applied IGDB match");
        Ok(updated)
    }

    async fn scan_unmatched_games(&self) -> Result<(), IgdbError> {
        self.ensure_configured()?;

        let games = game::Entity::find()
            .filter(game::Column::IgdbId.is_null())
            .filter(game::Column::IsMissing.eq(false))
            .all(&self.db)
            .await?;

        self.update_status(|status| {
            status.total = games.len();
            status.processed = 0;
            status.matched = 0;
        });

        let mut matched = 0usize;
        let mut processed = 0usize;

        for game_model in games {
            self.update_status(|status| status.current_game = Some(game_model.title.clone()));

            let result = self.match_game(game_model).await;
            match result {
                Ok(true) => matched += 1,
                Ok(false) => {}
                Err(error) => warn!(error = %error, "failed to fetch IGDB data"),
            }

            processed += 1;
            self.update_status(|status| {
                status.processed = processed;
                status.matched = matched;
            });

            sleep(RATE_LIMIT_DELAY).await;
        }

        info!(matched, processed, "IGDB scan complete");
        self.reset_status();
        Ok(())
    }

    async fn match_game(&self, game_model: game::Model) -> Result<bool, IgdbError> {
        let (cleaned_title, year, tagged_igdb_id) =
            matcher::parse_folder_name(&game_model.folder_name);

        let Some(candidate) = (match tagged_igdb_id {
            Some(igdb_id) => {
                client::fetch_by_id(&self.client, &self.config_store, &self.token_cache, igdb_id)
                    .await?
            }
            None => {
                let candidates = client::search_igdb(
                    &self.client,
                    &self.config_store,
                    &self.token_cache,
                    &cleaned_title,
                    year,
                )
                .await?;
                matcher::select_best_candidate(candidates, &cleaned_title, &game_model.platform)
            }
        }) else {
            return Ok(false);
        };

        let active_model = matcher::apply_candidate(game_model, &candidate);
        active_model.update(&self.db).await?;
        Ok(true)
    }

    fn ensure_configured(&self) -> Result<(), IgdbError> {
        if self.is_configured()? {
            Ok(())
        } else {
            Err(IgdbError::MissingCredentials)
        }
    }

    fn update_status(&self, update: impl FnOnce(&mut BackgroundTaskStatus)) {
        let mut status = self
            .status
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        update(&mut status);
    }

    fn reset_status(&self) {
        self.update_status(|status| *status = BackgroundTaskStatus::default());
    }
}
