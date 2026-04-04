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

        if is_process_running(pid) {
            Err(format!("Failed to stop game process (PID {pid})."))
        } else {
            Ok(())
        }
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
        Command::new("kill")
            .args(["-0", &pid.to_string()])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }
}

fn current_timestamp() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string())
}
