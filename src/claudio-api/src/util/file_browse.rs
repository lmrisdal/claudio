use std::{
    fs,
    path::{Path, PathBuf},
};

use serde::Serialize;
use thiserror::Error;

use crate::{entity::game, util::archive};

const HIDDEN_NAMES: &[&str] = &[
    "__MACOSX",
    ".DS_Store",
    "@eaDir",
    "#recycle",
    "Thumbs.db",
];
const EXECUTABLE_EXTENSIONS: &[&str] = &[".exe", ".iso"];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowseEntry {
    pub name: String,
    pub is_directory: bool,
    pub size: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowseResult {
    pub path: String,
    pub inside_archive: bool,
    pub entries: Vec<BrowseEntry>,
}

#[derive(Debug, Error)]
pub enum FileBrowseError {
    #[error("invalid path")]
    InvalidPath,
    #[error("path not found")]
    PathNotFound,
    #[error("failed to browse files: {0}")]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Archive(#[from] archive::ArchiveError),
}

pub fn exists_on_disk(game: &game::Model) -> bool {
    Path::new(&game.folder_path).is_dir() || Path::new(&game.folder_path).is_file()
}

pub fn is_standalone_archive(game: &game::Model) -> bool {
    Path::new(&game.folder_path).is_file() && archive::is_archive_path(&game.folder_path)
}

pub fn is_archive_game(game: &game::Model) -> bool {
    is_standalone_archive(game) || find_single_archive(Path::new(&game.folder_path)).is_some()
}

pub fn find_single_archive(folder_path: &Path) -> Option<PathBuf> {
    if !folder_path.is_dir() {
        return None;
    }

    let entries = fs::read_dir(folder_path).ok()?;
    let mut directories = Vec::new();
    let mut archives = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            directories.push(path);
            continue;
        }

        if archive::is_archive_path(&path.to_string_lossy()) {
            archives.push(path);
        }
    }

    if directories.is_empty() && archives.len() == 1 {
        archives.into_iter().next()
    } else {
        None
    }
}

pub fn list_relative_files(game: &game::Model) -> Result<Vec<String>, FileBrowseError> {
    if !Path::new(&game.folder_path).is_dir() {
        return Ok(Vec::new());
    }

    let root = Path::new(&game.folder_path);
    let mut files = Vec::new();
    collect_files(root, root, &mut |relative_path, _| {
        files.push(relative_path.to_string())
    })?;
    Ok(files)
}

pub fn list_executables(game: &game::Model) -> Result<Vec<String>, FileBrowseError> {
    if is_standalone_archive(game) {
        return Ok(Vec::new());
    }

    let single_archive = find_single_archive(Path::new(&game.folder_path));
    let mut executables = Vec::new();

    if let Some(archive_path) = single_archive {
        for entry in archive::read_archive_entries(&archive_path)? {
            if entry.is_dir {
                continue;
            }

            if has_supported_extension(&entry.name, EXECUTABLE_EXTENSIONS) {
                executables.push(entry.name);
            }
        }
    } else {
        collect_files(
            Path::new(&game.folder_path),
            Path::new(&game.folder_path),
            &mut |relative_path, _| {
                if has_supported_extension(relative_path, EXECUTABLE_EXTENSIONS) {
                    executables.push(relative_path.to_string());
                }
            },
        )?;
    }

    executables.sort_unstable_by_key(|path| path.to_ascii_lowercase());
    Ok(executables)
}

pub fn browse(game: &game::Model, path: Option<&str>) -> Result<BrowseResult, FileBrowseError> {
    if !exists_on_disk(game) {
        return Err(FileBrowseError::PathNotFound);
    }

    let requested_path = path
        .unwrap_or_default()
        .replace('\\', "/")
        .trim_matches('/')
        .to_string();
    let segments = split_relative_path(&requested_path)?;

    if is_standalone_archive(game) {
        let prefix = if requested_path.is_empty() {
            String::new()
        } else {
            format!("{requested_path}/")
        };

        return Ok(BrowseResult {
            path: requested_path,
            inside_archive: true,
            entries: browse_archive(Path::new(&game.folder_path), &prefix)?,
        });
    }

    let root_path = Path::new(&game.folder_path)
        .canonicalize()
        .map_err(|_| FileBrowseError::PathNotFound)?;
    let mut current_path = root_path.clone();
    let mut archive_path = find_single_archive(&current_path);
    let mut archive_segments = Vec::new();

    if archive_path.is_none() {
        for segment in &segments {
            if let Some(existing_archive_path) = &archive_path {
                let _ = existing_archive_path;
                archive_segments.push(segment.clone());
                continue;
            }

            let candidate = current_path.join(segment);
            let candidate = candidate
                .canonicalize()
                .map_err(|_| FileBrowseError::PathNotFound)?;
            ensure_inside_root(&root_path, &candidate)?;

            if candidate.is_dir() {
                current_path = candidate;
                continue;
            }

            if candidate.is_file() && archive::is_archive_path(&candidate.to_string_lossy()) {
                archive_path = Some(candidate);
                continue;
            }

            return Err(FileBrowseError::PathNotFound);
        }
    } else {
        archive_segments = segments;
    }

    if let Some(archive_path) = archive_path {
        let prefix = if archive_segments.is_empty() {
            String::new()
        } else {
            format!("{}/", archive_segments.join("/"))
        };

        return Ok(BrowseResult {
            path: requested_path,
            inside_archive: true,
            entries: browse_archive(&archive_path, &prefix)?,
        });
    }

    let transparent_archive = find_single_archive(&current_path);
    if let Some(archive_path) = transparent_archive {
        return Ok(BrowseResult {
            path: requested_path,
            inside_archive: true,
            entries: browse_archive(&archive_path, "")?,
        });
    }

    let mut entries = Vec::new();
    for entry in fs::read_dir(&current_path)? {
        let entry = entry?;
        let metadata = entry.metadata()?;
        let name = entry.file_name().to_string_lossy().to_string();
        if is_hidden_name(&name) {
            continue;
        }

        entries.push(BrowseEntry {
            name,
            is_directory: metadata.is_dir()
                || archive::is_archive_path(&entry.path().to_string_lossy()),
            size: metadata.is_file().then_some(metadata.len()),
        });
    }

    sort_entries(&mut entries);
    Ok(BrowseResult {
        path: requested_path,
        inside_archive: false,
        entries,
    })
}

pub async fn read_game_file(
    game: &game::Model,
    relative_path: &str,
) -> Result<Option<Vec<u8>>, FileBrowseError> {
    let normalized_path =
        normalize_relative_path(relative_path).ok_or(FileBrowseError::InvalidPath)?;

    if is_standalone_archive(game) {
        let archive_name = Path::new(&game.folder_path)
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .ok_or(FileBrowseError::PathNotFound)?;

        if archive_name.eq_ignore_ascii_case(&normalized_path) {
            return Ok(Some(tokio::fs::read(&game.folder_path).await?));
        }

        return Ok(None);
    }

    if let Some(single_archive) = find_single_archive(Path::new(&game.folder_path)) {
        let archive_name = single_archive
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .ok_or(FileBrowseError::PathNotFound)?;

        if archive_name.eq_ignore_ascii_case(&normalized_path) {
            return Ok(Some(tokio::fs::read(single_archive).await?));
        }

        return Ok(None);
    }

    let root = Path::new(&game.folder_path).canonicalize()?;
    let candidate = root
        .join(&normalized_path)
        .canonicalize()
        .map_err(|_| FileBrowseError::PathNotFound)?;
    ensure_inside_root(&root, &candidate)?;

    if candidate.is_file() {
        return Ok(Some(tokio::fs::read(candidate).await?));
    }

    Ok(None)
}

pub fn normalize_relative_path(path: &str) -> Option<String> {
    let normalized = path.replace('\\', "/").trim_matches('/').to_string();
    if normalized.is_empty() {
        return None;
    }

    let segments = normalized.split('/').collect::<Vec<_>>();
    if segments
        .iter()
        .any(|segment| *segment == "." || *segment == ".." || segment.is_empty())
    {
        return None;
    }

    Some(segments.join("/"))
}

fn split_relative_path(path: &str) -> Result<Vec<String>, FileBrowseError> {
    if path.is_empty() {
        return Ok(Vec::new());
    }

    let Some(normalized_path) = normalize_relative_path(path) else {
        return Err(FileBrowseError::InvalidPath);
    };

    Ok(normalized_path.split('/').map(ToOwned::to_owned).collect())
}

fn browse_archive(path: &Path, prefix: &str) -> Result<Vec<BrowseEntry>, FileBrowseError> {
    let mut entries = Vec::new();
    let mut seen_directories = std::collections::BTreeSet::new();

    for entry in archive::read_archive_entries(path)? {
        if entry.name.split('/').any(is_hidden_name) {
            continue;
        }

        if !prefix.is_empty() && !entry.name.starts_with(prefix) {
            continue;
        }

        let remainder = entry.name[prefix.len()..].trim_end_matches('/');
        if remainder.is_empty() {
            continue;
        }

        if let Some((directory_name, _)) = remainder.split_once('/') {
            if is_hidden_name(directory_name)
                || !seen_directories.insert(directory_name.to_string())
            {
                continue;
            }

            entries.push(BrowseEntry {
                name: directory_name.to_string(),
                is_directory: true,
                size: None,
            });

            continue;
        }

        if entry.is_dir {
            if seen_directories.insert(remainder.to_string()) {
                entries.push(BrowseEntry {
                    name: remainder.to_string(),
                    is_directory: true,
                    size: None,
                });
            }

            continue;
        }

        entries.push(BrowseEntry {
            name: remainder.to_string(),
            is_directory: false,
            size: Some(entry.size),
        });
    }

    sort_entries(&mut entries);
    Ok(entries)
}

fn sort_entries(entries: &mut [BrowseEntry]) {
    entries.sort_unstable_by(|left, right| {
        left.is_directory
            .cmp(&right.is_directory)
            .reverse()
            .then_with(|| {
                left.name
                    .to_ascii_lowercase()
                    .cmp(&right.name.to_ascii_lowercase())
            })
    });
}

fn collect_files<F>(root: &Path, path: &Path, callback: &mut F) -> Result<(), FileBrowseError>
where
    F: FnMut(&str, u64),
{
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let entry_path = entry.path();
        let file_name = entry.file_name().to_string_lossy().to_string();
        if is_hidden_name(&file_name) {
            continue;
        }

        if entry_path.is_dir() {
            collect_files(root, &entry_path, callback)?;
            continue;
        }

        let metadata = entry.metadata()?;
        let relative_path = entry_path
            .strip_prefix(root)
            .map_err(|_| FileBrowseError::InvalidPath)?
            .to_string_lossy()
            .replace('\\', "/");

        callback(&relative_path, metadata.len());
    }

    Ok(())
}

fn ensure_inside_root(root: &Path, candidate: &Path) -> Result<(), FileBrowseError> {
    if candidate == root || candidate.starts_with(root) {
        Ok(())
    } else {
        Err(FileBrowseError::InvalidPath)
    }
}

fn has_supported_extension(path: &str, extensions: &[&str]) -> bool {
    let extension = archive::full_extension(path);
    extensions
        .iter()
        .any(|candidate| candidate.eq_ignore_ascii_case(&extension))
}

fn is_hidden_name(name: &str) -> bool {
    HIDDEN_NAMES
        .iter()
        .any(|hidden_name| hidden_name.eq_ignore_ascii_case(name))
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::{browse, list_relative_files, normalize_relative_path, BrowseEntry};
    use crate::entity::game;

    #[test]
    fn normalize_relative_path_rejects_parent_segments() {
        assert_eq!(
            normalize_relative_path("folder/game.exe"),
            Some("folder/game.exe".to_string())
        );
        assert_eq!(normalize_relative_path("../game.exe"), None);
    }

    #[test]
    fn browse_orders_directories_before_files() {
        let temp_root = std::env::temp_dir().join(format!(
            "claudio-api-file-browse-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        fs::create_dir_all(temp_root.join("folder")).unwrap();
        fs::write(temp_root.join("file.txt"), b"hello").unwrap();

        let game = game::Model {
            id: 1,
            title: "Test".to_string(),
            platform: "win".to_string(),
            folder_name: "Test".to_string(),
            folder_path: temp_root.to_string_lossy().to_string(),
            install_type: "portable".to_string(),
            summary: None,
            genre: None,
            release_year: None,
            cover_url: None,
            hero_url: None,
            igdb_id: None,
            igdb_slug: None,
            size_bytes: 0,
            is_missing: false,
            installer_exe: None,
            game_exe: None,
            developer: None,
            publisher: None,
            game_mode: None,
            series: None,
            franchise: None,
            game_engine: None,
            is_processing: false,
        };

        let result = browse(&game, None).unwrap();
        let names = result
            .entries
            .into_iter()
            .map(|entry: BrowseEntry| entry.name)
            .collect::<Vec<_>>();
        assert_eq!(names, vec!["folder", "file.txt"]);

        fs::remove_dir_all(temp_root).unwrap();
    }

    #[test]
    fn list_relative_files_skips_hidden_segments() {
        let temp_root = std::env::temp_dir().join(format!(
            "claudio-api-file-list-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        fs::create_dir_all(temp_root.join("visible")).unwrap();
        fs::create_dir_all(temp_root.join(".claudio")).unwrap();
        fs::write(temp_root.join("visible/game.exe"), b"hello").unwrap();
        fs::write(temp_root.join(".claudio/secret.exe"), b"hello").unwrap();

        let game = game::Model {
            id: 1,
            title: "Test".to_string(),
            platform: "win".to_string(),
            folder_name: "Test".to_string(),
            folder_path: temp_root.to_string_lossy().to_string(),
            install_type: "portable".to_string(),
            summary: None,
            genre: None,
            release_year: None,
            cover_url: None,
            hero_url: None,
            igdb_id: None,
            igdb_slug: None,
            size_bytes: 0,
            is_missing: false,
            installer_exe: None,
            game_exe: None,
            developer: None,
            publisher: None,
            game_mode: None,
            series: None,
            franchise: None,
            game_engine: None,
            is_processing: false,
        };

        let files = list_relative_files(&game).unwrap();
        assert_eq!(files, vec!["visible/game.exe"]);

        fs::remove_dir_all(temp_root).unwrap();
    }

    #[test]
    fn find_single_archive_ignores_hidden_root_directories() {
        let temp_root = std::env::temp_dir().join(format!(
            "claudio-api-single-archive-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        fs::create_dir_all(temp_root.join("__MACOSX")).unwrap();
        fs::write(
            temp_root.join("game.zip"),
            b"not a real zip, detection only",
        )
        .unwrap();

        let archive = super::find_single_archive(&temp_root);
        assert_eq!(
            archive.as_deref(),
            Some(temp_root.join("game.zip").as_path())
        );

        fs::remove_dir_all(temp_root).unwrap();
    }
}
