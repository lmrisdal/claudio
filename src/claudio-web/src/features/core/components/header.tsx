import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useId, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useAuth } from "../../auth/hooks/use-auth";
import {
  COLLAPSED_KEY,
  HEADER_HEIGHT,
  TOGGLE_SIDEBAR_EVENT,
} from "../../desktop/components/desktop-sidebar";
import { isDesktop, openSettingsWindow } from "../../desktop/hooks/use-desktop";
import { useSettingsDialog } from "../../settings/hooks/use-settings-dialog";
import { useGamepadDirectionalKeyBridge } from "../hooks/use-gamepad-directional-key-bridge";
import { useNavigation } from "../hooks/use-navigation";
import { useServerStatus } from "../hooks/use-server-status";
import { isMac } from "../utils/os";
import Logo from "./logo";
import SearchDialog from "./search-dialog";
import TasksPopover from "./tasks-popover";

export default function Header() {
  const userMenuBridgeId = useId();
  useGamepadDirectionalKeyBridge(userMenuBridgeId);

  const navigate = useNavigate();
  const { isLoggedIn, isAdmin, user, logout } = useAuth();
  const { isConnected } = useServerStatus();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(
    () => isDesktop && localStorage.getItem(COLLAPSED_KEY) === "true",
  );
  const { searchOpen, closeSearch, toggleSearch, canGoBack, canGoForward } =
    useNavigation();
  const settingsDialog = useSettingsDialog();
  const appWindow = isDesktop && !isMac ? getCurrentWindow() : null;
  const desktopHeaderRowHeight = isDesktop
    ? { height: HEADER_HEIGHT }
    : undefined;

  useEffect(() => {
    if (!isDesktop) {
      return;
    }

    function syncCollapsedState() {
      setIsSidebarCollapsed(localStorage.getItem(COLLAPSED_KEY) === "true");
    }

    globalThis.addEventListener("sidebar-collapse-changed", syncCollapsedState);
    return () =>
      globalThis.removeEventListener(
        "sidebar-collapse-changed",
        syncCollapsedState,
      );
  }, []);

  return (
    <>
      <header
        data-tauri-drag-region={isDesktop || undefined}
        className={`app-blur-surface border-b ${isDesktop ? "border-border/50" : "border-border"} z-50 bg-bg-blur fixed top-0 inset-x-0`}
      >
        <div
          data-tauri-drag-region={isDesktop || undefined}
          style={desktopHeaderRowHeight}
          className={`${isDesktop ? (isMac ? "w-full px-6" : "w-full pl-1") : "max-w-7xl mx-auto px-6"} ${isDesktop ? "" : "h-14"} flex items-center justify-between gap-4`}
        >
          {isDesktop ? (
            <div
              className={`desktop-no-drag mt-0.5 flex items-center gap-0.5 min-w-0 ${isMac ? "ml-18" : "ml-2"}`}
            >
              <button
                onClick={() =>
                  globalThis.dispatchEvent(
                    new CustomEvent(TOGGLE_SIDEBAR_EVENT),
                  )
                }
                className="rounded-md p-1.5 text-text-muted hover:bg-surface-raised hover:text-text-primary transition-colors flex items-center justify-center"
                title={
                  isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"
                }
                aria-label={
                  isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"
                }
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
                  <rect
                    x="1.75"
                    y="2.25"
                    width="12.5"
                    height="11.5"
                    rx="1.75"
                  />
                  <path
                    d="M5.75 3.35v9.3"
                    strokeLinecap="round"
                    opacity="0.55"
                  />
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
            {isLoggedIn && !isConnected && isDesktop && (
              <span
                className="mr-2 flex items-center gap-2 text-xs text-red-400"
                title="Server could not connect"
                aria-label="Server could not connect"
              >
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse" />
                <span>Disconnected</span>
              </span>
            )}

            {isLoggedIn && (
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
            )}

            {isLoggedIn ? (
              <>
                {isAdmin && (
                  <>
                    <TasksPopover />
                    <Link
                      to="/admin"
                      className="px-3 py-1.5 rounded-lg text-sm text-text-secondary hover:text-text-primary hover:bg-surface-raised transition"
                    >
                      Admin
                    </Link>
                  </>
                )}
                {user && (
                  <div
                    className={`flex items-center gap-2 ml-2 pl-3 border-l ${isDesktop ? "border-border/50" : "border-border"}`}
                  >
                    <Menu
                      as="div"
                      className="relative h-full flex items-center"
                    >
                      <MenuButton
                        data-gamepad-nav-bridge={userMenuBridgeId}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-text-secondary hover:text-text-primary font-mono hover:bg-surface-raised transition outline-none ring-offset-bg focus-visible:ring-2 focus-visible:ring-focus-ring"
                        title="User menu"
                      >
                        {user?.username}
                        <svg
                          className="w-3.5 h-3.5 opacity-50"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2.5}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="m19.5 8.25-7.5 7.5-7.5-7.5"
                          />
                        </svg>
                      </MenuButton>

                      <MenuItems
                        anchor="bottom end"
                        data-gamepad-nav-bridge={userMenuBridgeId}
                        className="z-60 mt-2 w-52 rounded-xl bg-surface-raised border border-border shadow-2xl p-1.5 focus:outline-none"
                      >
                        <MenuItem>
                          <button
                            data-gamepad-nav-bridge={userMenuBridgeId}
                            onClick={() => {
                              if (isDesktop) {
                                void openSettingsWindow();
                                return;
                              }
                              settingsDialog.openTab("account");
                            }}
                            className="group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-text-secondary data-focus:bg-surface-overlay data-focus:text-text-primary transition"
                          >
                            <svg
                              className="w-5 h-5 opacity-60 group-data-focus:opacity-100"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={2}
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z"
                              />
                            </svg>
                            Preferences
                          </button>
                        </MenuItem>
                        <div className="my-1.5 border-t border-border/40 mx-2" />
                        <MenuItem>
                          <button
                            data-gamepad-nav-bridge={userMenuBridgeId}
                            onClick={logout}
                            className="group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-text-muted data-focus:bg-red-500/10 data-focus:text-red-400 transition"
                          >
                            <svg
                              className="w-5 h-5 opacity-60 group-data-focus:opacity-100"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={2}
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M8.25 9V5.25A2.25 2.25 0 0 1 10.5 3h6a2.25 2.25 0 0 1 2.25 2.25v13.5A2.25 2.25 0 0 1 16.5 21h-6a2.25 2.25 0 0 1-2.25-2.25V15m-3 0-3-3m0 0 3-3m-3 3H15"
                              />
                            </svg>
                            Sign out
                          </button>
                        </MenuItem>
                      </MenuItems>
                    </Menu>
                  </div>
                )}
              </>
            ) : (
              <Link
                to="/login"
                className="px-4 py-1.5 rounded-lg text-sm bg-accent hover:bg-accent-hover text-accent-foreground font-medium transition"
              >
                Sign in
              </Link>
            )}
            {appWindow && (
              <div
                style={desktopHeaderRowHeight}
                className="flex ml-2 border-l border-border/50"
              >
                <button
                  onClick={() => appWindow.minimize()}
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
                  onClick={() => appWindow.toggleMaximize()}
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
                  onClick={() => appWindow.close()}
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
