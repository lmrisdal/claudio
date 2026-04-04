const FULLSCREEN_KEY = "claudio-emulator-fullscreen";

export function isEmulatorFullscreenEnabled(): boolean {
  return localStorage.getItem(FULLSCREEN_KEY) !== "false";
}

export function setEmulatorFullscreenEnabled(enabled: boolean) {
  localStorage.setItem(FULLSCREEN_KEY, String(enabled));
}
