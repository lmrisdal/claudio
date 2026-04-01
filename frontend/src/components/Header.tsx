import { getCurrentWindow } from "@tauri-apps/api/window";
import { Link, useNavigate } from "react-router";
import { useAccountDialog } from "../hooks/useAccountDialog";
import { useAuth } from "../hooks/useAuth";
import { isDesktop } from "../hooks/useDesktop";
import { useNavigation } from "../hooks/useNavigation";
import { useTheme } from "../hooks/useTheme";
import { isMac } from "../utils/os";
import Logo from "./Logo";
import SearchDialog from "./SearchDialog";
import TasksPopover from "./TasksPopover";

export default function Header() {
  const navigate = useNavigate();
  const { isLoggedIn, isAdmin, user, logout, authDisabled } = useAuth();
  const { theme, toggle } = useTheme();
  const { searchOpen, closeSearch, toggleSearch, canGoBack, canGoForward } = useNavigation();
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
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                </svg>
              </button>
              <button
                onClick={() => navigate(1)}
                disabled={!canGoForward}
                className="p-1.5 rounded-lg text-text-muted hover:text-text-primary enabled:hover:bg-surface-raised transition-colors flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed"
                title="Go forward"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
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
            <button
              onClick={toggle}
              className="p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-raised transition"
              title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            >
              {theme === "dark" ? (
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
                    d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
                  />
                </svg>
              ) : (
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
                    d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
                  />
                </svg>
              )}
            </button>

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
                    <button
                      onClick={accountDialog.open}
                      className="text-sm text-text-secondary hover:text-text-primary font-mono transition"
                    >
                      {user?.username}
                    </button>
                    <button
                      onClick={logout}
                      className="px-3 py-1.5 rounded-lg text-sm text-text-muted hover:text-red-400 hover:bg-surface-raised transition"
                    >
                      Sign out
                    </button>
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
