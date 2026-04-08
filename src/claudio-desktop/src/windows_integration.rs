use crate::models::{InstallType, InstalledGame};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::Media::Audio::{
    IAudioSessionControl2, IAudioSessionEnumerator, IAudioSessionManager2, IMMDeviceEnumerator,
    ISimpleAudioVolume, MMDeviceEnumerator, eConsole, eRender,
};
use windows::Win32::System::Com::{
    CLSCTX_ALL, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx,
};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, PROCESSENTRY32, Process32First, Process32Next, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::Threading::{
    OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE, TerminateProcess,
    WaitForSingleObject,
};
use windows::core::Interface;
use winreg::RegKey;
use winreg::enums::{HKEY_CURRENT_USER, KEY_WRITE};

mod audio;
mod registration;
mod shell_dirs;
#[cfg(test)]
mod tests;

pub(crate) const UNINSTALL_ROOT: &str = "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall";

use audio::{
    collect_tracked_processes as collect_tracked_processes_inner, expand_process_tree,
    mute_process_audio as mute_process_audio_inner,
    terminate_tracked_processes as terminate_tracked_processes_inner,
};
use registration::{
    create_shortcut, days_to_ymd, deregister as deregister_inner, register as register_inner,
    register_from_resource_dir, registry_key_name, write_registry,
};
use shell_dirs::{desktop_shortcut_path, start_menu_shortcut_path, with_test_shell_dirs};

pub fn mute_process_audio(pid: u32, exe_name: Option<String>) {
    mute_process_audio_inner(pid, exe_name);
}

pub fn collect_tracked_processes(seed_pids: &[u32], exe_name: Option<&str>) -> Vec<u32> {
    collect_tracked_processes_inner(seed_pids, exe_name)
}

pub fn terminate_tracked_processes(
    seed_pids: &[u32],
    exe_name: Option<&str>,
) -> Result<(), String> {
    terminate_tracked_processes_inner(seed_pids, exe_name)
}

pub fn register(app: &AppHandle, game: &InstalledGame, desktop_shortcut: bool) {
    register_inner(app, game, desktop_shortcut);
}

pub fn deregister(game: &InstalledGame) {
    deregister_inner(game);
}
