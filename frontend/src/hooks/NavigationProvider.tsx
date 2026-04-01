import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useState,
  type ReactNode,
} from "react";
import { getShortcuts } from "../utils/shortcuts";
import { useAuth } from "./useAuth";
import { useGamepad } from "./useGamepad";
import { useGuide } from "./useGuide";
import { useLocation } from "react-router";
import { NavigationContext } from "./useNavigation";
import { useGamepadEvent, useShortcut } from "./useShortcut";

export default function NavigationProvider({
  children,
}: {
  children: ReactNode;
}) {
  // Gamepad polling (converts gamepad input to keyboard/custom events)
  useGamepad();

  const [searchOpen, setSearchOpen] = useState(false);
  const { isLoggedIn } = useAuth();
  const guide = useGuide();
  const location = useLocation();

  interface HistoryState {
    stack: string[];
    index: number;
  }

  type HistoryAction = { type: "push"; key: string };

  const [history, dispatch] = useReducer(
    (state: HistoryState, action: HistoryAction): HistoryState => {
      const idx = state.stack.indexOf(action.key);
      if (idx !== -1) {
        return { ...state, index: idx };
      } else {
        const newStack = [...state.stack.slice(0, state.index + 1), action.key];
        return { stack: newStack, index: newStack.length - 1 };
      }
    },
    { stack: [], index: -1 },
  );

  // Track history entries for back/forward state
  useEffect(() => {
    dispatch({ type: "push", key: location.key || "default" });
  }, [location.key]);

  const canGoBack = history.index > 0;
  const canGoForward = history.index < history.stack.length - 1;

  const openSearch = useCallback(() => setSearchOpen(true), []);
  const closeSearch = useCallback(() => setSearchOpen(false), []);
  const toggleSearch = useCallback(() => setSearchOpen((v) => !v), []);

  // Ctrl+K / Cmd+K toggles search (only when logged in)
  useShortcut("mod+k", (e) => {
    if (!isLoggedIn) return;
    e.preventDefault();
    toggleSearch();
  });

  // Gamepad Y button toggles search (unless emulator is active)
  useGamepadEvent("gamepad-search", () => {
    if (!isLoggedIn) return;
    if (document.body.dataset.emulatorActive) return;
    toggleSearch();
  });

  // Configurable keyboard shortcut for guide overlay
  const [guideKey, setGuideKey] = useState(() => getShortcuts().guide);

  useEffect(() => {
    function onChanged() {
      setGuideKey(getShortcuts().guide);
    }
    window.addEventListener("claudio:shortcuts-changed", onChanged);
    return () =>
      window.removeEventListener("claudio:shortcuts-changed", onChanged);
  }, []);

  useShortcut(guideKey, (e) => {
    if (!isLoggedIn) return;
    e.preventDefault();
    guide.toggle();
  });

  // Gamepad guide button toggles the guide overlay (only when logged in)
  useGamepadEvent("gamepad-guide", () => {
    if (!isLoggedIn) return;
    guide.toggle();
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
    [
      searchOpen,
      openSearch,
      closeSearch,
      toggleSearch,
      canGoBack,
      canGoForward,
    ],
  );

  return (
    <NavigationContext.Provider value={value}>
      {children}
    </NavigationContext.Provider>
  );
}
