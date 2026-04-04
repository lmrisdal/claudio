import { getCurrentWindow } from "@tauri-apps/api/window";
import { isDesktop } from "../../desktop/hooks/use-desktop";
import SettingsDialog from "./settings-dialog";
import SettingsWindowErrorBoundary from "./settings-window-error-boundary";

function closeSettingsWindow(): void {
  if (!isDesktop) return;
  void getCurrentWindow().close();
}

export default function SettingsWindow() {
  console.info("Opening embedded settings dialog window");

  return (
    <SettingsWindowErrorBoundary>
      <div className="h-full w-full bg-surface">
        <SettingsDialog embedded open initialTab="account" onClose={closeSettingsWindow} />
      </div>
    </SettingsWindowErrorBoundary>
  );
}
