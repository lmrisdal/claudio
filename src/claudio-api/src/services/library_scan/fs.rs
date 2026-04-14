use std::{
    fs,
    path::{Path, PathBuf},
};

use crate::{
    services::compression::CompressionService,
    util::{archive, file_browse},
};

const HIDDEN_NAMES: &[&str] = &[
    "__MACOSX",
    ".DS_Store",
    "@eaDir",
    "#recycle",
    "Thumbs.db",
    ".claudio",
];

pub(super) fn cleanup_temp_files(game_dir: &Path, compression_service: &CompressionService) {
    let Ok(entries) = fs::read_dir(game_dir) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let file_name = entry.file_name().to_string_lossy().to_string();
        if !file_name.starts_with(".claudio-compress-") || !file_name.ends_with(".tmp") {
            continue;
        }

        let Some(game_id) = compression_temp_game_id(&file_name) else {
            continue;
        };
        if compression_service.is_game_active(game_id) {
            continue;
        }

        let _ = fs::remove_file(path);
    }
}

pub(super) fn normalize_platform(folder_name: &str) -> String {
    if folder_name.eq_ignore_ascii_case("pc") {
        "win".to_string()
    } else {
        folder_name.to_ascii_lowercase()
    }
}

pub(super) fn detect_install_type(directory: &Path) -> String {
    let file_names = if let Some(single_archive) = file_browse::find_single_archive(directory) {
        archive::read_archive_entries(&single_archive)
            .unwrap_or_default()
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
    } else {
        collect_file_names(directory)
    };

    let has_installer = file_names.into_iter().any(|file_name| {
        let lower = file_name.to_ascii_lowercase();
        if lower.ends_with(".iso") {
            return true;
        }

        let stem = Path::new(&lower)
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        (lower.ends_with(".exe") || lower.ends_with(".msi")) && matches!(stem, "setup" | "install")
    });

    if has_installer {
        "installer".to_string()
    } else {
        "portable".to_string()
    }
}

pub(super) fn directory_size(directory: &Path) -> i64 {
    let mut total = 0i64;
    let mut stack = vec![directory.to_path_buf()];

    while let Some(path) = stack.pop() {
        let Ok(entries) = fs::read_dir(path) else {
            continue;
        };

        for entry in entries.flatten() {
            let child = entry.path();
            if child.is_dir() {
                stack.push(child);
            } else if let Ok(metadata) = child.metadata() {
                total += metadata.len() as i64;
            }
        }
    }

    total
}

pub(super) fn read_directories(path: &Path) -> Vec<PathBuf> {
    fs::read_dir(path)
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .collect()
}

pub(super) fn read_archive_files(path: &Path) -> Vec<PathBuf> {
    fs::read_dir(path)
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_file()
                && path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| !is_hidden_name(name) && archive::is_archive_path(name))
        })
        .collect()
}

pub(super) fn strip_extension(file_name: &str) -> String {
    let extension = archive::full_extension(file_name);
    if extension.is_empty() {
        file_name.to_string()
    } else {
        file_name
            .strip_suffix(&extension)
            .unwrap_or(file_name)
            .to_string()
    }
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
    let mut names = Vec::new();
    let mut stack = vec![directory.to_path_buf()];

    while let Some(path) = stack.pop() {
        let Ok(entries) = fs::read_dir(path) else {
            continue;
        };

        for entry in entries.flatten() {
            let child = entry.path();
            if child.is_dir() {
                stack.push(child);
            } else if child.is_file() {
                names.push(entry.file_name().to_string_lossy().to_string());
            }
        }
    }

    names
}
