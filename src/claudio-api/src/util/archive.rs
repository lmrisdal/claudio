use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::Path,
};

use flate2::read::GzDecoder;
use iso9660_simple::{helpers::get_directory_entry_by_path, ISO9660};
use tar::Archive as TarArchive;
use thiserror::Error;
use zip::ZipArchive;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArchiveEntry {
    pub name: String,
    pub size: u64,
    pub is_dir: bool,
}

#[derive(Debug, Error)]
pub enum ArchiveError {
    #[error("failed to read archive: {0}")]
    Io(#[from] std::io::Error),
    #[error("failed to read zip archive: {0}")]
    Zip(#[from] zip::result::ZipError),
    #[error("failed to read iso image")]
    Iso,
}

pub fn is_archive_path(path: &str) -> bool {
    matches!(
        full_extension(path).as_str(),
        ".zip" | ".tar" | ".tar.gz" | ".tgz" | ".iso"
    )
}

pub fn full_extension(path: &str) -> String {
    let lower = path.to_ascii_lowercase();
    if lower.ends_with(".tar.gz") {
        ".tar.gz".to_string()
    } else {
        Path::new(&lower)
            .extension()
            .map(|extension| format!(".{}", extension.to_string_lossy()))
            .unwrap_or_default()
    }
}

pub fn read_archive_entries(path: &Path) -> Result<Vec<ArchiveEntry>, ArchiveError> {
    match full_extension(&path.to_string_lossy()).as_str() {
        ".zip" => read_zip_entries(path),
        ".tar" => read_tar_entries(File::open(path)?),
        ".tar.gz" | ".tgz" => read_tar_entries(GzDecoder::new(File::open(path)?)),
        ".iso" => read_iso_entries(path),
        _ => Ok(Vec::new()),
    }
}

pub fn read_archive_file_prefix(
    path: &Path,
    relative_path: &str,
    max_bytes: Option<usize>,
) -> Result<Option<Vec<u8>>, ArchiveError> {
    match full_extension(&path.to_string_lossy()).as_str() {
        ".zip" => read_zip_file(path, relative_path, max_bytes),
        ".tar" => read_tar_file(File::open(path)?, relative_path, max_bytes),
        ".tar.gz" | ".tgz" => {
            read_tar_file(GzDecoder::new(File::open(path)?), relative_path, max_bytes)
        }
        ".iso" => read_iso_file(path, relative_path, max_bytes),
        _ => Ok(None),
    }
}

fn read_iso_entries(path: &Path) -> Result<Vec<ArchiveEntry>, ArchiveError> {
    let mut iso = open_iso(path)?;
    let mut entries = Vec::new();
    let root_lba = iso.root().lba.get();
    collect_iso_entries(&mut iso, root_lba, "", &mut entries);
    Ok(entries)
}

fn open_iso(path: &Path) -> Result<ISO9660, ArchiveError> {
    let file = File::open(path)?;
    ISO9660::from_device(FileDevice(file)).ok_or(ArchiveError::Iso)
}

fn collect_iso_entries(
    iso: &mut ISO9660,
    directory_lba: u32,
    prefix: &str,
    entries: &mut Vec<ArchiveEntry>,
) {
    let children = iso
        .read_directory(directory_lba as usize)
        .collect::<Vec<_>>();

    for child in children {
        let identifier = normalize_iso_identifier(&child.name);
        if identifier.is_empty() || identifier == "." || identifier == ".." {
            continue;
        }

        let name = if prefix.is_empty() {
            identifier.clone()
        } else {
            format!("{prefix}/{identifier}")
        };

        if child.is_folder() {
            entries.push(ArchiveEntry {
                name: name.clone(),
                size: 0,
                is_dir: true,
            });
            collect_iso_entries(iso, child.record.lba.get(), &name, entries);
        } else {
            entries.push(ArchiveEntry {
                name,
                size: u64::from(child.file_size()),
                is_dir: false,
            });
        }
    }
}

fn read_iso_file(
    path: &Path,
    relative_path: &str,
    max_bytes: Option<usize>,
) -> Result<Option<Vec<u8>>, ArchiveError> {
    let mut iso = open_iso(path)?;
    let Some(entry) = find_iso_entry(&mut iso, relative_path) else {
        return Ok(None);
    };

    if entry.is_folder() {
        return Ok(None);
    }

    let file_size = usize::try_from(entry.file_size()).unwrap_or(usize::MAX);
    let bytes_to_read = max_bytes.map_or(file_size, |limit| limit.min(file_size));
    let mut buffer = vec![0; bytes_to_read];

    if bytes_to_read > 0 && iso.read_file(&entry, 0, &mut buffer).is_none() {
        return Err(ArchiveError::Iso);
    }

    Ok(Some(buffer))
}

fn find_iso_entry(
    iso: &mut ISO9660,
    relative_path: &str,
) -> Option<iso9660_simple::ISODirectoryEntry> {
    let normalized_path = relative_path.trim_matches('/');
    if normalized_path.is_empty() {
        return None;
    }

    if let Some(entry) = get_directory_entry_by_path(iso, normalized_path) {
        return Some(entry);
    }

    let mut current_lba = iso.root().lba.get();
    let mut current_entry = None;

    for segment in normalized_path
        .split('/')
        .filter(|segment| !segment.is_empty())
    {
        let children = iso.read_directory(current_lba as usize).collect::<Vec<_>>();
        let child = children.into_iter().find(|entry| {
            let identifier = normalize_iso_identifier(&entry.name);
            !identifier.is_empty()
                && identifier != "."
                && identifier != ".."
                && identifier.eq_ignore_ascii_case(segment)
        })?;

        current_lba = child.record.lba.get();
        current_entry = Some(child);
    }

    current_entry
}

struct FileDevice(File);

impl iso9660_simple::Read for FileDevice {
    fn read(&mut self, position: usize, buffer: &mut [u8]) -> Option<()> {
        self.0.seek(SeekFrom::Start(position as u64)).ok()?;
        self.0.read_exact(buffer).ok()?;
        Some(())
    }
}

fn normalize_iso_identifier(identifier: &str) -> String {
    identifier
        .trim_end_matches(';')
        .split_once(';')
        .map_or_else(|| identifier.to_string(), |(name, _)| name.to_string())
}

fn read_zip_entries(path: &Path) -> Result<Vec<ArchiveEntry>, ArchiveError> {
    let file = File::open(path)?;
    let mut archive = ZipArchive::new(file)?;
    let mut entries = Vec::with_capacity(archive.len());

    for index in 0..archive.len() {
        let entry = archive.by_index(index)?;
        let name = entry.name().replace('\\', "/");
        if name.is_empty() {
            continue;
        }

        entries.push(ArchiveEntry {
            name,
            size: entry.size(),
            is_dir: entry.is_dir(),
        });
    }

    Ok(entries)
}

fn read_zip_file(
    path: &Path,
    relative_path: &str,
    max_bytes: Option<usize>,
) -> Result<Option<Vec<u8>>, ArchiveError> {
    let file = File::open(path)?;
    let mut archive = ZipArchive::new(file)?;

    for index in 0..archive.len() {
        let mut entry = archive.by_index(index)?;
        let entry_name = entry
            .name()
            .replace('\\', "/")
            .trim_end_matches('/')
            .to_string();
        if !entry_name.eq_ignore_ascii_case(relative_path) {
            continue;
        }

        let mut buffer = Vec::new();
        read_with_limit(&mut entry, max_bytes, &mut buffer)?;
        return Ok(Some(buffer));
    }

    Ok(None)
}

fn read_tar_entries<R>(reader: R) -> Result<Vec<ArchiveEntry>, ArchiveError>
where
    R: Read,
{
    let mut archive = TarArchive::new(reader);
    let mut entries = Vec::new();

    for entry in archive.entries()? {
        let entry = entry?;
        let path = entry.path()?.to_string_lossy().replace('\\', "/");
        if path.is_empty() {
            continue;
        }

        entries.push(ArchiveEntry {
            name: path,
            size: entry.size(),
            is_dir: entry.header().entry_type().is_dir(),
        });
    }

    Ok(entries)
}

fn read_tar_file<R>(
    reader: R,
    relative_path: &str,
    max_bytes: Option<usize>,
) -> Result<Option<Vec<u8>>, ArchiveError>
where
    R: Read,
{
    let mut archive = TarArchive::new(reader);

    for entry in archive.entries()? {
        let mut entry = entry?;
        let path = entry.path()?.to_string_lossy().replace('\\', "/");
        if !path.eq_ignore_ascii_case(relative_path) {
            continue;
        }

        let mut buffer = Vec::new();
        read_with_limit(&mut entry, max_bytes, &mut buffer)?;
        return Ok(Some(buffer));
    }

    Ok(None)
}

fn read_with_limit<R>(
    reader: &mut R,
    max_bytes: Option<usize>,
    buffer: &mut Vec<u8>,
) -> Result<(), std::io::Error>
where
    R: Read,
{
    match max_bytes {
        Some(max_bytes) => {
            let limit = u64::try_from(max_bytes).unwrap_or(u64::MAX);
            reader.take(limit).read_to_end(buffer)?;
        }
        None => {
            reader.read_to_end(buffer)?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{full_extension, is_archive_path};

    #[test]
    fn full_extension_handles_tar_gz() {
        assert_eq!(full_extension("roms/game.tar.gz"), ".tar.gz");
    }

    #[test]
    fn archive_detection_matches_supported_extensions() {
        assert!(is_archive_path("game.zip"));
        assert!(is_archive_path("game.iso"));
        assert!(!is_archive_path("game.exe"));
    }
}
