import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export const isDesktop = globalThis.window !== undefined && "__TAURI_INTERNALS__" in globalThis;

interface DesktopSession {
  isLoggedIn: boolean;
  user: DesktopSessionUser | null;
}

interface DesktopSessionUser {
  id: number;
  username: string;
  role: "user" | "admin";
}

interface DesktopSettings {
  serverUrl: string | null;
  logLevel: "error" | "warn" | "info" | "debug" | "trace";
  windowWidth: number;
  windowHeight: number;
  windowX: number | null;
  windowY: number | null;
  defaultInstallPath: string | null;
  closeToTray: boolean;
  hideDockIcon: boolean;
  customHeaders: Record<string, string>;
  allowInsecureAuthStorage: boolean;
  downloadSpeedLimitKbs: number | null;
}

interface PingResponse {
  version: string;
  platform: string;
}

interface DownloadPackageInput {
  id: number;
  title: string;
  targetDir: string;
  extract: boolean;
}

interface DesktopInstallGameInput {
  id: number;
  title: string;
  platform: string;
  installType: "portable" | "installer";
  installerExe?: string | null;
  gameExe?: string | null;
  installPath?: string | null;
  desktopShortcut?: boolean;
  runAsAdministrator?: boolean;
  forceInteractive?: boolean;
  summary?: string | null;
  genre?: string | null;
  releaseYear?: number | null;
  coverUrl?: string | null;
  heroUrl?: string | null;
  developer?: string | null;
  publisher?: string | null;
  gameMode?: string | null;
  series?: string | null;
  franchise?: string | null;
  gameEngine?: string | null;
  igdbId?: number | null;
  igdbSlug?: string | null;
}

interface InstalledGame {
  remoteGameId: number;
  title: string;
  platform: string;
  installType: "portable" | "installer";
  installPath: string;
  gameExe?: string | null;
  installedAt: string;
  summary?: string | null;
  genre?: string | null;
  releaseYear?: number | null;
  coverUrl?: string | null;
  heroUrl?: string | null;
  developer?: string | null;
  publisher?: string | null;
  gameMode?: string | null;
  series?: string | null;
  franchise?: string | null;
  gameEngine?: string | null;
  igdbId?: number | null;
  igdbSlug?: string | null;
}

interface InstallProgress {
  gameId: number;
  status: string;
  percent?: number | null;
  indeterminate?: boolean | null;
  detail?: string | null;
  bytesDownloaded?: number | null;
  totalBytes?: number | null;
}

interface RunningGame {
  gameId: number;
  pid: number;
  exePath: string;
  startedAt: string;
}

export async function ping(): Promise<PingResponse> {
  return invoke<PingResponse>("ping");
}

export async function getSettings(): Promise<DesktopSettings> {
  return invoke<DesktopSettings>("get_settings");
}

export async function updateSettings(settings: DesktopSettings): Promise<void> {
  return invoke<void>("update_settings", { settings });
}

export async function openSettingsWindow(): Promise<void> {
  return invoke<void>("open_settings_window");
}

export async function desktopGetSession(): Promise<DesktopSession> {
  return invoke<DesktopSession>("desktop_get_session");
}

export async function desktopLogin(username: string, password: string): Promise<DesktopSession> {
  return invoke<DesktopSession>("desktop_login", { username, password });
}

export async function desktopCompleteExternalLogin(nonce: string): Promise<DesktopSession> {
  return invoke<DesktopSession>("desktop_complete_external_login", { nonce });
}

export async function desktopProxyLogin(): Promise<DesktopSession> {
  return invoke<DesktopSession>("desktop_proxy_login");
}

export async function desktopLogout(): Promise<DesktopSession> {
  return invoke<DesktopSession>("desktop_logout");
}

export async function installGame(game: DesktopInstallGameInput): Promise<InstalledGame> {
  return invoke<InstalledGame>("install_game", { game });
}

export async function downloadGamePackage(input: DownloadPackageInput): Promise<string> {
  return invoke<string>("download_game_package", { input });
}

export async function resolveInstallPath(gameTitle: string): Promise<string> {
  return invoke<string>("resolve_install_path", { gameTitle });
}

export async function getInstalledGame(remoteGameId: number): Promise<InstalledGame | null> {
  return invoke<InstalledGame | null>("get_installed_game", { remoteGameId });
}

export async function listInstalledGames(): Promise<InstalledGame[]> {
  return invoke<InstalledGame[]>("list_installed_games");
}

export async function openInstallFolder(remoteGameId: number): Promise<void> {
  return invoke<void>("open_install_folder", { remoteGameId });
}

export async function cancelInstall(gameId: number): Promise<void> {
  return invoke<void>("cancel_install", { gameId });
}

export async function restartInstallInteractive(gameId: number): Promise<void> {
  return invoke<void>("restart_install_interactive", { gameId });
}

export async function uninstallGame(remoteGameId: number, deleteFiles: boolean): Promise<void> {
  return invoke<void>("uninstall_game", { remoteGameId, deleteFiles });
}

export async function launchGame(remoteGameId: number): Promise<void> {
  return invoke<void>("launch_game", { remoteGameId });
}

export async function stopGame(remoteGameId: number): Promise<void> {
  return invoke<void>("stop_game", { remoteGameId });
}

export async function listRunningGames(): Promise<RunningGame[]> {
  return invoke<RunningGame[]>("list_running_games");
}

export async function setGameExe(remoteGameId: number, gameExe: string): Promise<InstalledGame> {
  return invoke<InstalledGame>("set_game_exe", { remoteGameId, gameExe });
}

export async function listGameExecutables(remoteGameId: number): Promise<string[]> {
  return invoke<string[]>("list_game_executables", { remoteGameId });
}

export async function listenToInstallProgress(
  handler: (progress: InstallProgress) => void,
): Promise<UnlistenFn> {
  return listen<InstallProgress>("install-progress", (event) => {
    handler(event.payload);
  });
}

export function useDesktop() {
  return {
    isDesktop,
    desktopGetSession,
    desktopLogin,
    desktopCompleteExternalLogin,
    desktopProxyLogin,
    desktopLogout,
    ping,
    getSettings,
    updateSettings,
    openSettingsWindow,
    installGame,
    getInstalledGame,
    listInstalledGames,
    openInstallFolder,
    listenToInstallProgress,
  };
}

export type {
  DesktopInstallGameInput,
  DownloadPackageInput,
  DesktopSession,
  DesktopSettings,
  InstalledGame,
  InstallProgress,
  PingResponse,
  RunningGame,
};
