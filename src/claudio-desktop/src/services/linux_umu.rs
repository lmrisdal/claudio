use crate::models::InstalledGame;
use crate::settings;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::Duration;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtonVersionOption {
    pub label: String,
    pub value: String,
}

pub fn list_proton_versions() -> Vec<ProtonVersionOption> {
    let mut versions = vec![
        ProtonVersionOption {
            label: "UMU Latest".to_string(),
            value: "UMU-Latest".to_string(),
        },
        ProtonVersionOption {
            label: "GE-Proton Latest".to_string(),
            value: "GE-Proton".to_string(),
        },
        ProtonVersionOption {
            label: "GE Latest".to_string(),
            value: "GE-Latest".to_string(),
        },
        ProtonVersionOption {
            label: "UMU Sniper".to_string(),
            value: "umu-sniper".to_string(),
        },
    ];

    for dir in compatibility_tool_dirs() {
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_dir() || !path.join("toolmanifest.vdf").is_file() {
                    continue;
                }
                let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
                    continue;
                };
                if versions.iter().any(|version| version.value == name) {
                    continue;
                }
                versions.push(ProtonVersionOption {
                    label: name.to_string(),
                    value: name.to_string(),
                });
            }
        }
    }

    versions
}

pub fn selected_proton_path(requested: Option<&str>) -> String {
    requested
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(|| settings::resolve_proton_path(&settings::load()))
}

pub fn default_prefix_path(game_id: i32, title: &str) -> PathBuf {
    let settings = settings::load();
    settings::default_install_root(&settings)
        .join(".prefixes")
        .join(format!("{game_id}-{}", sanitize_segment(title)))
}

pub fn run_prefix_command(
    prefix: &Path,
    proton_path: &str,
    exe: &Path,
    extra_args: &[String],
    game_id: Option<&str>,
    store: Option<&str>,
) -> Result<Child, String> {
    let umu_run = resolve_umu_run()?;
    let working_dir = exe.parent().unwrap_or_else(|| Path::new("."));
    let mut command = Command::new(umu_run);
    command
        .arg(exe)
        .args(extra_args)
        .current_dir(working_dir)
        .env("WINEPREFIX", prefix)
        .env("PROTONPATH", proton_path)
        .env("GAMEID", game_id.unwrap_or("umu-default"))
        .env("STORE", store.unwrap_or("none"))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    command.spawn().map_err(|err| {
        format!(
            "Failed to start UMU for {} with prefix {}: {err}",
            exe.display(),
            prefix.display()
        )
    })
}

pub fn run_prefix_command_wait(
    prefix: &Path,
    proton_path: &str,
    exe: &Path,
    extra_args: &[String],
    cancelled: impl Fn() -> bool,
) -> Result<(), String> {
    let mut child = run_prefix_command(prefix, proton_path, exe, extra_args, None, None)?;

    loop {
        if cancelled() {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Install cancelled.".to_string());
        }

        match child.try_wait() {
            Ok(Some(status)) if status.success() => return Ok(()),
            Ok(Some(status)) => {
                return Err(format!(
                    "UMU exited with status {status} while running {}.",
                    exe.display()
                ));
            }
            Ok(None) => thread::sleep(Duration::from_millis(250)),
            Err(err) => return Err(format!("Failed waiting for UMU: {err}")),
        }
    }
}

pub fn prepare_prefix(
    prefix: &Path,
    proton_path: &str,
    cancelled: impl Fn() -> bool,
) -> Result<(), String> {
    fs::create_dir_all(prefix)
        .map_err(|err| format!("Failed to create Wine prefix {}: {err}", prefix.display()))?;
    let umu_run = resolve_umu_run()?;
    let mut command = Command::new(umu_run);
    command
        .arg("")
        .current_dir(prefix)
        .env("WINEPREFIX", prefix)
        .env("PROTONPATH", proton_path)
        .env("GAMEID", "umu-default")
        .env("STORE", "none")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    let mut child = command.spawn().map_err(|err| {
        format!(
            "Failed to prepare UMU prefix {} with Proton {proton_path}: {err}",
            prefix.display()
        )
    })?;

    loop {
        if cancelled() {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Install cancelled.".to_string());
        }

        match child.try_wait() {
            Ok(Some(status)) if status.success() => return Ok(()),
            Ok(Some(status)) => {
                return Err(format!(
                    "UMU exited with status {status} while preparing prefix {}.",
                    prefix.display()
                ));
            }
            Ok(None) => thread::sleep(Duration::from_millis(250)),
            Err(err) => return Err(format!("Failed waiting for UMU: {err}")),
        }
    }
}

pub fn sync_shortcuts(
    installed: &InstalledGame,
    desktop_shortcut: bool,
    app_menu_shortcut: bool,
    steam_shortcut: bool,
) {
    if desktop_shortcut && let Err(error) = write_desktop_shortcut(installed, ShortcutKind::Desktop)
    {
        log::warn!("[linux shortcut] failed to write desktop shortcut: {error}");
    }
    if app_menu_shortcut
        && let Err(error) = write_desktop_shortcut(installed, ShortcutKind::AppMenu)
    {
        log::warn!("[linux shortcut] failed to write app menu shortcut: {error}");
    }
    if steam_shortcut
        && let Err(error) = resolve_umu_run().and_then(|umu_run| {
            crate::services::linux_steam_shortcuts::write_steam_shortcut(installed, &umu_run)
        })
    {
        log::warn!("[linux shortcut] failed to write Steam shortcut: {error}");
    }
}

fn resolve_umu_run() -> Result<PathBuf, String> {
    let bundled = settings::tools_dir().join("umu-run");
    if bundled.is_file() {
        return Ok(bundled);
    }

    if let Some(path) = find_in_path("umu-run") {
        return Ok(path);
    }

    Err(
        "umu-run was not found. Install umu-launcher or place umu-run in Claudio's tools folder."
            .to_string(),
    )
}

fn find_in_path(binary: &str) -> Option<PathBuf> {
    std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths)
            .map(|path| path.join(binary))
            .find(|path| path.is_file())
    })
}

fn compatibility_tool_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(data_dir) = dirs::data_dir() {
        dirs.push(data_dir.join("Steam").join("compatibilitytools.d"));
        dirs.push(data_dir.join("umu").join("compatibilitytools"));
    }
    dirs
}

enum ShortcutKind {
    Desktop,
    AppMenu,
}

fn write_desktop_shortcut(installed: &InstalledGame, kind: ShortcutKind) -> Result<(), String> {
    let exe = installed
        .game_exe
        .as_deref()
        .ok_or_else(|| "No game executable is set.".to_string())?;
    let prefix = installed
        .wine_prefix
        .as_deref()
        .ok_or_else(|| "No Wine prefix is set.".to_string())?;
    let proton = installed.proton_path.as_deref().unwrap_or("UMU-Latest");
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
    let umu_run = resolve_umu_run()?;
    let start_dir = Path::new(exe).parent().unwrap_or_else(|| Path::new("."));
    let exec = format!(
        "env WINEPREFIX={} PROTONPATH={} GAMEID=umu-default STORE=none {} {}",
        desktop_quote(prefix),
        desktop_quote(proton),
        desktop_quote_path(&umu_run),
        desktop_quote(exe)
    );
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
