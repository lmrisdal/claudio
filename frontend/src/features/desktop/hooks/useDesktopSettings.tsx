import { createContext, useContext } from "react";

export interface DesktopSettingsDialogContextValue {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

export const DesktopSettingsDialogContext =
  createContext<DesktopSettingsDialogContextValue | null>(null);

export function useDesktopSettings() {
  const ctx = useContext(DesktopSettingsDialogContext);
  if (!ctx)
    throw new Error(
      "useDesktopSettings must be used within DesktopSettingsProvider",
    );
  return ctx;
}
