import { listen } from "@tauri-apps/api/event";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useShortcut } from "../../core/hooks/use-shortcut";
import { isDesktop } from "../hooks/use-desktop";
import { DesktopSettingsDialogContext } from "../hooks/use-desktop-settings";
import DesktopSettingsDialog from "./desktop-settings-dialog";

export default function DesktopSettingsProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  useEffect(() => {
    globalThis.addEventListener("claudio:open-desktop-settings", open);
    globalThis.addEventListener("claudio:close-dialogs", close);

    // Listen for native menu "Settings…" item
    const unlisten = listen("open-settings", open);

    return () => {
      globalThis.removeEventListener("claudio:open-desktop-settings", open);
      globalThis.removeEventListener("claudio:close-dialogs", close);
      void unlisten.then((function_) => function_());
    };
  }, [open, close]);

  // Cmd+, (macOS) / Ctrl+, (Windows/Linux) opens desktop settings
  useShortcut(
    "mod+,",
    (e) => {
      e.preventDefault();
      setIsOpen((v) => !v);
    },
    { enabled: isDesktop },
  );

  const value = useMemo(() => ({ isOpen, open, close }), [isOpen, open, close]);

  if (!isDesktop) return <>{children}</>;

  return (
    <DesktopSettingsDialogContext.Provider value={value}>
      {children}
      <DesktopSettingsDialog open={isOpen} onClose={close} />
    </DesktopSettingsDialogContext.Provider>
  );
}
