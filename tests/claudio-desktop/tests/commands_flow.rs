use claudio_desktop::integration_test_api::{
    DesktopSettings, RunningGameInfo, command_get_installed_game, command_launch_game,
    command_list_game_executables, command_list_installed_games, command_list_running_games,
    command_resolve_download_path, command_resolve_install_path, command_set_game_exe,
    command_stop_game, command_uninstall_game, new_running_games_state,
    record_running_game_for_test, save_settings, upsert_installed_game, with_test_data_dir_async,
};
use claudio_desktop_tests::support::fixtures::installed_game;
use claudio_desktop_tests::support::fs::TestWorkspace;
use claudio_desktop_tests::support::process::spawn_long_running_process;
use serial_test::serial;
use std::fs;
use std::thread;

#[tokio::test]
#[serial]
async fn command_registry_flow_lists_gets_updates_uninstalls_and_resolves_install_path() {
    let workspace = TestWorkspace::new();

    with_test_data_dir_async(workspace.data_dir.clone(), || async {
        let install_root = workspace.data_dir.join("games-root");
        save_settings(&DesktopSettings {
            default_install_path: Some(install_root.to_string_lossy().into_owned()),
            ..DesktopSettings::default()
        })
        .expect("settings should save");

        let install_dir = workspace.data_dir.join("command-game");
        fs::create_dir_all(&install_dir).expect("install dir should exist");
        fs::write(install_dir.join("game.exe"), b"binary").expect("game exe should exist");
        fs::write(install_dir.join("alt.exe"), b"binary").expect("alt exe should exist");

        upsert_installed_game(installed_game(
            31,
            "Command Game",
            install_dir.to_string_lossy().into_owned(),
            Some(install_dir.join("game.exe").to_string_lossy().into_owned()),
        ))
        .expect("installed game should save");

        let listed = command_list_installed_games()
            .await
            .expect("command list should succeed");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].remote_game_id, 31);

        let loaded = command_get_installed_game(31)
            .await
            .expect("command get should succeed")
            .expect("installed game should exist");
        assert_eq!(loaded.title, "Command Game");

        let executables = command_list_game_executables(31)
            .await
            .expect("command executable list should succeed");
        assert_eq!(executables, vec!["alt.exe", "game.exe"]);

        let updated = command_set_game_exe(31, "alt.exe".to_string())
            .await
            .expect("command set game exe should succeed");
        assert_eq!(updated.game_exe.as_deref(), Some("alt.exe"));

        let resolved = command_resolve_install_path(" Halo: Reach / GOTY?* ");
        assert_eq!(
            resolved,
            install_root.join("Halo_ Reach _ GOTY__").to_string_lossy()
        );

        let resolved_download = command_resolve_download_path(" Halo: Reach / GOTY?* ");
        assert_eq!(
            resolved_download,
            workspace
                .data_dir
                .join("downloads")
                .join("Halo_ Reach _ GOTY__")
                .to_string_lossy()
        );

        command_uninstall_game(31, false)
            .await
            .expect("command uninstall should succeed");
        assert!(install_dir.exists());
        assert!(
            command_get_installed_game(31)
                .await
                .expect("command get should succeed after uninstall")
                .is_none()
        );
    })
    .await;
}

#[tokio::test]
#[serial]
async fn command_launch_game_rejects_missing_executable() {
    let workspace = TestWorkspace::new();

    with_test_data_dir_async(workspace.data_dir.clone(), || async {
        let install_dir = workspace.data_dir.join("launch-missing");
        fs::create_dir_all(&install_dir).expect("install dir should exist");

        upsert_installed_game(installed_game(
            32,
            "Launcher Game",
            install_dir.to_string_lossy().into_owned(),
            None,
        ))
        .expect("installed game should save");

        let state = new_running_games_state();
        let error = command_launch_game(&state, 32).expect_err("command launch should fail");

        assert_eq!(error, "No executable is set for this game.");
    })
    .await;
}

#[tokio::test]
#[serial]
async fn command_runtime_flow_lists_and_stops_seeded_process() {
    let state = new_running_games_state();
    let mut child = spawn_long_running_process();
    let pid = child.id();
    let waiter = thread::spawn(move || child.wait());

    record_running_game_for_test(
        &state,
        RunningGameInfo {
            game_id: 33,
            pid,
            exe_path: "runner".to_string(),
            started_at: "1".to_string(),
        },
    )
    .expect("running game should be recorded");

    let running = command_list_running_games(&state).expect("command running list should succeed");
    assert_eq!(running.len(), 1);
    assert_eq!(running[0].game_id, 33);

    command_stop_game(&state, 33).expect("command stop should succeed");
    let _ = waiter.join().expect("waiter thread should join");
    assert!(
        command_list_running_games(&state)
            .expect("command running list should succeed after stop")
            .is_empty()
    );
}
