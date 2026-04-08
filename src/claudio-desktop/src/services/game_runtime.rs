use crate::models::RunningGameInfo;
use crate::registry;
use std::collections::HashMap;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::Mutex;
#[cfg(not(target_os = "windows"))]
use std::thread;
#[cfg(not(target_os = "windows"))]
use std::time::Duration;
use std::time::{SystemTime, UNIX_EPOCH};

pub struct RunningGamesState {
    games_by_id: Mutex<HashMap<i32, RunningGameInfo>>,
}

impl Default for RunningGamesState {
    fn default() -> Self {
        Self {
            games_by_id: Mutex::new(HashMap::new()),
        }
    }
}

impl RunningGamesState {
    fn upsert(&self, game: RunningGameInfo) -> Result<(), String> {
        let mut games = self
            .games_by_id
            .lock()
            .map_err(|_| "Running games state lock poisoned.".to_string())?;
        games.insert(game.game_id, game);
        Ok(())
    }

    fn remove(&self, game_id: i32) -> Result<Option<RunningGameInfo>, String> {
        let mut games = self
            .games_by_id
            .lock()
            .map_err(|_| "Running games state lock poisoned.".to_string())?;
        Ok(games.remove(&game_id))
    }

    pub fn list_active(&self) -> Result<Vec<RunningGameInfo>, String> {
        let mut games = self
            .games_by_id
            .lock()
            .map_err(|_| "Running games state lock poisoned.".to_string())?;

        games.retain(|_, game| is_process_running(game.pid));
        Ok(games.values().cloned().collect())
    }

    pub fn ensure_not_running(&self, game_id: i32) -> Result<(), String> {
        let mut games = self
            .games_by_id
            .lock()
            .map_err(|_| "Running games state lock poisoned.".to_string())?;

        let is_running = games
            .get(&game_id)
            .map(|game| is_process_running(game.pid))
            .unwrap_or(false);

        if is_running {
            return Err("This game is already running.".to_string());
        }

        games.remove(&game_id);
        Ok(())
    }
}

pub fn launch_game(state: &RunningGamesState, remote_game_id: i32) -> Result<(), String> {
    state.ensure_not_running(remote_game_id)?;

    let game =
        registry::get(remote_game_id)?.ok_or_else(|| "Game is not installed.".to_string())?;
    let exe = game
        .game_exe
        .ok_or_else(|| "No executable is set for this game.".to_string())?;

    let exe_path = Path::new(&exe);
    let working_dir = exe_path.parent().unwrap_or_else(|| Path::new("."));

    let child = Command::new(exe_path)
        .current_dir(working_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to launch game: {e}"))?;

    state.upsert(RunningGameInfo {
        game_id: remote_game_id,
        pid: child.id(),
        exe_path: exe,
        started_at: current_timestamp(),
    })?;

    Ok(())
}

pub fn stop_game(state: &RunningGamesState, remote_game_id: i32) -> Result<(), String> {
    let running = state
        .remove(remote_game_id)?
        .ok_or_else(|| "This game is not running.".to_string())?;

    kill_process_tree(running.pid)?;
    Ok(())
}

fn kill_process_tree(pid: u32) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let status = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map_err(|e| format!("Failed to stop game process: {e}"))?;

        if status.success() {
            Ok(())
        } else {
            Err(format!("Failed to stop game process (PID {pid})."))
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = Command::new("pkill")
            .args(["-TERM", "-P", &pid.to_string()])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();

        let status = Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map_err(|e| format!("Failed to stop game process: {e}"))?;

        if !status.success() {
            return Err(format!("Failed to stop game process (PID {pid})."));
        }

        for _ in 0..12 {
            if !is_process_running(pid) {
                return Ok(());
            }
            thread::sleep(Duration::from_millis(100));
        }

        let _ = Command::new("pkill")
            .args(["-KILL", "-P", &pid.to_string()])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();

        let _ = Command::new("kill")
            .args(["-KILL", &pid.to_string()])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();

        for _ in 0..12 {
            if !is_process_running(pid) {
                return Ok(());
            }
            thread::sleep(Duration::from_millis(100));
        }

        Err(format!("Failed to stop game process (PID {pid})."))
    }
}

fn is_process_running(pid: u32) -> bool {
    #[cfg(target_os = "windows")]
    {
        Command::new("tasklist")
            .args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .output()
            .map(|output| {
                let body = String::from_utf8_lossy(&output.stdout);
                !body.trim().is_empty() && !body.contains("No tasks are running")
            })
            .unwrap_or(false)
    }

    #[cfg(not(target_os = "windows"))]
    {
        Command::new("ps")
            .args(["-o", "stat=", "-p", &pid.to_string()])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .output()
            .map(|output| {
                if !output.status.success() {
                    return false;
                }

                let state = String::from_utf8_lossy(&output.stdout);
                let state = state.trim();

                !state.is_empty() && !state.starts_with('Z')
            })
            .unwrap_or(false)
    }
}

fn current_timestamp() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

#[cfg(feature = "integration-tests")]
pub(crate) fn record_running_game_for_tests(
    state: &RunningGamesState,
    game: RunningGameInfo,
) -> Result<(), String> {
    state.upsert(game)
}

#[cfg(test)]
mod tests {
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
}
