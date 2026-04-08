const FULLSCREEN_KEY = "claudio-emulator-fullscreen";
const REDUCED_TRANSPARENCY_KEY = "claudio-reduce-transparency";
const REDUCED_TRANSPARENCY_EVENT = "claudio:reduce-transparency-changed";

export function isEmulatorFullscreenEnabled(): boolean {
  return localStorage.getItem(FULLSCREEN_KEY) !== "false";
}

export function setEmulatorFullscreenEnabled(enabled: boolean) {
  localStorage.setItem(FULLSCREEN_KEY, String(enabled));
}

export function isReducedTransparencyEnabled(): boolean {
  return localStorage.getItem(REDUCED_TRANSPARENCY_KEY) === "true";
}

export function setReducedTransparencyEnabled(enabled: boolean) {
  localStorage.setItem(REDUCED_TRANSPARENCY_KEY, String(enabled));
  globalThis.dispatchEvent(new Event(REDUCED_TRANSPARENCY_EVENT));
}

export function subscribeToReducedTransparency(callback: () => void) {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === REDUCED_TRANSPARENCY_KEY) {
      callback();
    }
  };
  const handlePreferenceChange = () => {
    callback();
  };

  globalThis.addEventListener("storage", handleStorage);
  globalThis.addEventListener(REDUCED_TRANSPARENCY_EVENT, handlePreferenceChange);

  return () => {
    globalThis.removeEventListener("storage", handleStorage);
    globalThis.removeEventListener(REDUCED_TRANSPARENCY_EVENT, handlePreferenceChange);
  };
}
