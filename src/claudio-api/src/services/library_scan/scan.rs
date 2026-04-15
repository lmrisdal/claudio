use std::{collections::HashSet, path::Path, time::Instant};

use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, EntityTrait, QueryFilter, TransactionTrait,
};
use tracing::{debug, info, warn};

use crate::entity::game;

use super::{fs, error::LibraryScanError, LibraryScanService, ScanResult};

fn found_path_key(platform: &str, folder_name: &str) -> String {
    format!("{platform}/{folder_name}")
}

fn archive_title_from_file_name(file_name: &str) -> String {
    Path::new(file_name)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(file_name)
        .to_string()
}

impl LibraryScanService {
    pub(super) async fn perform_scan(&self) -> Result<ScanResult, LibraryScanError> {
        let scan_started_at = Instant::now();
        debug!("TEMP_SCAN_DEBUG: perform_scan() start");

        let txn = self.db.begin().await?;
        debug!("TEMP_SCAN_DEBUG: database transaction started for library scan");

        let mut found_paths = HashSet::new();
        let mut games_found = 0usize;
        let mut games_added = 0usize;
        let mut games_missing = 0usize;

        for scan_path in &self.config.library.library_paths {
            debug!(path = %scan_path, "TEMP_SCAN_DEBUG: starting scan path");

            let root = Path::new(scan_path);
            if !root.is_dir() {
                warn!(path = %scan_path, "scan path does not exist");
                debug!(path = %scan_path, "TEMP_SCAN_DEBUG: scan path missing or not a directory");
                continue;
            }

            for platform_dir in fs::read_directories(root) {
                let platform_name = platform_dir
                    .file_name()
                    .map(|value| value.to_string_lossy().to_string())
                    .unwrap_or_default();
                let platform = fs::normalize_platform(&platform_name);

                debug!(
                    path = %platform_dir.display(),
                    platform_name = %platform_name,
                    normalized_platform = %platform,
                    "TEMP_SCAN_DEBUG: inspecting platform directory"
                );

                if fs::is_hidden_name(&platform) {
                    debug!(normalized_platform = %platform, "TEMP_SCAN_DEBUG: platform skipped because hidden");
                    continue;
                }

                if self
                    .config
                    .library
                    .exclude_platforms
                    .iter()
                    .any(|excluded| excluded.eq_ignore_ascii_case(&platform))
                {
                    debug!(normalized_platform = %platform, "TEMP_SCAN_DEBUG: platform skipped because excluded");
                    continue;
                }

                debug!(normalized_platform = %platform, "TEMP_SCAN_DEBUG: starting folder-based game enumeration for platform");
                for game_dir in fs::read_directories(&platform_dir) {
                    let folder_name = game_dir
                        .file_name()
                        .map(|value| value.to_string_lossy().to_string())
                        .unwrap_or_default();

                    debug!(
                        normalized_platform = %platform,
                        folder_name = %folder_name,
                        path = %game_dir.display(),
                        "TEMP_SCAN_DEBUG: inspecting game directory"
                    );

                    if fs::is_hidden_name(&folder_name) {
                        debug!(folder_name = %folder_name, path = %game_dir.display(), "TEMP_SCAN_DEBUG: game directory skipped because hidden");
                        continue;
                    }

                    found_paths.insert(found_path_key(&platform, &folder_name));
                    debug!(normalized_platform = %platform, folder_name = %folder_name, found_paths = found_paths.len(), "TEMP_SCAN_DEBUG: added game directory to found_paths");

                    let existing = game::Entity::find()
                        .filter(game::Column::Platform.eq(platform.clone()))
                        .filter(game::Column::FolderName.eq(folder_name.clone()))
                        .one(&txn)
                        .await?;
                    debug!(normalized_platform = %platform, folder_name = %folder_name, exists = existing.is_some(), "TEMP_SCAN_DEBUG: queried existing game row for directory-backed game");

                    fs::cleanup_temp_files(&game_dir, &self.compression_service);
                    debug!(normalized_platform = %platform, folder_name = %folder_name, path = %game_dir.display(), "TEMP_SCAN_DEBUG: cleanup_temp_files finished for game directory");

                    if let Some(existing_game) = existing {
                        debug!(normalized_platform = %platform, folder_name = %folder_name, "TEMP_SCAN_DEBUG: existing directory-backed game found, updating size/path/missing only");
                        let size_bytes = fs::directory_size(&game_dir);
                        let folder_path = game_dir.to_string_lossy().to_string();

                        let mut active_model: game::ActiveModel = existing_game.into();
                        active_model.size_bytes = Set(size_bytes);
                        active_model.folder_path = Set(folder_path);
                        active_model.is_missing = Set(false);
                        active_model.update(&txn).await?;

                        games_found += 1;
                        debug!(games_found, size_bytes, "TEMP_SCAN_DEBUG: existing directory-backed game updated");
                        continue;
                    }

                    debug!(normalized_platform = %platform, folder_name = %folder_name, "TEMP_SCAN_DEBUG: directory-backed game is new, computing install_type and size");
                    let install_type = fs::detect_install_type(&game_dir);
                    let size_bytes = fs::directory_size(&game_dir);
                    let folder_path = game_dir.to_string_lossy().to_string();

                    game::ActiveModel {
                        title: Set(folder_name.clone()),
                        platform: Set(platform.clone()),
                        folder_name: Set(folder_name.clone()),
                        folder_path: Set(folder_path),
                        install_type: Set(install_type),
                        size_bytes: Set(size_bytes),
                        is_missing: Set(false),
                        ..Default::default()
                    }
                    .insert(&txn)
                    .await?;

                    games_found += 1;
                    games_added += 1;
                    debug!(games_found, games_added, size_bytes, "TEMP_SCAN_DEBUG: inserted new directory-backed game");
                }

                debug!(normalized_platform = %platform, "TEMP_SCAN_DEBUG: starting standalone archive enumeration for platform");
                for archive_path in fs::read_archive_files(&platform_dir) {
                    let file_name = archive_path
                        .file_name()
                        .map(|value| value.to_string_lossy().to_string())
                        .unwrap_or_default();

                    debug!(
                        normalized_platform = %platform,
                        file_name = %file_name,
                        path = %archive_path.display(),
                        "TEMP_SCAN_DEBUG: inspecting archive file"
                    );

                    if fs::is_hidden_name(&file_name) {
                        debug!(file_name = %file_name, path = %archive_path.display(), "TEMP_SCAN_DEBUG: archive skipped because hidden");
                        continue;
                    }

                    found_paths.insert(found_path_key(&platform, &file_name));
                    debug!(normalized_platform = %platform, file_name = %file_name, found_paths = found_paths.len(), "TEMP_SCAN_DEBUG: added archive file to found_paths");

                    let existing = game::Entity::find()
                        .filter(game::Column::Platform.eq(platform.clone()))
                        .filter(game::Column::FolderName.eq(file_name.clone()))
                        .one(&txn)
                        .await?;
                    debug!(normalized_platform = %platform, file_name = %file_name, exists = existing.is_some(), "TEMP_SCAN_DEBUG: queried existing game row for archive-backed game");

                    let size_bytes = archive_path
                        .metadata()
                        .map(|metadata| metadata.len() as i64)
                        .unwrap_or_default();
                    debug!(normalized_platform = %platform, file_name = %file_name, size_bytes, "TEMP_SCAN_DEBUG: archive size resolved");

                    if let Some(existing_game) = existing {
                        debug!(normalized_platform = %platform, file_name = %file_name, "TEMP_SCAN_DEBUG: existing archive-backed game found, updating size/path/missing only");
                        let folder_path = archive_path.to_string_lossy().to_string();

                        let mut active_model: game::ActiveModel = existing_game.into();
                        active_model.size_bytes = Set(size_bytes);
                        active_model.folder_path = Set(folder_path);
                        active_model.is_missing = Set(false);
                        active_model.update(&txn).await?;

                        games_found += 1;
                        debug!(games_found, size_bytes, "TEMP_SCAN_DEBUG: existing archive-backed game updated");
                        continue;
                    }

                    let title = archive_title_from_file_name(&file_name);
                    let folder_path = archive_path.to_string_lossy().to_string();
                    debug!(normalized_platform = %platform, file_name = %file_name, title = %title, "TEMP_SCAN_DEBUG: archive-backed game is new, inserting");

                    game::ActiveModel {
                        title: Set(title),
                        platform: Set(platform.clone()),
                        folder_name: Set(file_name.clone()),
                        folder_path: Set(folder_path),
                        install_type: Set("portable".to_string()),
                        size_bytes: Set(size_bytes),
                        is_missing: Set(false),
                        ..Default::default()
                    }
                    .insert(&txn)
                    .await?;

                    games_found += 1;
                    games_added += 1;
                    debug!(games_found, games_added, size_bytes, "TEMP_SCAN_DEBUG: inserted new archive-backed game");
                }

                debug!(normalized_platform = %platform, games_found, games_added, found_paths = found_paths.len(), "TEMP_SCAN_DEBUG: finished platform scan");
            }

            debug!(path = %scan_path, games_found, games_added, found_paths = found_paths.len(), "TEMP_SCAN_DEBUG: finished scan path");
        }

        debug!("TEMP_SCAN_DEBUG: starting missing-game reconciliation");
        let all_games = game::Entity::find().all(&txn).await?;
        debug!(all_games = all_games.len(), "TEMP_SCAN_DEBUG: loaded all games for missing reconciliation");

        for existing_game in all_games {
            let key = found_path_key(&existing_game.platform, &existing_game.folder_name);
            debug!(platform = %existing_game.platform, folder_name = %existing_game.folder_name, key = %key, found = found_paths.contains(&key), "TEMP_SCAN_DEBUG: checking existing game against found_paths");

            if found_paths.contains(&key) {
                continue;
            }

            if !existing_game.is_missing {
                warn!(platform = %existing_game.platform, folder_name = %existing_game.folder_name, "game missing from disk");
            }

            let mut active_model: game::ActiveModel = existing_game.into();
            active_model.is_missing = Set(true);
            active_model.update(&txn).await?;
            games_missing += 1;
            debug!(games_missing, "TEMP_SCAN_DEBUG: marked game as missing");
        }

        debug!("TEMP_SCAN_DEBUG: committing library scan transaction");
        txn.commit().await?;
        debug!("TEMP_SCAN_DEBUG: library scan transaction committed");

        let total_elapsed = scan_started_at.elapsed();
        debug!(
            total_ms = total_elapsed.as_millis(),
            games_found,
            games_added,
            games_missing,
            found_paths = found_paths.len(),
            "TEMP_SCAN_DEBUG: perform_scan() end"
        );

        info!(
            games_found,
            games_added,
            games_missing,
            "library scan complete"
        );

        Ok(ScanResult {
            games_found,
            games_added,
            games_missing,
        })
    }
}
