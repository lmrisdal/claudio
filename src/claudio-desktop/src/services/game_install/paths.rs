use super::*;

pub(super) fn build_install_dir(install_root: &Path, game: &RemoteGame) -> PathBuf {
    install_root.join(sanitize_segment(&game.title))
}

pub(super) fn download_workspace_root(
    download_root: &Path,
    game_id: i32,
    game_title: &str,
) -> PathBuf {
    download_root.join(format!("{}-{game_id}", sanitize_segment(game_title)))
}

pub(super) fn install_download_root(download_root: &Path, game: &RemoteGame) -> PathBuf {
    download_workspace_root(download_root, game.id, &game.title)
}

pub(super) fn installer_staging_dir(base_dir: &Path) -> PathBuf {
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    base_dir.join(format!("installer-staging-{now_ms}"))
}

pub(super) fn install_probe_dir(base_dir: &Path) -> PathBuf {
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    base_dir.join(format!(".claudio-install-probe-{now_ms}"))
}

pub(super) fn validate_install_target_path(target_dir: &Path) -> Result<(), String> {
    if target_dir.exists() {
        return Err(format!(
            "Install target already exists: {}",
            target_dir.display()
        ));
    }

    let parent = target_dir.parent().unwrap_or(target_dir);
    fs::create_dir_all(parent).map_err(|err| {
        log_io_failure("create install target parent directory", parent, &err);
        format_install_io_error("create the install folder", parent, &err)
    })?;

    let probe_dir = install_probe_dir(parent);
    fs::create_dir(&probe_dir).map_err(|err| {
        log_io_failure(
            "create install permission probe directory",
            &probe_dir,
            &err,
        );
        format_install_io_error("create the install folder", &probe_dir, &err)
    })?;

    let validation = (|| -> Result<(), String> {
        let probe_file = probe_dir.join(".write-test");
        let mut file = fs::File::create(&probe_file).map_err(|err| {
            log_io_failure("create install permission probe file", &probe_file, &err);
            format_install_io_error("write to the install folder", &probe_file, &err)
        })?;
        std::io::Write::write_all(&mut file, b"claudio").map_err(|err| {
            log_io_failure("write install permission probe file", &probe_file, &err);
            format_install_io_error("write to the install folder", &probe_file, &err)
        })?;
        file.sync_all().map_err(|err| {
            log_io_failure("flush install permission probe file", &probe_file, &err);
            format_install_io_error("write to the install folder", &probe_file, &err)
        })?;
        Ok(())
    })();

    if let Err(error) = fs::remove_dir_all(&probe_dir) {
        log_io_failure(
            "remove install permission probe directory",
            &probe_dir,
            &error,
        );
        return Err(format_install_io_error(
            "finish checking the install folder",
            &probe_dir,
            &error,
        ));
    }

    validation
}

pub(super) fn log_io_failure(operation: &str, path: &Path, error: &io::Error) {
    log::error!(
        "[installer] {operation} failed for {}: {} (raw_os_error={:?})",
        path.display(),
        error,
        error.raw_os_error()
    );
}

pub(super) fn log_io_failure_pair(
    operation: &str,
    source: &Path,
    destination: &Path,
    error: &io::Error,
) {
    log::error!(
        "[installer] {operation} failed from {} to {}: {} (raw_os_error={:?})",
        source.display(),
        destination.display(),
        error,
        error.raw_os_error()
    );
}

pub(super) fn format_install_io_error(operation: &str, path: &Path, error: &io::Error) -> String {
    if matches!(error.raw_os_error(), Some(740)) {
        return format!(
            "Windows requires administrator privileges to {operation} at {}. Run Claudio as administrator or choose a different install folder.",
            path.display()
        );
    }

    if error.kind() == io::ErrorKind::PermissionDenied || matches!(error.raw_os_error(), Some(5)) {
        return format!(
            "Claudio couldn't write to {} while trying to {operation}. Choose a folder you can write to or run Claudio as administrator.",
            path.display()
        );
    }

    error.to_string()
}

pub(super) fn format_install_io_error_pair(
    operation: &str,
    source: &Path,
    destination: &Path,
    error: &io::Error,
) -> String {
    if matches!(error.raw_os_error(), Some(740)) {
        return format!(
            "Windows requires administrator privileges to {operation} at {}. Run Claudio as administrator or choose a different install folder.",
            destination.display()
        );
    }

    if error.kind() == io::ErrorKind::PermissionDenied || matches!(error.raw_os_error(), Some(5)) {
        return format!(
            "Claudio couldn't move files from {} to {} while trying to {operation}. Choose a folder you can write to or run Claudio as administrator.",
            source.display(),
            destination.display()
        );
    }

    error.to_string()
}
