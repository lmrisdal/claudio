use crate::models::InstalledGame;
use crate::settings;
use std::fmt::Display;
use std::fs;
use std::io::{self, Write};
use std::path::Path;
use std::sync::{Mutex, MutexGuard, PoisonError};

static REGISTRY_LOCK: Mutex<()> = Mutex::new(());

fn lock_registry() -> MutexGuard<'static, ()> {
    REGISTRY_LOCK.lock().unwrap_or_else(PoisonError::into_inner)
}

fn registry_failure(operation: &str, path: &Path, err: impl Display) -> String {
    log::error!(
        "[registry] {operation} failed for {}: {err}",
        path.display()
    );
    format!(
        "Failed to {operation} the installed games list {}: {err}",
        path.display()
    )
}

fn load_all() -> Result<Vec<InstalledGame>, String> {
    let path = settings::registry_path();
    let contents = match fs::read_to_string(&path) {
        Ok(contents) => contents,
        Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(err) => return Err(registry_failure("read", &path, err)),
    };
    if contents.trim().is_empty() {
        log::warn!(
            "[registry] {} is empty, treating it as no installed games",
            path.display()
        );
        return Ok(Vec::new());
    }
    serde_json::from_str(&contents).map_err(|err| registry_failure("parse", &path, err))
}

fn write_synced(path: &Path, contents: &[u8]) -> io::Result<()> {
    let mut file = fs::File::create(path)?;
    file.write_all(contents)?;
    file.sync_all()
}

fn save_all(games: &[InstalledGame]) -> Result<(), String> {
    let path = settings::registry_path();
    let json = serde_json::to_string_pretty(games)
        .map_err(|err| registry_failure("encode", &path, err))?;
    let temp_path = path.with_extension("json.tmp");
    write_synced(&temp_path, json.as_bytes())
        .map_err(|err| registry_failure("write", &temp_path, err))?;
    fs::rename(&temp_path, &path).map_err(|err| registry_failure("replace", &path, err))
}

pub fn list() -> Result<Vec<InstalledGame>, String> {
    let _guard = lock_registry();
    let mut games = load_all()?;
    games.retain(|game| Path::new(&game.install_path).exists());
    save_all(&games)?;
    Ok(games)
}

pub fn get(remote_game_id: i32) -> Result<Option<InstalledGame>, String> {
    let _guard = lock_registry();
    let mut games = load_all()?;
    games.retain(|game| Path::new(&game.install_path).exists());
    save_all(&games)?;

    Ok(games
        .into_iter()
        .find(|game| game.remote_game_id == remote_game_id))
}

pub fn upsert(installed: InstalledGame) -> Result<InstalledGame, String> {
    let _guard = lock_registry();
    let mut games = load_all()?;
    games.retain(|game| game.remote_game_id != installed.remote_game_id);
    games.push(installed.clone());
    games.sort_by(|a, b| a.title.cmp(&b.title));
    save_all(&games)?;
    Ok(installed)
}

pub fn remove(remote_game_id: i32) -> Result<Option<InstalledGame>, String> {
    let _guard = lock_registry();
    let mut games = load_all()?;
    let removed = games
        .iter()
        .position(|g| g.remote_game_id == remote_game_id)
        .map(|i| games.remove(i));
    save_all(&games)?;
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::InstallType;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_test_dir(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "claudio-registry-{name}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time should be after epoch")
                .as_nanos()
        ))
    }

    fn installed_game(remote_game_id: i32, title: &str, install_path: &Path) -> InstalledGame {
        InstalledGame {
            launch_options: Default::default(),
            remote_game_id,
            title: title.to_string(),
            platform: "windows".to_string(),
            install_type: InstallType::Portable,
            install_path: install_path.to_string_lossy().into_owned(),
            game_exe: None,
            wine_prefix: None,
            proton_path: None,
            installed_at: "1".to_string(),
            summary: None,
            genre: None,
            release_year: None,
            cover_url: None,
            hero_url: None,
            developer: None,
            publisher: None,
            game_mode: None,
            series: None,
            franchise: None,
            game_engine: None,
        }
    }

    #[test]
    fn upsert_sorts_games_by_title() {
        settings::with_test_data_dir(unique_test_dir("sort"), || {
            let zebra_path = settings::data_dir().join("zebra");
            let alpha_path = settings::data_dir().join("alpha");
            fs::create_dir_all(&zebra_path).expect("zebra path should exist");
            fs::create_dir_all(&alpha_path).expect("alpha path should exist");

            upsert(installed_game(2, "Zebra", &zebra_path)).expect("zebra should be saved");
            upsert(installed_game(1, "Alpha", &alpha_path)).expect("alpha should be saved");

            let games = list().expect("games should load");
            assert_eq!(games.len(), 2);
            assert_eq!(games[0].title, "Alpha");
            assert_eq!(games[1].title, "Zebra");
        });
    }

    #[test]
    fn list_prunes_missing_install_paths() {
        settings::with_test_data_dir(unique_test_dir("prune"), || {
            let keep_path = settings::data_dir().join("keep");
            let missing_path = settings::data_dir().join("missing");
            fs::create_dir_all(&keep_path).expect("keep path should exist");

            upsert(installed_game(1, "Keep", &keep_path)).expect("keep game should be saved");
            upsert(installed_game(2, "Missing", &missing_path))
                .expect("missing game should be saved");

            let games = list().expect("games should load");
            assert_eq!(games.len(), 1);
            assert_eq!(games[0].title, "Keep");

            let persisted = fs::read_to_string(settings::registry_path())
                .expect("registry file should exist after prune");
            assert!(persisted.contains("Keep"));
            assert!(!persisted.contains("Missing"));
        });
    }

    #[test]
    fn upsert_recovers_from_empty_registry_file() {
        settings::with_test_data_dir(unique_test_dir("empty"), || {
            let install_path = settings::data_dir().join("game");
            fs::create_dir_all(&install_path).expect("install path should exist");
            fs::write(settings::registry_path(), "").expect("empty registry should be written");

            upsert(installed_game(1, "Game", &install_path)).expect("game should be saved");

            let games = list().expect("games should load");
            assert_eq!(games.len(), 1);
            assert_eq!(games[0].title, "Game");
        });
    }

    #[test]
    fn corrupt_registry_is_reported_and_left_in_place() {
        settings::with_test_data_dir(unique_test_dir("corrupt"), || {
            let install_path = settings::data_dir().join("game");
            fs::create_dir_all(&install_path).expect("install path should exist");
            fs::write(settings::registry_path(), "[{").expect("corrupt registry should be written");

            let error = match upsert(installed_game(1, "Game", &install_path)) {
                Ok(_) => panic!("corrupt registry should not be overwritten"),
                Err(error) => error,
            };

            assert!(error.contains("installed-games.json"));
            let persisted = fs::read_to_string(settings::registry_path())
                .expect("registry file should still exist");
            assert_eq!(persisted, "[{");
        });
    }

    #[test]
    fn concurrent_list_and_upsert_keep_every_game() {
        settings::with_test_data_dir(unique_test_dir("concurrent"), || {
            let install_path = settings::data_dir().join("game");
            fs::create_dir_all(&install_path).expect("install path should exist");
            upsert(installed_game(0, "Seed", &install_path)).expect("seed should be saved");

            std::thread::scope(|scope| {
                for _ in 0..4 {
                    scope.spawn(|| {
                        for _ in 0..200 {
                            list().expect("list should not observe a partial registry");
                        }
                    });
                }
                for id in 1..=50 {
                    let install_path = install_path.clone();
                    scope.spawn(move || {
                        upsert(installed_game(id, "Game", &install_path))
                            .expect("upsert should not observe a partial registry");
                    });
                }
            });

            assert_eq!(list().expect("games should load").len(), 51);
        });
    }

    #[test]
    fn get_loads_entries_saved_with_removed_bottles_fields() {
        let root = unique_test_dir("legacy-bottles-entry");
        let install_dir = root.join("game");
        fs::create_dir_all(&install_dir).expect("install dir should be created");

        settings::with_test_data_dir(root.join("data"), || {
            let mut entry = serde_json::to_value(installed_game(9, "Legacy Game", &install_dir))
                .expect("entry should serialize");
            entry
                .as_object_mut()
                .expect("entry should be an object")
                .remove("launchOptions");
            entry["linuxRuntimeBackend"] = serde_json::json!("bottles");
            entry["bottleName"] = serde_json::json!("Gaming");
            fs::write(
                settings::registry_path(),
                serde_json::json!([entry]).to_string(),
            )
            .expect("legacy registry should be written");

            let game = get(9)
                .expect("legacy registry should load")
                .expect("legacy entry should be present");

            assert_eq!(game.title, "Legacy Game");
            assert!(game.launch_options.parameters.is_empty());
            assert!(!game.launch_options.run_as_administrator);
        });

        let _ = fs::remove_dir_all(&root);
    }
}
