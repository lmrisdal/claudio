use super::*;
use std::time::{SystemTime, UNIX_EPOCH};

fn unique_test_dir(name: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "claudio-windows-integration-{name}-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after epoch")
            .as_nanos()
    ))
}

fn installed_game(remote_game_id: i32, install_path: &Path, exe_path: &Path) -> InstalledGame {
    InstalledGame {
        remote_game_id,
        title: format!("Test Game {remote_game_id}"),
        platform: "windows".to_string(),
        install_type: InstallType::Portable,
        install_path: install_path.to_string_lossy().into_owned(),
        game_exe: Some(exe_path.to_string_lossy().into_owned()),
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

#[test]
fn expand_process_tree_finds_descendants_across_multiple_levels() {
    let tree = expand_process_tree(&[(10, 1), (11, 10), (12, 11), (99, 50)], &[1]);

    assert_eq!(tree, vec![1, 10, 11, 12]);
}

#[test]
fn days_to_ymd_matches_known_epoch_dates() {
    assert_eq!(days_to_ymd(0), (1970, 1, 1));
    assert_eq!(days_to_ymd(31), (1970, 2, 1));
}

#[test]
fn create_shortcut_writes_lnk_file() {
    let root = unique_test_dir("shortcut");
    let shortcut = root.join("game.lnk");

    create_shortcut(
        std::env::current_exe()
            .expect("current exe should exist")
            .to_string_lossy()
            .as_ref(),
        &shortcut,
    )
    .expect("shortcut should be created");

    assert!(shortcut.exists());
    let _ = fs::remove_dir_all(root);
}

#[test]
fn write_registry_creates_expected_uninstall_values() {
    let root = unique_test_dir("registry");
    let install_dir = root.join("game");
    fs::create_dir_all(&install_dir).expect("install dir should exist");
    fs::write(install_dir.join("game.exe"), b"binary").expect("game exe should exist");
    fs::write(install_dir.join("data.bin"), vec![0_u8; 4096]).expect("data file should exist");

    let game = installed_game(91, &install_dir, &install_dir.join("game.exe"));
    let key_name = registry_key_name(game.remote_game_id);
    let uninstall_exe = install_dir.join("uninstall.exe");
    fs::write(&uninstall_exe, b"binary").expect("uninstaller should exist");

    write_registry(&game, &key_name, &install_dir, &uninstall_exe)
        .expect("registry should be written");

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = hkcu
        .open_subkey(format!("{UNINSTALL_ROOT}\\{key_name}"))
        .expect("registry key should exist");
    let display_name: String = key
        .get_value("DisplayName")
        .expect("display name should exist");
    let install_location: String = key
        .get_value("InstallLocation")
        .expect("install location should exist");
    let publisher: String = key.get_value("Publisher").expect("publisher should exist");

    assert_eq!(display_name, game.title);
    assert_eq!(install_location, install_dir.to_string_lossy());
    assert_eq!(publisher, "Claudio");

    let _ = hkcu.delete_subkey_all(format!("{UNINSTALL_ROOT}\\{key_name}"));
    let _ = fs::remove_dir_all(root);
}
