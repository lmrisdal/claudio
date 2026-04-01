import { listen } from "@tauri-apps/api/event";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useShortcut } from "../../core/hooks/useShortcut";
import { isDesktop } from "../hooks/useDesktop";
import { DesktopSettingsDialogContext } from "../hooks/useDesktopSettings";
import DesktopSettingsDialog from "./DesktopSettingsDialog";

export default function DesktopSettingsProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  useEffect(() => {
    window.addEventListener("claudio:open-desktop-settings", open);
    window.addEventListener("claudio:close-dialogs", close);

    // Listen for native menu "Settings…" item
    const unlisten = listen("open-settings", open);

    return () => {
      window.removeEventListener("claudio:open-desktop-settings", open);
      window.removeEventListener("claudio:close-dialogs", close);
      unlisten.then((fn) => fn());
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
