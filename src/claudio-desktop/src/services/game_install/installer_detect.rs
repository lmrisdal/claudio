use super::*;

pub(super) fn resolve_installer_path(
    root: &Path,
    installer_hint: Option<&str>,
) -> Result<PathBuf, String> {
    if let Some(hint) = installer_hint {
        let hinted = root.join(hint);
        if hinted.exists() {
            return Ok(hinted);
        }
    }

    detect_installer(root)
        .ok_or_else(|| "Could not find an installer executable in the extracted files.".to_string())
}

pub(super) fn detect_installer(root: &Path) -> Option<PathBuf> {
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

pub(super) fn detect_windows_executable(root: &Path) -> Option<PathBuf> {
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

#[cfg(target_os = "windows")]
pub(super) enum InstallerType {
    Msi,
    GogInnoSetup,
    InnoSetup,
    Nsis,
    Unknown,
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum InstallerLaunchKind {
    Exe,
    Msi,
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct InstallerAttemptConfig {
    pub(super) force_interactive: bool,
    pub(super) run_as_administrator: bool,
    pub(super) force_run_as_invoker: bool,
}

#[cfg(target_os = "windows")]
pub(super) fn detect_installer_type(path: &Path) -> InstallerType {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or_default();
    if ext.eq_ignore_ascii_case("msi") {
        return InstallerType::Msi;
    }
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
pub(super) fn installer_launch_kind(path: &Path) -> InstallerLaunchKind {
    match path.extension().and_then(|ext| ext.to_str()) {
        Some(ext) if ext.eq_ignore_ascii_case("exe") => InstallerLaunchKind::Exe,
        Some(ext) if ext.eq_ignore_ascii_case("msi") => InstallerLaunchKind::Msi,
        _ => InstallerLaunchKind::Unknown,
    }
}

pub(super) fn installer_attempt_config(
    force_interactive: bool,
    run_as_administrator: bool,
    requests_elevation: bool,
) -> InstallerAttemptConfig {
    InstallerAttemptConfig {
        force_interactive,
        run_as_administrator,
        force_run_as_invoker: requests_elevation && !run_as_administrator,
    }
}

#[cfg(not(target_os = "windows"))]
pub(super) fn installer_launch_kind(_path: &Path) -> InstallerLaunchKind {
    InstallerLaunchKind::Unknown
}

#[cfg(target_os = "windows")]
pub(super) fn file_requests_elevation(path: &Path) -> Result<bool, String> {
    let mut file = fs::File::open(path).map_err(|error| error.to_string())?;
    stream_requests_elevation(&mut file)
}

#[cfg(target_os = "windows")]
pub(super) fn stream_requests_elevation(reader: &mut impl Read) -> Result<bool, String> {
    const BUFFER_SIZE: usize = 8192;
    let patterns = [
        b"requireAdministrator".as_slice(),
        b"highestAvailable".as_slice(),
        b"r\0e\0q\0u\0i\0r\0e\0A\0d\0m\0i\0n\0i\0s\0t\0r\0a\0t\0o\0r\0".as_slice(),
        b"h\0i\0g\0h\0e\0s\0t\0A\0v\0a\0i\0l\0a\0b\0l\0e\0".as_slice(),
    ];
    let overlap = patterns
        .iter()
        .map(|pattern| pattern.len())
        .max()
        .unwrap_or(0);
    let mut buffer = vec![0u8; BUFFER_SIZE + overlap];
    let mut carried = 0usize;

    loop {
        let read = reader
            .read(&mut buffer[carried..])
            .map_err(|error| error.to_string())?;
        if read == 0 {
            return Ok(false);
        }

        let total = carried + read;
        for pattern in patterns {
            if buffer[..total]
                .windows(pattern.len())
                .any(|window| window == pattern)
            {
                return Ok(true);
            }
        }

        carried = overlap.min(total);
        if carried > 0 {
            buffer.copy_within(total - carried..total, 0);
        }
    }
}

#[cfg(not(target_os = "windows"))]
pub(super) fn file_requests_elevation(_path: &Path) -> Result<bool, String> {
    Ok(false)
}
