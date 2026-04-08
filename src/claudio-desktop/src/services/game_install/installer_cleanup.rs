use super::*;

pub(super) fn cleanup_directory(path: &Path, label: &str) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }

    log::info!("[installer] removing {label} {}", path.display());

    let mut last_error = None;
    for attempt in 1..=20 {
        match fs::remove_dir_all(path) {
            Ok(()) => return Ok(()),
            Err(_error) if !path.exists() => return Ok(()),
            Err(error) => {
                if path.is_file() {
                    match fs::remove_file(path) {
                        Ok(()) => return Ok(()),
                        Err(_file_error) if !path.exists() => return Ok(()),
                        Err(file_error) => {
                            let detail = format!(
                                "{} (raw_os_error={:?})",
                                file_error,
                                file_error.raw_os_error()
                            );
                            last_error = Some(detail.clone());
                            log::warn!(
                                "[installer] {label} file cleanup attempt {attempt} failed for {}: {}",
                                path.display(),
                                detail
                            );
                        }
                    }
                } else {
                    let detail = format!("{} (raw_os_error={:?})", error, error.raw_os_error());
                    last_error = Some(detail.clone());
                    log::warn!(
                        "[installer] {label} cleanup attempt {attempt} failed for {}: {}",
                        path.display(),
                        detail
                    );
                }

                let backoff_ms = (attempt as u64).saturating_mul(200).min(2_000);
                std::thread::sleep(std::time::Duration::from_millis(backoff_ms));
            }
        }
    }

    Err(format!(
        "Failed to remove {label} {}: {}",
        path.display(),
        last_error.unwrap_or_else(|| "unknown error".to_string())
    ))
}

pub(super) fn cleanup_partial_install_dir(target_dir: &Path) -> Result<(), String> {
    cleanup_directory(target_dir, "partial install directory")
}

pub(super) fn cleanup_failed_installer_state(
    target_dir: &Path,
    staging_dir: &Path,
) -> Result<(), String> {
    let mut warnings = Vec::new();

    if let Err(error) = cleanup_partial_install_dir(target_dir) {
        warnings.push(error);
    }

    if let Err(error) = cleanup_directory(staging_dir, "installer staging directory") {
        warnings.push(error);
    }

    if warnings.is_empty() {
        return Ok(());
    }

    log::warn!(
        "[installer] cleanup after failed install was incomplete: {}",
        warnings.join(" ")
    );
    Ok(())
}
