use super::super::installer_arguments::{installer_arguments, windows_argument_line};
use super::super::installer_detect::InstallerType;

#[test]
fn interactive_wizards_receive_destination_without_silent_flags() {
    let target = r"D:\My Games\A Game";
    for (kind, expected) in [
        (InstallerType::InnoSetup, format!("/DIR={target}")),
        (InstallerType::GogInnoSetup, format!("/DIR={target}")),
        (InstallerType::Nsis, format!("/D={target}")),
        (InstallerType::Msi, format!("TARGETDIR={target}")),
    ] {
        assert_eq!(installer_arguments(kind, target, true), vec![expected]);
    }
}

#[test]
fn unknown_installers_receive_no_guessed_arguments() {
    assert!(installer_arguments(InstallerType::Unknown, r"D:\Games", true).is_empty());
}

#[test]
fn silent_installers_keep_their_automation_flags_and_destination() {
    let target = r"D:\Games\Example";
    for (kind, expected) in [
        (
            InstallerType::InnoSetup,
            vec![
                "/VERYSILENT",
                "/SUPPRESSMSGBOXES",
                "/NOSOUND",
                r"/DIR=D:\Games\Example",
            ],
        ),
        (InstallerType::Nsis, vec!["/S", r"/D=D:\Games\Example"]),
        (
            InstallerType::Msi,
            vec!["/qn", r"TARGETDIR=D:\Games\Example"],
        ),
    ] {
        assert_eq!(installer_arguments(kind, target, false), expected);
    }
}

#[test]
fn nsis_destination_with_spaces_is_unquoted_and_last() {
    let args = installer_arguments(InstallerType::Nsis, r"D:\My Games\Example", false);
    assert_eq!(
        windows_argument_line(InstallerType::Nsis, &args),
        r#"/S /D=D:\My Games\Example"#
    );
}

#[test]
fn inno_destination_with_spaces_is_quoted_as_one_argument() {
    let args = installer_arguments(InstallerType::InnoSetup, r"D:\My Games\Example", true);
    assert_eq!(
        windows_argument_line(InstallerType::InnoSetup, &args),
        r#""/DIR=D:\My Games\Example""#
    );
}

#[test]
fn elevated_msi_arguments_preserve_package_and_destination_paths() {
    let mut args = vec!["/i".to_string(), r"C:\Downloads\My Game.msi".to_string()];
    args.extend(installer_arguments(
        InstallerType::Msi,
        r"D:\My Games\",
        true,
    ));
    assert_eq!(
        windows_argument_line(InstallerType::Msi, &args),
        r#"/i "C:\Downloads\My Game.msi" "TARGETDIR=D:\My Games\\""#
    );
}

#[cfg(target_os = "linux")]
#[test]
fn linux_destination_stays_inside_the_prefix_c_drive() {
    use super::super::prefix_paths::prefix_install_directory;
    assert_eq!(
        prefix_install_directory("My Game: Part 2"),
        r"C:\Games\My Game Part 2"
    );
    assert_eq!(prefix_install_directory(".."), r"C:\Games\game");
}

#[cfg(target_os = "linux")]
#[test]
fn linux_executable_hint_resolves_inside_prefilled_destination()
-> Result<(), Box<dyn std::error::Error>> {
    use super::super::installer_install_linux::resolve_game_exe_hint;
    let root = super::unique_test_dir("linux-prefilled-hint");
    let game_exe = root.join("Games/My Game/bin/game.exe");
    std::fs::create_dir_all(root.join("Games/My Game/bin"))?;
    std::fs::write(&game_exe, b"game")?;
    assert_eq!(
        resolve_game_exe_hint(&root, r"C:\Games\My Game", Some(r"bin\game.exe")),
        Some(game_exe.to_string_lossy().into_owned()),
    );
    assert_eq!(
        resolve_game_exe_hint(&root, r"C:\Games\My Game", None),
        None
    );
    std::fs::remove_dir_all(root)?;
    Ok(())
}
