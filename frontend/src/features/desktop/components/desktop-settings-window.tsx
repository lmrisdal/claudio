import { getCurrentWindow } from "@tauri-apps/api/window";
import AccountDialog from "../../auth/components/account-dialog";

const appWindow = getCurrentWindow();

export default function DesktopSettingsWindow() {
  return (
    <div className="h-full w-full bg-surface">
      <AccountDialog embedded open initialTab="account" onClose={() => void appWindow.close()} />
    </div>
  );
}
