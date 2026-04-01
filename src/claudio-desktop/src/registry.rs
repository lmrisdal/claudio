use crate::models::InstalledGame;
use crate::settings;
use std::fs;
use std::path::Path;
use std::path::PathBuf;

fn registry_path() -> PathBuf {
    settings::data_dir().join("installed-games.json")
}

fn load_all() -> Result<Vec<InstalledGame>, String> {
    let path = registry_path();
    match fs::read_to_string(path) {
        Ok(contents) => serde_json::from_str(&contents).map_err(|err| err.to_string()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(err) => Err(err.to_string()),
    }
}

fn save_all(games: &[InstalledGame]) -> Result<(), String> {
    let path = registry_path();
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
