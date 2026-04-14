use std::{
    sync::{Arc, Mutex},
    time::Duration,
};

use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter,
};
use serde::Deserialize;

use crate::{
    entity::game,
    services::igdb::{BackgroundTaskStatus, IgdbService},
};

use super::error::LibraryScanError;

const STEAM_GRID_DB_WAIT_MIN: Duration = Duration::from_secs(2);
const STEAM_GRID_DB_WAIT_MAX: Duration = Duration::from_secs(30);

pub(super) struct SteamGridDbWorker {
    db: DatabaseConnection,
    client: reqwest::Client,
    igdb_service: Arc<IgdbService>,
    status: Arc<Mutex<BackgroundTaskStatus>>,
}

impl SteamGridDbWorker {
    pub(super) fn new(
        db: DatabaseConnection,
        client: reqwest::Client,
        igdb_service: Arc<IgdbService>,
        status: Arc<Mutex<BackgroundTaskStatus>>,
    ) -> Self {
        Self {
            db,
            client,
            igdb_service,
            status,
        }
    }

    pub(super) fn status(&self) -> BackgroundTaskStatus {
        self.status
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    pub(super) fn try_start(&self) -> bool {
        let mut status = self
            .status
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if status.is_running {
            return false;
        }

        *status = BackgroundTaskStatus {
            is_running: true,
            current_game: None,
            total: 0,
            processed: 0,
            matched: 0,
        };
        true
    }

    pub(super) fn reset_status(&self) {
        self.update_status(|status| *status = BackgroundTaskStatus::default());
    }

    pub(super) async fn fetch_heroes_streaming(
        &self,
        api_key: &str,
    ) -> Result<(), LibraryScanError> {
        if api_key.is_empty() {
            self.reset_status();
            return Ok(());
        }

        if !self.status().is_running && !self.try_start() {
            return Ok(());
        }

        let mut processed = std::collections::HashSet::new();
        let mut matched = 0usize;
        let mut processed_count = 0usize;
        let mut wait_duration = STEAM_GRID_DB_WAIT_MIN;

        loop {
            let candidates = game::Entity::find()
                .filter(game::Column::IgdbId.is_not_null())
                .filter(game::Column::HeroUrl.is_null())
                .filter(game::Column::IsMissing.eq(false))
                .all(&self.db)
                .await?;

            let batch = candidates
                .into_iter()
                .filter(|game_model| !processed.contains(&game_model.id))
                .collect::<Vec<_>>();

            if batch.is_empty() {
                if self.igdb_service.status().is_running {
                    tokio::time::sleep(wait_duration).await;
                    wait_duration = (wait_duration * 2).min(STEAM_GRID_DB_WAIT_MAX);
                    continue;
                }
                break;
            }

            wait_duration = STEAM_GRID_DB_WAIT_MIN;
            self.update_status(|status| {
                status.total = processed_count + batch.len();
                status.processed = processed_count;
                status.matched = matched;
            });

            for game_model in batch {
                processed.insert(game_model.id);
                self.update_status(|status| status.current_game = Some(game_model.title.clone()));

                let hero_url = self
                    .fetch_first_hero_url(api_key, &game_model.title)
                    .await?;
                processed_count += 1;

                if let Some(hero_url) = hero_url {
                    let mut active_model: game::ActiveModel = game_model.into();
                    active_model.hero_url = Set(Some(hero_url));
                    active_model.update(&self.db).await?;
                    matched += 1;
                }

                self.update_status(|status| {
                    status.processed = processed_count;
                    status.matched = matched;
                });

                tokio::time::sleep(Duration::from_millis(250)).await;
            }
        }

        self.reset_status();
        Ok(())
    }

    async fn fetch_first_hero_url(
        &self,
        api_key: &str,
        title: &str,
    ) -> Result<Option<String>, LibraryScanError> {
        let search_url = format!(
            "https://www.steamgriddb.com/api/v2/search/autocomplete/{}",
            percent_encoding::utf8_percent_encode(title, percent_encoding::NON_ALPHANUMERIC)
        );
        let search_response = self
            .client
            .get(search_url)
            .bearer_auth(api_key)
            .send()
            .await?;
        if !search_response.status().is_success() {
            return Ok(None);
        }

        let search_envelope: SteamGridDbEnvelope<Vec<SteamGridDbGame>> =
            search_response.json().await?;
        let Some(game_result) = search_envelope
            .data
            .and_then(|results| results.into_iter().next())
        else {
            return Ok(None);
        };

        let hero_url = format!(
            "https://www.steamgriddb.com/api/v2/heroes/game/{}",
            game_result.id
        );
        let hero_response = self
            .client
            .get(hero_url)
            .bearer_auth(api_key)
            .send()
            .await?;
        if !hero_response.status().is_success() {
            return Ok(None);
        }

        let hero_envelope: SteamGridDbEnvelope<Vec<SteamGridDbImage>> =
            hero_response.json().await?;
        Ok(hero_envelope
            .data
            .and_then(|images| images.into_iter().find_map(|image| image.url)))
    }

    fn update_status(&self, update: impl FnOnce(&mut BackgroundTaskStatus)) {
        let mut status = self
            .status
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        update(&mut status);
    }
}

#[derive(Debug, Deserialize)]
struct SteamGridDbEnvelope<T> {
    data: Option<T>,
}

#[derive(Debug, Deserialize)]
struct SteamGridDbGame {
    id: i64,
}

#[derive(Debug, Deserialize)]
struct SteamGridDbImage {
    url: Option<String>,
}
