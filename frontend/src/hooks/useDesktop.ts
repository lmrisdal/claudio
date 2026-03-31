import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

export const isDesktop =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

interface DesktopSettings {
  serverUrl: string | null;
  windowWidth: number;
  windowHeight: number;
  windowX: number | null;
  windowY: number | null;
  defaultInstallPath: string | null;
  customHeaders: Record<string, string>;
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
}

interface InstalledGame {
  remoteGameId: number;
  title: string;
  platform: string;
  installType: "portable" | "installer";
  installPath: string;
  gameExe?: string | null;
  installedAt: string;
}

interface InstallProgress {
  gameId: number;
  status: string;
  percent?: number | null;
  detail?: string | null;
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

export async function getInstalledGame(
  remoteGameId: number,
): Promise<InstalledGame | null> {
  return invoke<InstalledGame | null>("get_installed_game", { remoteGameId });
}

export async function openInstallFolder(remoteGameId: number): Promise<void> {
  return invoke<void>("open_install_folder", { remoteGameId });
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
