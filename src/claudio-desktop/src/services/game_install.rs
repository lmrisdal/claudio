use crate::models::{InstallProgress, InstallType, InstalledGame, RemoteGame};
use crate::registry;
use crate::settings;
use flate2::read::GzDecoder;
use futures_util::StreamExt;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, AUTHORIZATION, CONTENT_DISPOSITION};
use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tar::Archive;
use tauri::{AppHandle, Emitter, State};
use tokio::fs::File;
use tokio::io::AsyncWriteExt;
use zip::read::ZipArchive;

pub struct InstallState {
    active_game_ids: Mutex<Vec<i32>>,
}

impl Default for InstallState {
    fn default() -> Self {
        Self {
            active_game_ids: Mutex::new(Vec::new()),
        }
    }
}

impl InstallState {
    fn start(&self, game_id: i32) -> Result<(), String> {
        let mut active = self
            .active_game_ids
            .lock()
            .map_err(|_| "Install state lock poisoned.".to_string())?;
        if active.contains(&game_id) {
            return Err("This game is already being installed.".to_string());
        }

        active.push(game_id);
        Ok(())
    }

    fn finish(&self, game_id: i32) {
        if let Ok(mut active) = self.active_game_ids.lock() {
            active.retain(|id| *id != game_id);
        }
    }
}

pub async fn install_game(
    app: AppHandle,
    state: State<'_, InstallState>,
    game: RemoteGame,
    token: String,
) -> Result<InstalledGame, String> {
    state.start(game.id)?;
    let game_id = game.id;
    let result = install_game_inner(&app, game, token).await;
    state.finish(game_id);
    result
}

pub fn get_installed_game(remote_game_id: i32) -> Result<Option<InstalledGame>, String> {
    registry::get(remote_game_id)
}

pub fn open_install_folder(remote_game_id: i32) -> Result<(), String> {
    let installed =
        registry::get(remote_game_id)?.ok_or_else(|| "Game is not installed.".to_string())?;

    let path = PathBuf::from(installed.install_path);
    if !path.exists() {
        return Err("Installed path no longer exists.".to_string());
    }

    open_path(&path)
}

async fn install_game_inner(
    app: &AppHandle,
    game: RemoteGame,
    token: String,
) -> Result<InstalledGame, String> {
    emit_progress(
        app,
        game.id,
        "starting",
        Some(0.0),
        Some("Preparing install"),
    );

    let settings = settings::load();
    let server_url = settings
        .server_url
        .clone()
        .ok_or_else(|| "Desktop server URL is not configured.".to_string())?;
    let install_root = settings::resolve_install_root(&settings)?;
    let target_dir = build_install_dir(&install_root, &game);

    if target_dir.exists() {
        return Err(format!(
            "Install target already exists: {}",
            target_dir.display()
        ));
    }

    let temp_root = settings::data_dir()
        .join("tmp")
        .join(format!("install-{}", game.id));
    if temp_root.exists() {
        fs::remove_dir_all(&temp_root).map_err(|err| err.to_string())?;
    }
    fs::create_dir_all(&temp_root).map_err(|err| err.to_string())?;

    let download_info = download_package(
        app,
        &server_url,
        &settings.custom_headers,
        &token,
        game.id,
        &temp_root,
    )
    .await?;

    let install_result = match game.install_type {
        InstallType::Portable => {
            install_portable(app, &game, &target_dir, &download_info.file_path).await
        }
        InstallType::Installer => {
            install_installer(app, &game, &target_dir, &download_info.file_path).await
        }
    };

    if install_result.is_err() {
        let _ = fs::remove_dir_all(&temp_root);
    }

    let installed = install_result?;
    let installed = registry::upsert(installed)?;

    let _ = fs::remove_dir_all(&temp_root);
    emit_progress(
        app,
        game.id,
        "completed",
        Some(100.0),
        Some("Install complete"),
    );
    Ok(installed)
}

struct DownloadInfo {
    file_path: PathBuf,
}

async fn download_package(
    app: &AppHandle,
    server_url: &str,
    custom_headers: &HashMap<String, String>,
    token: &str,
    game_id: i32,
    temp_root: &Path,
) -> Result<DownloadInfo, String> {
    let client = reqwest::Client::new();
    emit_progress(
        app,
        game_id,
        "requestingTicket",
        Some(2.0),
        Some("Requesting download ticket"),
    );

    let auth_headers = build_headers(custom_headers, token)?;
    let ticket_response = client
        .post(format!("{server_url}/api/games/{game_id}/download-ticket"))
        .headers(auth_headers.clone())
        .send()
        .await
        .map_err(|err| err.to_string())?;

    if !ticket_response.status().is_success() {
        return Err(format!(
            "Failed to create download ticket: {}",
            ticket_response.status()
        ));
    }

    let ticket_json: serde_json::Value = ticket_response
        .json()
        .await
        .map_err(|err| err.to_string())?;
    let ticket = ticket_json
        .get("ticket")
        .and_then(|value| value.as_str())
        .ok_or_else(|| "Download ticket response was missing the ticket.".to_string())?;

    let response = client
        .get(format!(
            "{server_url}/api/games/{game_id}/download?ticket={ticket}"
        ))
        .headers(auth_headers)
        .send()
        .await
        .map_err(|err| err.to_string())?;

    if !response.status().is_success() {
        return Err(format!(
            "Failed to download game package: {}",
            response.status()
        ));
    }

    let filename =
        infer_filename(response.headers()).unwrap_or_else(|| format!("game-{game_id}.tar"));
    let download_path = temp_root.join(filename);
    let mut file = File::create(&download_path)
        .await
        .map_err(|err| err.to_string())?;
    let total_bytes = response.content_length();
    let mut downloaded = 0_u64;
    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|err| err.to_string())?;
        file.write_all(&chunk)
            .await
            .map_err(|err| err.to_string())?;
        downloaded += chunk.len() as u64;

        let percent = total_bytes
            .filter(|total| *total > 0)
            .map(|total| 5.0 + (downloaded as f64 / total as f64) * 55.0);
        emit_progress(
            app,
            game_id,
            "downloading",
            percent,
            Some("Downloading package"),
        );
    }

    file.flush().await.map_err(|err| err.to_string())?;
    Ok(DownloadInfo {
        file_path: download_path,
    })
}

async fn install_portable(
    app: &AppHandle,
    game: &RemoteGame,
    target_dir: &Path,
    package_path: &Path,
) -> Result<InstalledGame, String> {
    emit_progress(
        app,
        game.id,
        "extracting",
        Some(65.0),
        Some("Extracting portable game"),
    );

    let extract_root = target_dir.with_extension("extracting");
    if extract_root.exists() {
        fs::remove_dir_all(&extract_root).map_err(|err| err.to_string())?;
    }
    fs::create_dir_all(&extract_root).map_err(|err| err.to_string())?;

    extract_archive_or_copy(package_path, &extract_root)?;
    normalize_into_final_dir(&extract_root, target_dir)?;

    let game_exe = game
        .game_exe
        .as_ref()
        .and_then(|entry| {
            let candidate = target_dir.join(entry);
            candidate
                .exists()
                .then(|| candidate.to_string_lossy().into_owned())
        })
        .or_else(|| {
            detect_windows_executable(target_dir).map(|path| path.to_string_lossy().into_owned())
        });

    Ok(InstalledGame {
        remote_game_id: game.id,
        title: game.title.clone(),
        platform: game.platform.clone(),
        install_type: game.install_type.clone(),
        install_path: target_dir.to_string_lossy().into_owned(),
        game_exe,
        installed_at: current_timestamp(),
    })
}

async fn install_installer(
    app: &AppHandle,
    game: &RemoteGame,
    target_dir: &Path,
    package_path: &Path,
) -> Result<InstalledGame, String> {
    if !cfg!(target_os = "windows") {
        return Err("Installer-based PC installs are only supported on Windows.".to_string());
    }

    emit_progress(
        app,
        game.id,
        "extracting",
        Some(65.0),
        Some("Extracting installer files"),
    );
    fs::create_dir_all(target_dir).map_err(|err| err.to_string())?;
    extract_archive_or_copy(package_path, target_dir)?;

    let installer = resolve_installer_path(target_dir, game.installer_exe.as_deref())?;

    emit_progress(
        app,
        game.id,
        "installing",
        Some(85.0),
        Some("Running installer"),
    );
    run_installer(&installer)?;

    let game_exe = game
        .game_exe
        .as_ref()
        .map(|entry| target_dir.join(entry))
        .filter(|path| path.exists())
        .or_else(|| detect_windows_executable(target_dir))
        .map(|path| path.to_string_lossy().into_owned());

    Ok(InstalledGame {
        remote_game_id: game.id,
        title: game.title.clone(),
        platform: game.platform.clone(),
        install_type: game.install_type.clone(),
        install_path: target_dir.to_string_lossy().into_owned(),
        game_exe,
        installed_at: current_timestamp(),
    })
}

fn build_headers(
    custom_headers: &HashMap<String, String>,
    token: &str,
) -> Result<HeaderMap, String> {
    let mut headers = HeaderMap::new();
    for (name, value) in custom_headers {
        let header_name = HeaderName::from_bytes(name.as_bytes()).map_err(|err| err.to_string())?;
        let header_value = HeaderValue::from_str(value).map_err(|err| err.to_string())?;
        headers.insert(header_name, header_value);
    }

    let auth_value =
        HeaderValue::from_str(&format!("Bearer {token}")).map_err(|err| err.to_string())?;
    headers.insert(AUTHORIZATION, auth_value);
    Ok(headers)
}

fn build_install_dir(install_root: &Path, game: &RemoteGame) -> PathBuf {
    install_root
        .join(sanitize_segment(&game.platform))
        .join(sanitize_segment(&game.title))
}

fn infer_filename(headers: &HeaderMap) -> Option<String> {
    let disposition = headers.get(CONTENT_DISPOSITION)?.to_str().ok()?;

    disposition.split(';').map(str::trim).find_map(|part| {
        if let Some(value) = part.strip_prefix("filename*=UTF-8''") {
            return Some(value.to_string());
        }

        part.strip_prefix("filename=")
            .map(|value| value.trim_matches('"').to_string())
    })
}

fn extract_archive_or_copy(source: &Path, destination: &Path) -> Result<(), String> {
    let lower = source.to_string_lossy().to_lowercase();

    if lower.ends_with(".zip") {
        extract_zip(source, destination)
    } else if lower.ends_with(".tar.gz") || lower.ends_with(".tgz") {
        extract_targz(source, destination)
    } else if lower.ends_with(".tar") {
        extract_tar(source, destination)
    } else {
        fs::create_dir_all(destination).map_err(|err| err.to_string())?;
        let target = destination.join(
            source
                .file_name()
                .ok_or_else(|| "Downloaded package had no file name.".to_string())?,
        );
        fs::copy(source, target).map_err(|err| err.to_string())?;
        Ok(())
    }
}

fn extract_zip(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination).map_err(|err| err.to_string())?;
    let file = fs::File::open(source).map_err(|err| err.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|err| err.to_string())?;

    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|err| err.to_string())?;
        let Some(path) = entry.enclosed_name().map(|path| destination.join(path)) else {
            continue;
        };

        if entry.is_dir() {
            fs::create_dir_all(&path).map_err(|err| err.to_string())?;
            continue;
        }

        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }

        let mut out = fs::File::create(&path).map_err(|err| err.to_string())?;
        io::copy(&mut entry, &mut out).map_err(|err| err.to_string())?;
    }

    Ok(())
}

fn extract_tar(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination).map_err(|err| err.to_string())?;
    let file = fs::File::open(source).map_err(|err| err.to_string())?;
    let mut archive = Archive::new(file);
    archive.unpack(destination).map_err(|err| err.to_string())
}

fn extract_targz(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination).map_err(|err| err.to_string())?;
    let file = fs::File::open(source).map_err(|err| err.to_string())?;
    let decoder = GzDecoder::new(file);
    let mut archive = Archive::new(decoder);
    archive.unpack(destination).map_err(|err| err.to_string())
}

fn normalize_into_final_dir(staging_root: &Path, final_dir: &Path) -> Result<(), String> {
    let entries = visible_entries(staging_root)?;

    if entries.len() == 1 && entries[0].is_dir() {
        fs::rename(&entries[0], final_dir).map_err(|err| err.to_string())?;
        fs::remove_dir_all(staging_root).map_err(|err| err.to_string())?;
        return Ok(());
    }

    fs::create_dir_all(final_dir).map_err(|err| err.to_string())?;
    for entry in entries {
        let target = final_dir.join(
            entry
                .file_name()
                .ok_or_else(|| "Extracted entry was missing a file name.".to_string())?,
        );
        fs::rename(&entry, &target).map_err(|err| err.to_string())?;
    }

    fs::remove_dir_all(staging_root).map_err(|err| err.to_string())
}

fn visible_entries(root: &Path) -> Result<Vec<PathBuf>, String> {
    let mut entries = Vec::new();
    for entry in fs::read_dir(root).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        let path = entry.path();
        let hidden = path
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| name == "__MACOSX" || name == ".DS_Store")
            .unwrap_or(false);
        if !hidden {
            entries.push(path);
        }
    }
    Ok(entries)
}

fn sanitize_segment(value: &str) -> String {
    let sanitized: String = value
        .chars()
        .map(|ch| match ch {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => ch,
        })
        .collect();

    let trimmed = sanitized.trim();
    if trimmed.is_empty() {
        "game".to_string()
    } else {
        trimmed.to_string()
    }
}

fn resolve_installer_path(root: &Path, installer_hint: Option<&str>) -> Result<PathBuf, String> {
    if let Some(hint) = installer_hint {
        let hinted = root.join(hint);
        if hinted.exists() {
            return Ok(hinted);
        }
    }

    detect_installer(root)
        .ok_or_else(|| "Could not find an installer executable in the extracted files.".to_string())
}

fn detect_installer(root: &Path) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    collect_matching_files(root, &mut candidates, |path| {
        let Some(extension) = path.extension().and_then(|ext| ext.to_str()) else {
            return false;
        };

        if !extension.eq_ignore_ascii_case("exe") && !extension.eq_ignore_ascii_case("msi") {
            return false;
        }

        let stem = path
            .file_stem()
            .and_then(|name| name.to_str())
            .unwrap_or_default();
        stem.eq_ignore_ascii_case("setup") || stem.eq_ignore_ascii_case("install")
    });

    candidates.sort();
    candidates.into_iter().next()
}

fn detect_windows_executable(root: &Path) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    collect_matching_files(root, &mut candidates, |path| {
        path.extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.eq_ignore_ascii_case("exe"))
            .unwrap_or(false)
    });

    candidates.sort();
    candidates.into_iter().next()
}

fn collect_matching_files<F>(root: &Path, matches: &mut Vec<PathBuf>, predicate: F)
where
    F: Copy + Fn(&Path) -> bool,
{
    if let Ok(entries) = fs::read_dir(root) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                collect_matching_files(&path, matches, predicate);
            } else if predicate(&path) {
                matches.push(path);
            }
        }
    }
}

#[cfg(target_os = "windows")]
fn run_installer(path: &Path) -> Result<(), String> {
    let extension = path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default();

    let status = if extension.eq_ignore_ascii_case("msi") {
        std::process::Command::new("msiexec")
            .arg("/i")
            .arg(path)
            .stdin(Stdio::null())
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .status()
            .map_err(|err| err.to_string())?
    } else {
        std::process::Command::new(path)
            .current_dir(path.parent().unwrap_or_else(|| Path::new(".")))
            .stdin(Stdio::null())
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .status()
            .map_err(|err| err.to_string())?
    };

    if status.success() {
        Ok(())
    } else {
        Err(format!("Installer exited with status {status}."))
    }
}

#[cfg(not(target_os = "windows"))]
fn run_installer(_path: &Path) -> Result<(), String> {
    Err("Installer-based PC installs are only supported on Windows.".to_string())
}

fn emit_progress(
    app: &AppHandle,
    game_id: i32,
    status: &str,
    percent: Option<f64>,
    detail: Option<&str>,
) {
    let _ = app.emit(
        "install-progress",
        InstallProgress {
            game_id,
            status: status.to_string(),
            percent,
            detail: detail.map(ToString::to_string),
        },
    );
}

fn current_timestamp() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

fn open_path(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut command = std::process::Command::new("open");
    #[cfg(target_os = "linux")]
    let mut command = std::process::Command::new("xdg-open");
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut cmd = std::process::Command::new("explorer");
        cmd.arg(path);
        cmd
    };

    #[cfg(not(target_os = "windows"))]
    command.arg(path);

    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|err| err.to_string())?;

    Ok(())
}
