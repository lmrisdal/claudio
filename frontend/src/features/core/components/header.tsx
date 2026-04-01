import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Link, useNavigate } from "react-router";
import { useAccountDialog } from "../../auth/hooks/use-account-dialog";
import { useAuth } from "../../auth/hooks/use-auth";
import { isDesktop } from "../../desktop/hooks/use-desktop";
import { useNavigation } from "../hooks/use-navigation";
import { isMac } from "../utils/os";
import Logo from "./logo";
import SearchDialog from "./search-dialog";
import TasksPopover from "./tasks-popover";

export default function Header() {
  const navigate = useNavigate();
  const { isLoggedIn, isAdmin, user, logout, authDisabled } = useAuth();
  const { searchOpen, closeSearch, toggleSearch, canGoBack, canGoForward } =
    useNavigation();
  const accountDialog = useAccountDialog();
  const appWindow = isDesktop && !isMac ? getCurrentWindow() : null;

  return (
    <>
      <header
        data-tauri-drag-region={isDesktop || undefined}
        className={`border-b border-border z-50 backdrop-blur-xl bg-bg-blur ${isDesktop ? "fixed top-0 inset-x-0" : "sticky top-0"}`}
      >
        <div
          data-tauri-drag-region={isDesktop || undefined}
          className={`${isDesktop ? (isMac ? "w-full px-6" : "w-full pl-6") : "max-w-7xl mx-auto px-6"} h-14 flex items-center justify-between gap-4`}
        >
          {isDesktop ? (
            <div
              className={`desktop-no-drag flex items-center gap-0.5 min-w-0 ${isMac ? "ml-20" : "ml-2"}`}
            >
              <button
                onClick={() => navigate(-1)}
                disabled={!canGoBack}
                className="p-1.5 rounded-lg text-text-muted hover:text-text-primary enabled:hover:bg-surface-raised transition-colors flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed"
                title="Go back"
              >
                <svg
                  className="w-5 h-5"
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
                className="p-1.5 rounded-lg text-text-muted hover:text-text-primary enabled:hover:bg-surface-raised transition-colors flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed"
                title="Go forward"
              >
                <svg
                  className="w-5 h-5"
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
                {!authDisabled && (
                  <div className="flex items-center gap-2 ml-2 pl-3 border-l border-border">
                    <Menu
                      as="div"
                      className="relative h-full flex items-center"
                    >
                      <MenuButton
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-text-secondary hover:text-text-primary font-mono hover:bg-surface-raised transition outline-none ring-offset-bg focus-visible:ring-2 focus-visible:ring-accent"
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
                        className="z-60 mt-2 w-52 rounded-xl bg-surface-raised border border-border shadow-2xl p-1.5 focus:outline-none"
                      >
                        <MenuItem>
                          <button
                            onClick={accountDialog.open}
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
                className="px-4 py-1.5 rounded-lg text-sm bg-accent hover:bg-accent-hover text-neutral-950 font-medium transition"
              >
                Sign in
              </Link>
            )}
            {appWindow && (
              <div className="flex h-14 ml-2 border-l border-border">
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
