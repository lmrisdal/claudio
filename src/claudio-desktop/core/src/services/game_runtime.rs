use crate::models::RunningGameInfo;
use crate::registry;
use std::collections::HashMap;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::Mutex;
#[cfg(not(target_os = "windows"))]
use std::thread;
#[cfg(not(target_os = "windows"))]
use std::time::Duration;
use std::time::{SystemTime, UNIX_EPOCH};
#[cfg(target_os = "windows")]
use windows::Win32::Foundation::CloseHandle;
#[cfg(target_os = "windows")]
use windows::Win32::System::Threading::{
    CREATE_NO_WINDOW, GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
};

#[cfg(target_os = "windows")]
const STILL_ACTIVE_EXIT_CODE: u32 = 259;

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
    #[cfg(not(target_os = "windows"))]
    let arguments = crate::services::launch_arguments::parse(&game.launch_options.parameters)?;
    let exe = game
        .game_exe
        .ok_or_else(|| "No executable is set for this game.".to_string())?;

    #[cfg(target_os = "linux")]
    if let Some(prefix) = game.wine_prefix.as_deref() {
        let proton_path = game
            .proton_path
            .as_deref()
            .unwrap_or("UMU-Latest")
            .to_string();
        let child = crate::services::linux_umu::run_prefix_command(
            Path::new(prefix),
            &proton_path,
            Path::new(&exe),
            &arguments,
            game.launch_options.umu_game_id.as_deref(),
            None,
        )?;

        state.upsert(RunningGameInfo {
            game_id: remote_game_id,
            pid: child.id(),
            exe_path: exe,
            started_at: current_timestamp(),
        })?;

        return Ok(());
    }

    let exe_path = Path::new(&exe);
    let working_dir = exe_path.parent().unwrap_or_else(|| Path::new("."));

    #[cfg(target_os = "windows")]
    let pid = if game.launch_options.run_as_administrator {
        super::game_elevation::launch(exe_path, &game.launch_options.parameters)?
    } else {
        Command::new(exe_path)
            .raw_arg(&game.launch_options.parameters)
            .current_dir(working_dir)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| format!("Failed to launch game: {error}"))?
            .id()
    };
    #[cfg(not(target_os = "windows"))]
    let pid = Command::new(exe_path)
        .args(&arguments)
        .current_dir(working_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("Failed to launch game: {error}"))?
        .id();

    state.upsert(RunningGameInfo {
        game_id: remote_game_id,
        pid,
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
        let mut command = Command::new("taskkill");
        command
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        configure_background_command(&mut command);

        let status = command
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
        with_process_handle(pid, |handle| unsafe {
            let mut exit_code = 0u32;
            GetExitCodeProcess(handle, &mut exit_code)
                .map(|_| exit_code == STILL_ACTIVE_EXIT_CODE)
                .unwrap_or(false)
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

#[cfg(target_os = "windows")]
fn configure_background_command(command: &mut Command) {
    command.creation_flags(CREATE_NO_WINDOW.0);
}

#[cfg(target_os = "windows")]
fn with_process_handle<T>(
    pid: u32,
    callback: impl FnOnce(windows::Win32::Foundation::HANDLE) -> T,
) -> Option<T> {
    unsafe {
        let handle = match OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
            Ok(handle) if !handle.is_invalid() => handle,
            _ => return None,
        };

        let result = callback(handle);
        let _ = CloseHandle(handle);
        Some(result)
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
mod tests;
