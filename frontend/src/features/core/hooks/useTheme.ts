import { useEffect, useState, useSyncExternalStore } from "react";

export type ThemePreference = "system" | "dark" | "light";

function subscribeToColorScheme(callback: () => void) {
  const mq = window.matchMedia("(prefers-color-scheme: light)");
  mq.addEventListener("change", callback);
  return () => mq.removeEventListener("change", callback);
}

function getColorSchemeSnapshot() {
  return window.matchMedia("(prefers-color-scheme: light)").matches;
}

export function useTheme() {
  const [pref, setPref] = useState<ThemePreference>(() => {
    const stored = localStorage.getItem("theme") as ThemePreference | null;
    if (stored === "dark" || stored === "light" || stored === "system")
      return stored;
    return "system";
  });

  const systemIsLight = useSyncExternalStore(
    subscribeToColorScheme,
    getColorSchemeSnapshot,
    () => false,
  );

  const resolved: "dark" | "light" =
    pref === "system" ? (systemIsLight ? "light" : "dark") : pref;

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(resolved);
    localStorage.setItem("theme", pref);
  }, [resolved, pref]);

  return { theme: pref, setTheme: setPref };
}
