use super::*;

fn running_game(game_id: i32, pid: u32) -> RunningGameInfo {
    RunningGameInfo {
        game_id,
        pid,
        exe_path: "test.exe".to_string(),
        started_at: "1".to_string(),
    }
}

fn spawn_long_running_process() -> std::process::Child {
    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/C", "ping -n 30 127.0.0.1 > NUL"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("long running process should spawn")
    }

    #[cfg(not(target_os = "windows"))]
    {
        Command::new("sleep")
            .arg("30")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("long running process should spawn")
    }
}

#[test]
fn ensure_not_running_rejects_alive_process() {
    let state = RunningGamesState::default();
    let pid = std::process::id();
    state
        .upsert(running_game(7, pid))
        .expect("state should accept process");

    let error = state
        .ensure_not_running(7)
        .expect_err("alive process should be rejected");

    assert_eq!(error, "This game is already running.");
}

#[test]
fn ensure_not_running_removes_stale_process() {
    let state = RunningGamesState::default();
    state
        .upsert(running_game(8, u32::MAX))
        .expect("state should accept process");

    state
        .ensure_not_running(8)
        .expect("stale process should be removed");

    assert!(
        state
            .remove(8)
            .expect("state lookup should succeed")
            .is_none()
    );
}

#[test]
fn list_active_prunes_dead_processes() {
    let state = RunningGamesState::default();
    state
        .upsert(running_game(1, std::process::id()))
        .expect("alive process should be stored");
    state
        .upsert(running_game(2, u32::MAX))
        .expect("dead process should be stored");

    let active = state.list_active().expect("active list should load");

    assert_eq!(active.len(), 1);
    assert_eq!(active[0].game_id, 1);
    assert!(
        state
            .remove(2)
            .expect("state lookup should succeed")
            .is_none()
    );
}

#[test]
fn stop_game_terminates_tracked_process() {
    let state = RunningGamesState::default();
    let mut child = spawn_long_running_process();
    let pid = child.id();
    let waiter = std::thread::spawn(move || child.wait());

    state
        .upsert(running_game(99, pid))
        .expect("state should accept process");

    stop_game(&state, 99).expect("game process should stop");

    let _ = waiter.join().expect("waiter thread should join");
    assert!(!is_process_running(pid));
    assert!(
        state
            .remove(99)
            .expect("state lookup should succeed")
            .is_none()
    );
}
