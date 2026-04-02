use crate::models::{InstallType, InstalledGame};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use winreg::enums::{HKEY_CURRENT_USER, KEY_WRITE};
use winreg::RegKey;

use windows::core::Interface;
use windows::Win32::Media::Audio::{
    eConsole, eRender, IAudioSessionControl2, IAudioSessionEnumerator, IAudioSessionManager2,
    IMMDeviceEnumerator, ISimpleAudioVolume, MMDeviceEnumerator,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED,
};

const UNINSTALL_ROOT: &str =
    "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall";

/// Mutes all audio sessions associated with the given Process ID.
/// This runs in a background thread and retries for a few seconds to account for
/// processes that initialize their audio systems after startup.
pub fn mute_process_audio(pid: u32) {
    std::thread::spawn(move || {
        log::info!("Attempting to mute audio for process {}", pid);
        // Retry for up to 10 seconds (20 * 500ms)
        for _ in 0..20 {
            match try_mute_process_audio(pid) {
                Ok(true) => {
                    log::info!("Successfully muted audio for process {}", pid);
                    return;
                }
                Err(err) => {
                    log::debug!("Error while trying to mute process {}: {}", pid, err);
                }
                Ok(false) => {
                    // Process session not found yet, continue retrying
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(500));
        }
        log::debug!("Finished attempting to mute audio for process {}", pid);
    });
}

fn try_mute_process_audio(pid: u32) -> Result<bool, String> {
    unsafe {
        // Initialize COM for this thread
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

        let mut found = false;
        for i in 0..count {
            let session = match session_enumerator.GetSession(i) {
                Ok(s) => s,
                Err(_) => continue,
            };

            let session2: IAudioSessionControl2 = match session.cast() {
                Ok(s) => s,
                Err(_) => continue,
            };

            if session2.GetProcessId().unwrap_or(0) == pid {
                let volume: ISimpleAudioVolume = match session.cast() {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                if let Err(e) = volume.SetMute(true, std::ptr::null()) {
                    log::warn!("Failed to mute session for process {}: {}", pid, e);
                } else {
                    found = true;
                }
            }
        }
        Ok(found)
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
        .create_subkey_with_flags(
            format!("{UNINSTALL_ROOT}\\{key_name}"),
            KEY_WRITE,
        )
        .map_err(|e| e.to_string())?;

    let uninstall_str = uninstall_exe.to_string_lossy();
    key.set_value("DisplayName", &game.title)
        .map_err(|e| e.to_string())?;
    key.set_value("UninstallString", &uninstall_str.as_ref())
        .map_err(|e| e.to_string())?;
    key.set_value("QuietUninstallString", &uninstall_str.as_ref())
        .map_err(|e| e.to_string())?;
    key.set_value(
        "InstallLocation",
        &install_dir.to_string_lossy().as_ref(),
    )
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
