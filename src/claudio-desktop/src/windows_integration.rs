use crate::models::{InstallType, InstalledGame};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use winreg::RegKey;
use winreg::enums::{HKEY_CURRENT_USER, KEY_WRITE};

use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::Media::Audio::{
    IAudioSessionControl2, IAudioSessionEnumerator, IAudioSessionManager2, IMMDeviceEnumerator,
    ISimpleAudioVolume, MMDeviceEnumerator, eConsole, eRender,
};
use windows::Win32::System::Com::{
    CLSCTX_ALL, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx,
};
use windows::core::Interface;

use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, PROCESSENTRY32, Process32First, Process32Next, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::Threading::{
    OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE, TerminateProcess,
    WaitForSingleObject,
};

const UNINSTALL_ROOT: &str = "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall";

/// Mutes all audio sessions associated with the given process tree and/or executable name.
/// Runs in a background thread and retries for up to 20 seconds to catch processes
/// that initialize their audio systems after startup (common with game installers).
///
/// `pid` — root process ID (0 to skip PID-tree matching, e.g. for elevated installs).
/// `exe_name` — optional installer filename (e.g. "setup.exe") for name-based fallback
///              matching, which catches elevated processes that aren't in the PID tree.
pub fn mute_process_audio(pid: u32, exe_name: Option<String>) {
    std::thread::spawn(move || {
        for _ in 0..400 {
            let _ = try_mute_sessions(pid, exe_name.as_deref());
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
    });
}

pub fn collect_tracked_processes(seed_pids: &[u32], exe_name: Option<&str>) -> Vec<u32> {
    let entries = snapshot_processes();
    let mut tracked = expand_process_tree(&entries, seed_pids);

    if let Some(name) = exe_name {
        for found_pid in find_pids_matching(|exe| exe.eq_ignore_ascii_case(name)) {
            if !tracked.contains(&found_pid) {
                tracked.push(found_pid);
            }
        }
    }

    for found_pid in find_pids_matching(|exe| exe.to_ascii_lowercase().ends_with(".tmp")) {
        if !tracked.contains(&found_pid) {
            tracked.push(found_pid);
        }
    }

    tracked.sort_unstable();
    tracked.dedup();
    tracked
}

pub fn terminate_tracked_processes(
    seed_pids: &[u32],
    exe_name: Option<&str>,
) -> Result<(), String> {
    let mut target_pids = collect_tracked_processes(seed_pids, exe_name);
    log::info!(
        "[installer] terminating tracked processes {:?} (exe_name={:?})",
        target_pids,
        exe_name
    );

    for _ in 0..3 {
        for target_pid in &target_pids {
            terminate_process(*target_pid);
        }

        std::thread::sleep(std::time::Duration::from_millis(120));
        target_pids = collect_tracked_processes(&target_pids, exe_name);
        if target_pids.is_empty() {
            break;
        }
    }

    Ok(())
}

fn terminate_process(pid: u32) {
    let result = with_process_handle(
        pid,
        PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION,
        |handle| unsafe {
            let _ = TerminateProcess(handle, 1);
            let _ = WaitForSingleObject(handle, 2_000);
        },
    );

    if result.is_some() {
        log::info!("[installer] terminate requested for PID {pid}");
    }
}

fn with_process_handle<T>(
    pid: u32,
    access: windows::Win32::System::Threading::PROCESS_ACCESS_RIGHTS,
    callback: impl FnOnce(HANDLE) -> T,
) -> Option<T> {
    unsafe {
        let handle = match OpenProcess(access, false, pid) {
            Ok(handle) if !handle.is_invalid() => handle,
            _ => return None,
        };

        let result = callback(handle);
        let _ = CloseHandle(handle);
        Some(result)
    }
}

/// Collects all (pid, parent_pid) pairs from a toolhelp snapshot, then builds
/// the full descendant tree for `root_pid` using multi-pass expansion so that
/// grandchildren are never missed regardless of snapshot ordering.
fn get_process_tree(root_pid: u32) -> Vec<u32> {
    let entries = snapshot_processes();
    expand_process_tree(&entries, &[root_pid])
}

fn expand_process_tree(entries: &[(u32, u32)], root_pids: &[u32]) -> Vec<u32> {
    let mut tree: Vec<u32> = root_pids.iter().copied().filter(|pid| *pid != 0).collect();
    loop {
        let prev_len = tree.len();
        for &(pid, parent) in entries {
            if tree.contains(&parent) && !tree.contains(&pid) {
                tree.push(pid);
            }
        }
        if tree.len() == prev_len {
            break;
        }
    }
    tree
}

/// Returns (pid, parent_pid) for every process visible in the toolhelp snapshot.
fn snapshot_processes() -> Vec<(u32, u32)> {
    let mut out = Vec::new();
    unsafe {
        let snapshot = match CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) {
            Ok(s) => s,
            Err(_) => return out,
        };
        let mut entry = PROCESSENTRY32 {
            dwSize: std::mem::size_of::<PROCESSENTRY32>() as u32,
            ..Default::default()
        };
        if Process32First(snapshot, &mut entry).is_ok() {
            loop {
                out.push((entry.th32ProcessID, entry.th32ParentProcessID));
                if Process32Next(snapshot, &mut entry).is_err() {
                    break;
                }
            }
        }
        let _ = windows::Win32::Foundation::CloseHandle(snapshot);
    }
    out
}

/// Returns the PIDs of all running processes for which `predicate` returns true,
/// based on each process's executable filename from the toolhelp snapshot.
fn find_pids_matching(predicate: impl Fn(&str) -> bool) -> Vec<u32> {
    let mut out = Vec::new();
    unsafe {
        let snapshot = match CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) {
            Ok(s) => s,
            Err(_) => return out,
        };
        let mut entry = PROCESSENTRY32 {
            dwSize: std::mem::size_of::<PROCESSENTRY32>() as u32,
            ..Default::default()
        };
        if Process32First(snapshot, &mut entry).is_ok() {
            loop {
                let exe_bytes: Vec<u8> = entry
                    .szExeFile
                    .iter()
                    .map(|c| *c as u8)
                    .take_while(|&c| c != 0)
                    .collect();
                let exe = String::from_utf8_lossy(&exe_bytes);
                if predicate(&exe) {
                    out.push(entry.th32ProcessID);
                }
                if Process32Next(snapshot, &mut entry).is_err() {
                    break;
                }
            }
        }
        let _ = windows::Win32::Foundation::CloseHandle(snapshot);
    }
    out
}

/// Mutes audio sessions matching either the PID tree or the executable name.
/// Also catches InnoSetup's self-extractor, which runs as `*.tmp` rather than
/// the original `setup.exe` and is reparented away from the installer process.
fn try_mute_sessions(pid: u32, exe_name: Option<&str>) -> Result<usize, String> {
    let mut target_pids: Vec<u32> = if pid != 0 {
        get_process_tree(pid)
    } else {
        Vec::new()
    };

    // Match by installer exe name (handles non-elevated installs where setup.exe
    // may have been reparented before we walked the tree).
    if let Some(name) = exe_name {
        for found_pid in find_pids_matching(|exe| exe.eq_ignore_ascii_case(name)) {
            if !target_pids.contains(&found_pid) {
                target_pids.push(found_pid);
            }
        }
    }

    // InnoSetup extracts to %TEMP%\is-XXXXX.tmp\ and runs as setup.tmp (or similar).
    // It launches via ShellExecute so setup.tmp is not a child of setup.exe — it
    // escapes the PID tree. Catch it by extension: any *.tmp process during an
    // install is virtually guaranteed to be an InnoSetup self-extractor.
    for found_pid in find_pids_matching(|exe| exe.to_ascii_lowercase().ends_with(".tmp")) {
        if !target_pids.contains(&found_pid) {
            target_pids.push(found_pid);
        }
    }

    let mut muted_count = 0;

    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

        let device_enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                .map_err(|e| format!("Failed to create IMMDeviceEnumerator: {e}"))?;

        let device = device_enumerator
            .GetDefaultAudioEndpoint(eRender, eConsole)
            .map_err(|e| format!("Failed to get default audio endpoint: {e}"))?;

        let session_manager: IAudioSessionManager2 = device
            .Activate(CLSCTX_ALL, None)
            .map_err(|e| format!("Failed to activate IAudioSessionManager2: {e}"))?;

        let session_enumerator: IAudioSessionEnumerator = session_manager
            .GetSessionEnumerator()
            .map_err(|e| format!("Failed to get session enumerator: {e}"))?;

        let count = session_enumerator
            .GetCount()
            .map_err(|e| format!("Failed to get session count: {e}"))?;

        for i in 0..count {
            let session = match session_enumerator.GetSession(i) {
                Ok(s) => s,
                Err(_) => continue,
            };

            let session2: IAudioSessionControl2 = match session.cast() {
                Ok(s) => s,
                Err(_) => continue,
            };

            let session_pid = session2.GetProcessId().unwrap_or(0);
            if !target_pids.contains(&session_pid) {
                continue;
            }

            let volume: ISimpleAudioVolume = match session.cast() {
                Ok(v) => v,
                Err(_) => continue,
            };
            if let Ok(is_muted) = volume.GetMute() {
                if !is_muted.as_bool() {
                    if volume.SetMute(true, std::ptr::null()).is_ok() {
                        muted_count += 1;
                    }
                } else {
                    muted_count += 1;
                }
            }
        }
        Ok(muted_count)
    }
}

pub fn register(app: &AppHandle, game: &InstalledGame, desktop_shortcut: bool) {
    // Installer-based games register themselves via their own installer.
    if !matches!(game.install_type, InstallType::Portable) {
        return;
    }

    let key_name = registry_key_name(game.remote_game_id);
    let install_dir = PathBuf::from(&game.install_path);
    let shortcut_path = start_menu_shortcut_path(&game.title);

    if let Err(err) = deploy_uninstaller(app, game, &key_name, &shortcut_path) {
        log::warn!("Could not deploy uninstaller for '{}': {err}", game.title);
    }

    if let Some(exe) = &game.game_exe {
        if let Err(err) = create_shortcut(exe, &shortcut_path) {
            log::warn!(
                "Could not create Start Menu shortcut for '{}': {err}",
                game.title
            );
        }

        if desktop_shortcut {
            let desktop_path = desktop_shortcut_path(&game.title);
            if let Err(err) = create_shortcut(exe, &desktop_path) {
                log::warn!(
                    "Could not create desktop shortcut for '{}': {err}",
                    game.title
                );
            }
        }
    }

    let uninstall_exe = install_dir.join("uninstall.exe");
    if let Err(err) = write_registry(game, &key_name, &install_dir, &uninstall_exe) {
        log::warn!(
            "Could not write Windows registry entry for '{}': {err}",
            game.title
        );
    }
}

pub fn deregister(game: &InstalledGame) {
    let key_name = registry_key_name(game.remote_game_id);
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let _ = hkcu.delete_subkey_all(format!("{UNINSTALL_ROOT}\\{key_name}"));

    let _ = fs::remove_file(start_menu_shortcut_path(&game.title));
    let _ = fs::remove_file(desktop_shortcut_path(&game.title));
}

fn registry_key_name(remote_game_id: i32) -> String {
    format!("Claudio-{remote_game_id}")
}

fn start_menu_shortcut_path(title: &str) -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from(r"C:\Users\Default\AppData\Roaming"))
        .join(r"Microsoft\Windows\Start Menu\Programs")
        .join(format!("{title}.lnk"))
}

fn desktop_shortcut_path(title: &str) -> PathBuf {
    dirs::desktop_dir()
        .unwrap_or_else(|| PathBuf::from(r"C:\Users\Default\Desktop"))
        .join(format!("{title}.lnk"))
}

fn deploy_uninstaller(
    app: &AppHandle,
    game: &InstalledGame,
    key_name: &str,
    shortcut_path: &Path,
) -> Result<(), String> {
    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    let source = resource_dir.join("claudio-game-uninstaller.exe");
    if !source.exists() {
        return Err("Bundled claudio-game-uninstaller.exe not found in resources".to_string());
    }

    let dest = PathBuf::from(&game.install_path).join("uninstall.exe");
    fs::copy(&source, &dest).map_err(|e| format!("Failed to copy uninstall.exe: {e}"))?;

    let config = serde_json::json!({
        "gameTitle": game.title,
        "installPath": game.install_path,
        "registryKeyName": key_name,
        "shortcutPath": shortcut_path.to_string_lossy(),
        "desktopShortcutPath": desktop_shortcut_path(&game.title).to_string_lossy()
    });
    let config_path = PathBuf::from(&game.install_path).join("uninstall-config.json");
    fs::write(
        config_path,
        serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("Failed to write uninstall-config.json: {e}"))
}

fn create_shortcut(exe_path: &str, shortcut_path: &Path) -> Result<(), String> {
    if let Some(parent) = shortcut_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let lnk = mslnk::ShellLink::new(exe_path).map_err(|e| e.to_string())?;
    lnk.create_lnk(shortcut_path).map_err(|e| e.to_string())
}

fn write_registry(
    game: &InstalledGame,
    key_name: &str,
    install_dir: &Path,
    uninstall_exe: &Path,
) -> Result<(), String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (key, _) = hkcu
        .create_subkey_with_flags(format!("{UNINSTALL_ROOT}\\{key_name}"), KEY_WRITE)
        .map_err(|e| e.to_string())?;

    let uninstall_str = uninstall_exe.to_string_lossy();
    key.set_value("DisplayName", &game.title)
        .map_err(|e| e.to_string())?;
    key.set_value("UninstallString", &uninstall_str.as_ref())
        .map_err(|e| e.to_string())?;
    key.set_value("QuietUninstallString", &uninstall_str.as_ref())
        .map_err(|e| e.to_string())?;
    key.set_value("InstallLocation", &install_dir.to_string_lossy().as_ref())
        .map_err(|e| e.to_string())?;
    key.set_value("Publisher", &"Claudio")
        .map_err(|e| e.to_string())?;
    key.set_value("InstallDate", &install_date_string())
        .map_err(|e| e.to_string())?;
    key.set_value("NoModify", &1u32)
        .map_err(|e| e.to_string())?;
    key.set_value("NoRepair", &1u32)
        .map_err(|e| e.to_string())?;

    if let Some(exe) = &game.game_exe {
        key.set_value("DisplayIcon", exe)
            .map_err(|e| e.to_string())?;
    }

    if let Ok(size_kb) = dir_size_kb(install_dir) {
        let clamped: u32 = size_kb.min(u32::MAX as u64) as u32;
        key.set_value("EstimatedSize", &clamped)
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Returns the current date as `YYYYMMDD` without pulling in a date library.
fn install_date_string() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let (y, m, d) = days_to_ymd((secs / 86400) as u32);
    format!("{y:04}{m:02}{d:02}")
}

fn days_to_ymd(days: u32) -> (u32, u32, u32) {
    // Algorithm from http://howardhinnant.github.io/date_algorithms.html
    let z = days + 719468;
    let era = z / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
}

fn dir_size_kb(path: &Path) -> Result<u64, ()> {
    fn recurse(path: &Path, total: &mut u64) {
        let Ok(entries) = fs::read_dir(path) else {
            return;
        };
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                recurse(&p, total);
            } else if let Ok(meta) = entry.metadata() {
                *total += meta.len();
            }
        }
    }
    let mut total = 0u64;
    recurse(path, &mut total);
    Ok(total / 1024)
}
