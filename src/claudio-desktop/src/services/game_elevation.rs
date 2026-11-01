use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::path::Path;
use windows::Win32::Foundation::CloseHandle;
use windows::Win32::System::Threading::GetProcessId;
use windows::Win32::UI::Shell::{SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW, ShellExecuteExW};
use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
use windows::core::PCWSTR;

pub fn launch(path: &Path, parameters: &str) -> Result<u32, String> {
    let wide = |text: &OsStr| text.encode_wide().chain(Some(0)).collect::<Vec<_>>();
    let verb = wide(OsStr::new("runas"));
    let file = wide(path.as_os_str());
    let arguments = wide(OsStr::new(parameters));
    let directory = wide(path.parent().unwrap_or_else(|| Path::new(".")).as_os_str());
    let mut info = SHELLEXECUTEINFOW {
        cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
        fMask: SEE_MASK_NOCLOSEPROCESS,
        lpVerb: PCWSTR(verb.as_ptr()),
        lpFile: PCWSTR(file.as_ptr()),
        lpParameters: PCWSTR(arguments.as_ptr()),
        lpDirectory: PCWSTR(directory.as_ptr()),
        nShow: SW_SHOWNORMAL.0,
        ..Default::default()
    };
    unsafe {
        ShellExecuteExW(&mut info).map_err(|error| format!("Failed to launch game: {error}"))?;
        if info.hProcess.is_invalid() {
            return Err("Elevated launch did not return a process handle.".into());
        }
        let pid = GetProcessId(info.hProcess);
        let _ = CloseHandle(info.hProcess);
        if pid == 0 {
            return Err("Elevated launch did not return a valid process ID.".into());
        }
        Ok(pid)
    }
}
