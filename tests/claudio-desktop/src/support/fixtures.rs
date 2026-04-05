use claudio_desktop::integration_test_api::{
    DesktopSettings, DownloadPackageInput, InstallType, InstalledGame, RemoteGame,
};

pub fn desktop_settings(server_url: &str) -> DesktopSettings {
    DesktopSettings {
        server_url: Some(server_url.to_string()),
        allow_insecure_auth_storage: true,
        ..DesktopSettings::default()
    }
}

pub fn portable_remote_game(id: i32, title: &str, install_path: String) -> RemoteGame {
    RemoteGame {
        id,
        title: title.to_string(),
        platform: std::env::consts::OS.to_string(),
        install_type: InstallType::Portable,
        installer_exe: None,
        game_exe: None,
        install_path: Some(install_path),
        desktop_shortcut: None,
        run_as_administrator: None,
        force_interactive: None,
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

pub fn download_input(
    id: i32,
    title: &str,
    target_dir: String,
    extract: bool,
) -> DownloadPackageInput {
    DownloadPackageInput {
        id,
        title: title.to_string(),
        target_dir,
        extract,
    }
}

pub fn installed_game(
    remote_game_id: i32,
    title: &str,
    install_path: String,
    game_exe: Option<String>,
) -> InstalledGame {
    InstalledGame {
        remote_game_id,
        title: title.to_string(),
        platform: std::env::consts::OS.to_string(),
        install_type: InstallType::Portable,
        install_path,
        game_exe,
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
