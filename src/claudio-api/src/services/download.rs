use std::{
    ffi::OsStr,
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, SystemTime},
};

use dashmap::DashMap;
use serde::Serialize;
use thiserror::Error;
use tokio::io::AsyncReadExt;
use tokio::sync::Mutex;
use tracing::info;

use crate::{
    config::ClaudioConfig,
    entity::game,
    util::{archive, file_browse},
};

const TAR_REUSE_WINDOW: Duration = Duration::from_secs(10 * 60);
const INSTALLER_INSPECTION_READ_LIMIT: usize = 4 * 1024 * 1024;
const HIDDEN_NAMES: &[&str] = &[
    "__MACOSX",
    ".DS_Store",
    "@eaDir",
    "#recycle",
    "Thumbs.db",
    ".claudio",
];

#[derive(Debug)]
pub struct DownloadService {
    tar_root: PathBuf,
    tar_creation_locks: DashMap<i32, Arc<Mutex<()>>>,
}

#[derive(Debug, Error)]
pub enum DownloadServiceError {
    #[error("library paths are not configured")]
    MissingLibraryPath,
    #[error("invalid file path")]
    InvalidPath,
    #[error("failed to access game files: {0}")]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Archive(#[from] archive::ArchiveError),
    #[error("failed to create download archive: {0}")]
    TarBuild(String),
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadFileManifestEntry {
    pub path: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallerInspectionResponse {
    pub installer_type: String,
    pub requests_elevation: bool,
    pub can_patch_copy_for_non_admin: bool,
}

pub enum DownloadTarget {
    DirectFile {
        path: PathBuf,
        content_type: &'static str,
        file_name: String,
    },
    TarFile {
        path: PathBuf,
        file_name: String,
    },
}

impl DownloadService {
    pub fn new(config: &ClaudioConfig) -> Result<Self, DownloadServiceError> {
        let Some(first_library_path) = config.library.library_paths.first() else {
            return Err(DownloadServiceError::MissingLibraryPath);
        };

        Ok(Self {
            tar_root: Path::new(first_library_path).join(".claudio").join("tars"),
            tar_creation_locks: DashMap::new(),
        })
    }

    pub async fn create_tar(&self, game: &game::Model) -> Result<PathBuf, DownloadServiceError> {
        let tar_lock = self.tar_creation_lock(game.id);
        let _guard = tar_lock.lock().await;

        tokio::fs::create_dir_all(&self.tar_root).await?;
        let tar_path = self.tar_root.join(format!("claudio-game-{}.tar", game.id));
        if should_reuse_tar(&tar_path).await? {
            return Ok(tar_path);
        }

        let temp_tar_path = temporary_tar_path(&tar_path);
        if tokio::fs::try_exists(&temp_tar_path).await? {
            tokio::fs::remove_file(&temp_tar_path).await?;
        }

        let source_path = PathBuf::from(&game.folder_path);
        let tar_path_for_task = tar_path.clone();
        let temp_tar_path_for_task = temp_tar_path.clone();
        let top_level_name = source_path
            .file_name()
            .unwrap_or_else(|| OsStr::new(&game.folder_name))
            .to_owned();

        tokio::task::spawn_blocking(move || {
            create_tar_archive(
                &source_path,
                &tar_path_for_task,
                &temp_tar_path_for_task,
                &top_level_name,
            )
        })
        .await
        .map_err(|error| DownloadServiceError::TarBuild(error.to_string()))??;

        info!(game_id = game.id, tar_path = %tar_path.display(), "created game tar archive");
        Ok(tar_path)
    }

    pub async fn select_download_target(
        &self,
        game: &game::Model,
    ) -> Result<DownloadTarget, DownloadServiceError> {
        if file_browse::is_standalone_archive(game) {
            return Ok(DownloadTarget::DirectFile {
                path: PathBuf::from(&game.folder_path),
                content_type: archive_content_type(Path::new(&game.folder_path)),
                file_name: format!(
                    "{}{}",
                    game.title,
                    archive::full_extension(&game.folder_path)
                ),
            });
        }

        if let Some(single_archive) = file_browse::find_single_archive(Path::new(&game.folder_path))
        {
            let extension = archive::full_extension(&single_archive.to_string_lossy());
            return Ok(DownloadTarget::DirectFile {
                content_type: archive_content_type(&single_archive),
                file_name: format!("{}{}", game.title, extension),
                path: single_archive,
            });
        }

        Ok(DownloadTarget::TarFile {
            path: self.create_tar(game).await?,
            file_name: format!("{}.tar", game.title),
        })
    }

    pub fn build_loose_file_manifest(
        &self,
        game: &game::Model,
    ) -> Result<Option<Vec<DownloadFileManifestEntry>>, DownloadServiceError> {
        if file_browse::is_standalone_archive(game) {
            return Ok(None);
        }

        let root = Path::new(&game.folder_path);
        if !root.is_dir() || file_browse::find_single_archive(root).is_some() {
            return Ok(None);
        }

        let mut files = Vec::new();
        collect_manifest_entries(root, root, &mut files)?;
        files.sort_unstable_by(|left, right| {
            left.path
                .to_ascii_lowercase()
                .cmp(&right.path.to_ascii_lowercase())
        });
        Ok(Some(files))
    }

    pub fn resolve_loose_file_path(
        &self,
        game: &game::Model,
        relative_path: &str,
    ) -> Result<Option<PathBuf>, DownloadServiceError> {
        let normalized_path = file_browse::normalize_relative_path(relative_path)
            .ok_or(DownloadServiceError::InvalidPath)?;

        if file_browse::is_standalone_archive(game) {
            return Ok(
                matches_named_archive(Path::new(&game.folder_path), &normalized_path)
                    .then(|| PathBuf::from(&game.folder_path)),
            );
        }

        let root = Path::new(&game.folder_path);
        if let Some(single_archive) = file_browse::find_single_archive(root) {
            if matches_named_archive(&single_archive, &normalized_path) {
                return Ok(Some(single_archive));
            }
        }

        let canonical_root = root.canonicalize()?;
        let candidate = canonical_root.join(path_segments(&normalized_path));
        let Ok(canonical_candidate) = candidate.canonicalize() else {
            return Ok(None);
        };

        if canonical_candidate == canonical_root
            || !canonical_candidate.starts_with(&canonical_root)
        {
            return Ok(None);
        }

        Ok(canonical_candidate.is_file().then_some(canonical_candidate))
    }

    pub async fn inspect_installer(
        &self,
        game: &game::Model,
        relative_path: &str,
    ) -> Result<Option<InstallerInspectionResponse>, DownloadServiceError> {
        let normalized_path = file_browse::normalize_relative_path(relative_path)
            .ok_or(DownloadServiceError::InvalidPath)?;
        let extension = archive::full_extension(&normalized_path);
        let Some(bytes) = self
            .read_game_entry_prefix(game, &normalized_path, INSTALLER_INSPECTION_READ_LIMIT)
            .await?
        else {
            return Ok(None);
        };

        let requests_elevation =
            extension.eq_ignore_ascii_case(".exe") && contains_embedded_elevation_request(&bytes);

        Ok(Some(InstallerInspectionResponse {
            installer_type: installer_type(&extension).to_string(),
            requests_elevation,
            can_patch_copy_for_non_admin: extension.eq_ignore_ascii_case(".exe")
                && requests_elevation,
        }))
    }

    async fn read_game_entry_prefix(
        &self,
        game: &game::Model,
        relative_path: &str,
        max_bytes: usize,
    ) -> Result<Option<Vec<u8>>, DownloadServiceError> {
        if let Some(path) = self.resolve_loose_file_path(game, relative_path)? {
            let file = tokio::fs::File::open(path).await?;
            let mut buffer = Vec::with_capacity(max_bytes.min(64 * 1024));
            let limit = u64::try_from(max_bytes).unwrap_or(u64::MAX);
            file.take(limit).read_to_end(&mut buffer).await?;
            return Ok(Some(buffer));
        }

        let archive_path = if file_browse::is_standalone_archive(game) {
            Some(PathBuf::from(&game.folder_path))
        } else {
            file_browse::find_single_archive(Path::new(&game.folder_path))
        };

        let Some(archive_path) = archive_path else {
            return Ok(None);
        };

        let relative_path = relative_path.to_string();
        tokio::task::spawn_blocking(move || {
            archive::read_archive_file_prefix(&archive_path, &relative_path, Some(max_bytes))
        })
        .await
        .map_err(|error| DownloadServiceError::TarBuild(error.to_string()))?
        .map_err(DownloadServiceError::Archive)
    }

    fn tar_creation_lock(&self, game_id: i32) -> Arc<Mutex<()>> {
        self.tar_creation_locks
            .entry(game_id)
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }
}

fn create_tar_archive(
    source_path: &Path,
    tar_path: &Path,
    temp_tar_path: &Path,
    top_level_name: &OsStr,
) -> Result<(), DownloadServiceError> {
    let file = fs::File::create(temp_tar_path)?;
    let mut builder = tar::Builder::new(file);
    builder.follow_symlinks(false);
    builder.append_dir_all(Path::new(top_level_name), source_path)?;
    builder.into_inner()?.flush()?;
    fs::rename(temp_tar_path, tar_path)?;
    Ok(())
}

fn collect_manifest_entries(
    root: &Path,
    current: &Path,
    entries: &mut Vec<DownloadFileManifestEntry>,
) -> Result<(), DownloadServiceError> {
    for entry in fs::read_dir(current)? {
        let entry = entry?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if is_hidden_name(&name) {
            continue;
        }

        if path.is_dir() {
            collect_manifest_entries(root, &path, entries)?;
            continue;
        }

        let metadata = entry.metadata()?;
        let relative_path = path
            .strip_prefix(root)
            .map_err(|_| DownloadServiceError::InvalidPath)?
            .to_string_lossy()
            .replace('\\', "/");
        entries.push(DownloadFileManifestEntry {
            path: relative_path,
            size: metadata.len(),
        });
    }

    Ok(())
}

async fn should_reuse_tar(tar_path: &Path) -> Result<bool, DownloadServiceError> {
    let Ok(metadata) = tokio::fs::metadata(tar_path).await else {
        return Ok(false);
    };
    let Ok(modified_at) = metadata.modified() else {
        return Ok(false);
    };

    Ok(SystemTime::now()
        .duration_since(modified_at)
        .map(|age| age < TAR_REUSE_WINDOW)
        .unwrap_or(false))
}

fn temporary_tar_path(tar_path: &Path) -> PathBuf {
    let file_name = tar_path
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| format!("{name}.tmp"))
        .unwrap_or_else(|| "download.tar.tmp".to_string());
    tar_path.with_file_name(file_name)
}

fn path_segments(path: &str) -> PathBuf {
    path.split('/').fold(PathBuf::new(), |mut buffer, segment| {
        buffer.push(segment);
        buffer
    })
}

fn matches_named_archive(path: &Path, relative_path: &str) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.eq_ignore_ascii_case(relative_path))
}

fn archive_content_type(path: &Path) -> &'static str {
    match archive::full_extension(&path.to_string_lossy()).as_str() {
        ".zip" => "application/zip",
        ".iso" => "application/x-iso9660-image",
        _ => "application/x-tar",
    }
}

fn installer_type(extension: &str) -> &'static str {
    match extension {
        ".exe" => "exe",
        ".msi" => "msi",
        _ => "unknown",
    }
}

fn contains_embedded_elevation_request(bytes: &[u8]) -> bool {
    let utf8_patterns = [
        b"requireAdministrator".as_slice(),
        b"highestAvailable".as_slice(),
    ];
    let utf16_patterns = [
        "requireAdministrator"
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect::<Vec<_>>(),
        "highestAvailable"
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect::<Vec<_>>(),
    ];

    utf8_patterns.iter().any(|pattern| {
        bytes
            .windows(pattern.len())
            .any(|window| window == *pattern)
    }) || utf16_patterns.iter().any(|pattern| {
        bytes
            .windows(pattern.len())
            .any(|window| window == pattern.as_slice())
    })
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

    use super::{contains_embedded_elevation_request, DownloadService};
    use crate::{
        config::{ClaudioConfig, LibraryConfig},
        entity::game,
    };

    #[test]
    fn installer_scan_detects_utf16_manifest_tokens() {
        let bytes = "requireAdministrator"
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect::<Vec<_>>();

        assert!(contains_embedded_elevation_request(&bytes));
    }

    #[test]
    fn loose_file_manifest_skips_hidden_entries() {
        let temp_root = std::env::temp_dir().join(format!(
            "claudio-api-download-service-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        fs::create_dir_all(temp_root.join("Game/visible")).unwrap();
        fs::create_dir_all(temp_root.join("Game/.claudio")).unwrap();
        fs::write(temp_root.join("Game/visible/data.bin"), b"hello").unwrap();
        fs::write(temp_root.join("Game/.claudio/hidden.bin"), b"secret").unwrap();

        let config = ClaudioConfig {
            library: LibraryConfig {
                library_paths: vec![temp_root.to_string_lossy().to_string()],
                ..LibraryConfig::default()
            },
            ..ClaudioConfig::default()
        };
        let service = DownloadService::new(&config).unwrap();
        let game = game::Model {
            id: 1,
            title: "Game".to_string(),
            platform: "win".to_string(),
            folder_name: "Game".to_string(),
            folder_path: temp_root.join("Game").to_string_lossy().to_string(),
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

        let files = service.build_loose_file_manifest(&game).unwrap().unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "visible/data.bin");

        fs::remove_dir_all(temp_root).unwrap();
    }
}
