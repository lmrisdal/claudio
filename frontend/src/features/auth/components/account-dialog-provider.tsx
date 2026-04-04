import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useShortcut } from "../../core/hooks/use-shortcut";
import { isDesktop, openSettingsWindow } from "../../desktop/hooks/use-desktop";
import { AccountDialogContext } from "../hooks/use-account-dialog";
import AccountDialog from "./account-dialog";

type SettingsTab = "account" | "interface" | "app.general" | "app.server" | "app.downloads";

export default function AccountDialogProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [initialTab, setInitialTab] = useState<SettingsTab>("account");

  const openTab = useCallback((tab: SettingsTab) => {
    setInitialTab(tab);
    setIsOpen(true);
  }, []);
  const open = useCallback(() => openTab("account"), [openTab]);
  const close = useCallback(() => setIsOpen(false), []);

  useEffect(() => {
    const openAccount = () => openTab("account");
    const openDesktop = () => {
      void openSettingsWindow();
    };

    globalThis.addEventListener("claudio:open-account", openAccount);
    if (isDesktop) {
      globalThis.addEventListener("claudio:open-desktop-settings", openDesktop);
    }
    globalThis.addEventListener("claudio:close-dialogs", close);

    return () => {
      globalThis.removeEventListener("claudio:open-account", openAccount);
      if (isDesktop) {
        globalThis.removeEventListener("claudio:open-desktop-settings", openDesktop);
      }
      globalThis.removeEventListener("claudio:close-dialogs", close);
    };
  }, [openTab, close]);

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
    <AccountDialogContext.Provider value={value}>
      {children}
      <AccountDialog open={isOpen} initialTab={initialTab} onClose={close} />
    </AccountDialogContext.Provider>
  );
}
