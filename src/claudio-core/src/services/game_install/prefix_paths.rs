use std::path::{Path, PathBuf};

pub(super) fn prefix_install_directory(title: &str) -> String {
    format!(r"C:\Games\{}", game_directory_name(title))
}

pub(super) fn prefix_payload_directory(prefix: &Path, title: &str) -> PathBuf {
    prefix
        .join("pfx")
        .join("drive_c")
        .join("Games")
        .join(game_directory_name(title))
}

fn game_directory_name(title: &str) -> String {
    let name = super::sanitize_segment(title);
    let name = name.trim_matches('.').trim();
    if name.is_empty() {
        "game".to_string()
    } else {
        name.to_string()
    }
}
