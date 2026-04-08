use super::*;

pub(super) fn run_innoextract(installer: &Path, target_dir: &Path) -> Result<(), String> {
    log::info!("Running innoextract for {}", installer.display());
    let bin = ensure_innoextract()?;
    log::info!("Using innoextract binary: {}", bin.display());

    run_innoextract_with_binary(&bin, installer, target_dir)
}

pub(super) fn run_innoextract_with_binary(
    bin: &Path,
    installer: &Path,
    target_dir: &Path,
) -> Result<(), String> {
    let status = std::process::Command::new(&bin)
        .arg("-d")
        .arg(target_dir)
        .arg("--gog")
        .arg(installer)
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status()
        .map_err(|err| format!("Failed to run innoextract: {err}"))?;

    if !status.success() {
        return Err(format!("innoextract exited with status {status}."));
    }
    log::info!("innoextract succeeded");

    let app_dir = target_dir.join("app");
    if app_dir.is_dir() {
        for entry in fs::read_dir(&app_dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let dest = target_dir.join(entry.file_name());
            let src = entry.path();
            fs::rename(&src, &dest).map_err(|error| {
                format_install_io_error_pair("move extracted files", &src, &dest, &error)
            })?;
        }
        let _ = fs::remove_dir_all(&app_dir);
    }

    let tmp_dir = target_dir.join("tmp");
    if tmp_dir.is_dir() {
        let _ = fs::remove_dir_all(&tmp_dir);
    }

    Ok(())
}

pub(super) fn ensure_innoextract() -> Result<PathBuf, String> {
    if std::process::Command::new("innoextract")
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
    {
        return Ok(PathBuf::from("innoextract"));
    }

    let cached = innoextract_cache_path();
    if cached.exists() {
        log::info!("Using cached innoextract: {}", cached.display());
        return Ok(cached);
    }

    log::info!("innoextract not found, downloading from GitHub releases");
    download_innoextract(&cached)?;
    log::info!("innoextract downloaded to {}", cached.display());
    Ok(cached)
}

pub(super) fn download_innoextract(target: &Path) -> Result<(), String> {
    let client = reqwest::blocking::Client::builder()
        .user_agent("Claudio/1.0")
        .build()
        .map_err(|e| e.to_string())?;

    let release: serde_json::Value = client
        .get("https://api.github.com/repos/dscharrer/innoextract/releases/latest")
        .send()
        .map_err(|e| format!("Failed to fetch innoextract release info: {e}"))?
        .json()
        .map_err(|e| e.to_string())?;

    let download_url = release["assets"]
        .as_array()
        .ok_or("No assets found in innoextract release")?
        .iter()
        .find(|asset| {
            asset["name"]
                .as_str()
                .map(|name| name.contains("windows") && name.ends_with(".zip"))
                .unwrap_or(false)
        })
        .and_then(|asset| asset["browser_download_url"].as_str())
        .ok_or("Could not find Windows innoextract release asset")?
        .to_string();

    let bytes = client
        .get(&download_url)
        .send()
        .map_err(|e| format!("Failed to download innoextract: {e}"))?
        .bytes()
        .map_err(|e| e.to_string())?;

    let cursor = std::io::Cursor::new(bytes.as_ref());
    let mut archive = ZipArchive::new(cursor).map_err(|e| e.to_string())?;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        if entry.name().ends_with("innoextract.exe") {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut out = fs::File::create(target).map_err(|e| e.to_string())?;
            io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
            return Ok(());
        }
    }

    Err("innoextract.exe not found in downloaded release zip".to_string())
}

pub(super) fn innoextract_cache_path() -> PathBuf {
    settings::tools_dir().join("innoextract.exe")
}
