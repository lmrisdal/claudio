use claudio_desktop::integration_test_api::{
    RunningGameInfo, get_installed_game, launch_game, list_running_games, new_running_games_state,
    record_running_game_for_test, stop_game, upsert_installed_game, with_test_data_dir_async,
};
use claudio_desktop_tests::support::fixtures::installed_game;
use claudio_desktop_tests::support::fs::TestWorkspace;
use claudio_desktop_tests::support::process::spawn_long_running_process;
use serial_test::serial;
use std::fs;
use std::thread;

#[tokio::test]
#[serial]
async fn runtime_flow_rejects_launch_when_executable_is_missing() {
    let workspace = TestWorkspace::new();

    with_test_data_dir_async(workspace.data_dir.clone(), || async {
        let install_dir = workspace.data_dir.join("runtime-missing");
        fs::create_dir_all(&install_dir).expect("install dir should exist");
        upsert_installed_game(installed_game(
            20,
            "Runtime Missing",
            install_dir.to_string_lossy().into_owned(),
            None,
        ))
        .expect("installed game should save");

        let state = new_running_games_state();
        let error = launch_game(&state, 20).expect_err("launch should fail without an executable");

        assert_eq!(error, "No executable is set for this game.");
    })
    .await;
}

#[tokio::test]
#[serial]
async fn runtime_flow_lists_and_stops_seeded_process() {
    let state = new_running_games_state();
    let mut child = spawn_long_running_process();
    let pid = child.id();
    let waiter = thread::spawn(move || child.wait());

    record_running_game_for_test(
        &state,
        RunningGameInfo {
            game_id: 21,
            pid,
            exe_path: "runner".to_string(),
            started_at: "1".to_string(),
        },
    )
    .expect("running game should be recorded");

    let running = list_running_games(&state).expect("running games should load");
    assert_eq!(running.len(), 1);
    assert_eq!(running[0].game_id, 21);

    stop_game(&state, 21).expect("seeded process should stop");
    let _ = waiter.join().expect("waiter thread should join");
    assert!(
        list_running_games(&state)
            .expect("running games should load")
            .is_empty()
    );
    assert!(
        get_installed_game(21)
            .expect("installed game lookup should succeed")
            .is_none()
    );
}
