use crate::auth;
use crate::models::{
    DownloadPackageInput, InstallProgress, InstallType, InstalledGame, RemoteGame,
};
use crate::refresh_auth_state_ui;
use crate::registry;
use crate::settings;
use flate2::read::GzDecoder;
use futures_util::StreamExt;
use reqwest::header::{AUTHORIZATION, CONTENT_DISPOSITION, HeaderMap, HeaderName, HeaderValue};
use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::io;
#[cfg(target_os = "windows")]
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tar::Archive;
use tauri::{AppHandle, Emitter, State};
#[cfg(target_os = "windows")]
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use zip::read::ZipArchive;

mod api;
mod auth_headers;
mod download;
mod download_individual;
mod extract;
mod file_ops;
mod install;
mod installer_cleanup;
mod installer_detect;
#[cfg(target_os = "windows")]
mod installer_elevated;
#[cfg(target_os = "windows")]
mod installer_innoextract;
mod installer_install;
mod installer_run;
#[cfg(feature = "integration-tests")]
pub(crate) mod integration_testing;
mod paths;
mod progress;
mod state;
#[cfg(test)]
mod tests;

pub use api::{
    cancel_install, cleanup_failed_install, download_game_package, get_installed_game,
    install_game, list_game_executables, list_installed_games, open_install_folder,
    resolve_default_download_root_path, resolve_download_path, resolve_install_path,
    restart_install_interactive, set_game_exe, uninstall_game, validate_install_target,
};
pub use state::InstallState;

#[cfg(test)]
use auth_headers::build_headers;
use auth_headers::{authenticated_headers_with, refreshed_headers_with};
#[cfg(any(test, feature = "integration-tests"))]
use download::download_package_with;
use download::{DownloadInfo, DownloadOptions, download_package};
use download_individual::download_files_individually;
use extract::{extract_archive_or_copy, extract_archive_subprocess, infer_filename};
#[cfg(any(test, feature = "integration-tests"))]
use file_ops::visible_entries;
use file_ops::{
    apply_scene_overrides, clear_existing_path, collect_matching_files, copy_dir_contents,
    move_visible_entries_into_dir, normalize_into_final_dir, sanitize_segment,
};
use install::{install_game_inner, urlencoding_encode};
#[cfg(any(test, feature = "integration-tests"))]
use installer_cleanup::cleanup_failed_installer_state;
use installer_cleanup::{cleanup_directory, cleanup_partial_install_dir};
#[cfg(test)]
use installer_detect::detect_installer;
use installer_detect::{
    InstallerAttemptConfig, InstallerLaunchKind, detect_windows_executable,
    file_requests_elevation, installer_attempt_config, installer_launch_kind,
    resolve_installer_path,
};
#[cfg(all(test, target_os = "windows"))]
use installer_detect::{InstallerType, detect_installer_type, stream_requests_elevation};
#[cfg(all(feature = "integration-tests", target_os = "windows"))]
use installer_innoextract::run_innoextract_with_binary;
use installer_install::install_installer;
use installer_run::{confirm_installer_elevation, run_installer, run_installer_with_retries};
use paths::{
    build_install_dir, download_workspace_root, format_install_io_error,
    format_install_io_error_pair, install_download_root, installer_staging_dir, log_io_failure,
    log_io_failure_pair, validate_install_target_path,
};
use progress::{
    current_timestamp, emit_progress, emit_progress_indeterminate, emit_progress_with_bytes_to,
};
use state::InstallControl;
