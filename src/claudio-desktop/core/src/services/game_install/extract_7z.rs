use super::*;
use sevenz_rust2::{Archive, Error as SevenZipError, decompress_with_extract_fn};

const CANCELLED_MESSAGE: &str = "Install cancelled.";

pub(super) async fn extract_7z_blocking(
    source: &Path,
    destination: &Path,
    cancel_token: &Arc<AtomicBool>,
) -> Result<(), String> {
    let source = source.to_path_buf();
    let destination = destination.to_path_buf();
    let cancel_token = cancel_token.clone();
    tokio::task::spawn_blocking(move || extract_7z(&source, &destination, &cancel_token, |_| {}))
        .await
        .map_err(|err| format!("7z extraction task failed: {err}"))?
}

pub(super) fn extract_7z<F>(
    source: &Path,
    destination: &Path,
    cancel_token: &Arc<AtomicBool>,
    mut progress: F,
) -> Result<(), String>
where
    F: FnMut(f64),
{
    fs::create_dir_all(destination).map_err(|err| {
        log_io_failure("create 7z extraction destination", destination, &err);
        format_install_io_error("create the 7z extraction destination", destination, &err)
    })?;
    let total_bytes: u64 = Archive::open(source)
        .map_err(|err| describe_7z_failure("read 7z headers", source, &err))?
        .files
        .iter()
        .map(|entry| entry.size())
        .sum();
    let file = fs::File::open(source).map_err(|err| {
        log_io_failure("open 7z archive", source, &err);
        format_install_io_error("open the 7z archive", source, &err)
    })?;

    let mut written_bytes = 0_u64;
    let mut last_report = std::time::Instant::now();
    let result = decompress_with_extract_fn(file, destination, |entry, reader, path| {
        if entry.is_directory() {
            create_dir(path)?;
            return Ok(true);
        }
        if let Some(parent) = path.parent() {
            create_dir(parent)?;
        }

        let mut out = fs::File::create(path).map_err(|err| {
            log_io_failure("create extracted file", path, &err);
            install_error(format_install_io_error(
                "create the extracted file",
                path,
                &err,
            ))
        })?;
        let mut buf = vec![0u8; 64 * 1024];
        loop {
            if cancel_token.load(Ordering::Relaxed) {
                return Err(install_error(CANCELLED_MESSAGE.to_string()));
            }
            let n = reader.read(&mut buf)?;
            if n == 0 {
                break;
            }
            io::Write::write_all(&mut out, &buf[..n]).map_err(|err| {
                log_io_failure("write extracted file", path, &err);
                install_error(format_install_io_error(
                    "write the extracted file",
                    path,
                    &err,
                ))
            })?;
            written_bytes += n as u64;

            let now = std::time::Instant::now();
            if total_bytes > 0 && now.duration_since(last_report).as_millis() > 100 {
                progress(written_bytes as f64 / total_bytes as f64);
                last_report = now;
            }
        }
        Ok(true)
    });

    match result {
        Ok(()) => {
            progress(1.0);
            Ok(())
        }
        Err(SevenZipError::Other(message)) if message == CANCELLED_MESSAGE => {
            Err(CANCELLED_MESSAGE.to_string())
        }
        Err(err) => Err(describe_7z_failure("extract 7z archive", source, &err)),
    }
}

fn create_dir(path: &Path) -> Result<(), SevenZipError> {
    fs::create_dir_all(path).map_err(|err| {
        log_io_failure("create extracted directory", path, &err);
        install_error(format_install_io_error(
            "create the extracted directory",
            path,
            &err,
        ))
    })
}

fn install_error(message: String) -> SevenZipError {
    SevenZipError::Other(message.into())
}

fn describe_7z_failure(operation: &str, source: &Path, err: &SevenZipError) -> String {
    log::error!(
        "[installer] {operation} failed for {}: {err}",
        source.display()
    );
    format!("Failed to {operation} {}: {err}", source.display())
}
