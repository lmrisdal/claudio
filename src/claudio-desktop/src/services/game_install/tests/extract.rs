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
