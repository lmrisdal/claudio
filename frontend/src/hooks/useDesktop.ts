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

export async function ping(): Promise<PingResponse> {
  return invoke<PingResponse>("ping");
}

export async function getSettings(): Promise<DesktopSettings> {
  return invoke<DesktopSettings>("get_settings");
}

export async function updateSettings(settings: DesktopSettings): Promise<void> {
  return invoke<void>("update_settings", { settings });
}


export function useDesktop() {
  return { isDesktop, ping, getSettings, updateSettings };
}

export type { DesktopSettings, PingResponse };
