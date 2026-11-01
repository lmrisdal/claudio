import { invoke, listen, type UnlistenFn } from "./desktop-bridge";

export const isDesktop = globalThis.window !== undefined && "claudioDesktop" in globalThis;

interface DesktopSettings {
  serverUrl: string | null;
  logLevel: "error" | "warn" | "info" | "debug" | "trace";
  windowWidth: number;
  windowHeight: number;
  windowX: number | null;
  windowY: number | null;
  defaultInstallPath: string | null;
  defaultDownloadPath: string | null;
  defaultProtonPath: string | null;
  closeToTray: boolean;
  customHeaders: Record<string, string>;
  downloadSpeedLimitKbs: number | null;
}

interface PingResponse {
  version: string;
  platform: string;
}

interface DesktopServerConnectionResult {
  ok: boolean;
  status: number | null;
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
  appMenuShortcut?: boolean;
  steamShortcut?: boolean;
  protonPath?: string | null;
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
  winePrefix?: string | null;
  protonPath?: string | null;
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

interface ProtonVersionOption {
  label: string;
  value: string;
}

export async function ping(): Promise<PingResponse> {
  return invoke<PingResponse>("ping");
}

export async function desktopCheckServerConnection(input?: {
  serverUrl?: string | null;
  customHeaders?: Record<string, string> | null;
  path?: string;
}): Promise<DesktopServerConnectionResult> {
  return invoke<DesktopServerConnectionResult>("desktop_check_server_connection", input);
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

export async function installGame(game: DesktopInstallGameInput): Promise<InstalledGame> {
  return invoke<InstalledGame>("install_game", { game });
}

export async function retryCachedInstall(game: DesktopInstallGameInput): Promise<InstalledGame> {
  return invoke<InstalledGame>("retry_cached_install", { game });
}

export async function listProtonVersions(): Promise<ProtonVersionOption[]> {
  return invoke<ProtonVersionOption[]>("list_proton_versions");
}

export async function downloadGamePackage(input: DownloadPackageInput): Promise<string> {
  return invoke<string>("download_game_package", { input });
}

export async function resolveInstallPath(gameTitle: string): Promise<string> {
  return invoke<string>("resolve_install_path", { gameTitle });
}

export async function validateInstallTarget(targetPath: string): Promise<void> {
  return invoke<void>("validate_install_target", { targetPath });
}

export async function resolveInstallBrowseRoot(targetPath: string): Promise<string | null> {
  return invoke<string | null>("resolve_install_browse_root", { targetPath });
}

export async function resolveDefaultDownloadRoot(): Promise<string> {
  return invoke<string>("resolve_default_download_root");
}

export async function resolveDownloadPath(gameTitle: string): Promise<string> {
  return invoke<string>("resolve_download_path", { gameTitle });
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

export async function addSteamShortcut(remoteGameId: number): Promise<void> {
  return invoke<void>("add_steam_shortcut", { remoteGameId });
}

export async function cancelInstall(gameId: number): Promise<void> {
  return invoke<void>("cancel_install", { gameId });
}

export async function restartInstallInteractive(gameId: number): Promise<void> {
  return invoke<void>("restart_install_interactive", { gameId });
}

export async function cleanupFailedInstall(game: DesktopInstallGameInput): Promise<void> {
  return invoke<void>("cleanup_failed_install", { game });
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
  return listen<InstallProgress>("install-progress", handler);
}

export function useDesktop() {
  return {
    isDesktop,
    desktopCheckServerConnection,
    ping,
    getSettings,
    updateSettings,
    openSettingsWindow,
    installGame,
    listProtonVersions,
    validateInstallTarget,
    getInstalledGame,
    listInstalledGames,
    openInstallFolder,
    listenToInstallProgress,
  };
}

export type {
  DesktopInstallGameInput,
  DownloadPackageInput,
  DesktopSettings,
  ProtonVersionOption,
  InstalledGame,
  InstallProgress,
  PingResponse,
  DesktopServerConnectionResult,
  RunningGame,
};
