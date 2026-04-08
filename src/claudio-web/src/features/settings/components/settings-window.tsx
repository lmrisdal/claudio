import { getCurrentWindow } from "@tauri-apps/api/window";
import { isDesktop } from "../../desktop/hooks/use-desktop";
import UpdateToast from "../../desktop/components/update-toast";
import type { SettingsTab } from "../hooks/use-settings-dialog";
import SettingsDialog from "./settings-dialog";
import SettingsWindowErrorBoundary from "./settings-window-error-boundary";

const SETTINGS_TAB_STORAGE_KEY = "claudio_settings_active_tab";
const SETTINGS_TABS = new Set<SettingsTab>([
  "account",
  "interface",
  "app.general",
  "app.server",
  "app.downloads",
]);

function getInitialSettingsTab(): SettingsTab {
  const saved = globalThis.sessionStorage.getItem(SETTINGS_TAB_STORAGE_KEY);
  return SETTINGS_TABS.has(saved as SettingsTab) ? (saved as SettingsTab) : "account";
}

function closeSettingsWindow(): void {
  if (!isDesktop) return;
  void getCurrentWindow().close();
}

export default function SettingsWindow() {
  const initialTab = getInitialSettingsTab();

  return (
    <SettingsWindowErrorBoundary>
      <div className="h-full w-full">
        <SettingsDialog embedded open initialTab={initialTab} onClose={closeSettingsWindow} />
        <UpdateToast />
      </div>
    </SettingsWindowErrorBoundary>
  );
}
