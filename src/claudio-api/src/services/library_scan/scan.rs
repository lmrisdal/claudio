use std::{collections::HashSet, path::Path};

use sea_orm::{ActiveModelTrait, ActiveValue::Set, EntityTrait};
use tracing::{info, warn};

use crate::entity::game;

use super::{error::LibraryScanError, fs, LibraryScanService, ScanResult};

impl LibraryScanService {
    pub(super) async fn perform_scan(&self) -> Result<ScanResult, LibraryScanError> {
        let mut found_paths = HashSet::new();
        let mut games_found = 0usize;
        let mut games_added = 0usize;
        let mut games_missing = 0usize;

        for scan_path in &self.config.library.library_paths {
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
                if self
                    .config
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

                    found_paths.insert((platform.clone(), folder_name.clone()));
                    fs::cleanup_temp_files(&game_dir, &self.compression_service);
                    let size_bytes = fs::directory_size(&game_dir);
                    let install_type = fs::detect_install_type(&game_dir);
                    let folder_path = game_dir.to_string_lossy().to_string();

                    if self
                        .upsert_game(
                            &platform,
                            &folder_name,
                            folder_path,
                            install_type,
                            size_bytes,
                        )
                        .await?
                    {
                        games_added += 1;
                    }
                    games_found += 1;
                }

                for archive_path in fs::read_archive_files(&platform_dir) {
                    let folder_name = archive_path
                        .file_name()
                        .map(|value| value.to_string_lossy().to_string())
                        .unwrap_or_default();
                    found_paths.insert((platform.clone(), folder_name.clone()));

                    let size_bytes = archive_path
                        .metadata()
                        .map(|metadata| metadata.len() as i64)
                        .unwrap_or_default();
                    let title = fs::strip_extension(&folder_name);
                    let added = self
                        .upsert_archive_game(
                            &platform,
                            &folder_name,
                            &title,
                            archive_path,
                            size_bytes,
                        )
                        .await?;
                    if added {
                        games_added += 1;
                    }
                    games_found += 1;
                }
            }
        }

        let existing_games = game::Entity::find().all(&self.db).await?;
        for existing_game in existing_games {
            let key = (
                existing_game.platform.clone(),
                existing_game.folder_name.clone(),
            );
            if found_paths.contains(&key) {
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
