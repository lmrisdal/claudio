import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useShortcut } from "../../core/hooks/use-shortcut";
import { isDesktop, openSettingsWindow } from "../../desktop/hooks/use-desktop";
import { SettingsDialogContext, type SettingsTab } from "../hooks/use-settings-dialog";
import SettingsDialog from "./settings-dialog";

export default function SettingsDialogProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [initialTab, setInitialTab] = useState<SettingsTab>("interface");

  const openTab = useCallback((tab: SettingsTab) => {
    setInitialTab(tab);
    setIsOpen(true);
  }, []);
  const open = useCallback(() => openTab("interface"), [openTab]);
  const close = useCallback(() => setIsOpen(false), []);

  useEffect(() => {
    const openSettings = () => openTab("interface");
    const openDesktop = () => {
      void openSettingsWindow();
    };

    globalThis.addEventListener("claudio:open-account", openSettings);
    if (isDesktop) {
      globalThis.addEventListener("claudio:open-desktop-settings", openDesktop);
    }

    return () => {
      globalThis.removeEventListener("claudio:open-account", openSettings);
      if (isDesktop) {
        globalThis.removeEventListener("claudio:open-desktop-settings", openDesktop);
      }
    };
  }, [openTab]);

  useShortcut(
    "mod+,",
    (event) => {
      event.preventDefault();
      void openSettingsWindow();
    },
    { enabled: isDesktop },
  );

  const value = useMemo(() => ({ isOpen, open, openTab, close }), [isOpen, open, openTab, close]);

  return (
    <SettingsDialogContext.Provider value={value}>
      {children}
      <SettingsDialog open={isOpen} initialTab={initialTab} onClose={close} />
    </SettingsDialogContext.Provider>
  );
}
