use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::Arc,
};

use sea_orm::{ActiveModelTrait, ActiveValue::Set, EntityTrait};
use tracing::{info, warn};

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

                result
                    .found_paths
                    .insert((platform.clone(), folder_name.clone()));
                fs::cleanup_temp_files(&game_dir, compression_service);
                let size_bytes = fs::directory_size(&game_dir);
                let install_type = fs::detect_install_type(&game_dir);
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
        let config = Arc::clone(&self.config);
        let compression_service = Arc::clone(&self.compression_service);

        let discovery =
            tokio::task::spawn_blocking(move || discover_library(&config, &compression_service))
                .await
                .map_err(|error| LibraryScanError::Scan(error.to_string()))?;

        let mut games_found = 0usize;
        let mut games_added = 0usize;
        let mut games_missing = 0usize;

        for game in discovery.games {
            if self
                .upsert_game(
                    &game.platform,
                    &game.folder_name,
                    game.folder_path,
                    game.install_type,
                    game.size_bytes,
                )
                .await?
            {
                games_added += 1;
            }
            games_found += 1;
        }

        for archive in discovery.archives {
            if self
                .upsert_archive_game(
                    &archive.platform,
                    &archive.folder_name,
                    &archive.title,
                    archive.archive_path,
                    archive.size_bytes,
                )
                .await?
            {
                games_added += 1;
            }
            games_found += 1;
        }

        let existing_games = game::Entity::find().all(&self.db).await?;
        for existing_game in existing_games {
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
        }

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
