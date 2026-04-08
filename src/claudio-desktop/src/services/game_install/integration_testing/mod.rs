use super::*;

mod download;
#[cfg(target_os = "windows")]
mod installer;
mod portable;

pub(crate) use download::download_game_package;
#[cfg(target_os = "windows")]
pub use installer::{
    TestInstallerAttempt, TestInstallerLaunchKind, TestInstallerOutcome, TestInstallerSimulation,
};
#[cfg(target_os = "windows")]
pub(crate) use installer::{
    cleanup_failed_installer_state, run_innoextract_with_binary, simulate_installer_session,
};
pub(crate) use portable::install_portable_game;

#[derive(Clone)]
pub struct TestInstallController {
    pub(super) control: InstallControl,
}

impl TestInstallController {
    pub fn new() -> Self {
        Self {
            control: InstallControl::new(),
        }
    }

    pub fn cancel(&self) {
        self.control.set_cancelled(true);
    }

    pub fn request_restart_interactive(&self) {
        self.control.request_restart_interactive();
    }
}
