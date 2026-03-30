import { Link } from "react-router";
import { useAccountDialog } from "../hooks/useAccountDialog";
import { useAuth } from "../hooks/useAuth";
import { isDesktop } from "../hooks/useDesktop";
import { useNavigation } from "../hooks/useNavigation";
import { useTheme } from "../hooks/useTheme";
import { isMac } from "./DesktopTitleBar";
import Logo from "./Logo";
import SearchDialog from "./SearchDialog";
import TasksPopover from "./TasksPopover";

const hasTrafficLights = isDesktop && isMac;

export default function Header() {
  const { isLoggedIn, isAdmin, user, logout, authDisabled } = useAuth();
  const { theme, toggle } = useTheme();
  const { searchOpen, closeSearch, toggleSearch } = useNavigation();
  const accountDialog = useAccountDialog();

  return (
    <>
      <header
        data-tauri-drag-region={isDesktop || undefined}
        className="border-b border-border sticky top-0 z-50 backdrop-blur-xl bg-bg-blur"
      >
        <div
          data-tauri-drag-region={isDesktop || undefined}
          className={`max-w-7xl mx-auto h-14 flex items-center justify-between ${hasTrafficLights ? "pl-20 pr-6" : "px-6"}`}
        >
          {!isDesktop && (
            <Link to="/" className="flex items-center gap-3">
              <Logo className="text-xl" />
            </Link>
          )}
          {isDesktop && <div />}

          <div className="flex items-center gap-1">
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
            {isDesktop && (
              <button
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent("claudio:open-desktop-settings"),
                  )
                }
                className="p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-raised transition"
                title="Desktop settings (⌘,)"
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
                    d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
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
          </div>
        </div>
      </header>
      <SearchDialog open={searchOpen} onClose={closeSearch} />
    </>
  );
}
