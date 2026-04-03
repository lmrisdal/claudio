import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useShortcut } from "../../core/hooks/use-shortcut";
import { isDesktop } from "../../desktop/hooks/use-desktop";
import { AccountDialogContext } from "../hooks/use-account-dialog";
import AccountDialog from "./account-dialog";

type SettingsTab = "account" | "preferences" | "desktop";

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
    const openDesktop = () => openTab("desktop");

    globalThis.addEventListener("claudio:open-account", openAccount);
    if (isDesktop) {
      globalThis.addEventListener("claudio:open-desktop-settings", openDesktop);
    }
    globalThis.addEventListener("claudio:close-dialogs", close);

    const unlisten = isDesktop ? listen("open-settings", openDesktop) : null;

    return () => {
      globalThis.removeEventListener("claudio:open-account", openAccount);
      if (isDesktop) {
        globalThis.removeEventListener("claudio:open-desktop-settings", openDesktop);
      }
      globalThis.removeEventListener("claudio:close-dialogs", close);
      if (unlisten) {
        void unlisten.then((function_) => function_());
      }
    };
  }, [openTab, close]);

  useShortcut(
    "mod+,",
    (event) => {
      event.preventDefault();
      openTab("desktop");
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
