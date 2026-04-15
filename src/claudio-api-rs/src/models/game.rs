use serde::Serialize;

use crate::{entity::game, util::file_browse};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameDto {
    pub id: i32,
    pub title: String,
    pub platform: String,
    pub folder_name: String,
    pub install_type: String,
    pub summary: Option<String>,
    pub genre: Option<String>,
    pub release_year: Option<i32>,
    pub cover_url: Option<String>,
    pub hero_url: Option<String>,
    pub igdb_id: Option<i64>,
    pub igdb_slug: Option<String>,
    pub size_bytes: i64,
    pub is_missing: bool,
    pub installer_exe: Option<String>,
    pub game_exe: Option<String>,
    pub developer: Option<String>,
    pub publisher: Option<String>,
    pub game_mode: Option<String>,
    pub series: Option<String>,
    pub franchise: Option<String>,
    pub game_engine: Option<String>,
    pub is_processing: bool,
    pub is_archive: bool,
}

impl From<&game::Model> for GameDto {
    fn from(game: &game::Model) -> Self {
        Self {
            id: game.id,
            title: game.title.clone(),
            platform: game.platform.clone(),
            folder_name: game.folder_name.clone(),
            install_type: game.install_type.clone(),
            summary: game.summary.clone(),
            genre: game.genre.clone(),
            release_year: game.release_year,
            cover_url: game.cover_url.clone(),
            hero_url: game.hero_url.clone(),
            igdb_id: game.igdb_id,
            igdb_slug: game.igdb_slug.clone(),
            size_bytes: game.size_bytes,
            is_missing: game.is_missing,
            installer_exe: game.installer_exe.clone(),
            game_exe: game.game_exe.clone(),
            developer: game.developer.clone(),
            publisher: game.publisher.clone(),
            game_mode: game.game_mode.clone(),
            series: game.series.clone(),
            franchise: game.franchise.clone(),
            game_engine: game.game_engine.clone(),
            is_processing: game.is_processing,
            is_archive: file_browse::is_archive_game(game),
        }
    }
}
