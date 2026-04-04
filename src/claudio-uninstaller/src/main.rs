//! Standalone uninstaller for Claudio-managed portable games.
//!
//! Phase 1 (normal launch from install dir):
//!   - Reads uninstall-config.json from the same directory
//!   - Shows a confirmation dialog
//!   - Removes the Windows registry entry and Start Menu shortcut
//!   - Copies itself to %TEMP% and re-launches with --do-delete to handle the
//!     directory deletion (can't delete the folder we're running from)
//!
//! Phase 2 (--do-delete <path> <title>, launched from %TEMP%):
//!   - Waits briefly for phase 1 to exit
//!   - Deletes the install directory
//!   - Shows a completion message
//!   - Schedules deletion of the temp copy of itself

#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

use serde::Deserialize;
use std::env;
use std::fs;
use std::path::PathBuf;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UninstallConfig {
    game_title: String,
    install_path: String,
    registry_key_name: String,
    shortcut_path: Option<String>,
    desktop_shortcut_path: Option<String>,
}

fn main() {
    let args: Vec<String> = env::args().collect();

    if args.len() >= 3 && args[1] == "--do-delete" {
        let install_path = &args[2];
        let game_title = args.get(3).map(String::as_str).unwrap_or("Game");
        do_delete(install_path, game_title);
        schedule_self_delete(&args[0]);
        return;
    }

    run_phase1();
}

fn run_phase1() {
    let exe_path = match env::current_exe() {
        Ok(p) => p,
        Err(_) => {
            show_error("Could not determine uninstaller path.");
            return;
        }
    };

    let config_path = exe_path
        .parent()
        .unwrap_or_else(|| std::path::Path::new("."))
        .join("uninstall-config.json");

    let config: UninstallConfig = match fs::read_to_string(&config_path)
        .map_err(|e| e.to_string())
        .and_then(|s| serde_json::from_str(&s).map_err(|e| e.to_string()))
    {
        Ok(c) => c,
        Err(err) => {
            show_error(&format!("Could not read uninstall configuration: {err}"));
            return;
        }
    };

    if !confirm(&format!(
        "Are you sure you want to uninstall {}?\n\nThis will permanently delete all game files.",
        config.game_title
    )) {
        return;
    }

    // Remove registry entry and Start Menu shortcut before we vacate the directory.
    #[cfg(target_os = "windows")]
    delete_registry_key(&config.registry_key_name);

    if let Some(shortcut) = &config.shortcut_path {
        let _ = fs::remove_file(shortcut);
    }
    if let Some(shortcut) = &config.desktop_shortcut_path {
        let _ = fs::remove_file(shortcut);
    }

    // Copy ourselves to %TEMP% and re-launch for directory deletion.
    let temp_exe = env::temp_dir().join(format!(
        "claudio-uninstall-{}.exe",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
    ));

    if let Err(err) = fs::copy(&exe_path, &temp_exe) {
        show_error(&format!(
            "Could not prepare uninstaller: {err}\n\nPlease delete the game folder manually:\n{}",
            config.install_path
        ));
        return;
    }

    let _ = std::process::Command::new(&temp_exe)
        .arg("--do-delete")
        .arg(&config.install_path)
        .arg(&config.game_title)
        .spawn();

    std::process::exit(0);
}

fn do_delete(install_path: &str, game_title: &str) {
    // Brief pause to let phase 1 exit and release any file handles.
    std::thread::sleep(std::time::Duration::from_millis(500));

    let path = PathBuf::from(install_path);
    if path.exists() {
        if let Err(err) = fs::remove_dir_all(&path) {
            show_error(&format!(
                "Failed to delete game files: {err}\n\nPlease delete the folder manually:\n{install_path}"
            ));
            return;
        }
    }

    show_info(&format!("{game_title} has been successfully uninstalled."));
}

/// Schedules deletion of this temp exe after we exit, via a detached cmd process.
fn schedule_self_delete(exe_path: &str) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let _ = std::process::Command::new("cmd")
            .args([
                "/c",
                &format!("ping 127.0.0.1 -n 3 > nul & del /f /q \"{exe_path}\""),
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn();
    }
    #[cfg(not(target_os = "windows"))]
    let _ = exe_path;
}

#[cfg(target_os = "windows")]
fn delete_registry_key(key_name: &str) {
    use winreg::RegKey;
    use winreg::enums::HKEY_CURRENT_USER;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let path = format!("SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{key_name}");
    let _ = hkcu.delete_subkey_all(path);
}

fn confirm(message: &str) -> bool {
    #[cfg(target_os = "windows")]
    {
        // MB_YESNO | MB_ICONQUESTION | MB_DEFBUTTON2
        message_box(message, "Uninstall Game", 0x0124) == 6 // IDYES
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = message;
        true
    }
}

fn show_error(message: &str) {
    #[cfg(target_os = "windows")]
    message_box(message, "Uninstall Error", 0x0010); // MB_ICONERROR
    #[cfg(not(target_os = "windows"))]
    eprintln!("Error: {message}");
}

fn show_info(message: &str) {
    #[cfg(target_os = "windows")]
    message_box(message, "Uninstall Complete", 0x0040); // MB_ICONINFORMATION
    #[cfg(not(target_os = "windows"))]
    println!("{message}");
}

#[cfg(target_os = "windows")]
fn message_box(text: &str, caption: &str, flags: u32) -> i32 {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;

    fn to_wide(s: &str) -> Vec<u16> {
        OsStr::new(s)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    extern "system" {
        fn MessageBoxW(
            hwnd: *mut std::ffi::c_void,
            lptext: *const u16,
            lpcaption: *const u16,
            utype: u32,
        ) -> i32;
    }

    let text_w = to_wide(text);
    let caption_w = to_wide(caption);
    unsafe {
        MessageBoxW(
            std::ptr::null_mut(),
            text_w.as_ptr(),
            caption_w.as_ptr(),
            flags,
        )
    }
}
