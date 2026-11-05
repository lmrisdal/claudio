export const CHANNELS = {
  invoke: "claudio:invoke",
  event: "claudio:event",
  windowControl: "claudio:window-control",
  openDialog: "claudio:open-dialog",
  log: "claudio:log",
  updatesCheck: "claudio:updates-check",
  updatesDownload: "claudio:updates-download",
  updatesInstall: "claudio:updates-install",
} as const;

export const APP_SCHEME = "claudio-app";
export const API_SCHEME = "claudio";
export const APP_ORIGIN = `${APP_SCHEME}://app`;

export type WindowControl = "minimize" | "toggleMaximize" | "close";
export type InvokeResult = { ok: true; value: unknown } | { ok: false; error: string };

export interface OpenDialogOptions {
  directory?: boolean;
  title?: string;
  defaultPath?: string;
}

export const UPDATE_DOWNLOAD_EVENT = "update-download";

export interface UpdateInfo {
  version: string;
  body?: string | null;
}

export interface UpdateDownloadEvent {
  event: "Started" | "Progress" | "Finished";
  data?: { contentLength?: number | null; chunkLength?: number };
}

export const CORE_METHODS = [
  "install_game",
  "retry_cached_install",
  "download_game_package",
  "cancel_install",
  "restart_install_interactive",
  "cleanup_failed_install",
  "uninstall_game",
  "validate_install_target",
  "resolve_install_path",
  "resolve_install_browse_root",
  "get_disk_space",
  "resolve_default_download_root",
  "resolve_download_path",
  "open_install_folder",
  "list_installed_games",
  "get_installed_game",
  "list_game_executables",
  "set_game_exe",
  "update_game_launch_settings",
  "add_steam_shortcut",
  "launch_game",
  "stop_game",
  "list_running_games",
  "list_proton_versions",
  "get_settings",
  "update_settings",
  "ping",
  "desktop_check_server_connection",
] as const;

export const SHELL_METHODS = ["restart_app"] as const;
