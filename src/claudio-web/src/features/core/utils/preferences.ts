const FULLSCREEN_KEY = "claudio-emulator-fullscreen";
const REDUCED_TRANSPARENCY_KEY = "claudio-reduce-transparency";
const REDUCED_TRANSPARENCY_EVENT = "claudio:reduce-transparency-changed";
const APP_TINT_KEY = "claudio-app-tint";
const APP_TINT_EVENT = "claudio:app-tint-changed";

export interface AppTintPreference {
  hue: number;
  intensity: number;
}

export const DEFAULT_APP_TINT: AppTintPreference = {
  hue: 172,
  intensity: 46,
};

let cachedAppTintRaw: string | null = null;
let cachedAppTint = DEFAULT_APP_TINT;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeHue(value: number) {
  const rounded = Math.round(value);
  return ((rounded % 361) + 361) % 361;
}

function normalizeIntensity(value: number) {
  return clamp(Math.round(value), 0, 50);
}

function sanitizeAppTint(value: Partial<AppTintPreference> | null | undefined): AppTintPreference {
  const hue = Number.isFinite(value?.hue)
    ? normalizeHue(value?.hue ?? DEFAULT_APP_TINT.hue)
    : DEFAULT_APP_TINT.hue;
  const intensity = Number.isFinite(value?.intensity)
    ? normalizeIntensity(value?.intensity ?? DEFAULT_APP_TINT.intensity)
    : DEFAULT_APP_TINT.intensity;

  return {
    hue,
    intensity,
  };
}

function notifyAppTintChanged() {
  globalThis.dispatchEvent(new Event(APP_TINT_EVENT));
}

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

export function getAppTint(): AppTintPreference {
  const raw = localStorage.getItem(APP_TINT_KEY);
  if (!raw) {
    cachedAppTintRaw = null;
    cachedAppTint = DEFAULT_APP_TINT;
    return DEFAULT_APP_TINT;
  }

  if (raw === cachedAppTintRaw) {
    return cachedAppTint;
  }

  try {
    cachedAppTintRaw = raw;
    cachedAppTint = sanitizeAppTint(JSON.parse(raw) as Partial<AppTintPreference>);
    return cachedAppTint;
  } catch {
    cachedAppTintRaw = null;
    cachedAppTint = DEFAULT_APP_TINT;
    return DEFAULT_APP_TINT;
  }
}

export function setAppTint(nextTint: Partial<AppTintPreference>) {
  const currentTint = getAppTint();
  const tint = sanitizeAppTint({
    hue: nextTint.hue ?? currentTint.hue,
    intensity: nextTint.intensity ?? currentTint.intensity,
  });

  const raw = JSON.stringify(tint);
  cachedAppTintRaw = raw;
  cachedAppTint = tint;
  localStorage.setItem(APP_TINT_KEY, raw);
  notifyAppTintChanged();
}

export function resetAppTint() {
  cachedAppTintRaw = null;
  cachedAppTint = DEFAULT_APP_TINT;
  localStorage.removeItem(APP_TINT_KEY);
  notifyAppTintChanged();
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

export function subscribeToAppTint(callback: () => void) {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === APP_TINT_KEY) {
      callback();
    }
  };
  const handlePreferenceChange = () => {
    callback();
  };

  globalThis.addEventListener("storage", handleStorage);
  globalThis.addEventListener(APP_TINT_EVENT, handlePreferenceChange);

  return () => {
    globalThis.removeEventListener("storage", handleStorage);
    globalThis.removeEventListener(APP_TINT_EVENT, handlePreferenceChange);
  };
}
