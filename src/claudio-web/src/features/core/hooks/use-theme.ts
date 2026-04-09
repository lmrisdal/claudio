import { useEffect, useSyncExternalStore } from "react";

export type ThemePreference = "system" | "dark" | "light";
export type ResolvedTheme = "dark" | "light";

const THEME_KEY = "theme";
const THEME_EVENT = "claudio:theme-changed";

function getThemePreferenceSnapshot(): ThemePreference {
  const stored = localStorage.getItem(THEME_KEY) as ThemePreference | null;
  if (stored === "dark" || stored === "light" || stored === "system") {
    return stored;
  }

  return "system";
}

function subscribeToThemePreference(callback: () => void) {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === THEME_KEY) {
      callback();
    }
  };
  const handleThemeChange = () => {
    callback();
  };

  globalThis.addEventListener("storage", handleStorage);
  globalThis.addEventListener(THEME_EVENT, handleThemeChange);

  return () => {
    globalThis.removeEventListener("storage", handleStorage);
    globalThis.removeEventListener(THEME_EVENT, handleThemeChange);
  };
}

export function setThemePreference(theme: ThemePreference) {
  localStorage.setItem(THEME_KEY, theme);
  globalThis.dispatchEvent(new Event(THEME_EVENT));
}

function subscribeToColorScheme(callback: () => void) {
  const mq = globalThis.matchMedia("(prefers-color-scheme: light)");
  mq.addEventListener("change", callback);
  return () => mq.removeEventListener("change", callback);
}

function getColorSchemeSnapshot() {
  return globalThis.matchMedia("(prefers-color-scheme: light)").matches;
}

export function resolveThemePreference(
  preference: ThemePreference,
  systemIsLight: boolean,
): ResolvedTheme {
  return preference === "system" ? (systemIsLight ? "light" : "dark") : preference;
}

export function useTheme() {
  const pref = useSyncExternalStore(
    subscribeToThemePreference,
    getThemePreferenceSnapshot,
    getThemePreferenceSnapshot,
  );

  const systemIsLight = useSyncExternalStore(
    subscribeToColorScheme,
    getColorSchemeSnapshot,
    () => false,
  );

  const resolved = resolveThemePreference(pref, systemIsLight);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(resolved);
  }, [resolved]);

  return { theme: pref, resolvedTheme: resolved, setTheme: setThemePreference };
}
