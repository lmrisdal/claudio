import { useEffect, useSyncExternalStore } from "react";
import type { ResolvedTheme } from "./use-theme";
import { applyAppTintVariables, clearAppTintVariables } from "../utils/app-tint";
import { getAppTint, subscribeToAppTint } from "../utils/preferences";

export function useAppTintPreference() {
  return useSyncExternalStore(subscribeToAppTint, getAppTint, getAppTint);
}

export function useApplyAppTint({
  enabled,
  theme,
  reducedTransparency,
}: {
  enabled: boolean;
  theme: ResolvedTheme;
  reducedTransparency: boolean;
}) {
  const tintPreference = useAppTintPreference();

  useEffect(() => {
    const root = document.documentElement;

    if (!enabled) {
      clearAppTintVariables(root);
      return;
    }

    applyAppTintVariables(root, theme, tintPreference, reducedTransparency);
  }, [enabled, reducedTransparency, theme, tintPreference]);

  return tintPreference;
}
