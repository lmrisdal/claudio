#[cfg(target_os = "windows")]
use super::installer_detect::{InstallerType, detect_installer_type};
use super::*;

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
            Err(RunInstallerError::Failed(message)) => return Err(message),
        }
    }
}

#[cfg(target_os = "windows")]
pub(super) fn confirm_installer_elevation(app: &AppHandle) -> bool {
    app.dialog()
        .message("This installer requires administrator privileges. Continue?")
        .title("Administrator Privileges Required")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Continue".to_string(),
            "Cancel".to_string(),
        ))
        .blocking_show()
}

#[cfg(target_os = "windows")]
fn apply_run_as_invoker_env(cmd: &mut std::process::Command) {
    log::info!("[installer] applying RunAsInvoker compatibility layer for non-admin launch");
    cmd.env("__COMPAT_LAYER", "RunAsInvoker");
}

#[cfg(not(target_os = "windows"))]
pub(super) fn confirm_installer_elevation(_app: &AppHandle) -> bool {
    false
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

    if force_interactive {
        if matches!(installer_type, InstallerType::Msi) {
            let msi_args = format!("/i \"{}\"", path.to_string_lossy());
            let mut cmd = std::process::Command::new("msiexec");
            cmd.arg("/i").arg(path).stdin(Stdio::null());
            return spawn_mute_wait(
                cmd,
                Path::new("msiexec"),
                &msi_args,
                run_as_administrator,
                false,
                control,
            );
        }

        let mut cmd = std::process::Command::new(path);
        if force_run_as_invoker {
            apply_run_as_invoker_env(&mut cmd);
        }
        cmd.current_dir(path.parent().unwrap_or_else(|| Path::new(".")))
            .stdin(Stdio::null());
        return spawn_mute_wait(
            cmd,
            path,
            "",
            run_as_administrator,
            force_run_as_invoker,
            control,
        );
    }

    match installer_type {
        InstallerType::GogInnoSetup => run_innoextract(path, target_dir).or_else(|err| {
            log::warn!("innoextract failed ({err}), falling back to silent InnoSetup install");
            let _ = fs::remove_dir_all(target_dir);
            run_innosetup_silent(
                path,
                &target,
                run_as_administrator,
                force_run_as_invoker,
                control,
            )
        }),
        InstallerType::Msi => {
            let msi_args = format!(
                "/i \"{}\" /qn TARGETDIR=\"{}\"",
                path.to_string_lossy(),
                target
            );
            let mut cmd = std::process::Command::new("msiexec");
            cmd.arg("/i")
                .arg(path)
                .arg("/qn")
                .arg(format!("TARGETDIR={target}"))
                .stdin(Stdio::null());
            spawn_mute_wait(
                cmd,
                Path::new("msiexec"),
                &msi_args,
                run_as_administrator,
                false,
                control,
            )
        }
        InstallerType::InnoSetup => run_innosetup_silent(
            path,
            &target,
            run_as_administrator,
            force_run_as_invoker,
            control,
        ),
        InstallerType::Nsis => {
            let nsis_args = format!("/S /D={target}");
            let mut cmd = std::process::Command::new(path);
            if force_run_as_invoker {
                apply_run_as_invoker_env(&mut cmd);
            }
            cmd.arg("/S")
                .arg(format!("/D={target}"))
                .stdin(Stdio::null());
            spawn_mute_wait(
                cmd,
                path,
                &nsis_args,
                run_as_administrator,
                force_run_as_invoker,
                control,
            )
        }
        InstallerType::Unknown => {
            let mut cmd = std::process::Command::new(path);
            if force_run_as_invoker {
                apply_run_as_invoker_env(&mut cmd);
            }
            cmd.current_dir(path.parent().unwrap_or_else(|| Path::new(".")))
                .stdin(Stdio::null());
            spawn_mute_wait(
                cmd,
                path,
                "",
                run_as_administrator,
                force_run_as_invoker,
                control,
            )
        }
    }
}

#[cfg(target_os = "windows")]
fn run_innosetup_silent(
    path: &Path,
    target: &str,
    run_as_administrator: bool,
    force_run_as_invoker: bool,
    control: &InstallControl,
) -> Result<(), RunInstallerError> {
    let args = format!("/VERYSILENT /SUPPRESSMSGBOXES /NOSOUND \"/DIR={target}\"");
    let mut cmd = std::process::Command::new(path);
    if force_run_as_invoker {
        apply_run_as_invoker_env(&mut cmd);
    }
    cmd.arg("/VERYSILENT")
        .arg("/SUPPRESSMSGBOXES")
        .arg("/NOSOUND")
        .arg(format!("/DIR={target}"))
        .stdin(Stdio::null());

    spawn_mute_wait(
        cmd,
        path,
        &args,
        run_as_administrator,
        force_run_as_invoker,
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
