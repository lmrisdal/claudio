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
    collect_tracked_processes as collect_tracked_processes_inner,
    mute_process_audio as mute_process_audio_inner,
    terminate_tracked_processes as terminate_tracked_processes_inner,
};
use registration::{deregister as deregister_inner, register as register_inner};

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

#[cfg(test)]
pub(crate) fn expand_process_tree(entries: &[(u32, u32)], root_pids: &[u32]) -> Vec<u32> {
    audio::expand_process_tree(entries, root_pids)
}

#[cfg(test)]
pub(crate) fn create_shortcut(exe_path: &str, shortcut_path: &Path) -> Result<(), String> {
    registration::create_shortcut(exe_path, shortcut_path)
}

#[cfg(test)]
pub(crate) fn write_registry(
    game: &InstalledGame,
    key_name: &str,
    install_dir: &Path,
    uninstall_exe: &Path,
) -> Result<(), String> {
    registration::write_registry(game, key_name, install_dir, uninstall_exe)
}

#[cfg(test)]
pub(crate) fn days_to_ymd(days: u32) -> (u32, u32, u32) {
    registration::days_to_ymd(days)
}

#[cfg(any(test, feature = "integration-tests"))]
pub(crate) fn registry_key_name(remote_game_id: i32) -> String {
    registration::registry_key_name(remote_game_id)
}

#[cfg(feature = "integration-tests")]
pub(crate) fn register_from_resource_dir(
    resource_dir: &Path,
    game: &InstalledGame,
    desktop_shortcut: bool,
) {
    registration::register_from_resource_dir(resource_dir, game, desktop_shortcut);
}

#[cfg(feature = "integration-tests")]
pub(crate) fn with_test_shell_dirs<T>(
    start_menu_dir: PathBuf,
    desktop_dir: PathBuf,
    run: impl FnOnce() -> T,
) -> T {
    shell_dirs::with_test_shell_dirs(start_menu_dir, desktop_dir, run)
}

#[cfg(feature = "integration-tests")]
pub(crate) fn start_menu_shortcut_path(title: &str) -> PathBuf {
    shell_dirs::start_menu_shortcut_path(title)
}

#[cfg(feature = "integration-tests")]
pub(crate) fn desktop_shortcut_path(title: &str) -> PathBuf {
    shell_dirs::desktop_shortcut_path(title)
}
