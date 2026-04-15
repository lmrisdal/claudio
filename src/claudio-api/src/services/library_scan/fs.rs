use std::{
    fs,
    path::{Path, PathBuf},
};

use tracing::{debug, warn};

use crate::{services::compression::CompressionService, util::archive};

use super::error::LibraryScanError;

const HIDDEN_NAMES: &[&str] = &["__MACOSX", ".DS_Store", "@eaDir", "#recycle", "Thumbs.db"];

pub(super) fn cleanup_temp_files(game_dir: &Path, compression_service: &CompressionService) {
    debug!(path = %game_dir.display(), "TEMP_SCAN_DEBUG: cleanup_temp_files() start");
    let entries = match fs::read_dir(game_dir) {
        Ok(entries) => entries,
        Err(error) => {
            warn!(path = %game_dir.display(), error = %error, "failed to clean up temp files");
            debug!(path = %game_dir.display(), "TEMP_SCAN_DEBUG: cleanup_temp_files() read_dir failed");
            return;
        }
    };

    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                warn!(path = %game_dir.display(), error = %error, "failed to clean up temp files");
                debug!(path = %game_dir.display(), error = %error, "TEMP_SCAN_DEBUG: cleanup_temp_files() entry read failed");
                return;
            }
        };

        let path = entry.path();
        let file_name = entry.file_name().to_string_lossy().to_string();
        debug!(path = %path.display(), file_name = %file_name, "TEMP_SCAN_DEBUG: cleanup_temp_files() inspecting entry");
        if !file_name.starts_with(".claudio-compress-") || !file_name.ends_with(".zip.tmp") {
            debug!(path = %path.display(), file_name = %file_name, "TEMP_SCAN_DEBUG: cleanup_temp_files() skipped non-temp entry");
            continue;
        }

        let Some(game_id) = compression_temp_game_id(&file_name) else {
            debug!(path = %path.display(), file_name = %file_name, "TEMP_SCAN_DEBUG: cleanup_temp_files() skipped temp entry with no parsable game id");
            continue;
        };
        if compression_service.is_game_active(game_id) {
            debug!(path = %path.display(), game_id, "TEMP_SCAN_DEBUG: cleanup_temp_files() skipped active compression temp file");
            continue;
        }

        match fs::remove_file(&path) {
            Ok(()) => {
                debug!(path = %path.display(), game_id, "TEMP_SCAN_DEBUG: cleanup_temp_files() removed stale temp file")
            }
            Err(error) => {
                warn!(path = %game_dir.display(), error = %error, "failed to clean up temp files");
                debug!(path = %path.display(), game_id, error = %error, "TEMP_SCAN_DEBUG: cleanup_temp_files() failed to remove stale temp file");
                return;
            }
        }
    }

    debug!(path = %game_dir.display(), "TEMP_SCAN_DEBUG: cleanup_temp_files() end");
}

pub(super) fn normalize_platform(folder_name: &str) -> String {
    if folder_name.eq_ignore_ascii_case("pc") {
        "win".to_string()
    } else {
        folder_name.to_string()
    }
}

pub(super) fn detect_install_type(directory: &Path) -> Result<String, LibraryScanError> {
    debug!(path = %directory.display(), "TEMP_SCAN_DEBUG: detect_install_type() start");
    let file_names = if let Some(single_archive) = find_single_archive_for_scan(directory)? {
        debug!(path = %directory.display(), archive_path = %single_archive.display(), "TEMP_SCAN_DEBUG: detect_install_type() using single archive mode");
        match archive::read_archive_entries(&single_archive) {
            Ok(entries) => {
                debug!(path = %directory.display(), entry_count = entries.len(), "TEMP_SCAN_DEBUG: detect_install_type() archive entries loaded");
                entries
                    .into_iter()
                    .map(|entry| {
                        entry
                            .name
                            .replace('\\', "/")
                            .split('/')
                            .next_back()
                            .unwrap_or_default()
                            .to_string()
                    })
                    .collect::<Vec<_>>()
            }
            Err(error) => {
                debug!(path = %directory.display(), archive_path = %single_archive.display(), error = %error, "TEMP_SCAN_DEBUG: detect_install_type() failed to read archive entries, returning empty list like .NET");
                Vec::new()
            }
        }
    } else {
        debug!(path = %directory.display(), "TEMP_SCAN_DEBUG: detect_install_type() using recursive file collection mode");
        collect_file_names(directory)?
    };

    debug!(path = %directory.display(), file_name_count = file_names.len(), "TEMP_SCAN_DEBUG: detect_install_type() file names collected");

    let has_installer = file_names.into_iter().any(|file_name| {
        debug!(path = %directory.display(), file_name = %file_name, "TEMP_SCAN_DEBUG: detect_install_type() inspecting file name");
        let lower = file_name.to_ascii_lowercase();
        if lower.ends_with(".iso") {
            debug!(path = %directory.display(), file_name = %lower, "TEMP_SCAN_DEBUG: detect_install_type() installer matched iso");
            return true;
        }

        let stem = Path::new(&lower)
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        let matched = (lower.ends_with(".exe") || lower.ends_with(".msi"))
            && matches!(stem, "setup" | "install");
        if matched {
            debug!(path = %directory.display(), file_name = %lower, stem = %stem, "TEMP_SCAN_DEBUG: detect_install_type() installer matched exe/msi");
        }
        matched
    });

    if has_installer {
        debug!(path = %directory.display(), "TEMP_SCAN_DEBUG: detect_install_type() result installer");
        Ok("installer".to_string())
    } else {
        debug!(path = %directory.display(), "TEMP_SCAN_DEBUG: detect_install_type() result portable");
        Ok("portable".to_string())
    }
}

pub(super) fn directory_size(directory: &Path) -> Result<i64, LibraryScanError> {
    debug!(path = %directory.display(), "TEMP_SCAN_DEBUG: directory_size() start");
    let mut total = 0i64;
    let mut stack = vec![directory.to_path_buf()];

    while let Some(path) = stack.pop() {
        debug!(path = %path.display(), stack_len = stack.len(), "TEMP_SCAN_DEBUG: directory_size() reading directory");
        let entries = fs::read_dir(&path)?;

        for entry in entries {
            let entry = entry?;
            let child = entry.path();
            debug!(path = %child.display(), "TEMP_SCAN_DEBUG: directory_size() inspecting child");
            if child.is_dir() {
                debug!(path = %child.display(), "TEMP_SCAN_DEBUG: directory_size() child is directory, pushing to stack");
                stack.push(child);
            } else {
                let metadata = child.metadata()?;
                total += metadata.len() as i64;
                debug!(path = %child.display(), file_len = metadata.len(), running_total = total, "TEMP_SCAN_DEBUG: directory_size() added file size");
            }
        }
    }

    debug!(path = %directory.display(), total, "TEMP_SCAN_DEBUG: directory_size() end");
    Ok(total)
}

pub(super) fn read_directories(path: &Path) -> Result<Vec<PathBuf>, LibraryScanError> {
    debug!(path = %path.display(), "TEMP_SCAN_DEBUG: read_directories() start");
    let entries = fs::read_dir(path)?;

    let mut directories = Vec::new();
    for entry in entries {
        let entry = entry?;
        let entry_path = entry.path();
        debug!(path = %entry_path.display(), "TEMP_SCAN_DEBUG: read_directories() inspecting entry");
        if entry_path.is_dir() {
            debug!(path = %entry_path.display(), "TEMP_SCAN_DEBUG: read_directories() entry is directory, adding to result");
            directories.push(entry_path);
        } else {
            debug!(path = %entry_path.display(), "TEMP_SCAN_DEBUG: read_directories() entry skipped because not a directory");
        }
    }

    debug!(path = %path.display(), directory_count = directories.len(), "TEMP_SCAN_DEBUG: read_directories() end");
    Ok(directories)
}

pub(super) fn read_archive_files(path: &Path) -> Result<Vec<PathBuf>, LibraryScanError> {
    debug!(path = %path.display(), "TEMP_SCAN_DEBUG: read_archive_files() start");
    let entries = fs::read_dir(path)?;

    let mut archives = Vec::new();
    for entry in entries {
        let entry = entry?;
        let entry_path = entry.path();
        let file_name = entry.file_name().to_string_lossy().to_string();
        debug!(path = %entry_path.display(), file_name = %file_name, "TEMP_SCAN_DEBUG: read_archive_files() inspecting entry");
        let is_file = entry_path.is_file();
        let is_hidden = is_hidden_name(&file_name);
        let is_archive = archive::is_archive_path(&file_name);
        debug!(path = %entry_path.display(), is_file, is_hidden, is_archive, "TEMP_SCAN_DEBUG: read_archive_files() entry classification");

        if is_file && !is_hidden && is_archive {
            debug!(path = %entry_path.display(), file_name = %file_name, "TEMP_SCAN_DEBUG: read_archive_files() entry added to archive result");
            archives.push(entry_path);
        }
    }

    debug!(path = %path.display(), archive_count = archives.len(), "TEMP_SCAN_DEBUG: read_archive_files() end");
    Ok(archives)
}

pub(super) fn is_hidden_name(name: &str) -> bool {
    HIDDEN_NAMES
        .iter()
        .any(|hidden| hidden.eq_ignore_ascii_case(name))
}

fn compression_temp_game_id(file_name: &str) -> Option<i32> {
    let suffix = file_name.strip_prefix(".claudio-compress-")?;
    let id_str = suffix.strip_suffix(".zip.tmp")?;
    id_str.parse().ok()
}

fn find_single_archive_for_scan(folder_path: &Path) -> Result<Option<PathBuf>, LibraryScanError> {
    debug!(path = %folder_path.display(), "TEMP_SCAN_DEBUG: find_single_archive_for_scan() start");
    if !folder_path.is_dir() {
        debug!(path = %folder_path.display(), "TEMP_SCAN_DEBUG: find_single_archive_for_scan() path is not a directory");
        return Ok(None);
    }

    let entries = fs::read_dir(folder_path)?;

    let mut directories = Vec::new();
    let mut archives = Vec::new();

    for entry in entries {
        let entry = entry?;

        let path = entry.path();
        debug!(path = %path.display(), "TEMP_SCAN_DEBUG: find_single_archive_for_scan() inspecting entry");
        if path.is_dir() {
            directories.push(path);
            debug!(
                directory_count = directories.len(),
                "TEMP_SCAN_DEBUG: find_single_archive_for_scan() counted directory entry"
            );
            continue;
        }

        if archive::is_archive_path(&path.to_string_lossy()) {
            archives.push(path);
            debug!(
                archive_count = archives.len(),
                "TEMP_SCAN_DEBUG: find_single_archive_for_scan() counted archive entry"
            );
        }
    }

    let result = if directories.is_empty() && archives.len() == 1 {
        archives.into_iter().next()
    } else {
        None
    };

    debug!(
        path = %folder_path.display(),
        found = result.is_some(),
        "TEMP_SCAN_DEBUG: find_single_archive_for_scan() end"
    );
    Ok(result)
}

fn collect_file_names(directory: &Path) -> Result<Vec<String>, LibraryScanError> {
    debug!(path = %directory.display(), "TEMP_SCAN_DEBUG: collect_file_names() start");
    let mut names = Vec::new();
    let mut stack = vec![directory.to_path_buf()];

    while let Some(path) = stack.pop() {
        debug!(path = %path.display(), stack_len = stack.len(), "TEMP_SCAN_DEBUG: collect_file_names() reading directory");
        let entries = fs::read_dir(&path)?;

        for entry in entries {
            let entry = entry?;

            let child = entry.path();
            debug!(path = %child.display(), "TEMP_SCAN_DEBUG: collect_file_names() inspecting child");
            if child.is_dir() {
                debug!(path = %child.display(), "TEMP_SCAN_DEBUG: collect_file_names() child is directory, pushing to stack");
                stack.push(child);
            } else if child.is_file() {
                let file_name = entry.file_name().to_string_lossy().to_string();
                debug!(path = %child.display(), file_name = %file_name, "TEMP_SCAN_DEBUG: collect_file_names() child is file, pushing file name");
                names.push(file_name);
            } else {
                debug!(path = %child.display(), "TEMP_SCAN_DEBUG: collect_file_names() child skipped because neither file nor directory");
            }
        }
    }

    debug!(path = %directory.display(), file_name_count = names.len(), "TEMP_SCAN_DEBUG: collect_file_names() end");
    Ok(names)
}
