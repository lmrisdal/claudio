use super::*;

#[test]
fn cleanup_failed_installer_state_removes_target_and_staging_dirs() {
    let root = unique_test_dir("cleanup");
    let target_dir = root.join("Hades II");
    let staging_dir = root.join("Hades II.installing");

    fs::create_dir_all(&target_dir).expect("target dir should be created");
    fs::create_dir_all(&staging_dir).expect("staging dir should be created");
    fs::write(target_dir.join("game.exe"), b"binary").expect("target file should be created");
    fs::write(staging_dir.join("setup.exe"), b"installer").expect("staging file should be created");

    cleanup_failed_installer_state(&target_dir, &staging_dir)
        .expect("cleanup should remove target and staging dirs");

    assert!(!target_dir.exists());
    assert!(!staging_dir.exists());
    let _ = fs::remove_dir_all(root);
}

#[test]
fn visible_entries_skips_macos_metadata() {
    let root = unique_test_dir("visible-entries");
    fs::create_dir_all(root.join("Game")).expect("game dir should be created");
    fs::create_dir_all(root.join("__MACOSX")).expect("metadata dir should be created");
    fs::write(root.join(".DS_Store"), b"meta").expect("ds_store should be created");

    let entries = visible_entries(&root).expect("entries should load");
    assert_eq!(entries, vec![root.join("Game")]);

    let _ = fs::remove_dir_all(root);
}

#[test]
fn normalize_into_final_dir_flattens_single_extracted_root() {
    let root = unique_test_dir("normalize");
    let staging_root = root.join("extracting");
    let nested_root = staging_root.join("Game");
    let final_dir = root.join("final");

    fs::create_dir_all(&nested_root).expect("nested root should be created");
    fs::write(nested_root.join("game.exe"), b"binary").expect("game file should exist");

    normalize_into_final_dir(&staging_root, &final_dir)
        .expect("single extracted root should be flattened");

    assert!(final_dir.join("game.exe").exists());
    assert!(!staging_root.exists());
    let _ = fs::remove_dir_all(root);
}

#[test]
fn move_visible_entries_into_dir_moves_entries_and_flattens_single_root() {
    let root = unique_test_dir("move-visible-entries");
    let source_root = root.join("extract");
    let nested_root = source_root.join("Game");
    let destination = root.join("target");

    fs::create_dir_all(&nested_root).expect("nested root should be created");
    fs::create_dir_all(&destination).expect("destination should be created");
    fs::write(nested_root.join("game.exe"), b"binary").expect("game file should be written");

    let moved =
        move_visible_entries_into_dir(&source_root, &destination).expect("entries should move");

    assert_eq!(moved, vec![destination.join("game.exe")]);
    assert!(destination.join("game.exe").exists());
    assert!(!nested_root.join("game.exe").exists());
    let _ = fs::remove_dir_all(root);
}

#[test]
fn clear_existing_path_removes_existing_file() {
    let root = unique_test_dir("clear-existing-path");
    let file = root.join("existing.bin");

    fs::create_dir_all(&root).expect("root should be created");
    fs::write(&file, b"binary").expect("file should be written");

    clear_existing_path(&file).expect("existing file should be removed");

    assert!(!file.exists());
    let _ = fs::remove_dir_all(root);
}

#[test]
fn validate_install_target_path_allows_writable_parent() {
    let root = unique_test_dir("validate-install-target");
    let target = root.join("Game");

    fs::create_dir_all(&root).expect("root directory should be created");

    validate_install_target_path(&target).expect("writable target should validate");

    assert!(
        !target.exists(),
        "validation should not create the target directory"
    );
    assert!(
        fs::read_dir(&root)
            .expect("validation root should still be readable")
            .next()
            .is_none(),
        "validation should clean up probe files"
    );

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn format_install_io_error_maps_access_denied_to_friendly_message() {
    let error = io::Error::from_raw_os_error(5);
    let message =
        format_install_io_error("create the install folder", Path::new("D:\\Games"), &error);

    assert!(message.contains("Claudio couldn't write to"));
    assert!(message.contains("run Claudio as administrator"));
}

#[test]
fn format_install_io_error_maps_elevation_required_to_friendly_message() {
    let error = io::Error::from_raw_os_error(740);
    let message =
        format_install_io_error("create the install folder", Path::new("D:\\Games"), &error);

    assert!(message.contains("requires administrator privileges"));
    assert!(message.contains("choose a different install folder"));
}

#[test]
fn format_install_io_error_pair_maps_access_denied_to_friendly_message() {
    let error = io::Error::from_raw_os_error(5);
    let source =
        Path::new("C:\\Users\\Lars\\AppData\\Local\\Claudio\\downloads\\Hades II-365\\files");
    let destination = Path::new(
        "C:\\Users\\Lars\\AppData\\Local\\Claudio\\downloads\\Hades II-365\\installer-staging",
    );
    let message = format_install_io_error_pair(
        "copy package into the extraction destination",
        source,
        destination,
        &error,
    );

    assert!(message.contains("couldn't move files from"));
    assert!(message.contains(source.to_string_lossy().as_ref()));
    assert!(message.contains(destination.to_string_lossy().as_ref()));
}

#[test]
fn sanitize_segment_replaces_invalid_path_characters() {
    assert_eq!(
        sanitize_segment(" Halo: Reach / GOTY?* "),
        "Halo_ Reach _ GOTY__"
    );
    assert_eq!(sanitize_segment("   "), "game");
}

#[test]
fn infer_filename_prefers_utf8_content_disposition_name() {
    let mut headers = HeaderMap::new();
    headers.insert(
        CONTENT_DISPOSITION,
        HeaderValue::from_static(
            "attachment; filename*=UTF-8''Game%20Pack.zip; filename=ignored.zip",
        ),
    );

    assert_eq!(infer_filename(&headers).as_deref(), Some("Game%20Pack.zip"));
}

#[test]
fn build_headers_ignores_forbidden_custom_headers_and_sets_bearer_token() {
    let headers = build_headers(
        &HashMap::from([
            ("X-Test".to_string(), "ok".to_string()),
            ("Authorization".to_string(), "blocked".to_string()),
        ]),
        Some("token-123"),
    )
    .expect("headers should build");

    assert_eq!(
        headers.get("x-test").and_then(|v| v.to_str().ok()),
        Some("ok")
    );
    assert_eq!(
        headers.get(AUTHORIZATION).and_then(|v| v.to_str().ok()),
        Some("Bearer token-123")
    );
    assert_eq!(headers.len(), 2);
}

#[test]
fn build_install_dir_uses_sanitized_title() {
    let game = RemoteGame {
        id: 1,
        title: "Max Payne: GOTY".to_string(),
        platform: "windows".to_string(),
        install_type: InstallType::Portable,
        installer_exe: None,
        game_exe: None,
        install_path: None,
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
    };

    let path = build_install_dir(Path::new("/games"), &game);

    assert_eq!(path, PathBuf::from("/games/Max Payne_ GOTY"));
}

#[test]
fn install_download_root_uses_configured_download_root_and_sanitized_title() {
    let game = RemoteGame {
        id: 9,
        title: "Max Payne: GOTY".to_string(),
        platform: "windows".to_string(),
        install_type: InstallType::Portable,
        installer_exe: None,
        game_exe: None,
        install_path: None,
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
    };
    let path = install_download_root(Path::new("/games/downloads"), &game);

    assert_eq!(path, PathBuf::from("/games/downloads/Max Payne_ GOTY-9"));
}
