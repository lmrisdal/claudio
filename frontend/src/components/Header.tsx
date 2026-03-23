import { Link } from "react-router";
import { useAuth } from "../hooks/useAuth";
import { useNavigation } from "../hooks/useNavigation";
import { useTheme } from "../hooks/useTheme";
import Logo from "./Logo";
import SearchDialog from "./SearchDialog";
import TasksPopover from "./TasksPopover";

export default function Header() {
  const { isLoggedIn, isAdmin, user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const { searchOpen, closeSearch, toggleSearch } = useNavigation();

  return (
    <>
      <header className="border-b border-border sticky top-0 z-50 backdrop-blur-xl bg-bg-blur">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3">
            <Logo className="text-xl" />
          </Link>

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
                <div className="flex items-center gap-2 ml-2 pl-3 border-l border-border">
                  <Link
                    to="/account"
                    className="text-sm text-text-secondary hover:text-text-primary font-mono transition"
                  >
                    {user?.username}
                  </Link>
                  <button
                    onClick={logout}
                    className="px-3 py-1.5 rounded-lg text-sm text-text-muted hover:text-red-400 hover:bg-surface-raised transition"
                  >
                    Sign out
                  </button>
                </div>
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
