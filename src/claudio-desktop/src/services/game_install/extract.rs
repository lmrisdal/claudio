use super::*;

pub(super) fn infer_filename(headers: &HeaderMap) -> Option<String> {
    let disposition = headers.get(CONTENT_DISPOSITION)?.to_str().ok()?;

    disposition.split(';').map(str::trim).find_map(|part| {
        if let Some(value) = part.strip_prefix("filename*=UTF-8''") {
            return Some(value.to_string());
        }

        part.strip_prefix("filename=")
            .map(|value| value.trim_matches('"').to_string())
    })
}

pub(super) async fn extract_archive_subprocess<F>(
    source: &Path,
    destination: &Path,
    cancel_token: &Arc<AtomicBool>,
    mut on_progress: F,
) -> Result<(), String>
where
    F: FnMut(Option<f64>),
{
    fs::create_dir_all(destination).map_err(|err| {
        log_io_failure("create extraction destination", destination, &err);
        format_install_io_error("create the extraction destination", destination, &err)
    })?;
    let lower = source.to_string_lossy().to_lowercase();

    let mut command = if lower.ends_with(".zip") {
        #[cfg(target_os = "macos")]
        {
            let mut c = tokio::process::Command::new("ditto");
            c.arg("-x").arg("-k").arg(source).arg(destination);
            c
        }
        #[cfg(not(target_os = "macos"))]
        {
            let mut c = tokio::process::Command::new("tar");
            c.arg("-xf").arg(source).arg("-C").arg(destination);
            c
        }
    } else if lower.ends_with(".tar.gz") || lower.ends_with(".tgz") || lower.ends_with(".tar") {
        let mut c = tokio::process::Command::new("tar");
        c.arg("-xf").arg(source).arg("-C").arg(destination);
        c
    } else {
        let target = destination.join(
            source
                .file_name()
                .ok_or_else(|| "Downloaded package had no file name.".to_string())?,
        );
        if cancel_token.load(Ordering::Relaxed) {
            return Err("Install cancelled.".to_string());
        }
        fs::copy(source, target.as_path()).map_err(|err| {
            log_io_failure_pair(
                "copy package into extraction destination",
                source,
                &target,
                &err,
            );
            format_install_io_error_pair(
                "copy package into the extraction destination",
                source,
                &target,
                &err,
            )
        })?;
        return Ok(());
    };

    command.stdout(Stdio::null()).stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|err| format!("Failed to start extractor: {err}"))?;

    loop {
        if cancel_token.load(Ordering::Relaxed) {
            let _ = child.start_kill();
            let _ = child.wait().await;
            return Err("Install cancelled.".to_string());
        }
        tokio::select! {
            exit = child.wait() => {
                let status = exit.map_err(|err| err.to_string())?;
                if status.success() {
                    on_progress(Some(1.0));
                    return Ok(());
                }
                if cancel_token.load(Ordering::Relaxed) {
                    return Err("Install cancelled.".to_string());
                }
                return Err(format!("Extractor exited with status {status}"));
            }
            _ = tokio::time::sleep(std::time::Duration::from_millis(400)) => {
                on_progress(None);
            }
        }
    }
}

pub(super) fn extract_archive_or_copy<F>(
    source: &Path,
    destination: &Path,
    cancel_token: &Arc<AtomicBool>,
    progress: F,
) -> Result<(), String>
where
    F: FnMut(f64),
{
    let lower = source.to_string_lossy().to_lowercase();

    if lower.ends_with(".zip") {
        extract_zip(source, destination, cancel_token, progress)
    } else if lower.ends_with(".tar.gz") || lower.ends_with(".tgz") {
        extract_targz(source, destination, cancel_token, progress)
    } else if lower.ends_with(".tar") {
        extract_tar(source, destination, cancel_token, progress)
    } else {
        if cancel_token.load(Ordering::Relaxed) {
            return Err("Install cancelled.".to_string());
        }

        fs::create_dir_all(destination).map_err(|err| {
            log_io_failure("create extraction destination", destination, &err);
            format_install_io_error("create the extraction destination", destination, &err)
        })?;

        if source.is_dir() {
            copy_dir_contents(source, destination)?;
        } else {
            let target = destination.join(
                source
                    .file_name()
                    .ok_or_else(|| "Downloaded package had no file name.".to_string())?,
            );
            fs::copy(source, &target).map_err(|err| {
                log_io_failure_pair(
                    "copy package into extraction destination",
                    source,
                    &target,
                    &err,
                );
                format_install_io_error_pair(
                    "copy package into the extraction destination",
                    source,
                    &target,
                    &err,
                )
            })?;
        }

        let mut progress = progress;
        progress(1.0);
        Ok(())
    }
}

fn extract_zip<F>(
    source: &Path,
    destination: &Path,
    cancel_token: &Arc<AtomicBool>,
    mut progress: F,
) -> Result<(), String>
where
    F: FnMut(f64),
{
    fs::create_dir_all(destination).map_err(|err| {
        log_io_failure("create zip extraction destination", destination, &err);
        format_install_io_error("create the zip extraction destination", destination, &err)
    })?;
    let file = fs::File::open(source).map_err(|err| {
        log_io_failure("open zip archive", source, &err);
        format_install_io_error("open the zip archive", source, &err)
    })?;
    let mut archive = ZipArchive::new(file).map_err(|err| {
        log::error!(
            "[installer] initialize zip archive failed for {}: {}",
            source.display(),
            err
        );
        format!("Failed to open zip archive {}: {err}", source.display())
    })?;

    let total = archive.len();
    if total == 0 {
        progress(1.0);
        return Ok(());
    }

    let mut last_report = std::time::Instant::now();
    for index in 0..total {
        if cancel_token.load(Ordering::Relaxed) {
            return Err("Install cancelled.".to_string());
        }
        let mut entry = archive.by_index(index).map_err(|err| {
            log::error!(
                "[installer] read zip entry {index} failed for {}: {}",
                source.display(),
                err
            );
            format!(
                "Failed to read zip entry {index} from {}: {err}",
                source.display()
            )
        })?;
        let Some(path) = entry.enclosed_name().map(|path| destination.join(path)) else {
            continue;
        };

        if entry.is_dir() {
            fs::create_dir_all(&path).map_err(|err| {
                log_io_failure("create extracted directory", &path, &err);
                format_install_io_error("create the extracted directory", &path, &err)
            })?;
            continue;
        }

        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|err| {
                log_io_failure("create parent directory for extracted file", parent, &err);
                format_install_io_error("create the extracted file parent directory", parent, &err)
            })?;
        }

        let mut out = fs::File::create(&path).map_err(|err| {
            log_io_failure("create extracted file", &path, &err);
            format_install_io_error("create the extracted file", &path, &err)
        })?;
        let mut buf = [0u8; 64 * 1024];
        loop {
            if cancel_token.load(Ordering::Relaxed) {
                return Err("Install cancelled.".to_string());
            }
            let n = io::Read::read(&mut entry, &mut buf).map_err(|err| {
                log::error!(
                    "[installer] read zip entry data failed from {} into {}: {} (raw_os_error={:?})",
                    source.display(),
                    path.display(),
                    err,
                    err.raw_os_error()
                );
                format!(
                    "Failed to read extracted file data from {} into {}: {err}",
                    source.display(),
                    path.display()
                )
            })?;
            if n == 0 {
                break;
            }
            io::Write::write_all(&mut out, &buf[..n]).map_err(|err| {
                log_io_failure("write extracted file", &path, &err);
                format_install_io_error("write the extracted file", &path, &err)
            })?;
        }

        let now = std::time::Instant::now();
        if now.duration_since(last_report).as_millis() > 100 {
            progress(index as f64 / total as f64);
            last_report = now;
        }
    }

    progress(1.0);
    Ok(())
}

struct ProgressReader<'a, R, F> {
    inner: R,
    callback: F,
    bytes_read: u64,
    total_bytes: u64,
    last_reported: std::time::Instant,
    cancel_token: &'a Arc<AtomicBool>,
}

impl<R: io::Read, F: FnMut(f64)> io::Read for ProgressReader<'_, R, F> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if self.cancel_token.load(Ordering::Relaxed) {
            return Err(io::Error::new(io::ErrorKind::Interrupted, "cancelled"));
        }
        let n = self.inner.read(buf)?;
        self.bytes_read += n as u64;
        let now = std::time::Instant::now();
        if now.duration_since(self.last_reported).as_millis() > 100 {
            if self.total_bytes > 0 {
                (self.callback)(self.bytes_read as f64 / self.total_bytes as f64);
            }
            self.last_reported = now;
        }
        Ok(n)
    }
}

fn extract_tar<F>(
    source: &Path,
    destination: &Path,
    cancel_token: &Arc<AtomicBool>,
    mut progress: F,
) -> Result<(), String>
where
    F: FnMut(f64),
{
    fs::create_dir_all(destination).map_err(|err| {
        log_io_failure("create tar extraction destination", destination, &err);
        format_install_io_error("create the tar extraction destination", destination, &err)
    })?;
    let file = fs::File::open(source).map_err(|err| {
        log_io_failure("open tar archive", source, &err);
        format_install_io_error("open the tar archive", source, &err)
    })?;
    let total_bytes = file.metadata().map(|m| m.len()).unwrap_or(0);

    let reader = ProgressReader {
        inner: file,
        callback: &mut progress,
        bytes_read: 0,
        total_bytes,
        last_reported: std::time::Instant::now(),
        cancel_token,
    };

    let mut archive = Archive::new(reader);
    archive.unpack(destination).map_err(|err| {
        if cancel_token.load(Ordering::Relaxed) {
            "Install cancelled.".to_string()
        } else {
            log::error!(
                "[installer] unpack tar archive failed for {} into {}: {}",
                source.display(),
                destination.display(),
                err
            );
            format_install_io_error_pair("unpack the tar archive", source, destination, &err)
        }
    })?;
    progress(1.0);
    Ok(())
}

fn extract_targz<F>(
    source: &Path,
    destination: &Path,
    cancel_token: &Arc<AtomicBool>,
    mut progress: F,
) -> Result<(), String>
where
    F: FnMut(f64),
{
    fs::create_dir_all(destination).map_err(|err| {
        log_io_failure("create tar.gz extraction destination", destination, &err);
        format_install_io_error(
            "create the tar.gz extraction destination",
            destination,
            &err,
        )
    })?;
    let file = fs::File::open(source).map_err(|err| {
        log_io_failure("open tar.gz archive", source, &err);
        format_install_io_error("open the tar.gz archive", source, &err)
    })?;
    let total_bytes = file.metadata().map(|m| m.len()).unwrap_or(0);

    let reader = ProgressReader {
        inner: file,
        callback: &mut progress,
        bytes_read: 0,
        total_bytes,
        last_reported: std::time::Instant::now(),
        cancel_token,
    };

    let decoder = GzDecoder::new(reader);
    let mut archive = Archive::new(decoder);
    archive.unpack(destination).map_err(|err| {
        if cancel_token.load(Ordering::Relaxed) {
            "Install cancelled.".to_string()
        } else {
            log::error!(
                "[installer] unpack tar.gz archive failed for {} into {}: {}",
                source.display(),
                destination.display(),
                err
            );
            format_install_io_error_pair("unpack the tar.gz archive", source, destination, &err)
        }
    })?;
    progress(1.0);
    Ok(())
}
