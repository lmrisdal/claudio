#![cfg(target_os = "windows")]

use claudio_desktop::integration_test_api::{
    deregister_windows_game, register_windows_game_from_resource_dir,
    windows_desktop_shortcut_path, windows_registry_key_name, windows_start_menu_shortcut_path,
    windows_uninstall_root, with_test_windows_shell_dirs,
};
use claudio_desktop_tests::support::fixtures::installed_game;
use claudio_desktop_tests::support::fs::TestWorkspace;
use serde_json::Value;
use serial_test::serial;
use std::fs;
use winreg::RegKey;
use winreg::enums::HKEY_CURRENT_USER;

fn uninstall_key_path(remote_game_id: i32) -> String {
    format!(
        "{}\\{}",
        windows_uninstall_root(),
        windows_registry_key_name(remote_game_id)
    )
}

#[test]
#[serial]
fn portable_registration_writes_shortcuts_uninstaller_config_registry_and_cleanup() {
    let workspace = TestWorkspace::new();
    let install_dir = workspace.data_dir.join("registered-game");
    let resource_dir = workspace.data_dir.join("resources");
    let start_menu_dir = workspace.data_dir.join("start-menu");
    let desktop_dir = workspace.data_dir.join("desktop");

    fs::create_dir_all(&install_dir).expect("install dir should exist");
    fs::create_dir_all(&resource_dir).expect("resource dir should exist");
    fs::write(install_dir.join("game.exe"), b"binary").expect("game exe should exist");
    fs::write(resource_dir.join("claudio-game-uninstaller.exe"), b"binary")
        .expect("bundled uninstaller should exist");

    let game = installed_game(
        41,
        "Registered Game",
        install_dir.to_string_lossy().into_owned(),
        Some(install_dir.join("game.exe").to_string_lossy().into_owned()),
    );

    with_test_windows_shell_dirs(start_menu_dir.clone(), desktop_dir.clone(), || {
        register_windows_game_from_resource_dir(resource_dir.clone(), &game, true);

        let start_menu_shortcut = windows_start_menu_shortcut_path(&game.title);
        let desktop_shortcut = windows_desktop_shortcut_path(&game.title);
        let uninstall_exe = install_dir.join("uninstall.exe");
        let uninstall_config = install_dir.join("uninstall-config.json");

        assert!(start_menu_shortcut.exists());
        assert!(desktop_shortcut.exists());
        assert!(uninstall_exe.exists());
        assert!(uninstall_config.exists());

        let config: Value = serde_json::from_str(
            &fs::read_to_string(&uninstall_config).expect("uninstall config should be readable"),
        )
        .expect("uninstall config should be valid json");
        assert_eq!(config["gameTitle"].as_str(), Some(game.title.as_str()));
        assert_eq!(
            config["installPath"].as_str(),
            Some(game.install_path.as_str())
        );
        assert_eq!(
            config["registryKeyName"].as_str(),
            Some(windows_registry_key_name(game.remote_game_id).as_str())
        );
        assert_eq!(
            config["shortcutPath"].as_str(),
            Some(start_menu_shortcut.to_string_lossy().as_ref())
        );
        assert_eq!(
            config["desktopShortcutPath"].as_str(),
            Some(desktop_shortcut.to_string_lossy().as_ref())
        );

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let key = hkcu
            .open_subkey(uninstall_key_path(game.remote_game_id))
            .expect("uninstall registry key should exist");
        let display_name: String = key
            .get_value("DisplayName")
            .expect("display name should exist");
        let install_location: String = key
            .get_value("InstallLocation")
            .expect("install location should exist");
        let uninstall_string: String = key
            .get_value("UninstallString")
            .expect("uninstall string should exist");

        assert_eq!(display_name, game.title);
        assert_eq!(install_location, game.install_path);
        assert_eq!(uninstall_string, uninstall_exe.to_string_lossy());

        deregister_windows_game(&game);

        assert!(!start_menu_shortcut.exists());
        assert!(!desktop_shortcut.exists());
        assert!(
            hkcu.open_subkey(uninstall_key_path(game.remote_game_id))
                .is_err()
        );
    });
}
