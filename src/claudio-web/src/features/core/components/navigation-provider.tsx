import { useCallback, useEffect, useMemo, useReducer, useState, type ReactNode } from "react";
import { useLocation } from "react-router";
import { useAuth } from "../../auth/hooks/use-auth";
import { useGamepad } from "../hooks/use-gamepad";
import { useInputScopeState } from "../hooks/use-input-scope";
import { NavigationContext } from "../hooks/use-navigation";
import { useGamepadEvent, useShortcut } from "../hooks/use-shortcut";

export default function NavigationProvider({ children }: { children: ReactNode }) {
  useGamepad();

  const [searchOpen, setSearchOpen] = useState(false);
  const { isLoggedIn } = useAuth();
  const { isActionBlocked } = useInputScopeState();
  const location = useLocation();

  interface HistoryState {
    stack: string[];
    index: number;
  }

  type HistoryAction = { type: "push"; key: string };

  const [history, dispatch] = useReducer(
    (state: HistoryState, action: HistoryAction): HistoryState => {
      const index = state.stack.indexOf(action.key);
      if (index === -1) {
        const newStack = [...state.stack.slice(0, state.index + 1), action.key];
        return { stack: newStack, index: newStack.length - 1 };
      } else {
        return { ...state, index: index };
      }
    },
    { stack: [], index: -1 },
  );

  useEffect(() => {
    dispatch({ type: "push", key: location.key || "default" });
  }, [location.key]);

  const canGoBack = history.index > 0;
  const canGoForward = history.index < history.stack.length - 1;

  const openSearch = useCallback(() => setSearchOpen(true), []);
  const closeSearch = useCallback(() => setSearchOpen(false), []);
  const toggleSearch = useCallback(() => setSearchOpen((v) => !v), []);

  useShortcut("mod+k", (e) => {
    if (!isLoggedIn) return;
    if (isActionBlocked("search")) return;
    e.preventDefault();
    toggleSearch();
  });

  useGamepadEvent("gamepad-search", () => {
    if (!isLoggedIn) return;
    if (document.body.dataset.emulatorActive) return;
    if (isActionBlocked("search")) return;
    toggleSearch();
  });

  const value = useMemo(
    () => ({
      searchOpen,
      openSearch,
      closeSearch,
      toggleSearch,
      canGoBack,
      canGoForward,
    }),
    [searchOpen, openSearch, closeSearch, toggleSearch, canGoBack, canGoForward],
  );

  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}
