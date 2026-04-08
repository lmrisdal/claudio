use super::installer_run::RunInstallerError;
use super::state::terminate_external_installer;
use super::*;

pub(super) struct ElevatedInstallerProcess {
    handle: windows::Win32::Foundation::HANDLE,
    pid: u32,
}

impl ElevatedInstallerProcess {
    fn pid(&self) -> u32 {
        self.pid
    }

    fn try_wait(&self) -> Result<Option<u32>, String> {
        use windows::Win32::Foundation::{WAIT_OBJECT_0, WAIT_TIMEOUT};
        use windows::Win32::System::Threading::{GetExitCodeProcess, WaitForSingleObject};

        unsafe {
            match WaitForSingleObject(self.handle, 0) {
                WAIT_TIMEOUT => Ok(None),
                WAIT_OBJECT_0 => {
                    let mut code = 0u32;
                    GetExitCodeProcess(self.handle, &mut code)
                        .map_err(|error| error.to_string())?;
                    Ok(Some(code))
                }
                other => Err(format!(
                    "WaitForSingleObject returned unexpected status {other:?}"
                )),
            }
        }
    }

    fn terminate(&self) {
        use windows::Win32::System::Threading::{TerminateProcess, WaitForSingleObject};

        unsafe {
            let _ = TerminateProcess(self.handle, 1);
            let _ = WaitForSingleObject(self.handle, 2_000);
        }
    }
}

impl Drop for ElevatedInstallerProcess {
    fn drop(&mut self) {
        unsafe {
            let _ = windows::Win32::Foundation::CloseHandle(self.handle);
        }
    }
}

pub(super) fn spawn_mute_wait(
    mut cmd: std::process::Command,
    path: &Path,
    args: &str,
    run_as_administrator: bool,
    force_run_as_invoker: bool,
    control: &InstallControl,
) -> Result<(), RunInstallerError> {
    let exe_name = path.file_name().and_then(|n| n.to_str()).map(String::from);

    if run_as_administrator {
        log::info!(
            "[installer] launching {} with administrator privileges",
            path.display()
        );
        let elevated = launch_elevated_command(path, args).map_err(RunInstallerError::Failed)?;
        return wait_for_elevated_installer(elevated, path, exe_name, control);
    }

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(err) if err.raw_os_error() == Some(740) => {
            log::warn!(
                "[installer] Windows reported elevation required (error 740) for {}",
                path.display()
            );
            return Err(RunInstallerError::RequiresAdministrator);
        }
        Err(err) => return Err(RunInstallerError::Failed(err.to_string())),
    };

    if force_run_as_invoker {
        log::info!(
            "[installer] non-admin launch started successfully for {}; any later UAC prompt is coming from the installer, not Claudio fallback",
            path.display()
        );
    }

    log::info!(
        "[installer] launched installer {} with PID {}",
        path.display(),
        child.id()
    );
    control.set_installer_process(child.id(), exe_name.clone());
    crate::windows_integration::mute_process_audio(child.id(), exe_name);
    loop {
        control.refresh_tracked_processes();
        if control.take_restart_interactive_request() {
            log::info!("[installer] stopping installer to relaunch interactively");
            terminate_external_installer(control);
            control.clear_installer_processes();
            control.set_cancelled(false);
            return Err(RunInstallerError::RestartInteractiveRequested);
        }

        if control.is_cancelled() {
            log::info!("[installer] stopping installer after cancel request");
            terminate_external_installer(control);
            control.clear_installer_processes();
            return Err(RunInstallerError::Cancelled);
        }

        match child
            .try_wait()
            .map_err(|err| RunInstallerError::Failed(err.to_string()))?
        {
            Some(status) => {
                control.clear_installer_processes();
                return if status.success() {
                    Ok(())
                } else {
                    Err(RunInstallerError::Failed(format!(
                        "Installer exited with status {status}."
                    )))
                };
            }
            None => std::thread::sleep(std::time::Duration::from_millis(120)),
        }
    }
}

pub(super) fn wait_for_elevated_installer(
    elevated: ElevatedInstallerProcess,
    path: &Path,
    exe_name: Option<String>,
    control: &InstallControl,
) -> Result<(), RunInstallerError> {
    log::info!(
        "[installer] launched elevated installer {} with PID {}",
        path.display(),
        elevated.pid()
    );
    control.set_installer_process(elevated.pid(), exe_name.clone());
    crate::windows_integration::mute_process_audio(elevated.pid(), exe_name);

    loop {
        control.refresh_tracked_processes();
        if control.take_restart_interactive_request() {
            log::info!("[installer] stopping elevated installer to relaunch interactively");
            elevated.terminate();
            terminate_external_installer(control);
            control.clear_installer_processes();
            control.set_cancelled(false);
            return Err(RunInstallerError::RestartInteractiveRequested);
        }

        if control.is_cancelled() {
            log::info!("[installer] stopping elevated installer after cancel request");
            elevated.terminate();
            terminate_external_installer(control);
            control.clear_installer_processes();
            return Err(RunInstallerError::Cancelled);
        }

        match elevated.try_wait() {
            Ok(Some(0)) => {
                control.clear_installer_processes();
                return Ok(());
            }
            Ok(Some(code)) => {
                control.clear_installer_processes();
                return Err(RunInstallerError::Failed(format!(
                    "Installer exited with status code {code}."
                )));
            }
            Ok(None) => std::thread::sleep(std::time::Duration::from_millis(120)),
            Err(error) => {
                control.clear_installer_processes();
                return Err(RunInstallerError::Failed(error));
            }
        }
    }
}

pub(super) fn launch_elevated_command(
    path: &Path,
    args: &str,
) -> Result<ElevatedInstallerProcess, String> {
    use std::ffi::OsStr;
    use std::iter;
    use std::os::windows::ffi::OsStrExt;
    use windows::Win32::System::Threading::GetProcessId;
    use windows::Win32::UI::Shell::{SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW, ShellExecuteExW};
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
    use windows::core::PCWSTR;

    log::info!(
        "Installer requires elevation, requesting UAC prompt for {}",
        path.display()
    );

    let wide = |value: &OsStr| -> Vec<u16> { value.encode_wide().chain(iter::once(0)).collect() };

    let verb = wide(OsStr::new("runas"));
    let file = wide(path.as_os_str());
    let parameters = (!args.is_empty()).then(|| wide(OsStr::new(args)));
    let directory = path.parent().map(|parent| wide(parent.as_os_str()));

    let mut exec_info = SHELLEXECUTEINFOW::default();
    exec_info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
    exec_info.fMask = SEE_MASK_NOCLOSEPROCESS;
    exec_info.lpVerb = PCWSTR(verb.as_ptr());
    exec_info.lpFile = PCWSTR(file.as_ptr());
    exec_info.lpParameters = parameters
        .as_ref()
        .map_or(PCWSTR::null(), |value| PCWSTR(value.as_ptr()));
    exec_info.lpDirectory = directory
        .as_ref()
        .map_or(PCWSTR::null(), |value| PCWSTR(value.as_ptr()));
    exec_info.nShow = SW_SHOWNORMAL.0;

    unsafe {
        ShellExecuteExW(&mut exec_info).map_err(|error| error.to_string())?;
        if exec_info.hProcess.is_invalid() {
            return Err("Elevated installer launch did not return a process handle.".to_string());
        }

        let pid = GetProcessId(exec_info.hProcess);
        if pid == 0 {
            let _ = windows::Win32::Foundation::CloseHandle(exec_info.hProcess);
            return Err("Elevated installer launch did not return a valid PID.".to_string());
        }

        Ok(ElevatedInstallerProcess {
            handle: exec_info.hProcess,
            pid,
        })
    }
}
