use super::*;

#[test]
fn extract_archive_or_copy_extracts_zip_archives() {
    let root = unique_test_dir("extract-zip");
    let archive_path = root.join("game.zip");
    let destination = root.join("out");
    fs::create_dir_all(&root).expect("root should be created");
    write_zip_archive(&archive_path, &[("Game/game.exe", b"binary")]);

    extract_archive_or_copy(
        &archive_path,
        &destination,
        &Arc::new(AtomicBool::new(false)),
        |_| {},
    )
    .expect("zip archive should extract");

    assert!(destination.join("Game").join("game.exe").exists());
    let _ = fs::remove_dir_all(root);
}

const SEVEN_ZIP_FIXTURE_BASE64: &str = "N3q8ryccAARQnH/DpQAAAAAAAAAiAAAAAAAAAKzMYEIBABNoZWxsb01aLWdhbWVNWi1zZXR1cAAAAIEzB64Pz4CuDA/r6py/Nj3+cG8h8glczghOgiqan2/W4uIIwjB6BunJYMdywoHLFMAJFsUZKbQdKQAROCpxhOfxQl1SQWKndmqWLZOQFdn0dKjmqbPvu1nx8j8gmAolifguMb5gU4STpqAvyaAQOGBgTqQHgm7aWjGrjWX0N2tR6wr1u1CXKAAAAAAXBhgBCYCNAAcLAQABIwMBAQVdABAAAAyBCgoBPFio1QAA";

fn write_7z_fixture(path: &Path) {
    let bytes = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        SEVEN_ZIP_FIXTURE_BASE64,
    )
    .expect("fixture should decode");
    fs::write(path, bytes).expect("fixture should be written");
}

#[test]
fn extract_archive_or_copy_extracts_7z_archives() {
    let root = unique_test_dir("extract-7z");
    let archive_path = root.join("game.7z");
    let destination = root.join("out");
    fs::create_dir_all(&root).expect("root should be created");
    write_7z_fixture(&archive_path);
    let mut last_progress = 0.0;

    extract_archive_or_copy(
        &archive_path,
        &destination,
        &Arc::new(AtomicBool::new(false)),
        |value| last_progress = value,
    )
    .expect("7z archive should extract");

    assert_eq!(
        fs::read(destination.join("Game").join("game.exe")).expect("game.exe should exist"),
        b"MZ-game"
    );
    assert_eq!(
        fs::read(destination.join("Game").join("data").join("readme.txt"))
            .expect("readme should exist"),
        b"hello"
    );
    assert_eq!(last_progress, 1.0);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn extract_archive_or_copy_stops_7z_extraction_when_cancelled() {
    let root = unique_test_dir("extract-7z-cancel");
    let archive_path = root.join("game.7z");
    let destination = root.join("out");
    fs::create_dir_all(&root).expect("root should be created");
    write_7z_fixture(&archive_path);

    let error = extract_archive_or_copy(
        &archive_path,
        &destination,
        &Arc::new(AtomicBool::new(true)),
        |_| {},
    )
    .expect_err("cancelled extraction should fail");

    assert_eq!(error, "Install cancelled.");
    let _ = fs::remove_dir_all(root);
}

#[test]
fn extract_archive_or_copy_reports_corrupt_7z_archives() {
    let root = unique_test_dir("extract-7z-corrupt");
    let archive_path = root.join("game.7z");
    fs::create_dir_all(&root).expect("root should be created");
    fs::write(&archive_path, b"not a 7z archive").expect("fixture should be written");

    let error = extract_archive_or_copy(
        &archive_path,
        &root.join("out"),
        &Arc::new(AtomicBool::new(false)),
        |_| {},
    )
    .expect_err("corrupt archive should fail");

    assert!(error.contains("game.7z"), "unexpected error: {error}");
    let _ = fs::remove_dir_all(root);
}

#[test]
fn extract_archive_or_copy_extracts_tar_gz_archives() {
    let root = unique_test_dir("extract-targz");
    let archive_path = root.join("game.tar.gz");
    let destination = root.join("out");
    fs::create_dir_all(&root).expect("root should be created");
    write_tar_gz_archive(&archive_path, &[("Game/readme.txt", b"hello")]);

    extract_archive_or_copy(
        &archive_path,
        &destination,
        &Arc::new(AtomicBool::new(false)),
        |_| {},
    )
    .expect("tar.gz archive should extract");

    assert!(destination.join("Game").join("readme.txt").exists());
    let _ = fs::remove_dir_all(root);
}

#[test]
fn extract_archive_or_copy_copies_directory_sources_into_destination() {
    let root = unique_test_dir("extract-directory");
    let source = root.join("files");
    let destination = root.join("out");
    fs::create_dir_all(source.join("Game")).expect("source directory should be created");
    fs::write(source.join("setup.exe"), b"installer").expect("installer should exist");
    fs::write(source.join("Game").join("data.bin"), b"payload").expect("payload should exist");

    extract_archive_or_copy(
        &source,
        &destination,
        &Arc::new(AtomicBool::new(false)),
        |_| {},
    )
    .expect("directory source should copy into destination");

    assert!(destination.join("setup.exe").exists());
    assert!(destination.join("Game").join("data.bin").exists());
    assert!(!destination.join("files").exists());
    let _ = fs::remove_dir_all(root);
}

#[test]
fn extract_archive_or_copy_respects_pre_cancelled_copy_requests() {
    let root = unique_test_dir("extract-copy-cancelled");
    let source = root.join("game.bin");
    let destination = root.join("out");
    fs::create_dir_all(&root).expect("root should be created");
    fs::write(&source, b"binary").expect("source should exist");

    let error = extract_archive_or_copy(
        &source,
        &destination,
        &Arc::new(AtomicBool::new(true)),
        |_| {},
    )
    .expect_err("pre-cancelled copy should fail");

    assert_eq!(error, "Install cancelled.");
    assert!(!destination.exists());
    assert!(!destination.join("game.bin").exists());
    let _ = fs::remove_dir_all(root);
}

#[test]
fn uninstall_game_can_preserve_or_delete_install_files() {
    crate::settings::with_test_data_dir(unique_test_dir("uninstall"), || {
        let keep_dir = crate::settings::data_dir().join("keep");
        let delete_dir = crate::settings::data_dir().join("delete");
        fs::create_dir_all(&keep_dir).expect("keep dir should exist");
        fs::create_dir_all(&delete_dir).expect("delete dir should exist");

        crate::registry::upsert(installed_game(1, "Keep", &keep_dir))
            .expect("keep game should be saved");
        crate::registry::upsert(installed_game(2, "Delete", &delete_dir))
            .expect("delete game should be saved");

        uninstall_game(1, false).expect("keep uninstall should succeed");
        uninstall_game(2, true).expect("delete uninstall should succeed");

        assert!(keep_dir.exists());
        assert!(!delete_dir.exists());
        assert!(
            crate::registry::get(1)
                .expect("registry should load")
                .is_none()
        );
        assert!(
            crate::registry::get(2)
                .expect("registry should load")
                .is_none()
        );
    });
}

#[test]
fn delete_install_artifacts_with_preserves_selected_bottles_for_portable_installs() {
    let root = unique_test_dir("uninstall-linux-runtime");
    let bottle_install_dir = root.join("bottle-game");
    let bottle_dir = root.join("bottle-prefix");
    let umu_install_dir = root.join("umu-game");
    let umu_prefix_dir = root.join("umu-prefix");
    fs::create_dir_all(&bottle_install_dir).expect("bottle install dir should exist");
    fs::create_dir_all(&bottle_dir).expect("bottle dir should exist");
    fs::create_dir_all(&umu_install_dir).expect("umu install dir should exist");
    fs::create_dir_all(&umu_prefix_dir).expect("umu prefix dir should exist");

    let mut bottles_game = installed_game(3, "Bottle Game", &bottle_install_dir);
    bottles_game.linux_runtime_backend = Some(crate::models::LinuxRuntimeBackend::Bottles);
    bottles_game.bottle_name = Some("claudio-3-Bottle Game".to_string());

    super::super::api::delete_install_artifacts_with(&bottles_game, |bottle_name| {
        if bottle_name == "claudio-3-Bottle Game" {
            vec![bottle_dir.clone()]
        } else {
            Vec::new()
        }
    })
    .expect("bottles uninstall cleanup should succeed");

    let mut umu_game = installed_game(4, "UMU Game", &umu_install_dir);
    umu_game.linux_runtime_backend = Some(crate::models::LinuxRuntimeBackend::Umu);
    umu_game.wine_prefix = Some(umu_prefix_dir.to_string_lossy().into_owned());

    super::super::api::delete_install_artifacts_with(&umu_game, |_| Vec::new())
        .expect("umu uninstall cleanup should succeed");

    assert!(!bottle_install_dir.exists());
    assert!(bottle_dir.exists());
    assert!(!umu_install_dir.exists());
    assert!(!umu_prefix_dir.exists());
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn delete_install_artifacts_with_removes_derived_bottle_dir_when_metadata_is_missing() {
    let root = unique_test_dir("uninstall-derived-bottle");
    let install_dir = root.join("install");
    let bottle_dir = root.join("Legacy Game");
    fs::create_dir_all(&install_dir).expect("install dir should exist");
    fs::create_dir_all(&bottle_dir).expect("bottle dir should exist");

    let mut legacy_game = installed_game(7, "Legacy Game", &install_dir);
    legacy_game.linux_runtime_backend = Some(crate::models::LinuxRuntimeBackend::Bottles);
    legacy_game.bottle_name = None;

    super::super::api::delete_install_artifacts_with(&legacy_game, |bottle_name| {
        if bottle_name == "Legacy Game" {
            vec![bottle_dir.clone()]
        } else {
            Vec::new()
        }
    })
    .expect("derived bottle cleanup should succeed");

    assert!(!install_dir.exists());
    assert!(!bottle_dir.exists());
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn delete_install_artifacts_with_removes_legacy_bottle_dir_when_only_old_name_exists() {
    let root = unique_test_dir("uninstall-legacy-bottle-name");
    let install_dir = root.join("install");
    let bottle_dir = root.join("claudio-8-Legacy Game");
    fs::create_dir_all(&install_dir).expect("install dir should exist");
    fs::create_dir_all(&bottle_dir).expect("bottle dir should exist");

    let mut legacy_game = installed_game(8, "Legacy Game", &install_dir);
    legacy_game.linux_runtime_backend = Some(crate::models::LinuxRuntimeBackend::Bottles);
    legacy_game.bottle_name = None;

    super::super::api::delete_install_artifacts_with(&legacy_game, |bottle_name| {
        if bottle_name == "claudio-8-Legacy Game" {
            vec![bottle_dir.clone()]
        } else {
            Vec::new()
        }
    })
    .expect("legacy bottle cleanup should succeed");

    assert!(!install_dir.exists());
    assert!(!bottle_dir.exists());
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn cleanup_failed_installer_state_is_non_fatal_when_staging_cleanup_fails() {
    let root = unique_test_dir("cleanup-non-fatal");
    let staging_file = root.join("Hades II.installing");
    fs::create_dir_all(&root).expect("root should be created");
    fs::write(&staging_file, b"locked").expect("staging file should be created");

    let result = cleanup_failed_installer_state(&root.join("missing-target"), &staging_file);

    assert!(result.is_ok(), "cleanup failure should be non-fatal");
    let _ = fs::remove_file(&staging_file);
    let _ = fs::remove_dir_all(&root);
}
