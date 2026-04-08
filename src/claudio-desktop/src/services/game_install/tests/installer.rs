use super::*;

#[test]
fn detect_installer_and_windows_executable_find_sorted_matches() {
    let root = unique_test_dir("detectors");
    fs::create_dir_all(root.join("nested")).expect("nested root should be created");
    fs::write(root.join("nested").join("setup.exe"), b"setup").expect("setup should exist");
    fs::write(root.join("aaa.exe"), b"game").expect("exe should exist");

    assert_eq!(
        detect_installer(&root),
        Some(root.join("nested").join("setup.exe"))
    );
    assert_eq!(detect_windows_executable(&root), Some(root.join("aaa.exe")));

    let _ = fs::remove_dir_all(root);
}

#[cfg(target_os = "windows")]
fn write_installer_fixture(name: &str, contents: &[u8]) -> PathBuf {
    let root = unique_test_dir(name);
    fs::create_dir_all(&root).expect("root should be created");
    let installer = root.join("setup.exe");
    fs::write(&installer, contents).expect("installer should exist");
    installer
}

#[test]
fn resolve_installer_path_uses_hint_when_present() {
    let root = unique_test_dir("installer-hint");
    fs::create_dir_all(&root).expect("root should be created");
    fs::write(root.join("custom-installer.exe"), b"installer").expect("installer should exist");

    let installer = resolve_installer_path(&root, Some("custom-installer.exe"))
        .expect("hinted installer should resolve");

    assert_eq!(installer, root.join("custom-installer.exe"));
    let _ = fs::remove_dir_all(root);
}

#[test]
fn installer_launch_kind_detects_common_extensions() {
    #[cfg(target_os = "windows")]
    {
        assert_eq!(
            installer_launch_kind(Path::new("setup.exe")),
            InstallerLaunchKind::Exe
        );
        assert_eq!(
            installer_launch_kind(Path::new("setup.msi")),
            InstallerLaunchKind::Msi
        );
        assert_eq!(
            installer_launch_kind(Path::new("setup.bin")),
            InstallerLaunchKind::Unknown
        );
    }

    #[cfg(not(target_os = "windows"))]
    {
        assert_eq!(
            installer_launch_kind(Path::new("setup.exe")),
            InstallerLaunchKind::Unknown
        );
        assert_eq!(
            installer_launch_kind(Path::new("setup.msi")),
            InstallerLaunchKind::Unknown
        );
    }
}

#[cfg(target_os = "windows")]
#[test]
fn detect_installer_type_identifies_gog_inno_setup_from_ascii_marker() {
    let installer = write_installer_fixture(
        "installer-type-gog-ascii",
        b"prefix Inno Setup middle GOG.com suffix",
    );

    assert_eq!(
        detect_installer_type(&installer),
        InstallerType::GogInnoSetup
    );

    let _ = fs::remove_dir_all(installer.parent().expect("fixture dir should exist"));
}

#[cfg(target_os = "windows")]
#[test]
fn detect_installer_type_identifies_gog_inno_setup_from_utf16_marker() {
    let installer = write_installer_fixture(
        "installer-type-gog-utf16",
        b"prefix Inno Setup middle G\0O\0G\0.\0c\0o\0m\0 suffix",
    );

    assert_eq!(
        detect_installer_type(&installer),
        InstallerType::GogInnoSetup
    );

    let _ = fs::remove_dir_all(installer.parent().expect("fixture dir should exist"));
}

#[cfg(target_os = "windows")]
#[test]
fn detect_installer_type_falls_back_to_plain_inno_without_gog_marker() {
    let installer =
        write_installer_fixture("installer-type-inno-only", b"prefix Inno Setup suffix");

    assert_eq!(detect_installer_type(&installer), InstallerType::InnoSetup);

    let _ = fs::remove_dir_all(installer.parent().expect("fixture dir should exist"));
}

#[cfg(target_os = "windows")]
#[test]
fn detect_installer_type_requires_inno_marker_for_gog_classification() {
    let installer = write_installer_fixture(
        "installer-type-gog-without-inno",
        b"prefix G\0O\0G\0.\0c\0o\0m\0 suffix",
    );

    assert_eq!(detect_installer_type(&installer), InstallerType::Unknown);

    let _ = fs::remove_dir_all(installer.parent().expect("fixture dir should exist"));
}

#[cfg(not(target_os = "windows"))]
#[test]
fn run_installer_fails_closed_on_non_windows() {
    let error = run_installer(
        Path::new("setup.exe"),
        Path::new("/tmp/game"),
        false,
        false,
        false,
        &InstallControl::new(),
    )
    .err()
    .expect("non-windows installer should fail");

    match error {
        RunInstallerError::Failed(message) => {
            assert_eq!(
                message,
                "Installer-based PC installs are only supported on Windows."
            );
        }
        other => panic!("unexpected installer error: {other:?}"),
    }
}

#[cfg(target_os = "windows")]
#[test]
fn stream_requests_elevation_detects_ascii_and_utf16_markers() {
    let mut ascii = std::io::Cursor::new(b"prefix requireAdministrator suffix".to_vec());
    let mut utf16 =
        std::io::Cursor::new(b"x\0h\0i\0g\0h\0e\0s\0t\0A\0v\0a\0i\0l\0a\0b\0l\0e\0y\0".to_vec());

    assert!(stream_requests_elevation(&mut ascii).expect("ascii marker should be read"));
    assert!(stream_requests_elevation(&mut utf16).expect("utf16 marker should be read"));
}
