import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export const isDesktop = globalThis.window !== undefined && "__TAURI_INTERNALS__" in globalThis;

interface DesktopSettings {
  serverUrl: string | null;
  windowWidth: number;
  windowHeight: number;
  windowX: number | null;
  windowY: number | null;
  defaultInstallPath: string | null;
  closeToTray: boolean;
  customHeaders: Record<string, string>;
  downloadSpeedLimitKbs: number | null;
}

interface PingResponse {
  version: string;
  platform: string;
}

interface DesktopInstallGameInput {
  id: number;
  title: string;
  platform: string;
  installType: "portable" | "installer";
  installerExe?: string | null;
  gameExe?: string | null;
  installPath?: string | null;
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
  detail?: string | null;
  bytesDownloaded?: number | null;
  totalBytes?: number | null;
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

export async function installGame(
  game: DesktopInstallGameInput,
  token: string,
): Promise<InstalledGame> {
  return invoke<InstalledGame>("install_game", { game, token });
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

export async function uninstallGame(remoteGameId: number, deleteFiles: boolean): Promise<void> {
  return invoke<void>("uninstall_game", { remoteGameId, deleteFiles });
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
    ping,
    getSettings,
    updateSettings,
    installGame,
    getInstalledGame,
    listInstalledGames,
    openInstallFolder,
    listenToInstallProgress,
  };
}

export type {
  DesktopInstallGameInput,
  DesktopSettings,
  InstalledGame,
  InstallProgress,
  PingResponse,
};
