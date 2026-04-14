use std::fs;

use claudio_api::{entity::game, services::library_scan::ScanResult};
use claudio_api_tests::support;
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};

async fn scan(app: &support::TestApp) -> ScanResult {
    app.state.library_scan_service.scan().await.unwrap()
}

#[tokio::test]
async fn scan_should_find_games_across_platforms_and_normalize_pc_to_win() {
    let app = support::TestApp::new().await;

    let doom_dir = app.root().join("pc/Doom");
    let quake_dir = app.root().join("pc/Quake");
    let ffx_dir = app.root().join("ps2/FFX");
    fs::create_dir_all(&doom_dir).unwrap();
    fs::create_dir_all(&quake_dir).unwrap();
    fs::create_dir_all(&ffx_dir).unwrap();
    fs::write(doom_dir.join("doom.exe"), "exe").unwrap();
    fs::write(quake_dir.join("quake.exe"), "exe").unwrap();
    fs::write(ffx_dir.join("rom.iso"), "iso").unwrap();

    let result = scan(&app).await;
    let games = game::Entity::find().all(&app.state.db).await.unwrap();

    assert_eq!(result.games_found, 3);
    assert_eq!(result.games_added, 3);
    assert_eq!(games.len(), 3);
    assert!(games
        .iter()
        .any(|game| game.platform == "win" && game.title == "Doom"));
    assert!(games
        .iter()
        .any(|game| game.platform == "win" && game.title == "Quake"));
    assert!(games
        .iter()
        .any(|game| game.platform == "ps2" && game.title == "FFX"));
}

#[tokio::test]
async fn scan_should_exclude_configured_platforms_case_insensitively() {
    let app = support::TestApp::with_config(|config| {
        config.library.exclude_platforms = vec!["gba".to_string()];
    })
    .await;

    let pokemon_dir = app.root().join("GBA/Pokemon");
    let doom_dir = app.root().join("pc/Doom");
    fs::create_dir_all(&pokemon_dir).unwrap();
    fs::create_dir_all(&doom_dir).unwrap();
    fs::write(pokemon_dir.join("pokemon.gba"), "rom").unwrap();
    fs::write(doom_dir.join("doom.exe"), "exe").unwrap();

    let result = scan(&app).await;
    let games = game::Entity::find().all(&app.state.db).await.unwrap();

    assert_eq!(result.games_found, 1);
    assert_eq!(games.len(), 1);
    assert_eq!(games[0].platform, "win");
    assert_eq!(games[0].title, "Doom");
}

#[tokio::test]
async fn scan_should_mark_missing_games_after_rescan() {
    let app = support::TestApp::new().await;

    let doom_dir = app.root().join("pc/Doom");
    fs::create_dir_all(&doom_dir).unwrap();
    fs::write(doom_dir.join("doom.exe"), "exe").unwrap();

    scan(&app).await;
    fs::remove_dir_all(&doom_dir).unwrap();

    let result = scan(&app).await;
    let doom = game::Entity::find()
        .filter(game::Column::Title.eq("Doom"))
        .one(&app.state.db)
        .await
        .unwrap()
        .unwrap();

    assert_eq!(result.games_missing, 1);
    assert!(doom.is_missing);
}

#[tokio::test]
async fn scan_should_support_multiple_library_paths() {
    let second_root = tempfile::tempdir().unwrap();
    let second_root_path = second_root.path().to_string_lossy().to_string();
    let app = support::TestApp::with_config(|config| {
        config.library.library_paths.push(second_root_path);
    })
    .await;

    let doom_dir = app.root().join("pc/Doom");
    let zelda_dir = second_root.path().join("snes/Zelda");
    fs::create_dir_all(&doom_dir).unwrap();
    fs::create_dir_all(&zelda_dir).unwrap();
    fs::write(doom_dir.join("doom.exe"), "exe").unwrap();
    fs::write(zelda_dir.join("zelda.sfc"), "rom").unwrap();

    let result = scan(&app).await;
    let games = game::Entity::find().all(&app.state.db).await.unwrap();

    assert_eq!(result.games_found, 2);
    assert_eq!(result.games_added, 2);
    assert_eq!(games.len(), 2);
}
