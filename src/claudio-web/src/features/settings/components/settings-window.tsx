import { getCurrentWindow } from "@tauri-apps/api/window";
import SettingsDialog from "./settings-dialog";

const appWindow = getCurrentWindow();

export default function SettingsWindow() {
  return (
    <div className="h-full w-full bg-surface">
      <SettingsDialog embedded open initialTab="account" onClose={() => void appWindow.close()} />
    </div>
  );
}
