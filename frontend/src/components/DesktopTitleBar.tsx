import { getCurrentWindow } from "@tauri-apps/api/window";
import { isDesktop } from "../hooks/useDesktop";

const isMac =
  typeof navigator !== "undefined" && navigator.platform.startsWith("Mac");

/**
 * On macOS with titleBarStyle: Overlay, the native traffic lights are
 * overlaid on the content and the OS handles window dragging in the
 * top area. We don't render a separate title bar — instead the Header
 * gets extra top padding via the `desktop-mac` class on the root div.
 *
 * On Windows/Linux, we render a custom title bar with drag region
 * and window control buttons above the Header.
 */
export default function DesktopTitleBar() {
  if (!isDesktop || isMac) return null;

  const appWindow = getCurrentWindow();

  return (
    <div
      data-tauri-drag-region
      className="h-9 flex items-center justify-between bg-bg border-b border-border select-none shrink-0"
    >
      <span
        data-tauri-drag-region
        className="pl-4 text-xs font-medium text-text-muted tracking-wider uppercase font-display"
      >
        Claudio
      </span>
      <div className="flex h-full">
        <button
          onClick={() => appWindow.minimize()}
          className="w-11 h-full flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-raised transition"
          aria-label="Minimize"
        >
          <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor">
            <rect width="10" height="1" />
          </svg>
        </button>
        <button
          onClick={() => appWindow.toggleMaximize()}
          className="w-11 h-full flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-raised transition"
          aria-label="Maximize"
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
          >
            <rect x="0.5" y="0.5" width="9" height="9" />
          </svg>
        </button>
        <button
          onClick={() => appWindow.close()}
          className="w-11 h-full flex items-center justify-center text-text-muted hover:text-white hover:bg-red-600 transition"
          aria-label="Close"
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
          >
            <line x1="1" y1="1" x2="9" y2="9" />
            <line x1="9" y1="1" x2="1" y2="9" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export { isMac };
