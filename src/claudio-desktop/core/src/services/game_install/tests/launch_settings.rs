use super::*;
use crate::models::GameLaunchOptions;

#[test]
fn launch_settings_persist_and_invalid_executable_leaves_registry_unchanged() {
    crate::settings::with_test_data_dir(unique_test_dir("launch-settings"), || {
        let install = crate::settings::data_dir().join("game");
        fs::create_dir_all(&install).expect("game directory should exist");
        fs::write(install.join("game.exe"), b"game").expect("executable should exist");
        crate::registry::upsert(installed_game(71, "Settings Game", &install))
            .expect("game should save");
        update_game_launch_settings(
            71,
            Some("game.exe".into()),
            Some("GE-Proton".into()),
            GameLaunchOptions {
                parameters: "-fullscreen \"Player One\"".into(),
                run_as_administrator: true,
                umu_game_id: Some("umu-123".into()),
            },
        )
        .expect("settings should save");
        let saved = crate::registry::get(71)
            .expect("registry should load")
            .expect("game should exist");
        assert_eq!(
            saved.launch_options.parameters,
            "-fullscreen \"Player One\""
        );
        assert!(saved.launch_options.run_as_administrator);
        assert_eq!(saved.launch_options.umu_game_id.as_deref(), Some("umu-123"));
        assert_eq!(saved.proton_path.as_deref(), Some("GE-Proton"));
        assert_eq!(saved.title, "Settings Game");
        update_game_launch_settings(
            71,
            Some("missing.exe".into()),
            None,
            GameLaunchOptions::default(),
        )
        .expect_err("missing file must fail");
        let unchanged = crate::registry::get(71)
            .expect("registry should load")
            .expect("game should exist");
        assert_eq!(
            serde_json::to_value(saved).unwrap(),
            serde_json::to_value(unchanged).unwrap()
        );
    });
}

#[test]
fn blank_runtime_overrides_restore_defaults() {
    crate::settings::with_test_data_dir(unique_test_dir("launch-defaults"), || {
        let install = crate::settings::data_dir().join("game");
        fs::create_dir_all(&install).expect("game directory should exist");
        crate::registry::upsert(installed_game(72, "Defaults", &install))
            .expect("game should save");
        let updated = update_game_launch_settings(
            72,
            None,
            Some("".into()),
            GameLaunchOptions {
                umu_game_id: Some("  ".into()),
                ..Default::default()
            },
        )
        .expect("defaults should save");
        assert!(updated.proton_path.is_none());
        assert!(updated.launch_options.umu_game_id.is_none());
    });
}
