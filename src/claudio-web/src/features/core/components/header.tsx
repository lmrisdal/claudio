import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import {
  COLLAPSED_KEY,
  HEADER_HEIGHT,
  TOGGLE_SIDEBAR_EVENT,
} from "../../desktop/components/desktop-sidebar";
import {
  closeWindow,
  minimizeWindow,
  toggleMaximizeWindow,
} from "../../desktop/hooks/desktop-window";
import { isDesktop, openSettingsWindow } from "../../desktop/hooks/use-desktop";
import { useSettingsDialog } from "../../settings/hooks/use-settings-dialog";
import { useNavigation } from "../hooks/use-navigation";
import { useServerStatus } from "../hooks/use-server-status";
import Logo from "./logo";
import SearchDialog from "./search-dialog";
import TasksPopover from "./tasks-popover";

export default function Header() {
  const navigate = useNavigate();
  const { isConnected } = useServerStatus();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(
    () => isDesktop && localStorage.getItem(COLLAPSED_KEY) === "true",
  );
  const { searchOpen, closeSearch, toggleSearch, canGoBack, canGoForward } = useNavigation();
  const settingsDialog = useSettingsDialog();
  const desktopHeaderRowHeight = isDesktop ? { height: HEADER_HEIGHT } : undefined;
  const headerBackdropClass = isDesktop ? "desktop-header-backdrop" : "bg-bg-blur";

  useEffect(() => {
    if (!isDesktop) {
      return;
    }

    function syncCollapsedState() {
      setIsSidebarCollapsed(localStorage.getItem(COLLAPSED_KEY) === "true");
    }

    globalThis.addEventListener("sidebar-collapse-changed", syncCollapsedState);
    return () => globalThis.removeEventListener("sidebar-collapse-changed", syncCollapsedState);
  }, []);

  return (
    <>
      <header className="z-50 fixed top-0 inset-x-0">
        <div
          aria-hidden="true"
          style={{ viewTransitionName: "app-header-backdrop" }}
          className={`app-blur-surface border-b ${isDesktop ? "border-border/50" : "border-border"} ${headerBackdropClass} absolute inset-0 pointer-events-none`}
        />
        <div
          style={{
            ...desktopHeaderRowHeight,
            viewTransitionName: "app-header-content",
          }}
          className={`${isDesktop ? "desktop-drag w-full pl-1" : "max-w-7xl mx-auto px-6"} ${isDesktop ? "" : "h-14"} relative flex items-center justify-between gap-4`}
        >
          {isDesktop ? (
            <div className={`desktop-no-drag mt-0.5 flex items-center gap-0.5 min-w-0 ml-2`}>
              <button
                onClick={() => globalThis.dispatchEvent(new CustomEvent(TOGGLE_SIDEBAR_EVENT))}
                className="rounded-md p-1.5 text-text-muted hover:bg-surface-raised hover:text-text-primary transition-colors flex items-center justify-center"
                title={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                aria-label={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                aria-pressed={!isSidebarCollapsed}
              >
                <svg
                  className={`w-4 h-4 transition-transform ${isSidebarCollapsed ? "scale-x-[-1]" : ""}`}
                  fill="none"
                  viewBox="0 0 16 16"
                  stroke="currentColor"
                  strokeWidth={1.25}
                  aria-hidden="true"
                >
                  <rect x="1.75" y="2.25" width="12.5" height="11.5" rx="1.75" />
                  <path d="M5.75 3.35v9.3" strokeLinecap="round" opacity="0.55" />
                  <rect
                    x="2.75"
                    y="3.35"
                    width="2"
                    height="9.3"
                    rx="0.8"
                    fill="currentColor"
                    stroke="none"
                    opacity="0.8"
                  />
                </svg>
              </button>
              <button
                onClick={() => navigate(-1)}
                disabled={!canGoBack}
                className="p-1.5 rounded-md text-text-muted hover:text-text-primary enabled:hover:bg-surface-raised transition-colors flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed"
                title="Go back"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15.75 19.5L8.25 12l7.5-7.5"
                  />
                </svg>
              </button>
              <button
                onClick={() => navigate(1)}
                disabled={!canGoForward}
                className="p-1.5 rounded-md text-text-muted hover:text-text-primary enabled:hover:bg-surface-raised transition-colors flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed"
                title="Go forward"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M8.25 4.5l7.5 7.5-7.5 7.5"
                  />
                </svg>
              </button>
            </div>
          ) : (
            <Link to="/" className="desktop-no-drag flex items-center gap-3">
              <Logo className="text-xl" />
            </Link>
          )}

          <div className="desktop-no-drag flex items-center gap-1 ml-auto min-w-0">
            {!isConnected && isDesktop && (
              <span
                className="mr-2 flex items-center gap-2 text-xs text-red-400"
                title="Server could not connect"
                aria-label="Server could not connect"
              >
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse" />
                <span>Disconnected</span>
              </span>
            )}

            <button
              onClick={toggleSearch}
              className="p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-raised transition"
              title="Search games (Ctrl+K)"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
                />
              </svg>
            </button>
            <TasksPopover />
            {!isDesktop && (
              <Link
                to="/admin"
                className="px-3 py-1.5 rounded-lg text-sm text-text-secondary hover:text-text-primary hover:bg-surface-raised transition"
              >
                Admin
              </Link>
            )}
            <button
              onClick={() => {
                if (isDesktop) {
                  void openSettingsWindow();
                  return;
                }
                settingsDialog.open();
              }}
              className="p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-raised transition"
              title="Settings"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.004.828c-.293.24-.438.613-.431.992a7.723 7.723 0 0 1 0 .255c-.007.378.138.751.431.992l1.004.827c.424.35.534.955.26 1.432l-1.296 2.247a1.125 1.125 0 0 1-1.37.49l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.219.128c-.332.183-.582.495-.645.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.02-.397-1.11-.94l-.213-1.281c-.063-.374-.313-.686-.645-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.075-.124l-1.217.456a1.125 1.125 0 0 1-1.37-.49l-1.296-2.247a1.125 1.125 0 0 1 .26-1.432l1.004-.827c.293-.241.438-.614.431-.992a6.932 6.932 0 0 1 0-.255c.007-.379-.138-.752-.431-.992l-1.004-.828a1.125 1.125 0 0 1-.26-1.431l1.296-2.247a1.125 1.125 0 0 1 1.37-.49l1.217.456c.355.133.75.072 1.076-.124.072-.044.145-.086.219-.128.332-.183.582-.495.645-.869l.213-1.281Z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
                />
              </svg>
            </button>
            {isDesktop && (
              <div style={desktopHeaderRowHeight} className="flex ml-2 border-l border-border/50">
                <button
                  onClick={() => minimizeWindow()}
                  className="w-12 h-full flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-raised transition"
                  aria-label="Minimize"
                >
                  <svg
                    width="10"
                    height="1"
                    viewBox="0 0 10 1"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <rect width="10" height="1" />
                  </svg>
                </button>
                <button
                  onClick={() => toggleMaximizeWindow()}
                  className="w-12 h-full flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-raised transition"
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
                  onClick={() => closeWindow()}
                  className="w-12 h-full flex items-center justify-center text-text-muted hover:text-white hover:bg-red-600 transition"
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
            )}
          </div>
        </div>
      </header>
      <SearchDialog open={searchOpen} onClose={closeSearch} />
    </>
  );
}
