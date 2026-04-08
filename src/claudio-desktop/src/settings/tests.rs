use super::*;
use std::time::{SystemTime, UNIX_EPOCH};

fn unique_test_dir(name: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "claudio-settings-{name}-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after epoch")
            .as_nanos()
    ))
}

#[test]
fn invalid_log_level_defaults_to_info() {
    let mut settings = DesktopSettings {
        log_level: "verbose".to_string(),
        ..DesktopSettings::default()
    };

    sanitize_settings(&mut settings);

    assert_eq!(settings.log_level, "info");
    assert_eq!(log_level_filter(&settings), log::LevelFilter::Info);
}

#[test]
fn warning_alias_normalizes_to_warn() {
    let mut settings = DesktopSettings {
        log_level: " WARNING ".to_string(),
        ..DesktopSettings::default()
    };

    sanitize_settings(&mut settings);

    assert_eq!(settings.log_level, "warn");
    assert_eq!(log_level_filter(&settings), log::LevelFilter::Warn);
}

#[test]
fn save_and_load_use_overridden_data_dir() {
    with_test_data_dir(unique_test_dir("save-load"), || {
        let settings = DesktopSettings {
            server_url: Some("https://example.com".to_string()),
            default_install_path: Some("/tmp/games".to_string()),
            default_download_path: Some("/tmp/downloads".to_string()),
            custom_headers: HashMap::from([
                ("X-Test".to_string(), "ok".to_string()),
                ("Authorization".to_string(), "blocked".to_string()),
            ]),
            ..DesktopSettings::default()
        };

        save(&settings).expect("settings should be saved");
        let loaded = load();

        assert_eq!(loaded.server_url.as_deref(), Some("https://example.com"));
        assert_eq!(loaded.default_install_path.as_deref(), Some("/tmp/games"));
        assert_eq!(
            loaded.default_download_path.as_deref(),
            Some("/tmp/downloads")
        );
        assert_eq!(
            loaded.custom_headers.get("X-Test").map(String::as_str),
            Some("ok")
        );
        assert!(!loaded.custom_headers.contains_key("Authorization"));
        assert!(settings_path().exists());
    });
}

#[test]
fn tools_dir_is_created_under_overridden_data_dir() {
    with_test_data_dir(unique_test_dir("subdirs"), || {
        let tools = tools_dir();

        assert!(tools.ends_with("tools"));
        assert!(tools.exists());
    });
}

#[test]
fn default_install_root_prefers_configured_path() {
    let settings = DesktopSettings {
        default_install_path: Some("/tmp/claudio-games".to_string()),
        ..DesktopSettings::default()
    };

    assert_eq!(
        default_install_root(&settings),
        PathBuf::from("/tmp/claudio-games")
    );
}

#[test]
fn default_download_root_prefers_configured_path() {
    let settings = DesktopSettings {
        default_download_path: Some("/tmp/claudio-downloads".to_string()),
        ..DesktopSettings::default()
    };

    assert_eq!(
        default_download_root(&settings),
        PathBuf::from("/tmp/claudio-downloads")
    );
}

#[test]
fn default_download_root_falls_back_to_app_data_downloads_subdir() {
    let settings = DesktopSettings {
        default_install_path: Some("/tmp/claudio-games".to_string()),
        default_download_path: None,
        ..DesktopSettings::default()
    };

    assert_eq!(
        default_download_root(&settings),
        data_dir().join("downloads")
    );
}

#[test]
fn sanitize_custom_headers_removes_forbidden_entries() {
    let sanitized = sanitize_custom_headers(&HashMap::from([
        ("X-Test".to_string(), "ok".to_string()),
        ("Authorization".to_string(), "blocked".to_string()),
        ("Proxy-Authorization".to_string(), "blocked".to_string()),
    ]));

    assert_eq!(sanitized.get("X-Test").map(String::as_str), Some("ok"));
    assert!(!sanitized.contains_key("Authorization"));
    assert!(!sanitized.contains_key("Proxy-Authorization"));
}
