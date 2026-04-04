import { createContext, useContext } from "react";

export type SettingsTab = "account" | "interface" | "app.general" | "app.server" | "app.downloads";

export interface SettingsDialogContextValue {
  isOpen: boolean;
  open: () => void;
  openTab: (tab: SettingsTab) => void;
  close: () => void;
}

export const SettingsDialogContext = createContext<SettingsDialogContextValue | null>(null);

export function useSettingsDialog() {
  const context = useContext(SettingsDialogContext);
  if (!context) {
    throw new Error("useSettingsDialog must be used within SettingsDialogProvider");
  }
  return context;
}
