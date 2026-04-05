use crate::models::InstalledGame;
use crate::settings;
use std::fs;
use std::path::Path;

fn load_all() -> Result<Vec<InstalledGame>, String> {
    let path = settings::registry_path();
    match fs::read_to_string(path) {
        Ok(contents) => serde_json::from_str(&contents).map_err(|err| err.to_string()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(err) => Err(err.to_string()),
    }
}

fn save_all(games: &[InstalledGame]) -> Result<(), String> {
    let path = settings::registry_path();
    let json = serde_json::to_string_pretty(games).map_err(|err| err.to_string())?;
    fs::write(path, json).map_err(|err| err.to_string())
}

pub fn list() -> Result<Vec<InstalledGame>, String> {
    let mut games = load_all()?;
    games.retain(|game| Path::new(&game.install_path).exists());
    save_all(&games)?;
    Ok(games)
}

pub fn get(remote_game_id: i32) -> Result<Option<InstalledGame>, String> {
    let mut games = load_all()?;
    games.retain(|game| Path::new(&game.install_path).exists());
    save_all(&games)?;

    Ok(games
        .into_iter()
        .find(|game| game.remote_game_id == remote_game_id))
}

pub fn upsert(installed: InstalledGame) -> Result<InstalledGame, String> {
    let mut games = load_all()?;
    games.retain(|game| game.remote_game_id != installed.remote_game_id);
    games.push(installed.clone());
    games.sort_by(|a, b| a.title.cmp(&b.title));
    save_all(&games)?;
    Ok(installed)
}

pub fn remove(remote_game_id: i32) -> Result<Option<InstalledGame>, String> {
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
            remote_game_id,
            title: title.to_string(),
            platform: "windows".to_string(),
            install_type: InstallType::Portable,
            install_path: install_path.to_string_lossy().into_owned(),
            game_exe: None,
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
}
