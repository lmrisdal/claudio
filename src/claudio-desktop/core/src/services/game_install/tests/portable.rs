use super::super::portable_install::finalize_portable_payload;
use super::super::prefix_paths::{prefix_install_directory, prefix_payload_directory};
use super::*;

#[test]
fn portable_payload_matches_installer_destination_for_sanitized_titles() {
    let prefix = Path::new("/prefix");
    for (title, name) in [("My Game: Part 2", "My Game Part 2"), ("..", "game")] {
        assert_eq!(prefix_install_directory(title), format!(r"C:\Games\{name}"));
        assert_eq!(
            prefix_payload_directory(prefix, title),
            prefix.join("pfx/drive_c/Games").join(name),
        );
    }
}

#[test]
fn portable_archive_installs_under_games_and_keeps_prefix_system_files()
-> Result<(), Box<dyn std::error::Error>> {
    crate::settings::with_test_data_dir(unique_test_dir("portable-prefix"), || {
        let root = crate::settings::data_dir();
        let prefix = root.join("prefix");
        let drive_c = prefix.join("pfx/drive_c");
        let payload = prefix_payload_directory(&prefix, "My Game");
        fs::create_dir_all(drive_c.join("windows"))?;
        fs::write(drive_c.join("windows/system.exe"), b"system")?;
        fs::create_dir_all(&payload)?;
        let archive = root.join("game.zip");
        write_zip_archive(
            &archive,
            &[("wrapper/game.exe", b"game"), ("wrapper/data.bin", b"data")],
        );
        let staging = root.join("staging");
        fs::create_dir_all(&staging)?;
        extract_archive_or_copy(
            &archive,
            &staging,
            &Arc::new(AtomicBool::new(false)),
            &mut |_| {},
        )
        .map_err(io::Error::other)?;
        let exe = finalize_portable_payload(&staging, &payload, Some("game.exe"))
            .map_err(io::Error::other)?;
        assert_eq!(
            exe,
            Some(payload.join("game.exe").to_string_lossy().into_owned())
        );
        assert_eq!(fs::read(payload.join("data.bin"))?, b"data");
        assert_eq!(fs::read(drive_c.join("windows/system.exe"))?, b"system");
        assert!(!drive_c.join("game.exe").exists());
        assert!(!staging.exists());

        let mut game = installed_game(78, "My Game", &prefix);
        game.wine_prefix = Some(prefix.to_string_lossy().into_owned());
        game.game_exe = exe;
        crate::registry::upsert(game).map_err(io::Error::other)?;
        let relative = PathBuf::from("Games/My Game/game.exe")
            .to_string_lossy()
            .into_owned();
        assert!(
            list_game_executables(78)
                .map_err(io::Error::other)?
                .contains(&relative)
        );
        assert_eq!(
            set_game_exe(78, relative)
                .map_err(io::Error::other)?
                .game_exe,
            Some(payload.join("game.exe").to_string_lossy().into_owned()),
        );
        Ok(())
    })
}

#[test]
fn portable_auto_detection_searches_only_the_game_payload() -> Result<(), Box<dyn std::error::Error>>
{
    let root = unique_test_dir("portable-auto-detect");
    let payload = prefix_payload_directory(&root, "My Game");
    fs::create_dir_all(root.join("pfx/drive_c/windows"))?;
    fs::write(root.join("pfx/drive_c/windows/aaa.exe"), b"system")?;
    fs::create_dir_all(&payload)?;
    let staging = root.join("staging");
    fs::create_dir_all(&staging)?;
    fs::write(staging.join("game.exe"), b"game")?;
    assert_eq!(
        finalize_portable_payload(&staging, &payload, None).map_err(io::Error::other)?,
        Some(payload.join("game.exe").to_string_lossy().into_owned()),
    );
    fs::remove_dir_all(root)?;
    Ok(())
}
