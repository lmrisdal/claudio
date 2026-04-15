use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::Arc,
    time::Instant,
};

use sea_orm::{ActiveModelTrait, ActiveValue::Set, EntityTrait};
use tracing::{debug, info, warn};

use crate::{config::ClaudioConfig, entity::game, services::compression::CompressionService};

use super::{error::LibraryScanError, fs, LibraryScanService, ScanResult};

struct DiscoveredGame {
    platform: String,
    folder_name: String,
    folder_path: String,
    install_type: String,
    size_bytes: i64,
}

struct DiscoveredArchive {
    platform: String,
    folder_name: String,
    title: String,
    archive_path: PathBuf,
    size_bytes: i64,
}

struct DiscoveryResult {
    games: Vec<DiscoveredGame>,
    archives: Vec<DiscoveredArchive>,
    found_paths: HashSet<(String, String)>,
}

fn discover_library(
    config: &ClaudioConfig,
    compression_service: &CompressionService,
    existing_paths: &HashSet<(String, String)>,
) -> DiscoveryResult {
    let mut result = DiscoveryResult {
        games: Vec::new(),
        archives: Vec::new(),
        found_paths: HashSet::new(),
    };

    for scan_path in &config.library.library_paths {
        let root = Path::new(scan_path);
        if !root.is_dir() {
            warn!(path = %scan_path, "scan path does not exist");
            continue;
        }

        let Ok(platform_entries) = std::fs::read_dir(root) else {
            warn!(path = %scan_path, "failed to read scan path");
            continue;
        };

        for platform_entry in platform_entries.flatten() {
            let platform_dir = platform_entry.path();
            if !platform_dir.is_dir() {
                continue;
            }

            let platform_name = platform_entry.file_name().to_string_lossy().to_string();
            if fs::is_hidden_name(&platform_name) {
                continue;
            }

            let platform = fs::normalize_platform(&platform_name);
            if config
                .library
                .exclude_platforms
                .iter()
                .any(|excluded| excluded.eq_ignore_ascii_case(&platform))
            {
                continue;
            }

            for game_dir in fs::read_directories(&platform_dir) {
                let folder_name = game_dir
                    .file_name()
                    .map(|value| value.to_string_lossy().to_string())
                    .unwrap_or_default();
                if fs::is_hidden_name(&folder_name) {
                    continue;
                }

                let key = (platform.clone(), folder_name.clone());

                result
                    .found_paths
                    .insert(key.clone());
                fs::cleanup_temp_files(&game_dir, compression_service);
                let size_bytes = fs::directory_size(&game_dir);
                let install_type = (!existing_paths.contains(&key))
                    .then(|| fs::detect_install_type(&game_dir))
                    .unwrap_or_else(|| "portable".to_string());
                let folder_path = game_dir.to_string_lossy().to_string();

                result.games.push(DiscoveredGame {
                    platform: platform.clone(),
                    folder_name,
                    folder_path,
                    install_type,
                    size_bytes,
                });
            }

            for archive_path in fs::read_archive_files(&platform_dir) {
                let folder_name = archive_path
                    .file_name()
                    .map(|value| value.to_string_lossy().to_string())
                    .unwrap_or_default();
                result
                    .found_paths
                    .insert((platform.clone(), folder_name.clone()));

                let size_bytes = archive_path
                    .metadata()
                    .map(|metadata| metadata.len() as i64)
                    .unwrap_or_default();
                let title = fs::strip_extension(&folder_name);

                result.archives.push(DiscoveredArchive {
                    platform: platform.clone(),
                    folder_name,
                    title,
                    archive_path,
                    size_bytes,
                });
            }
        }
    }

    result
}

impl LibraryScanService {
    pub(super) async fn perform_scan(&self) -> Result<ScanResult, LibraryScanError> {
        let scan_started_at = Instant::now();
        let existing_games = game::Entity::find().all(&self.db).await?;
        let existing_paths = existing_games
            .iter()
            .map(|game| (game.platform.clone(), game.folder_name.clone()))
            .collect::<HashSet<_>>();
        let config = Arc::clone(&self.config);
        let compression_service = Arc::clone(&self.compression_service);
        let existing_paths_for_discovery = existing_paths;

        let discovery_started_at = Instant::now();
        let discovery = tokio::task::spawn_blocking(move || {
            discover_library(&config, &compression_service, &existing_paths_for_discovery)
        })
        .await
        .map_err(|error| LibraryScanError::Scan(error.to_string()))?;
        let discovery_elapsed = discovery_started_at.elapsed();

        let existing_by_key = existing_games
            .into_iter()
            .map(|game| ((game.platform.clone(), game.folder_name.clone()), game))
            .collect::<HashMap<_, _>>();

        let mut games_found = 0usize;
        let mut games_added = 0usize;
        let mut games_missing = 0usize;
        let mut games_updated = 0usize;

        let db_sync_started_at = Instant::now();

        for game in discovery.games {
            let key = (game.platform.clone(), game.folder_name.clone());

            if let Some(existing_game) = existing_by_key.get(&key).cloned() {
                let mut active_model: game::ActiveModel = existing_game.into();
                active_model.folder_path = Set(game.folder_path);
                active_model.size_bytes = Set(game.size_bytes);
                active_model.is_missing = Set(false);
                active_model.update(&self.db).await?;
                games_updated += 1;
            } else {
                game::ActiveModel {
                    title: Set(game.folder_name.clone()),
                    platform: Set(game.platform.clone()),
                    folder_name: Set(game.folder_name),
                    folder_path: Set(game.folder_path),
                    install_type: Set(game.install_type),
                    size_bytes: Set(game.size_bytes),
                    is_missing: Set(false),
                    ..Default::default()
                }
                .insert(&self.db)
                .await?;
                games_added += 1;
            }

            games_found += 1;
        }

        for archive in discovery.archives {
            let key = (archive.platform.clone(), archive.folder_name.clone());

            if let Some(existing_game) = existing_by_key.get(&key).cloned() {
                let mut active_model: game::ActiveModel = existing_game.into();
                active_model.folder_path = Set(archive.archive_path.to_string_lossy().to_string());
                active_model.size_bytes = Set(archive.size_bytes);
                active_model.is_missing = Set(false);
                active_model.update(&self.db).await?;
                games_updated += 1;
            } else {
                game::ActiveModel {
                    title: Set(archive.title),
                    platform: Set(archive.platform.clone()),
                    folder_name: Set(archive.folder_name),
                    folder_path: Set(archive.archive_path.to_string_lossy().to_string()),
                    install_type: Set("portable".to_string()),
                    size_bytes: Set(archive.size_bytes),
                    is_missing: Set(false),
                    ..Default::default()
                }
                .insert(&self.db)
                .await?;
                games_added += 1;
            }

            games_found += 1;
        }

        for existing_game in existing_by_key.into_values() {
            let key = (
                existing_game.platform.clone(),
                existing_game.folder_name.clone(),
            );
            if discovery.found_paths.contains(&key) {
                continue;
            }

            if !existing_game.is_missing {
                warn!(platform = %existing_game.platform, folder_name = %existing_game.folder_name, "game missing from disk");
            }

            let mut active_model: game::ActiveModel = existing_game.into();
            active_model.is_missing = Set(true);
            active_model.update(&self.db).await?;
            games_missing += 1;
            games_updated += 1;
        }

        let db_sync_elapsed = db_sync_started_at.elapsed();
        let total_elapsed = scan_started_at.elapsed();

        debug!(
            discovery_ms = discovery_elapsed.as_millis(),
            db_sync_ms = db_sync_elapsed.as_millis(),
            total_ms = total_elapsed.as_millis(),
            games_found,
            games_added,
            games_missing,
            games_updated,
            "library scan timing"
        );

        info!(
            games_found,
            games_added, games_missing, "library scan complete"
        );

        Ok(ScanResult {
            games_found,
            games_added,
            games_missing,
        })
    }
}
