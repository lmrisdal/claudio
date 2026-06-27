#![cfg_attr(test, allow(dead_code))]

use crate::models::InstalledGame;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::Duration;

const FLATPAK_APP_ID: &str = "com.usebottles.bottles";

pub fn default_bottle_name(game_id: i32, title: &str) -> String {
    format!("claudio-{game_id}-{}", sanitize_segment(title))
}

pub fn is_installed() -> bool {
    bottles_command().is_ok()
}

pub fn prepare_bottle(
    bottle_name: &str,
    allow_existing: bool,
    cancelled: impl Fn() -> bool,
) -> Result<PathBuf, String> {
    if allow_existing && bottle_exists(bottle_name)? {
        return bottle_path(bottle_name);
    }

    let mut command = bottles_command()?;
    command.args([
        "new",
        "--bottle-name",
        bottle_name,
        "--environment",
        "gaming",
        "--arch",
        "win64",
    ]);

    wait_logged_command(
        command,
        "creating Bottles bottle",
        bottle_name,
        "Bottles bottle creation",
        cancelled,
    )?;
    bottle_path(bottle_name)
}

pub fn run_bottle_command(
    bottle_name: &str,
    exe: &Path,
    extra_args: &[String],
) -> Result<Child, String> {
    spawn_bottle_command(bottle_name, exe, extra_args).map(|logged| logged.child)
}

pub fn run_bottle_command_wait(
    bottle_name: &str,
    exe: &Path,
    extra_args: &[String],
    cancelled: impl Fn() -> bool,
) -> Result<(), String> {
    let mut process = spawn_bottle_command(bottle_name, exe, extra_args)?;

    loop {
        if cancelled() {
            let _ = process.child.kill();
            let _ = process.child.wait();
            return Err("Install cancelled.".to_string());
        }

        match process.child.try_wait() {
            Ok(Some(status)) if status.success() => return Ok(()),
            Ok(Some(status)) => {
                return Err(format!(
                    "Bottles exited with status {status} while running {}.\n{}",
                    exe.display(),
                    crate::services::process_log::format_log_tail("Bottles", &process.log_tail)
                ));
            }
            Ok(None) => thread::sleep(Duration::from_millis(250)),
            Err(err) => return Err(format!("Failed waiting for Bottles: {err}")),
        }
    }
}

pub fn bottle_drive_c_path(bottle_name: &str) -> Result<PathBuf, String> {
    Ok(bottle_path(bottle_name)?.join("drive_c"))
}

pub fn sync_shortcuts(
    installed: &InstalledGame,
    desktop_shortcut: bool,
    app_menu_shortcut: bool,
    steam_shortcut: bool,
) {
    if desktop_shortcut && let Err(error) = write_desktop_shortcut(installed, ShortcutKind::Desktop)
    {
        log::warn!("[linux shortcut] failed to write Bottles desktop shortcut: {error}");
    }
    if app_menu_shortcut
        && let Err(error) = write_desktop_shortcut(installed, ShortcutKind::AppMenu)
    {
        log::warn!("[linux shortcut] failed to write Bottles app menu shortcut: {error}");
    }
    if steam_shortcut
        && let Err(error) = steam_shortcut_command(installed).and_then(|launch_options| {
            crate::services::linux_steam_shortcuts::write_steam_shortcut_command(
                installed,
                "\"/usr/bin/env\"".to_string(),
                launch_options,
            )
        })
    {
        log::warn!("[linux shortcut] failed to write Bottles Steam shortcut: {error}");
    }
}

fn spawn_bottle_command(
    bottle_name: &str,
    exe: &Path,
    extra_args: &[String],
) -> Result<crate::services::process_log::LoggedChild, String> {
    let working_dir = exe.parent().unwrap_or_else(|| Path::new("."));
    let mut command = bottles_command()?;
    command
        .args(["run", "-b", bottle_name, "-e"])
        .arg(exe)
        .current_dir(working_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if !extra_args.is_empty() {
        command.args(["-a", &extra_args.join(" ")]);
    }

    log::info!(
        "[bottles] starting {} in bottle {}",
        exe.display(),
        bottle_name
    );
    crate::services::process_log::spawn_logged_child(command, "bottles").map_err(|err| {
        format!(
            "Failed to start Bottles for {} in bottle {}: {err}",
            exe.display(),
            bottle_name
        )
    })
}

fn wait_logged_command(
    mut command: Command,
    action: &str,
    label: &str,
    error_prefix: &str,
    cancelled: impl Fn() -> bool,
) -> Result<(), String> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    log::info!("[bottles] {action} {label}");
    let mut process = crate::services::process_log::spawn_logged_child(command, "bottles")
        .map_err(|err| format!("Failed to start Bottles while {action} {label}: {err}"))?;

    loop {
        if cancelled() {
            let _ = process.child.kill();
            let _ = process.child.wait();
            return Err("Install cancelled.".to_string());
        }

        match process.child.try_wait() {
            Ok(Some(status)) if status.success() => return Ok(()),
            Ok(Some(status)) => {
                return Err(format!(
                    "{error_prefix} failed for {label} with status {status}.\n{}",
                    crate::services::process_log::format_log_tail("Bottles", &process.log_tail)
                ));
            }
            Ok(None) => thread::sleep(Duration::from_millis(250)),
            Err(err) => return Err(format!("Failed waiting for Bottles: {err}")),
        }
    }
}

fn bottle_exists(bottle_name: &str) -> Result<bool, String> {
    let mut command = bottles_command()?;
    command.args(["--json", "list", "bottles"]);
    let output = command
        .output()
        .map_err(|err| format!("Failed to list Bottles bottles: {err}"))?;
    if !output.status.success() {
        return Err(format!(
            "Bottles failed to list bottles: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let value: Value = serde_json::from_str(stdout.trim()).map_err(|err| {
        format!(
            "Bottles returned invalid JSON while listing bottles: {err}. Output: {}",
            stdout.trim()
        )
    })?;
    Ok(match value {
        Value::Array(values) => values
            .iter()
            .any(|value| value.as_str() == Some(bottle_name)),
        Value::Object(map) => map.contains_key(bottle_name),
        _ => false,
    })
}

fn bottle_path(bottle_name: &str) -> Result<PathBuf, String> {
    let mut command = bottles_command()?;
    command.args(["info", "bottles-path"]);
    let output = command
        .output()
        .map_err(|err| format!("Failed to resolve Bottles path: {err}"))?;
    if !output.status.success() {
        return Err(format!(
            "Bottles failed to resolve its bottles path: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    let root = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if root.is_empty() {
        return Err("Bottles returned an empty bottles path.".to_string());
    }
    Ok(PathBuf::from(root).join(bottle_name))
}

fn bottles_command() -> Result<Command, String> {
    if let Some(path) = find_in_path("bottles-cli") {
        return Ok(Command::new(path));
    }

    if let Some(flatpak) = find_in_path("flatpak")
        && flatpak_app_installed(&flatpak)
    {
        let mut command = Command::new(flatpak);
        command.args(["run", "--command=bottles-cli", FLATPAK_APP_ID]);
        return Ok(command);
    }

    Err(
        "Bottles CLI was not found. Install Bottles or its Flatpak package to use the Bottles runtime backend."
            .to_string(),
    )
}

fn flatpak_app_installed(flatpak: &Path) -> bool {
    Command::new(flatpak)
        .args(["info", FLATPAK_APP_ID])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
}

fn find_in_path(binary: &str) -> Option<PathBuf> {
    std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths)
            .map(|path| path.join(binary))
            .find(|path| path.is_file())
    })
}

enum ShortcutKind {
    Desktop,
    AppMenu,
}

fn write_desktop_shortcut(installed: &InstalledGame, kind: ShortcutKind) -> Result<(), String> {
    let target_dir = match kind {
        ShortcutKind::Desktop => desktop_dir(),
        ShortcutKind::AppMenu => applications_dir(),
    };
    fs::create_dir_all(&target_dir).map_err(|err| {
        format!(
            "Failed to create shortcut directory {}: {err}",
            target_dir.display()
        )
    })?;

    let shortcut_path = target_dir.join(format!(
        "claudio-{}-{}.desktop",
        installed.remote_game_id,
        sanitize_segment(&installed.title)
    ));
    let exec = desktop_shortcut_command(installed)?;
    let start_dir = installed
        .game_exe
        .as_deref()
        .and_then(|exe| Path::new(exe).parent())
        .unwrap_or_else(|| Path::new(&installed.install_path));
    let contents = format!(
        "[Desktop Entry]\nName={}\nExec={}\nType=Application\nCategories=Game;\nPath={}\nTerminal=false\n",
        installed.title,
        exec,
        start_dir.display()
    );
    fs::write(&shortcut_path, contents).map_err(|err| {
        format!(
            "Failed to write shortcut {}: {err}",
            shortcut_path.display()
        )
    })?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&shortcut_path, fs::Permissions::from_mode(0o755)).map_err(|err| {
            format!(
                "Failed to mark shortcut executable {}: {err}",
                shortcut_path.display()
            )
        })?;
    }

    Ok(())
}

fn desktop_shortcut_command(installed: &InstalledGame) -> Result<String, String> {
    let bottle_name = installed
        .bottle_name
        .as_deref()
        .ok_or_else(|| "No Bottles bottle is set.".to_string())?;
    let exe = installed
        .game_exe
        .as_deref()
        .ok_or_else(|| "No game executable is set.".to_string())?;
    Ok(format!(
        "{} run -b {} -e {}",
        desktop_quote_command()?,
        desktop_quote(bottle_name),
        desktop_quote(exe)
    ))
}

fn steam_shortcut_command(installed: &InstalledGame) -> Result<String, String> {
    let bottle_name = installed
        .bottle_name
        .as_deref()
        .ok_or_else(|| "No Bottles bottle is set.".to_string())?;
    let exe = installed
        .game_exe
        .as_deref()
        .ok_or_else(|| "No game executable is set.".to_string())?;
    Ok(format!(
        "{} run -b {} -e {}",
        steam_quote_command()?,
        steam_quote(bottle_name),
        steam_quote(exe)
    ))
}

fn desktop_quote_command() -> Result<String, String> {
    if let Some(path) = find_in_path("bottles-cli") {
        return Ok(desktop_quote_path(&path));
    }
    if let Some(flatpak) = find_in_path("flatpak")
        && flatpak_app_installed(&flatpak)
    {
        return Ok(format!(
            "flatpak run --command=bottles-cli {}",
            desktop_quote(FLATPAK_APP_ID)
        ));
    }
    Err("Bottles CLI was not found for shortcut creation.".to_string())
}

fn steam_quote_command() -> Result<String, String> {
    if let Some(path) = find_in_path("bottles-cli") {
        return Ok(steam_quote_path(&path));
    }
    if let Some(flatpak) = find_in_path("flatpak")
        && flatpak_app_installed(&flatpak)
    {
        return Ok(format!(
            "flatpak run --command=bottles-cli {}",
            steam_quote(FLATPAK_APP_ID)
        ));
    }
    Err("Bottles CLI was not found for shortcut creation.".to_string())
}

fn desktop_dir() -> PathBuf {
    dirs::desktop_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| PathBuf::from("."))
}

fn applications_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("applications")
}

fn desktop_quote_path(path: &Path) -> String {
    desktop_quote(path.to_string_lossy().as_ref())
}

fn desktop_quote(value: &str) -> String {
    if value
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '.' | '-' | '_' | ':'))
    {
        return value.to_string();
    }
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

fn steam_quote_path(path: &Path) -> String {
    steam_quote(path.to_string_lossy().as_ref())
}

fn steam_quote(value: &str) -> String {
    if value
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '.' | '-' | '_' | ':'))
    {
        return value.to_string();
    }
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn sanitize_segment(input: &str) -> String {
    let sanitized = input
        .trim()
        .chars()
        .map(|ch| match ch {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            ch if ch.is_control() => '_',
            ch => ch,
        })
        .collect::<String>();
    if sanitized.is_empty() {
        "game".to_string()
    } else {
        sanitized
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_bottle_name_uses_claudio_prefix_and_sanitized_title() {
        assert_eq!(
            default_bottle_name(42, "Halo: Reach / GOTY?"),
            "claudio-42-Halo_ Reach _ GOTY_"
        );
    }
}
