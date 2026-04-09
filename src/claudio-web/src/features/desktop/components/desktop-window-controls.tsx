import { getCurrentWindow } from "@tauri-apps/api/window";
import { isMac } from "../../core/utils/os";
import { isDesktop } from "../hooks/use-desktop";
import { HEADER_HEIGHT } from "./desktop-sidebar";

export default function DesktopWindowControls() {
  if (!isDesktop || isMac) {
    return null;
  }

  const appWindow = getCurrentWindow();

  return (
    <div
      data-tauri-drag-region
      className="fixed top-0 right-0 z-50 flex "
      style={{ height: HEADER_HEIGHT }}
    >
      <button
        onClick={() => appWindow.minimize()}
        className="desktop-no-drag w-12 h-full flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-raised transition"
        aria-label="Minimize"
      >
        <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor" aria-hidden="true">
          <rect width="10" height="1" />
        </svg>
      </button>
      <button
        onClick={() => appWindow.toggleMaximize()}
        className="desktop-no-drag w-12 h-full flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-raised transition"
        aria-label="Maximize"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          aria-hidden="true"
        >
          <rect x="0.5" y="0.5" width="9" height="9" />
        </svg>
      </button>
      <button
        onClick={() => appWindow.close()}
        className="desktop-no-drag w-12 h-full flex items-center justify-center text-text-muted hover:text-white hover:bg-red-600 transition"
        aria-label="Close"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          aria-hidden="true"
        >
          <line x1="1" y1="1" x2="9" y2="9" />
          <line x1="9" y1="1" x2="1" y2="9" />
        </svg>
      </button>
    </div>
  );
}
