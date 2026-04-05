#![cfg(target_os = "windows")]

use claudio_desktop::integration_test_api::{
    TestInstallerLaunchKind, TestInstallerOutcome, cleanup_failed_installer_state,
    run_windows_innoextract_with_binary, simulate_windows_installer_session,
    terminate_windows_tracked_processes,
};
use claudio_desktop_tests::support::fs::TestWorkspace;
use claudio_desktop_tests::support::process::spawn_long_running_process;
use claudio_desktop_tests::support::windows::{
    write_fake_exe_installer_fixture, write_fake_gog_inno_installer_fixture,
    write_fake_innoextract_script, write_fake_msi_installer_fixture,
};
use serial_test::serial;
use std::fs;
use std::thread;
use std::time::{Duration, Instant};

#[test]
#[serial]
fn installer_failure_cleanup_removes_partial_target_and_staging_directories() {
    let workspace = TestWorkspace::new();
    let target_dir = workspace.data_dir.join("partial-target");
    let staging_dir = workspace.data_dir.join("installer-staging");

    fs::create_dir_all(target_dir.join("game")).expect("partial target dir should exist");
    fs::create_dir_all(staging_dir.join("extract")).expect("staging dir should exist");
    fs::write(target_dir.join("game/data.bin"), b"binary").expect("target file should exist");
    fs::write(staging_dir.join("extract/setup.exe"), b"binary").expect("staging file should exist");

    cleanup_failed_installer_state(&target_dir, &staging_dir)
        .expect("installer cleanup should succeed");

    assert!(!target_dir.exists());
    assert!(!staging_dir.exists());
}

#[test]
#[serial]
fn installer_cancel_cleanup_terminates_tracked_processes() {
    let mut child = spawn_long_running_process();
    let pid = child.id();

    terminate_windows_tracked_processes(&[pid], None)
        .expect("tracked installer processes should terminate");

    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if let Some(status) = child.try_wait().expect("child status should be readable") {
            assert!(!status.success());
            break;
        }

        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            panic!("tracked installer process was not terminated");
        }

        thread::sleep(Duration::from_millis(100));
    }
}

#[test]
#[serial]
fn exe_installer_success_path_uses_single_silent_attempt() {
    let workspace = TestWorkspace::new();
    let installer = workspace.data_dir.join("setup.exe");
    fs::create_dir_all(&workspace.data_dir).expect("workspace data dir should exist");
    write_fake_exe_installer_fixture(&installer);

    let simulation = simulate_windows_installer_session(
        &installer,
        false,
        false,
        false,
        vec![TestInstallerOutcome::Success],
        vec![],
    );

    assert_eq!(simulation.launch_kind, TestInstallerLaunchKind::Exe);
    assert_eq!(simulation.attempts.len(), 1);
    assert!(!simulation.attempts[0].force_interactive);
    assert!(!simulation.attempts[0].run_as_administrator);
    assert!(!simulation.attempts[0].force_run_as_invoker);
    assert_eq!(simulation.final_error, None);
}

#[test]
#[serial]
fn msi_installer_success_path_uses_single_silent_attempt() {
    let workspace = TestWorkspace::new();
    let installer = workspace.data_dir.join("setup.msi");
    fs::create_dir_all(&workspace.data_dir).expect("workspace data dir should exist");
    write_fake_msi_installer_fixture(&installer);

    let simulation = simulate_windows_installer_session(
        &installer,
        false,
        false,
        false,
        vec![TestInstallerOutcome::Success],
        vec![],
    );

    assert_eq!(simulation.launch_kind, TestInstallerLaunchKind::Msi);
    assert_eq!(simulation.attempts.len(), 1);
    assert!(!simulation.attempts[0].force_interactive);
    assert_eq!(simulation.final_error, None);
}

#[test]
#[serial]
fn installer_restart_interactive_retries_with_interactive_attempt() {
    let workspace = TestWorkspace::new();
    let installer = workspace.data_dir.join("setup.exe");
    fs::create_dir_all(&workspace.data_dir).expect("workspace data dir should exist");
    write_fake_exe_installer_fixture(&installer);

    let simulation = simulate_windows_installer_session(
        &installer,
        false,
        false,
        false,
        vec![
            TestInstallerOutcome::RestartInteractiveRequested,
            TestInstallerOutcome::Success,
        ],
        vec![],
    );

    assert_eq!(simulation.attempts.len(), 2);
    assert!(!simulation.attempts[0].force_interactive);
    assert!(simulation.attempts[1].force_interactive);
    assert_eq!(simulation.final_error, None);
}

#[test]
#[serial]
fn installer_elevation_required_returns_cancelled_when_user_declines_prompt() {
    let workspace = TestWorkspace::new();
    let installer = workspace.data_dir.join("setup.exe");
    fs::create_dir_all(&workspace.data_dir).expect("workspace data dir should exist");
    write_fake_exe_installer_fixture(&installer);

    let simulation = simulate_windows_installer_session(
        &installer,
        false,
        false,
        false,
        vec![TestInstallerOutcome::RequiresAdministrator],
        vec![false],
    );

    assert_eq!(simulation.confirm_elevation_calls, 1);
    assert_eq!(
        simulation.final_error.as_deref(),
        Some("Install cancelled.")
    );
}

#[test]
#[serial]
fn installer_run_as_invoker_fallback_retries_as_administrator_after_740() {
    let workspace = TestWorkspace::new();
    let installer = workspace.data_dir.join("setup.exe");
    fs::create_dir_all(&workspace.data_dir).expect("workspace data dir should exist");
    write_fake_exe_installer_fixture(&installer);

    let simulation = simulate_windows_installer_session(
        &installer,
        true,
        false,
        false,
        vec![
            TestInstallerOutcome::RequiresAdministrator,
            TestInstallerOutcome::Success,
        ],
        vec![true],
    );

    assert_eq!(simulation.attempts.len(), 2);
    assert!(simulation.attempts[0].force_run_as_invoker);
    assert!(!simulation.attempts[0].run_as_administrator);
    assert!(!simulation.attempts[1].force_run_as_invoker);
    assert!(simulation.attempts[1].run_as_administrator);
    assert_eq!(simulation.final_error, None);
}

#[test]
#[serial]
fn innoextract_path_flattens_output_and_cleans_leftovers() {
    let workspace = TestWorkspace::new();
    let tools_dir = workspace.data_dir.join("tools");
    let target_dir = workspace.data_dir.join("installed-game");
    let installer = workspace.data_dir.join("gog-setup.exe");
    let fake_innoextract = tools_dir.join("innoextract.cmd");

    fs::create_dir_all(&tools_dir).expect("tools dir should exist");
    write_fake_gog_inno_installer_fixture(&installer);
    write_fake_innoextract_script(&fake_innoextract);

    run_windows_innoextract_with_binary(&fake_innoextract, &installer, &target_dir)
        .expect("fake innoextract run should succeed");

    assert!(target_dir.join("game.exe").exists());
    assert!(!target_dir.join("app").exists());
    assert!(!target_dir.join("tmp").exists());
}
