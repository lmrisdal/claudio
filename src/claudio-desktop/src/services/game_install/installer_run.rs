#[cfg(target_os = "windows")]
use super::installer_arguments::{installer_arguments, windows_argument_line};
#[cfg(target_os = "windows")]
use super::installer_detect::{InstallerType, detect_installer_type};
#[cfg(target_os = "windows")]
use super::installer_elevated::spawn_mute_wait;
#[cfg(target_os = "windows")]
use super::installer_innoextract::run_innoextract;
use super::*;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

pub(super) fn run_installer_with_retries<F, G, H>(
    mut attempt: InstallerAttemptConfig,
    mut run_once: F,
    mut on_restart_interactive: G,
    mut confirm_elevation: H,
) -> Result<(), String>
where
    F: FnMut(InstallerAttemptConfig) -> Result<(), RunInstallerError>,
    G: FnMut() -> Result<(), String>,
    H: FnMut() -> bool,
{
    loop {
        match run_once(attempt) {
            Ok(()) => return Ok(()),
            Err(RunInstallerError::RestartInteractiveRequested) => {
                on_restart_interactive()?;
                attempt.force_interactive = true;
            }
            Err(RunInstallerError::Cancelled) => {
                return Err("Install cancelled.".to_string());
            }
            Err(RunInstallerError::RequiresAdministrator) => {
                if confirm_elevation() {
                    attempt.run_as_administrator = true;
                    attempt.force_run_as_invoker = false;
                    continue;
                }

                return Err("Install cancelled.".to_string());
            }
            Err(RunInstallerError::Failed(message)) => {
                if !attempt.force_interactive {
                    on_restart_interactive()?;
                    attempt.force_interactive = true;
                    continue;
                }

                return Err(message);
            }
        }
    }
}

#[cfg(target_os = "windows")]
pub(super) fn confirm_installer_elevation(app: &Host) -> bool {
    app.confirm(
        "Administrator Privileges Required",
        "This installer requires administrator privileges. Continue?",
        "Continue",
        "Cancel",
    )
}

#[cfg(target_os = "windows")]
fn apply_run_as_invoker_env(cmd: &mut std::process::Command) {
    log::info!("[installer] applying RunAsInvoker compatibility layer for non-admin launch");
    cmd.env("__COMPAT_LAYER", "RunAsInvoker");
}

#[cfg(target_os = "windows")]
pub(super) fn run_installer(
    path: &Path,
    target_dir: &Path,
    force_interactive: bool,
    run_as_administrator: bool,
    force_run_as_invoker: bool,
    control: &InstallControl,
) -> Result<(), RunInstallerError> {
    let target = target_dir.to_string_lossy();
    let installer_type = detect_installer_type(path);
    log::info!(
        "Detected installer type: {} for {}",
        match &installer_type {
            InstallerType::GogInnoSetup => "GOG InnoSetup",
            InstallerType::InnoSetup => "InnoSetup",
            InstallerType::Nsis => "NSIS",
            InstallerType::Msi => "MSI",
            InstallerType::Unknown => "Unknown",
        },
        path.display()
    );

    if !force_interactive && installer_type == InstallerType::GogInnoSetup {
        match run_innoextract(path, target_dir) {
            Ok(()) => return Ok(()),
            Err(error) => {
                log::warn!(
                    "innoextract failed ({error}), falling back to silent InnoSetup install"
                );
                let _ = fs::remove_dir_all(target_dir);
            }
        }
    }

    let mut args = installer_arguments(installer_type, &target, force_interactive);
    let program = if installer_type == InstallerType::Msi {
        args.splice(
            0..0,
            ["/i".to_string(), path.to_string_lossy().into_owned()],
        );
        Path::new("msiexec")
    } else {
        path
    };
    let argument_line = windows_argument_line(installer_type, &args);
    let mut cmd = std::process::Command::new(program);
    if installer_type != InstallerType::Msi && force_run_as_invoker {
        apply_run_as_invoker_env(&mut cmd);
    }
    cmd.raw_arg(&argument_line)
        .current_dir(path.parent().unwrap_or_else(|| Path::new(".")))
        .stdin(Stdio::null());
    log::info!(
        "[installer] launching {} {argument_line}",
        program.display()
    );
    spawn_mute_wait(
        cmd,
        program,
        &argument_line,
        run_as_administrator,
        installer_type != InstallerType::Msi && force_run_as_invoker,
        control,
    )
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
#[derive(Debug)]
pub(super) enum RunInstallerError {
    Cancelled,
    RestartInteractiveRequested,
    RequiresAdministrator,
    Failed(String),
}

#[cfg(not(target_os = "windows"))]
pub(super) fn run_installer(
    _path: &Path,
    _target_dir: &Path,
    _force_interactive: bool,
    _run_as_administrator: bool,
    _force_run_as_invoker: bool,
    _control: &InstallControl,
) -> Result<(), RunInstallerError> {
    Err(RunInstallerError::Failed(
        "Installer-based PC installs are only supported on Windows.".to_string(),
    ))
}
