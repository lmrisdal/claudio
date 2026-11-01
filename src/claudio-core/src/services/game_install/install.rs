use super::*;
use serde::{Deserialize, Serialize};

pub(super) async fn install_game_inner(
    app: &Host,
    game: RemoteGame,
    control: &InstallControl,
) -> Result<InstalledGame, String> {
    install_game_inner_with_options(app, game, control, false).await
}

pub(super) async fn install_game_from_cached_package_inner(
    app: &Host,
    game: RemoteGame,
    control: &InstallControl,
) -> Result<InstalledGame, String> {
    install_game_inner_with_options(app, game, control, true).await
}

async fn install_game_inner_with_options(
    app: &Host,
    game: RemoteGame,
    control: &InstallControl,
    reuse_cached_package: bool,
) -> Result<InstalledGame, String> {
    log::info!(
        "Starting install for '{}' (id={}, install_type={:?}, reuse_cached_package={})",
        game.title,
        game.id,
        game.install_type,
        reuse_cached_package
    );
    emit_progress(
        app,
        game.id,
        "starting",
        Some(0.0),
        Some("Preparing install"),
    );

    let settings = settings::load();
    let target_dir = match game.install_path.as_deref() {
        Some(path) => PathBuf::from(path),
        None => {
            let install_root = settings::resolve_install_root(&settings)?;
            build_install_dir(&install_root, &game)
        }
    };
    log::info!("Install target: {}", target_dir.display());

    if target_dir.exists() {
        if reuse_cached_package && matches!(game.install_type, InstallType::Portable) {
            fs::remove_dir_all(&target_dir).map_err(|err| {
                log_io_failure("remove failed portable install target", &target_dir, &err);
                format_install_io_error("clean the failed install target", &target_dir, &err)
            })?;
        } else if !reuse_cached_package {
            return Err(format!(
                "Install target already exists: {}",
                target_dir.display()
            ));
        }
    }

    if !target_dir.exists() {
        validate_install_target_path(&target_dir)?;
    }

    let downloads_root = settings::resolve_download_root(&settings)?;
    let temp_root = install_download_root(&downloads_root, &game);
    let download_info = if reuse_cached_package {
        emit_progress(
            app,
            game.id,
            "starting",
            Some(0.0),
            Some("Reusing downloaded package"),
        );
        read_cached_download_info(&temp_root)?
    } else {
        if temp_root.exists() {
            fs::remove_dir_all(&temp_root).map_err(|err| {
                log_io_failure("remove stale install download directory", &temp_root, &err);
                format_install_io_error("clean the temporary download directory", &temp_root, &err)
            })?;
        }
        fs::create_dir_all(&temp_root).map_err(|err| {
            log_io_failure("create install download directory", &temp_root, &err);
            format_install_io_error("create the temporary download directory", &temp_root, &err)
        })?;
        let server_url = settings
            .server_url
            .clone()
            .ok_or_else(|| "Desktop server URL is not configured.".to_string())?;

        let download_info = download_package(
            app,
            &DownloadOptions {
                server_url: &server_url,
                custom_headers: &settings.custom_headers,
                speed_limit_kbs: settings.download_speed_limit_kbs,
                progress_scale: 60.0,
            },
            game.id,
            game.title.as_str(),
            &temp_root,
            control,
        )
        .await?;
        write_cached_download_info(&temp_root, &download_info)?;
        log::info!("Download complete: {}", download_info.file_path.display());
        download_info
    };

    let install_result = match game.install_type {
        InstallType::Portable => {
            install_portable(app, &game, &target_dir, &download_info.file_path, control).await
        }
        InstallType::Installer => {
            install_installer(app, &game, &target_dir, &download_info.file_path, control).await
        }
    };

    if let Err(ref err) = install_result {
        log::error!("Install failed for '{}': {}", game.title, err);
    }

    let installed = install_result?;
    let installed = registry::upsert(installed)?;

    #[cfg(target_os = "windows")]
    crate::windows_integration::register(app, &installed, game.desktop_shortcut.unwrap_or(false));
    #[cfg(target_os = "linux")]
    crate::services::linux_umu::sync_shortcuts(
        &installed,
        game.desktop_shortcut.unwrap_or(false),
        game.app_menu_shortcut.unwrap_or(false),
        game.steam_shortcut.unwrap_or(false),
    );

    let _ = fs::remove_dir_all(&temp_root);
    log::info!(
        "Install complete for '{}': {}",
        game.title,
        installed.install_path
    );
    emit_progress(
        app,
        game.id,
        "completed",
        Some(100.0),
        Some("Install complete"),
    );
    Ok(installed)
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CachedDownloadInfo {
    file_path: String,
    is_individual: bool,
}

fn cached_download_marker_path(temp_root: &Path) -> PathBuf {
    temp_root.join(".claudio-download-complete.json")
}

fn write_cached_download_info(
    temp_root: &Path,
    download_info: &DownloadInfo,
) -> Result<(), String> {
    let marker = CachedDownloadInfo {
        file_path: download_info.file_path.to_string_lossy().into_owned(),
        is_individual: download_info.is_individual,
    };
    let json = serde_json::to_string_pretty(&marker).map_err(|err| err.to_string())?;
    fs::write(cached_download_marker_path(temp_root), json).map_err(|err| {
        log_io_failure("write cached install download marker", temp_root, &err);
        format_install_io_error("remember the completed download for retry", temp_root, &err)
    })
}

fn read_cached_download_info(temp_root: &Path) -> Result<DownloadInfo, String> {
    let marker_path = cached_download_marker_path(temp_root);
    let contents = fs::read_to_string(&marker_path).map_err(|err| {
        if err.kind() == std::io::ErrorKind::NotFound {
            return "The downloaded package is no longer available. Start the install again to download it.".to_string();
        }
        format!(
            "Failed to read cached download marker {}: {err}",
            marker_path.display()
        )
    })?;
    let marker: CachedDownloadInfo = serde_json::from_str(&contents).map_err(|err| {
        format!(
            "Cached download marker {} is invalid: {err}",
            marker_path.display()
        )
    })?;
    let file_path = PathBuf::from(marker.file_path);
    if !file_path.exists() {
        return Err(format!(
            "The downloaded package is no longer available at {}. Start the install again to download it.",
            file_path.display()
        ));
    }

    Ok(DownloadInfo {
        file_path,
        is_individual: marker.is_individual,
    })
}

pub(super) fn urlencoding_encode(input: &str) -> String {
    let mut encoded = String::with_capacity(input.len());
    for byte in input.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(byte as char);
            }
            b'/' => encoded.push('/'),
            other => {
                encoded.push('%');
                encoded.push(
                    char::from_digit((other >> 4) as u32, 16)
                        .unwrap()
                        .to_ascii_uppercase(),
                );
                encoded.push(
                    char::from_digit((other & 0xf) as u32, 16)
                        .unwrap()
                        .to_ascii_uppercase(),
                );
            }
        }
    }
    encoded
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_temp_dir(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "claudio-install-{name}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time should be after epoch")
                .as_nanos()
        ))
    }

    #[test]
    fn cached_download_info_round_trips_completed_package() {
        let temp_root = unique_temp_dir("cache-round-trip");
        fs::create_dir_all(&temp_root).expect("temp root should be created");
        let package_path = temp_root.join("game.tar");
        fs::write(&package_path, b"package").expect("package should be written");
        let download_info = DownloadInfo {
            file_path: package_path.clone(),
            is_individual: false,
        };

        write_cached_download_info(&temp_root, &download_info)
            .expect("cache marker should be written");
        let cached = read_cached_download_info(&temp_root).expect("cache marker should load");

        assert_eq!(cached.file_path, package_path);
        let _ = fs::remove_dir_all(temp_root);
    }

    #[test]
    fn cached_download_info_fails_when_marker_is_missing() {
        let temp_root = unique_temp_dir("cache-missing");
        fs::create_dir_all(&temp_root).expect("temp root should be created");

        let error = match read_cached_download_info(&temp_root) {
            Ok(_) => panic!("missing marker should not be reusable"),
            Err(error) => error,
        };

        assert!(error.contains("downloaded package is no longer available"));
        let _ = fs::remove_dir_all(temp_root);
    }
}
