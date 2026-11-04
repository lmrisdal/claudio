#![cfg_attr(test, allow(dead_code))]

use crate::models::InstalledGame;
use crate::settings;
use std::ffi::OsStr;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

const MANAGED_UMU_VERSION: &str = "1.4.4";
const MANAGED_UMU_ARCHIVE_MEMBER: &str = "umu/umu-run";

#[path = "linux_umu_command.rs"]
mod command;
pub use command::{prepare_prefix, run_prefix_command, run_prefix_command_wait};

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

pub fn add_steam_shortcut(installed: &InstalledGame) -> Result<(), String> {
    let umu_run = resolve_umu_run()?;
    crate::services::linux_steam_shortcuts::write_steam_shortcut(installed, &umu_run)
}

fn resolve_umu_run() -> Result<PathBuf, String> {
    if let Some(path) = cached_managed_umu_run() {
        return Ok(path);
    }

    let managed_error = match install_managed_umu_run() {
        Ok(path) => return Ok(path),
        Err(error) => error,
    };

    for path in binary_candidates("umu-run") {
        if path.is_file() {
            return Ok(path);
        }
    }

    Err(format!(
        "umu-run was not found and Claudio could not install UMU Launcher {MANAGED_UMU_VERSION}: {managed_error}"
    ))
}

fn cached_managed_umu_run() -> Option<PathBuf> {
    let target = managed_umu_run_path();
    let version = fs::read_to_string(managed_umu_version_path()).ok()?;
    (target.is_file() && version.trim() == MANAGED_UMU_VERSION).then_some(target)
}

fn install_managed_umu_run() -> Result<PathBuf, String> {
    let target = managed_umu_run_path();
    let parent = target
        .parent()
        .ok_or_else(|| format!("Could not determine parent folder for {}", target.display()))?;
    fs::create_dir_all(parent).map_err(|err| {
        format!(
            "Failed to create UMU tools folder {}: {err}",
            parent.display()
        )
    })?;

    let bytes = reqwest::blocking::Client::builder()
        .user_agent("Claudio/1.0")
        .build()
        .map_err(|err| err.to_string())?
        .get(managed_umu_download_url())
        .send()
        .map_err(|err| format!("Failed to download UMU Launcher: {err}"))?
        .error_for_status()
        .map_err(|err| format!("Failed to download UMU Launcher: {err}"))?
        .bytes()
        .map_err(|err| format!("Failed to read UMU Launcher download: {err}"))?;

    let cursor = io::Cursor::new(bytes.as_ref());
    let mut archive = tar::Archive::new(cursor);
    for entry in archive.entries().map_err(|err| err.to_string())? {
        let mut entry = entry.map_err(|err| err.to_string())?;
        let path = entry.path().map_err(|err| err.to_string())?;
        if path.as_ref() == Path::new(MANAGED_UMU_ARCHIVE_MEMBER) {
            let temp_target = target.with_extension("download");
            let mut out = fs::File::create(&temp_target).map_err(|err| {
                format!(
                    "Failed to create UMU Launcher file {}: {err}",
                    temp_target.display()
                )
            })?;
            io::copy(&mut entry, &mut out)
                .map_err(|err| format!("Failed to write UMU Launcher: {err}"))?;
            drop(out);

            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&temp_target, fs::Permissions::from_mode(0o755)).map_err(
                    |err| {
                        format!(
                            "Failed to mark UMU Launcher executable {}: {err}",
                            temp_target.display()
                        )
                    },
                )?;
            }

            fs::rename(&temp_target, &target).map_err(|err| {
                format!(
                    "Failed to install UMU Launcher from {} to {}: {err}",
                    temp_target.display(),
                    target.display()
                )
            })?;
            fs::write(
                managed_umu_version_path(),
                format!("{MANAGED_UMU_VERSION}\n"),
            )
            .map_err(|err| format!("Failed to write UMU Launcher version marker: {err}"))?;
            return Ok(target);
        }
    }

    Err(format!(
        "{MANAGED_UMU_ARCHIVE_MEMBER} was not found in UMU Launcher archive"
    ))
}

fn managed_umu_run_path() -> PathBuf {
    managed_umu_dir().join("umu-run")
}

fn managed_umu_version_path() -> PathBuf {
    managed_umu_dir().join("VERSION")
}

fn managed_umu_dir() -> PathBuf {
    settings::tools_dir()
        .join("umu-launcher")
        .join(MANAGED_UMU_VERSION)
}

fn managed_umu_download_url() -> String {
    format!(
        "https://github.com/Open-Wine-Components/umu-launcher/releases/download/{MANAGED_UMU_VERSION}/umu-launcher-{MANAGED_UMU_VERSION}-zipapp.tar"
    )
}

fn binary_candidates(binary: &str) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    push_unique_path(&mut candidates, settings::tools_dir().join(binary));

    for dir in binary_search_dirs(std::env::var_os("PATH").as_deref()) {
        push_unique_path(&mut candidates, dir.join(binary));
    }

    candidates
}

fn binary_search_dirs(path_env: Option<&OsStr>) -> Vec<PathBuf> {
    let mut dirs = Vec::new();

    if let Some(paths) = path_env {
        for path in std::env::split_paths(paths) {
            push_unique_path(&mut dirs, path);
        }
    }

    if let Some(home) = dirs::home_dir() {
        push_unique_path(&mut dirs, home.join(".local/bin"));
        push_unique_path(&mut dirs, home.join("bin"));
    }

    for path in [
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
        "/var/lib/flatpak/exports/bin",
        "/run/host/usr/local/bin",
        "/run/host/usr/bin",
        "/run/host/bin",
        "/run/host/var/lib/flatpak/exports/bin",
    ] {
        push_unique_path(&mut dirs, PathBuf::from(path));
    }

    dirs
}

fn push_unique_path(paths: &mut Vec<PathBuf>, path: PathBuf) {
    if !paths.iter().any(|existing| existing == &path) {
        paths.push(path);
    }
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_temp_dir(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "claudio-umu-{name}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time should be after UNIX epoch")
                .as_nanos()
        ))
    }

    #[test]
    fn binary_search_dirs_include_standard_linux_locations_without_path_env() {
        let dirs = binary_search_dirs(None);

        assert!(dirs.contains(&PathBuf::from("/usr/bin")));
    }

    #[test]
    fn binary_search_dirs_include_distrobox_host_locations_without_path_env() {
        let dirs = binary_search_dirs(None);

        assert!(dirs.contains(&PathBuf::from("/run/host/usr/bin")));
    }

    #[test]
    fn binary_search_dirs_keep_path_entries_before_fallbacks() {
        let path_env = std::env::join_paths(["/custom/bin", "/usr/bin"])
            .expect("path entries should join into a PATH value");
        let dirs = binary_search_dirs(Some(&path_env));

        assert_eq!(dirs.first(), Some(&PathBuf::from("/custom/bin")));
    }

    #[test]
    fn managed_umu_download_url_uses_pinned_version() {
        assert!(managed_umu_download_url().contains(MANAGED_UMU_VERSION));
    }

    #[test]
    fn cached_managed_umu_run_returns_pinned_cached_zipapp() {
        let temp_dir = unique_temp_dir("managed-cache");

        crate::settings::with_test_data_dir(temp_dir, || {
            let umu_run = managed_umu_run_path();
            fs::create_dir_all(umu_run.parent().expect("managed path should have parent"))
                .expect("managed UMU folder should be created");
            fs::write(&umu_run, b"umu").expect("cached umu-run should be written");
            fs::write(managed_umu_version_path(), MANAGED_UMU_VERSION)
                .expect("version marker should be written");

            assert_eq!(cached_managed_umu_run(), Some(umu_run));
        });
    }
}
