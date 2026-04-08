use super::super::installer_run::RunInstallerError;
use super::super::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TestInstallerLaunchKind {
    Exe,
    Msi,
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TestInstallerOutcome {
    Success,
    RestartInteractiveRequested,
    Cancelled,
    RequiresAdministrator,
    Failed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TestInstallerAttempt {
    pub force_interactive: bool,
    pub run_as_administrator: bool,
    pub force_run_as_invoker: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TestInstallerSimulation {
    pub launch_kind: TestInstallerLaunchKind,
    pub attempts: Vec<TestInstallerAttempt>,
    pub final_error: Option<String>,
    pub confirm_elevation_calls: usize,
}

pub fn simulate_installer_session(
    installer_path: &Path,
    requests_elevation: bool,
    initial_run_as_administrator: bool,
    initial_force_interactive: bool,
    outcomes: Vec<TestInstallerOutcome>,
    confirm_elevation_responses: Vec<bool>,
) -> TestInstallerSimulation {
    let mut attempts = Vec::new();
    let mut outcome_iter = outcomes.into_iter();
    let mut confirm_iter = confirm_elevation_responses.into_iter();
    let mut confirm_elevation_calls = 0usize;

    let launch_kind = match installer_launch_kind(installer_path) {
        InstallerLaunchKind::Exe => TestInstallerLaunchKind::Exe,
        InstallerLaunchKind::Msi => TestInstallerLaunchKind::Msi,
        InstallerLaunchKind::Unknown => TestInstallerLaunchKind::Unknown,
    };

    let result = run_installer_with_retries(
        installer_attempt_config(
            initial_force_interactive,
            initial_run_as_administrator,
            requests_elevation,
        ),
        |attempt| {
            attempts.push(TestInstallerAttempt {
                force_interactive: attempt.force_interactive,
                run_as_administrator: attempt.run_as_administrator,
                force_run_as_invoker: attempt.force_run_as_invoker,
            });

            match outcome_iter.next().unwrap_or(TestInstallerOutcome::Success) {
                TestInstallerOutcome::Success => Ok(()),
                TestInstallerOutcome::RestartInteractiveRequested => {
                    Err(RunInstallerError::RestartInteractiveRequested)
                }
                TestInstallerOutcome::Cancelled => Err(RunInstallerError::Cancelled),
                TestInstallerOutcome::RequiresAdministrator => {
                    Err(RunInstallerError::RequiresAdministrator)
                }
                TestInstallerOutcome::Failed => Err(RunInstallerError::Failed(
                    "Installer exited with status 1.".to_string(),
                )),
            }
        },
        || Ok(()),
        || {
            confirm_elevation_calls += 1;
            confirm_iter.next().unwrap_or(false)
        },
    );

    TestInstallerSimulation {
        launch_kind,
        attempts,
        final_error: result.err(),
        confirm_elevation_calls,
    }
}

pub fn cleanup_failed_installer_state(target_dir: &Path, staging_dir: &Path) -> Result<(), String> {
    super::super::cleanup_failed_installer_state(target_dir, staging_dir)
}

#[cfg(target_os = "windows")]
pub fn run_innoextract_with_binary(
    bin: &Path,
    installer: &Path,
    target_dir: &Path,
) -> Result<(), String> {
    super::super::run_innoextract_with_binary(bin, installer, target_dir)
}
