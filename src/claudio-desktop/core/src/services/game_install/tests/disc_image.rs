use super::super::disc_image::{
    disc_image_for_installer, extract_disc_image, is_disc_image, mount_point_in, parse_loop_device,
    parse_mount_point, prepare_installer_source,
};
use super::super::installer_detect::find_path_ignoring_case;
use super::*;

fn fixture_root(name: &str, files: &[&str]) -> PathBuf {
    let root = unique_test_dir(name);
    for file in files {
        let path = root.join(file);
        fs::create_dir_all(path.parent().expect("fixture file has a parent"))
            .expect("fixture folder should be created");
        fs::write(&path, b"data").expect("fixture file should be written");
    }
    root
}

fn assert_same_file(actual: &Path, expected: &Path) {
    assert_eq!(
        fs::canonicalize(actual).expect("actual path should exist"),
        fs::canonicalize(expected).expect("expected path should exist")
    );
}

#[test]
fn is_disc_image_matches_iso_in_any_case() {
    assert!(is_disc_image(Path::new("Game.ISO")));
    assert!(is_disc_image(Path::new("dir/game.iso")));
    assert!(!is_disc_image(Path::new("game.zip")));
    assert!(!is_disc_image(Path::new("iso")));
}

#[test]
fn disc_image_for_installer_prefers_loose_installer() {
    let root = fixture_root("disc-loose", &["setup.exe", "disc.iso"]);

    assert_eq!(disc_image_for_installer(&root, None), None);
    assert_eq!(disc_image_for_installer(&root, Some("setup.exe")), None);

    let _ = fs::remove_dir_all(root);
}

#[test]
fn disc_image_for_installer_uses_hinted_image() {
    let root = fixture_root("disc-hint", &["setup.exe", "Disc 1.iso", "Disc 2.iso"]);

    assert_eq!(
        disc_image_for_installer(&root, Some("Disc 2.iso")),
        Some(root.join("Disc 2.iso"))
    );

    let _ = fs::remove_dir_all(root);
}

#[test]
fn disc_image_for_installer_picks_first_disc_when_no_installer_is_loose() {
    let root = fixture_root("disc-first", &["CD2.iso", "CD1.iso", "readme.txt"]);

    assert_eq!(
        disc_image_for_installer(&root, Some("SETUP.EXE")),
        Some(root.join("CD1.iso"))
    );

    let _ = fs::remove_dir_all(root);
}

#[test]
fn prepare_installer_source_without_disc_uses_staging_folder() {
    let source_root = fixture_root("disc-none-src", &[]);
    fs::create_dir_all(&source_root).expect("source root should be created");
    let archive = source_root.join("game.zip");
    write_zip_archive(&archive, &[("setup.exe", b"installer")]);
    let staging = source_root.join("staging");
    let cancel = Arc::new(AtomicBool::new(false));

    let source = prepare_installer_source(&archive, &staging, Some("setup.exe"), &cancel, |_| {})
        .expect("source should be prepared");

    assert_eq!(source.root, staging);
    assert_eq!(source.installer_hint.as_deref(), Some("setup.exe"));
    assert!(staging.join("setup.exe").is_file());

    let _ = fs::remove_dir_all(source_root);
}

#[test]
fn find_path_ignoring_case_matches_lower_case_mount_names() {
    let root = fixture_root("disc-case", &["install/setup.exe"]);

    let found = find_path_ignoring_case(&root, "INSTALL/SETUP.EXE").expect("file should be found");
    assert_same_file(&found, &root.join("install").join("setup.exe"));
    assert_eq!(find_path_ignoring_case(&root, "INSTALL/missing.exe"), None);

    let _ = fs::remove_dir_all(root);
}

#[test]
fn resolve_installer_path_hint_ignores_case() {
    let root = fixture_root("disc-resolve-case", &["setup.exe", "other/install.exe"]);

    let installer =
        resolve_installer_path(&root, Some("OTHER/INSTALL.EXE")).expect("hint should resolve");
    assert_same_file(&installer, &root.join("other").join("install.exe"));

    let _ = fs::remove_dir_all(root);
}

#[test]
fn parses_udisksctl_output() {
    assert_eq!(
        parse_loop_device("Mapped file /games/My Game.iso as /dev/loop12.\n").as_deref(),
        Some("/dev/loop12")
    );
    assert_eq!(
        parse_mount_point("Mounted /dev/loop12 at /run/media/me/MY GAME.\n"),
        Some(PathBuf::from("/run/media/me/MY GAME"))
    );
    assert_eq!(parse_loop_device("Error setting up loop device"), None);
}

#[test]
fn mount_point_in_unescapes_proc_mounts() {
    let mounts = "/dev/sda1 / ext4 rw 0 0\n/dev/loop3 /run/media/me/MY\\040GAME iso9660 ro 0 0\n";

    assert_eq!(
        mount_point_in(mounts, "/dev/loop3"),
        Some(PathBuf::from("/run/media/me/MY GAME"))
    );
    assert_eq!(mount_point_in(mounts, "/dev/loop4"), None);
}

#[cfg(target_os = "linux")]
fn build_iso_with_bsdtar(root: &Path) -> PathBuf {
    let content = root.join("content");
    fs::create_dir_all(content.join("Install")).expect("content folder should be created");
    fs::write(content.join("Install").join("Setup.exe"), b"MZ").expect("setup should be written");
    let iso = root.join("Game Disc.iso");
    let status = std::process::Command::new("bsdtar")
        .args([
            "--format",
            "iso9660",
            "--options",
            "joliet,rockridge",
            "-cf",
        ])
        .arg(&iso)
        .arg("-C")
        .arg(&content)
        .arg("Install")
        .status()
        .expect("bsdtar should run");
    assert!(status.success());
    iso
}

#[cfg(target_os = "linux")]
#[test]
#[ignore]
fn prepare_installer_source_mounts_iso_with_udisks() {
    let root = unique_test_dir("disc-mount");
    let iso = build_iso_with_bsdtar(&root);
    let cancel = Arc::new(AtomicBool::new(false));

    let source = prepare_installer_source(
        &iso,
        &root.join("staging"),
        Some("INSTALL/SETUP.EXE"),
        &cancel,
        |_| {},
    )
    .expect("source should be prepared");
    let mount_root = source.root.clone();

    assert!(
        !mount_root.starts_with(&root),
        "image should be mounted, not extracted"
    );
    assert_eq!(
        resolve_installer_path(&source.root, source.installer_hint.as_deref())
            .expect("installer should resolve on the mounted disc"),
        mount_root.join("Install").join("Setup.exe")
    );

    drop(source);
    assert!(
        !mount_root.join("Install").exists(),
        "disc should be unmounted"
    );
    let _ = fs::remove_dir_all(root);
}

#[cfg(target_os = "linux")]
#[test]
#[ignore]
fn extract_disc_image_uses_system_archiver() {
    let root = unique_test_dir("disc-extract");
    let iso = build_iso_with_bsdtar(&root);
    let destination = root.join("out");

    extract_disc_image(&iso, &destination, &Arc::new(AtomicBool::new(false)))
        .expect("image should extract");

    assert!(destination.join("Install").join("Setup.exe").is_file());
    let _ = fs::remove_dir_all(root);
}
