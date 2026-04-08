use super::*;
use crate::auth::{StoredTokens, TestAuthGuard, store_tokens};
use crate::test_support::{TestResponse, TestServer};
use flate2::{Compression, write::GzEncoder};
use reqwest::header::HeaderValue;
use std::sync::Arc;
use std::sync::Arc as StdArc;
use std::sync::atomic::{AtomicBool, AtomicUsize};
use zip::write::SimpleFileOptions;

mod core;
mod download;
mod download_fallbacks;
#[cfg(feature = "integration-tests")]
mod download_progress;
mod extract;
mod installer;
#[cfg(feature = "integration-tests")]
mod portable;

fn unique_test_dir(name: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "claudio-game-install-{name}-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after epoch")
            .as_nanos()
    ))
}

fn installed_game(remote_game_id: i32, title: &str, install_path: &Path) -> InstalledGame {
    InstalledGame {
        remote_game_id,
        title: title.to_string(),
        platform: "windows".to_string(),
        install_type: InstallType::Portable,
        install_path: install_path.to_string_lossy().into_owned(),
        game_exe: None,
        installed_at: "1".to_string(),
        summary: None,
        genre: None,
        release_year: None,
        cover_url: None,
        hero_url: None,
        developer: None,
        publisher: None,
        game_mode: None,
        series: None,
        franchise: None,
        game_engine: None,
    }
}

fn download_settings(server_url: &str) -> settings::DesktopSettings {
    settings::DesktopSettings {
        server_url: Some(server_url.to_string()),
        allow_insecure_auth_storage: true,
        ..settings::DesktopSettings::default()
    }
}

fn write_zip_archive(path: &Path, entries: &[(&str, &[u8])]) {
    let file = fs::File::create(path).expect("zip file should be created");
    let mut archive = zip::ZipWriter::new(file);
    let options = SimpleFileOptions::default();

    for (name, contents) in entries {
        archive
            .start_file(name, options)
            .expect("zip entry should start");
        std::io::Write::write_all(&mut archive, contents).expect("zip entry should be written");
    }

    archive.finish().expect("zip archive should finish");
}

#[cfg(feature = "integration-tests")]
fn tar_gz_bytes(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut buffer = Vec::new();
    {
        let encoder = GzEncoder::new(&mut buffer, Compression::default());
        let mut archive = tar::Builder::new(encoder);
        for (name, contents) in entries {
            let mut header = tar::Header::new_gnu();
            header.set_size(contents.len() as u64);
            header.set_mode(0o644);
            header.set_cksum();
            archive
                .append_data(&mut header, name, std::io::Cursor::new(*contents))
                .expect("tar entry should be written");
        }
        archive.finish().expect("tar archive should finish");
    }
    buffer
}

fn write_tar_gz_archive(path: &Path, entries: &[(&str, &[u8])]) {
    let file = fs::File::create(path).expect("tar.gz file should be created");
    let encoder = GzEncoder::new(file, Compression::default());
    let mut archive = tar::Builder::new(encoder);

    for (name, contents) in entries {
        let mut header = tar::Header::new_gnu();
        header.set_size(contents.len() as u64);
        header.set_mode(0o644);
        header.set_cksum();
        archive
            .append_data(&mut header, name, std::io::Cursor::new(*contents))
            .expect("tar entry should be written");
    }

    archive.finish().expect("tar archive should finish");
}
