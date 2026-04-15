use std::{
    fs,
    path::{Path, PathBuf},
};

use tracing::debug;

use crate::{
    services::compression::CompressionService,
    util::{archive, file_browse},
};

const HIDDEN_NAMES: &[&str] = &["__MACOSX", ".DS_Store", "@eaDir", "#recycle", "Thumbs.db"];

pub(super) fn cleanup_temp_files(game_dir: &Path, compression_service: &CompressionService) {
    debug!(path = %game_dir.display(), "TEMP_SCAN_DEBUG: cleanup_temp_files() start");
    let Ok(entries) = fs::read_dir(game_dir) else {
        debug!(path = %game_dir.display(), "TEMP_SCAN_DEBUG: cleanup_temp_files() read_dir failed");
        return;
    };

    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                debug!(path = %game_dir.display(), error = %error, "TEMP_SCAN_DEBUG: cleanup_temp_files() entry read failed");
                continue;
            }
        };

        let path = entry.path();
        let file_name = entry.file_name().to_string_lossy().to_string();
        debug!(path = %path.display(), file_name = %file_name, "TEMP_SCAN_DEBUG: cleanup_temp_files() inspecting entry");
        if !file_name.starts_with(".claudio-compress-") || !file_name.ends_with(".tmp") {
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
                debug!(path = %path.display(), game_id, error = %error, "TEMP_SCAN_DEBUG: cleanup_temp_files() failed to remove stale temp file")
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

pub(super) fn detect_install_type(directory: &Path) -> String {
    debug!(path = %directory.display(), "TEMP_SCAN_DEBUG: detect_install_type() start");
    let file_names = if let Some(single_archive) = file_browse::find_single_archive(directory) {
        debug!(path = %directory.display(), archive_path = %single_archive.display(), "TEMP_SCAN_DEBUG: detect_install_type() using single archive mode");
        match archive::read_archive_entries(&single_archive) {
            Ok(entries) => {
                debug!(path = %directory.display(), entry_count = entries.len(), "TEMP_SCAN_DEBUG: detect_install_type() archive entries loaded");
                entries
                    .into_iter()
                    .filter(|entry| !entry.is_dir)
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
                debug!(path = %directory.display(), archive_path = %single_archive.display(), error = %error, "TEMP_SCAN_DEBUG: detect_install_type() failed to read archive entries");
                Vec::new()
            }
        }
    } else {
        debug!(path = %directory.display(), "TEMP_SCAN_DEBUG: detect_install_type() using recursive file collection mode");
        collect_file_names(directory)
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
        "installer".to_string()
    } else {
        debug!(path = %directory.display(), "TEMP_SCAN_DEBUG: detect_install_type() result portable");
        "portable".to_string()
    }
}

pub(super) fn directory_size(directory: &Path) -> i64 {
    debug!(path = %directory.display(), "TEMP_SCAN_DEBUG: directory_size() start");
    let mut total = 0i64;
    let mut stack = vec![directory.to_path_buf()];

    while let Some(path) = stack.pop() {
        debug!(path = %path.display(), stack_len = stack.len(), "TEMP_SCAN_DEBUG: directory_size() reading directory");
        let Ok(entries) = fs::read_dir(&path) else {
            debug!(path = %path.display(), "TEMP_SCAN_DEBUG: directory_size() read_dir failed");
            continue;
        };

        for entry in entries {
            let entry = match entry {
                Ok(entry) => entry,
                Err(error) => {
                    debug!(path = %path.display(), error = %error, "TEMP_SCAN_DEBUG: directory_size() entry read failed");
                    continue;
                }
            };

            let child = entry.path();
            debug!(path = %child.display(), "TEMP_SCAN_DEBUG: directory_size() inspecting child");
            if child.is_dir() {
                debug!(path = %child.display(), "TEMP_SCAN_DEBUG: directory_size() child is directory, pushing to stack");
                stack.push(child);
            } else if let Ok(metadata) = child.metadata() {
                total += metadata.len() as i64;
                debug!(path = %child.display(), file_len = metadata.len(), running_total = total, "TEMP_SCAN_DEBUG: directory_size() added file size");
            } else {
                debug!(path = %child.display(), "TEMP_SCAN_DEBUG: directory_size() metadata lookup failed");
            }
        }
    }

    debug!(path = %directory.display(), total, "TEMP_SCAN_DEBUG: directory_size() end");
    total
}

pub(super) fn read_directories(path: &Path) -> Vec<PathBuf> {
    debug!(path = %path.display(), "TEMP_SCAN_DEBUG: read_directories() start");
    let Ok(entries) = fs::read_dir(path) else {
        debug!(path = %path.display(), "TEMP_SCAN_DEBUG: read_directories() read_dir failed");
        return Vec::new();
    };

    let mut directories = Vec::new();
    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                debug!(path = %path.display(), error = %error, "TEMP_SCAN_DEBUG: read_directories() entry read failed");
                continue;
            }
        };

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
    directories
}

pub(super) fn read_archive_files(path: &Path) -> Vec<PathBuf> {
    debug!(path = %path.display(), "TEMP_SCAN_DEBUG: read_archive_files() start");
    let Ok(entries) = fs::read_dir(path) else {
        debug!(path = %path.display(), "TEMP_SCAN_DEBUG: read_archive_files() read_dir failed");
        return Vec::new();
    };

    let mut archives = Vec::new();
    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                debug!(path = %path.display(), error = %error, "TEMP_SCAN_DEBUG: read_archive_files() entry read failed");
                continue;
            }
        };

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
    archives
}

pub(super) fn is_hidden_name(name: &str) -> bool {
    HIDDEN_NAMES
        .iter()
        .any(|hidden| hidden.eq_ignore_ascii_case(name))
}

fn compression_temp_game_id(file_name: &str) -> Option<i32> {
    let suffix = file_name.strip_prefix(".claudio-compress-")?;
    let digits = suffix
        .chars()
        .take_while(|character| character.is_ascii_digit())
        .collect::<String>();
    digits.parse().ok()
}

fn collect_file_names(directory: &Path) -> Vec<String> {
    debug!(path = %directory.display(), "TEMP_SCAN_DEBUG: collect_file_names() start");
    let mut names = Vec::new();
    let mut stack = vec![directory.to_path_buf()];

    while let Some(path) = stack.pop() {
        debug!(path = %path.display(), stack_len = stack.len(), "TEMP_SCAN_DEBUG: collect_file_names() reading directory");
        let Ok(entries) = fs::read_dir(&path) else {
            debug!(path = %path.display(), "TEMP_SCAN_DEBUG: collect_file_names() read_dir failed");
            continue;
        };

        for entry in entries {
            let entry = match entry {
                Ok(entry) => entry,
                Err(error) => {
                    debug!(path = %path.display(), error = %error, "TEMP_SCAN_DEBUG: collect_file_names() entry read failed");
                    continue;
                }
            };

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
    names
}
