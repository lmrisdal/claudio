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
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tar::Archive;
use tauri::{AppHandle, Emitter, State};
use tokio::fs::File;
use tokio::io::AsyncWriteExt;
use zip::read::ZipArchive;

pub struct InstallState {
    active_game_ids: Mutex<Vec<i32>>,
    cancel_tokens: Mutex<HashMap<i32, Arc<AtomicBool>>>,
}

impl Default for InstallState {
    fn default() -> Self {
        Self {
            active_game_ids: Mutex::new(Vec::new()),
            cancel_tokens: Mutex::new(HashMap::new()),
        }
    }
}

impl InstallState {
    fn start(&self, game_id: i32) -> Result<Arc<AtomicBool>, String> {
        let mut active = self
            .active_game_ids
            .lock()
            .map_err(|_| "Install state lock poisoned.".to_string())?;
        if active.contains(&game_id) {
            return Err("This game is already being installed.".to_string());
        }
        active.push(game_id);

        let token = Arc::new(AtomicBool::new(false));
        if let Ok(mut tokens) = self.cancel_tokens.lock() {
            tokens.insert(game_id, token.clone());
        }
        Ok(token)
    }

    fn finish(&self, game_id: i32) {
        if let Ok(mut active) = self.active_game_ids.lock() {
            active.retain(|id| *id != game_id);
        }
        if let Ok(mut tokens) = self.cancel_tokens.lock() {
            tokens.remove(&game_id);
        }
    }

    pub fn cancel(&self, game_id: i32) -> Result<(), String> {
        let tokens = self
            .cancel_tokens
            .lock()
            .map_err(|_| "Install state lock poisoned.".to_string())?;
        if let Some(token) = tokens.get(&game_id) {
            token.store(true, Ordering::Relaxed);
            Ok(())
        } else {
            Err("No active install for this game.".to_string())
        }
    }
}

pub async fn install_game(
    app: AppHandle,
    state: State<'_, InstallState>,
    game: RemoteGame,
    token: String,
) -> Result<InstalledGame, String> {
    let cancel_token = state.start(game.id)?;
    let game_id = game.id;
    let result = install_game_inner(&app, game, token, &cancel_token).await;
    state.finish(game_id);
    if cancel_token.load(Ordering::Relaxed) {
        return Err("Install cancelled.".to_string());
    }
    result
}

pub fn list_installed_games() -> Result<Vec<InstalledGame>, String> {
    registry::list()
}

pub fn get_installed_game(remote_game_id: i32) -> Result<Option<InstalledGame>, String> {
    registry::get(remote_game_id)
}

pub fn cancel_install(state: &InstallState, game_id: i32) -> Result<(), String> {
    state.cancel(game_id)
}

pub fn uninstall_game(remote_game_id: i32, delete_files: bool) -> Result<(), String> {
    let removed = registry::remove(remote_game_id)?;

    #[cfg(target_os = "windows")]
    if let Some(game) = &removed {
        crate::windows_integration::deregister(game);
    }

    if delete_files {
        if let Some(installed) = removed {
            let path = PathBuf::from(&installed.install_path);
            if path.exists() {
                fs::remove_dir_all(&path).map_err(|err| {
                    format!("Failed to delete install folder: {err}")
                })?;
            }
        }
    }
    Ok(())
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
    cancel_token: &Arc<AtomicBool>,
) -> Result<InstalledGame, String> {
    log::info!(
        "Starting install for '{}' (id={}, install_type={:?})",
        game.title, game.id, game.install_type
    );
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

    let install_root = match game.install_path.as_deref() {
        Some(path) => PathBuf::from(path),
        None => settings::resolve_install_root(&settings)?,
    };
    let target_dir = build_install_dir(&install_root, &game);
    log::info!("Install target: {}", target_dir.display());

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
        cancel_token,
    )
    .await?;
    log::info!("Download complete: {}", download_info.file_path.display());

    let install_result = match game.install_type {
        InstallType::Portable => {
            install_portable(app, &game, &target_dir, &download_info.file_path).await
        }
        InstallType::Installer => {
            install_installer(app, &game, &target_dir, &download_info.file_path).await
        }
    };

    if let Err(ref err) = install_result {
        log::error!("Install failed for '{}': {}", game.title, err);
        let _ = fs::remove_dir_all(&temp_root);
    }

    let installed = install_result?;
    let installed = registry::upsert(installed)?;

    #[cfg(target_os = "windows")]
    crate::windows_integration::register(app, &installed, game.desktop_shortcut.unwrap_or(false));

    let _ = fs::remove_dir_all(&temp_root);
    log::info!("Install complete for '{}': {}", game.title, installed.install_path);
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
    cancel_token: &Arc<AtomicBool>,
) -> Result<DownloadInfo, String> {
    let client = reqwest::Client::new();
    emit_progress(
        app,
        game_id,
        "requestingTicket",
        Some(0.0),
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
    let mut last_progress_emit = std::time::Instant::now()
        .checked_sub(std::time::Duration::from_secs(1))
        .unwrap_or_else(std::time::Instant::now);

    fn read_speed_limit() -> Option<u64> {
        settings::load()
            .download_speed_limit_kbs
            .filter(|v| *v > 0.0)
            .map(|kbs| (kbs * 1024.0) as u64)
    }

    let mut bytes_per_second_limit = read_speed_limit();
    let mut window_start = std::time::Instant::now();
    let mut window_bytes = 0_u64;

    while let Some(chunk) = stream.next().await {
        if cancel_token.load(Ordering::Relaxed) {
            let _ = fs::remove_dir_all(temp_root);
            return Err("Install cancelled.".to_string());
        }
        let chunk = chunk.map_err(|err| err.to_string())?;
        file.write_all(&chunk)
            .await
            .map_err(|err| err.to_string())?;
        downloaded += chunk.len() as u64;
        window_bytes += chunk.len() as u64;

        // Throttle download speed if limit is set
        if let Some(limit) = bytes_per_second_limit {
            let elapsed = window_start.elapsed();
            let expected = std::time::Duration::from_secs_f64(window_bytes as f64 / limit as f64);
            if expected > elapsed {
                tokio::time::sleep(expected - elapsed).await;
            }
            // Reset window every second and re-read the limit from settings
            if window_start.elapsed().as_secs() >= 1 {
                window_start = std::time::Instant::now();
                window_bytes = 0;
                bytes_per_second_limit = read_speed_limit();
            }
        } else if window_start.elapsed().as_secs() >= 1 {
            // Even when unlimited, periodically check if a limit was added
            window_start = std::time::Instant::now();
            window_bytes = 0;
            bytes_per_second_limit = read_speed_limit();
        }

        let now = std::time::Instant::now();
        if now.duration_since(last_progress_emit).as_millis() >= 200 {
            last_progress_emit = now;
            let percent = total_bytes
                .filter(|total| *total > 0)
                .map(|total| (downloaded as f64 / total as f64) * 60.0);
            emit_progress_with_bytes(
                app,
                game_id,
                "downloading",
                percent,
                Some("Downloading package"),
                Some(downloaded),
                total_bytes,
            );
        }
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
        Some(60.0),
        Some("Extracting game"),
    );

    let app_handle = app.clone();
    let gid = game.id;
    let extract_root = target_dir.with_extension("extracting");
    let target_dir_owned = target_dir.to_path_buf();
    let package_path_owned = package_path.to_path_buf();
    let game_exe_hint = game.game_exe.clone();

    let game_exe = tokio::task::spawn_blocking(move || -> Result<Option<String>, String> {
        let mut progress_cb = |p: f64| {
            emit_progress(
                &app_handle,
                gid,
                "extracting",
                Some(60.0 + (p * 35.0)),
                Some("Extracting game…"),
            );
        };

        if extract_root.exists() {
            fs::remove_dir_all(&extract_root).map_err(|err| err.to_string())?;
        }
        fs::create_dir_all(&extract_root).map_err(|err| err.to_string())?;

        extract_archive_or_copy(&package_path_owned, &extract_root, &mut progress_cb)?;
        emit_progress(&app_handle, gid, "extracting", Some(96.0), Some("Moving files…"));
        normalize_into_final_dir(&extract_root, &target_dir_owned)?;

        let exe = game_exe_hint
            .as_ref()
            .and_then(|entry| {
                let candidate = target_dir_owned.join(entry);
                candidate
                    .exists()
                    .then(|| candidate.to_string_lossy().into_owned())
            })
            .or_else(|| {
                detect_windows_executable(&target_dir_owned)
                    .map(|path| path.to_string_lossy().into_owned())
            });
        Ok(exe)
    })
    .await
    .map_err(|err| format!("Extract task failed: {err}"))?
    ?;

    Ok(InstalledGame {
        remote_game_id: game.id,
        title: game.title.clone(),
        platform: game.platform.clone(),
        install_type: game.install_type.clone(),
        install_path: target_dir.to_string_lossy().into_owned(),
        game_exe,
        installed_at: current_timestamp(),
        summary: game.summary.clone(),
        genre: game.genre.clone(),
        release_year: game.release_year,
        cover_url: game.cover_url.clone(),
        hero_url: game.hero_url.clone(),
        developer: game.developer.clone(),
        publisher: game.publisher.clone(),
        game_mode: game.game_mode.clone(),
        series: game.series.clone(),
        franchise: game.franchise.clone(),
        game_engine: game.game_engine.clone(),
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
        Some(60.0),
        Some("Extracting game"),
    );

    let app_handle = app.clone();
    let gid = game.id;
    let staging_dir = target_dir.with_extension("installing");
    let target_dir_owned = target_dir.to_path_buf();
    let package_path_owned = package_path.to_path_buf();
    let installer_exe_hint = game.installer_exe.clone();
    let game_exe_hint = game.game_exe.clone();

    let game_exe = tokio::task::spawn_blocking(move || -> Result<Option<String>, String> {
        let mut progress_cb = |p: f64| {
            emit_progress(
                &app_handle,
                gid,
                "extracting",
                Some(60.0 + (p * 25.0)),
                Some("Extracting game…"),
            );
        };

        if staging_dir.exists() {
            fs::remove_dir_all(&staging_dir).map_err(|err| err.to_string())?;
        }
        fs::create_dir_all(&staging_dir).map_err(|err| err.to_string())?;
        extract_archive_or_copy(&package_path_owned, &staging_dir, &mut progress_cb)?;
        emit_progress(&app_handle, gid, "extracting", Some(86.0), Some("Extracting game…"));

        let installer =
            resolve_installer_path(&staging_dir, installer_exe_hint.as_deref())?;

        emit_progress(&app_handle, gid, "installing", Some(87.0), Some("Running installer…"));
        run_installer(&installer, &target_dir_owned)?;

        let _ = fs::remove_dir_all(&staging_dir);

        let exe = game_exe_hint
            .as_ref()
            .map(|entry| target_dir_owned.join(entry))
            .filter(|path| path.exists())
            .or_else(|| detect_windows_executable(&target_dir_owned))
            .map(|path| path.to_string_lossy().into_owned());
        Ok(exe)
    })
    .await
    .map_err(|err| format!("Install task failed: {err}"))?
    ?;

    Ok(InstalledGame {
        remote_game_id: game.id,
        title: game.title.clone(),
        platform: game.platform.clone(),
        install_type: game.install_type.clone(),
        install_path: target_dir.to_string_lossy().into_owned(),
        game_exe,
        installed_at: current_timestamp(),
        summary: game.summary.clone(),
        genre: game.genre.clone(),
        release_year: game.release_year,
        cover_url: game.cover_url.clone(),
        hero_url: game.hero_url.clone(),
        developer: game.developer.clone(),
        publisher: game.publisher.clone(),
        game_mode: game.game_mode.clone(),
        series: game.series.clone(),
        franchise: game.franchise.clone(),
        game_engine: game.game_engine.clone(),
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
    install_root.join(sanitize_segment(&game.title))
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

fn extract_archive_or_copy<F>(source: &Path, destination: &Path, mut progress: F) -> Result<(), String>
where
    F: FnMut(f64),
{
    let lower = source.to_string_lossy().to_lowercase();

    if lower.ends_with(".zip") {
        extract_zip(source, destination, progress)
    } else if lower.ends_with(".tar.gz") || lower.ends_with(".tgz") {
        extract_targz(source, destination, progress)
    } else if lower.ends_with(".tar") {
        extract_tar(source, destination, progress)
    } else {
        fs::create_dir_all(destination).map_err(|err| err.to_string())?;
        let target = destination.join(
            source
                .file_name()
                .ok_or_else(|| "Downloaded package had no file name.".to_string())?,
        );
        fs::copy(source, target).map_err(|err| err.to_string())?;
        progress(1.0);
        Ok(())
    }
}

fn extract_zip<F>(source: &Path, destination: &Path, mut progress: F) -> Result<(), String>
where
    F: FnMut(f64),
{
    fs::create_dir_all(destination).map_err(|err| err.to_string())?;
    let file = fs::File::open(source).map_err(|err| err.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|err| err.to_string())?;

    let total = archive.len();
    if total == 0 {
        progress(1.0);
        return Ok(());
    }

    let mut last_report = std::time::Instant::now();
    for index in 0..total {
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

        let now = std::time::Instant::now();
        if now.duration_since(last_report).as_millis() > 100 {
            progress(index as f64 / total as f64);
            last_report = now;
        }
    }

    progress(1.0);
    Ok(())
}

struct ProgressReader<R, F> {
    inner: R,
    callback: F,
    bytes_read: u64,
    total_bytes: u64,
    last_reported: std::time::Instant,
}

impl<R: io::Read, F: FnMut(f64)> io::Read for ProgressReader<R, F> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let n = self.inner.read(buf)?;
        self.bytes_read += n as u64;
        let now = std::time::Instant::now();
        if now.duration_since(self.last_reported).as_millis() > 100 {
            if self.total_bytes > 0 {
                (self.callback)(self.bytes_read as f64 / self.total_bytes as f64);
            }
            self.last_reported = now;
        }
        Ok(n)
    }
}

fn extract_tar<F>(source: &Path, destination: &Path, mut progress: F) -> Result<(), String>
where
    F: FnMut(f64),
{
    fs::create_dir_all(destination).map_err(|err| err.to_string())?;
    let file = fs::File::open(source).map_err(|err| err.to_string())?;
    let total_bytes = file.metadata().map(|m| m.len()).unwrap_or(0);

    let reader = ProgressReader {
        inner: file,
        callback: &mut progress,
        bytes_read: 0,
        total_bytes,
        last_reported: std::time::Instant::now(),
    };

    let mut archive = Archive::new(reader);
    archive.unpack(destination).map_err(|err| err.to_string())?;
    progress(1.0);
    Ok(())
}

fn extract_targz<F>(source: &Path, destination: &Path, mut progress: F) -> Result<(), String>
where
    F: FnMut(f64),
{
    fs::create_dir_all(destination).map_err(|err| err.to_string())?;
    let file = fs::File::open(source).map_err(|err| err.to_string())?;
    let total_bytes = file.metadata().map(|m| m.len()).unwrap_or(0);

    let reader = ProgressReader {
        inner: file,
        callback: &mut progress,
        bytes_read: 0,
        total_bytes,
        last_reported: std::time::Instant::now(),
    };

    let decoder = GzDecoder::new(reader);
    let mut archive = Archive::new(decoder);
    archive.unpack(destination).map_err(|err| err.to_string())?;
    progress(1.0);
    Ok(())
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
enum InstallerType {
    Msi,
    GogInnoSetup,
    InnoSetup,
    Nsis,
    Unknown,
}

#[cfg(target_os = "windows")]
fn detect_installer_type(path: &Path) -> InstallerType {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or_default();
    if ext.eq_ignore_ascii_case("msi") {
        return InstallerType::Msi;
    }
    // Scan the first 2 MB for known installer signatures
    if let Ok(mut file) = fs::File::open(path) {
        use std::io::Read;
        let mut buf = vec![0u8; 2 * 1024 * 1024];
        let n = file.read(&mut buf).unwrap_or(0);
        let slice = &buf[..n];
        let is_inno = slice.windows(10).any(|w| w == b"Inno Setup");
        let is_gog = slice.windows(7).any(|w| w == b"GOG.com");
        if is_inno && is_gog {
            return InstallerType::GogInnoSetup;
        }
        if is_inno {
            return InstallerType::InnoSetup;
        }
        if slice.windows(8).any(|w| w == b"Nullsoft") {
            return InstallerType::Nsis;
        }
    }
    InstallerType::Unknown
}

#[cfg(target_os = "windows")]
fn run_installer(path: &Path, target_dir: &Path) -> Result<(), String> {
    let target = target_dir.to_string_lossy();
    let installer_type = detect_installer_type(path);
    log::info!(
        "Detected installer type: {} for {}",
        match &installer_type {
            InstallerType::GogInnoSetup => "GOG InnoSetup",
            InstallerType::InnoSetup => "InnoSetup",
            InstallerType::Nsis => "NSIS",
            InstallerType::Msi => "MSI",
            InstallerType::Unknown => "Unknown",
        },
        path.display()
    );

    match installer_type {
        InstallerType::GogInnoSetup => {
            run_innoextract(path, target_dir).or_else(|err| {
                log::warn!("innoextract failed ({err}), falling back to silent InnoSetup install");
                // Clean up any partial output before falling back to the silent installer
                let _ = fs::remove_dir_all(target_dir);
                run_innosetup_silent(path, &target)
            })
        }
        InstallerType::Msi => {
            let msi_args = format!("/i {} /qn TARGETDIR={target}", path.to_string_lossy());
            let status = match std::process::Command::new("msiexec")
                .arg("/i")
                .arg(path)
                .arg("/qn")
                .arg(format!("TARGETDIR={target}"))
                .stdin(Stdio::null())
                .status()
            {
                Ok(s) => s,
                Err(err) if err.raw_os_error() == Some(740) => {
                    run_elevated(std::path::Path::new("msiexec"), &msi_args)?
                }
                Err(err) => return Err(err.to_string()),
            };
            if status.success() { Ok(()) } else { Err(format!("Installer exited with status {status}.")) }
        }
        InstallerType::InnoSetup => run_innosetup_silent(path, &target),
        InstallerType::Nsis => {
            // /D= must be the last argument and cannot be quoted
            let nsis_args = format!("/S /D={target}");
            let status = match std::process::Command::new(path)
                .arg("/S")
                .arg(format!("/D={target}"))
                .stdin(Stdio::null())
                .status()
            {
                Ok(s) => s,
                Err(err) if err.raw_os_error() == Some(740) => run_elevated(path, &nsis_args)?,
                Err(err) => return Err(err.to_string()),
            };
            if status.success() { Ok(()) } else { Err(format!("Installer exited with status {status}.")) }
        }
        InstallerType::Unknown => {
            // Fall back to interactive; user chooses install location
            let status = match std::process::Command::new(path)
                .current_dir(path.parent().unwrap_or_else(|| Path::new(".")))
                .stdin(Stdio::null())
                .status()
            {
                Ok(s) => s,
                Err(err) if err.raw_os_error() == Some(740) => run_elevated(path, "")?,
                Err(err) => return Err(err.to_string()),
            };
            if status.success() { Ok(()) } else { Err(format!("Installer exited with status {status}.")) }
        }
    }
}

#[cfg(target_os = "windows")]
fn run_innosetup_silent(path: &Path, target: &str) -> Result<(), String> {
    // Quote the path so spaces in the install directory are handled correctly.
    let args = format!("/VERYSILENT /SUPPRESSMSGBOXES \"/DIR={target}\"");
    let status = match std::process::Command::new(path)
        .arg("/VERYSILENT")
        .arg("/SUPPRESSMSGBOXES")
        .arg(format!("/DIR={target}"))
        .stdin(Stdio::null())
        .status()
    {
        Ok(s) => s,
        Err(err) if err.raw_os_error() == Some(740) => run_elevated(path, &args)?,
        Err(err) => return Err(err.to_string()),
    };
    if status.success() { Ok(()) } else { Err(format!("Installer exited with status {status}.")) }
}

/// Re-launches `path` with elevated privileges via a UAC prompt.
/// Uses PowerShell's Start-Process with -Verb RunAs so the prompt appears
/// even when Claudio itself is not running as administrator.
#[cfg(target_os = "windows")]
fn run_elevated(path: &Path, args: &str) -> Result<std::process::ExitStatus, String> {
    log::info!("Installer requires elevation, requesting UAC prompt for {}", path.display());
    let path_esc = path.to_string_lossy().replace('\'', "''");
    let args_esc = args.replace('\'', "''");

    let ps_script = if args_esc.is_empty() {
        format!(
            "try {{ $p = Start-Process -FilePath '{path_esc}' -Verb RunAs -Wait -PassThru; exit $p.ExitCode }} catch {{ exit 1 }}"
        )
    } else {
        format!(
            "try {{ $p = Start-Process -FilePath '{path_esc}' -ArgumentList '{args_esc}' -Verb RunAs -Wait -PassThru; exit $p.ExitCode }} catch {{ exit 1 }}"
        )
    };

    std::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &ps_script])
        .stdin(Stdio::null())
        .status()
        .map_err(|err| err.to_string())
}

#[cfg(target_os = "windows")]
fn run_innoextract(installer: &Path, target_dir: &Path) -> Result<(), String> {
    log::info!("Running innoextract for {}", installer.display());
    let bin = ensure_innoextract()?;
    log::info!("Using innoextract binary: {}", bin.display());

    let status = std::process::Command::new(&bin)
        .arg("-d")
        .arg(target_dir)
        .arg("--gog")
        .arg(installer)
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status()
        .map_err(|err| format!("Failed to run innoextract: {err}"))?;

    if !status.success() {
        return Err(format!("innoextract exited with status {status}."));
    }
    log::info!("innoextract succeeded");

    // innoextract places game files under <target_dir>/app/ — flatten into target_dir
    let app_dir = target_dir.join("app");
    if app_dir.is_dir() {
        for entry in fs::read_dir(&app_dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let dest = target_dir.join(entry.file_name());
            fs::rename(entry.path(), dest).map_err(|e| e.to_string())?;
        }
        let _ = fs::remove_dir_all(&app_dir);
    }

    // Remove leftover innoextract temp directory
    let tmp_dir = target_dir.join("tmp");
    if tmp_dir.is_dir() {
        let _ = fs::remove_dir_all(&tmp_dir);
    }

    Ok(())
}

#[cfg(target_os = "windows")]
fn ensure_innoextract() -> Result<PathBuf, String> {
    // Check PATH first
    if std::process::Command::new("innoextract")
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
    {
        return Ok(PathBuf::from("innoextract"));
    }

    // Check cached copy in the app's data dir
    let cached = settings::data_dir().join("tools").join("innoextract.exe");
    if cached.exists() {
        log::info!("Using cached innoextract: {}", cached.display());
        return Ok(cached);
    }

    // Download from GitHub releases on first use
    log::info!("innoextract not found, downloading from GitHub releases");
    download_innoextract(&cached)?;
    log::info!("innoextract downloaded to {}", cached.display());
    Ok(cached)
}

#[cfg(target_os = "windows")]
fn download_innoextract(target: &Path) -> Result<(), String> {
    let client = reqwest::blocking::Client::builder()
        .user_agent("Claudio/1.0")
        .build()
        .map_err(|e| e.to_string())?;

    let release: serde_json::Value = client
        .get("https://api.github.com/repos/dscharrer/innoextract/releases/latest")
        .send()
        .map_err(|e| format!("Failed to fetch innoextract release info: {e}"))?
        .json()
        .map_err(|e| e.to_string())?;

    let download_url = release["assets"]
        .as_array()
        .ok_or("No assets found in innoextract release")?
        .iter()
        .find(|asset| {
            asset["name"]
                .as_str()
                .map(|name| name.contains("windows") && name.ends_with(".zip"))
                .unwrap_or(false)
        })
        .and_then(|asset| asset["browser_download_url"].as_str())
        .ok_or("Could not find Windows innoextract release asset")?
        .to_string();

    let bytes = client
        .get(&download_url)
        .send()
        .map_err(|e| format!("Failed to download innoextract: {e}"))?
        .bytes()
        .map_err(|e| e.to_string())?;

    let cursor = std::io::Cursor::new(bytes.as_ref());
    let mut archive = ZipArchive::new(cursor).map_err(|e| e.to_string())?;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        if entry.name().ends_with("innoextract.exe") {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut out = fs::File::create(target).map_err(|e| e.to_string())?;
            io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
            return Ok(());
        }
    }

    Err("innoextract.exe not found in downloaded release zip".to_string())
}

#[cfg(not(target_os = "windows"))]
fn run_installer(_path: &Path, _target_dir: &Path) -> Result<(), String> {
    Err("Installer-based PC installs are only supported on Windows.".to_string())
}

fn emit_progress(
    app: &AppHandle,
    game_id: i32,
    status: &str,
    percent: Option<f64>,
    detail: Option<&str>,
) {
    emit_progress_with_bytes(app, game_id, status, percent, detail, None, None);
}

fn emit_progress_with_bytes(
    app: &AppHandle,
    game_id: i32,
    status: &str,
    percent: Option<f64>,
    detail: Option<&str>,
    bytes_downloaded: Option<u64>,
    total_bytes: Option<u64>,
) {
    let _ = app.emit(
        "install-progress",
        InstallProgress {
            game_id,
            status: status.to_string(),
            percent,
            detail: detail.map(ToString::to_string),
            bytes_downloaded,
            total_bytes,
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
