use super::*;

pub(super) fn mute_process_audio(pid: u32, exe_name: Option<String>) {
    std::thread::spawn(move || {
        for _ in 0..400 {
            let _ = try_mute_sessions(pid, exe_name.as_deref());
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
    });
}

pub(super) fn collect_tracked_processes(seed_pids: &[u32], exe_name: Option<&str>) -> Vec<u32> {
    let entries = snapshot_processes();
    let mut tracked = expand_process_tree(&entries, seed_pids);

    if let Some(name) = exe_name {
        for found_pid in find_pids_matching(|exe| exe.eq_ignore_ascii_case(name)) {
            if !tracked.contains(&found_pid) {
                tracked.push(found_pid);
            }
        }
    }

    for found_pid in find_pids_matching(|exe| exe.to_ascii_lowercase().ends_with(".tmp")) {
        if !tracked.contains(&found_pid) {
            tracked.push(found_pid);
        }
    }

    tracked.sort_unstable();
    tracked.dedup();
    tracked
}

pub(super) fn terminate_tracked_processes(
    seed_pids: &[u32],
    exe_name: Option<&str>,
) -> Result<(), String> {
    let mut target_pids = collect_tracked_processes(seed_pids, exe_name);
    log::info!(
        "[installer] terminating tracked processes {:?} (exe_name={:?})",
        target_pids,
        exe_name
    );

    for _ in 0..3 {
        for target_pid in &target_pids {
            terminate_process(*target_pid);
        }

        std::thread::sleep(std::time::Duration::from_millis(120));
        target_pids = collect_tracked_processes(&target_pids, exe_name);
        if target_pids.is_empty() {
            break;
        }
    }

    Ok(())
}

fn terminate_process(pid: u32) {
    let result = with_process_handle(
        pid,
        PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION,
        |handle| unsafe {
            let _ = TerminateProcess(handle, 1);
            let _ = WaitForSingleObject(handle, 2_000);
        },
    );

    if result.is_some() {
        log::info!("[installer] terminate requested for PID {pid}");
    }
}

fn with_process_handle<T>(
    pid: u32,
    access: windows::Win32::System::Threading::PROCESS_ACCESS_RIGHTS,
    callback: impl FnOnce(HANDLE) -> T,
) -> Option<T> {
    unsafe {
        let handle = match OpenProcess(access, false, pid) {
            Ok(handle) if !handle.is_invalid() => handle,
            _ => return None,
        };

        let result = callback(handle);
        let _ = CloseHandle(handle);
        Some(result)
    }
}

pub(super) fn expand_process_tree(entries: &[(u32, u32)], root_pids: &[u32]) -> Vec<u32> {
    let mut tree: Vec<u32> = root_pids.iter().copied().filter(|pid| *pid != 0).collect();
    loop {
        let prev_len = tree.len();
        for &(pid, parent) in entries {
            if tree.contains(&parent) && !tree.contains(&pid) {
                tree.push(pid);
            }
        }
        if tree.len() == prev_len {
            break;
        }
    }
    tree
}

fn get_process_tree(root_pid: u32) -> Vec<u32> {
    let entries = snapshot_processes();
    expand_process_tree(&entries, &[root_pid])
}

fn snapshot_processes() -> Vec<(u32, u32)> {
    let mut out = Vec::new();
    unsafe {
        let snapshot = match CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) {
            Ok(s) => s,
            Err(_) => return out,
        };
        let mut entry = PROCESSENTRY32 {
            dwSize: std::mem::size_of::<PROCESSENTRY32>() as u32,
            ..Default::default()
        };
        if Process32First(snapshot, &mut entry).is_ok() {
            loop {
                out.push((entry.th32ProcessID, entry.th32ParentProcessID));
                if Process32Next(snapshot, &mut entry).is_err() {
                    break;
                }
            }
        }
        let _ = windows::Win32::Foundation::CloseHandle(snapshot);
    }
    out
}

fn find_pids_matching(predicate: impl Fn(&str) -> bool) -> Vec<u32> {
    let mut out = Vec::new();
    unsafe {
        let snapshot = match CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) {
            Ok(s) => s,
            Err(_) => return out,
        };
        let mut entry = PROCESSENTRY32 {
            dwSize: std::mem::size_of::<PROCESSENTRY32>() as u32,
            ..Default::default()
        };
        if Process32First(snapshot, &mut entry).is_ok() {
            loop {
                let exe_bytes: Vec<u8> = entry
                    .szExeFile
                    .iter()
                    .map(|c| *c as u8)
                    .take_while(|&c| c != 0)
                    .collect();
                let exe = String::from_utf8_lossy(&exe_bytes);
                if predicate(&exe) {
                    out.push(entry.th32ProcessID);
                }
                if Process32Next(snapshot, &mut entry).is_err() {
                    break;
                }
            }
        }
        let _ = windows::Win32::Foundation::CloseHandle(snapshot);
    }
    out
}

fn try_mute_sessions(pid: u32, exe_name: Option<&str>) -> Result<usize, String> {
    let mut target_pids: Vec<u32> = if pid != 0 {
        get_process_tree(pid)
    } else {
        Vec::new()
    };

    if let Some(name) = exe_name {
        for found_pid in find_pids_matching(|exe| exe.eq_ignore_ascii_case(name)) {
            if !target_pids.contains(&found_pid) {
                target_pids.push(found_pid);
            }
        }
    }

    for found_pid in find_pids_matching(|exe| exe.to_ascii_lowercase().ends_with(".tmp")) {
        if !target_pids.contains(&found_pid) {
            target_pids.push(found_pid);
        }
    }

    let mut muted_count = 0;

    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

        let device_enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                .map_err(|e| format!("Failed to create IMMDeviceEnumerator: {e}"))?;

        let device = device_enumerator
            .GetDefaultAudioEndpoint(eRender, eConsole)
            .map_err(|e| format!("Failed to get default audio endpoint: {e}"))?;

        let session_manager: IAudioSessionManager2 = device
            .Activate(CLSCTX_ALL, None)
            .map_err(|e| format!("Failed to activate IAudioSessionManager2: {e}"))?;

        let session_enumerator: IAudioSessionEnumerator = session_manager
            .GetSessionEnumerator()
            .map_err(|e| format!("Failed to get session enumerator: {e}"))?;

        let count = session_enumerator
            .GetCount()
            .map_err(|e| format!("Failed to get session count: {e}"))?;

        for i in 0..count {
            let session = match session_enumerator.GetSession(i) {
                Ok(s) => s,
                Err(_) => continue,
            };

            let session2: IAudioSessionControl2 = match session.cast() {
                Ok(s) => s,
                Err(_) => continue,
            };

            let session_pid = session2.GetProcessId().unwrap_or(0);
            if !target_pids.contains(&session_pid) {
                continue;
            }

            let volume: ISimpleAudioVolume = match session.cast() {
                Ok(v) => v,
                Err(_) => continue,
            };
            if let Ok(is_muted) = volume.GetMute() {
                if !is_muted.as_bool() {
                    if volume.SetMute(true, std::ptr::null()).is_ok() {
                        muted_count += 1;
                    }
                } else {
                    muted_count += 1;
                }
            }
        }
        Ok(muted_count)
    }
}
