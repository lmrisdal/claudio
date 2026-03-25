import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "./useAuth";
import { useGamepad } from "./useGamepad";
import { useGuide } from "./useGuide";
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

  // Gamepad guide button toggles the guide overlay (only when logged in)
  useGamepadEvent("gamepad-guide", () => {
    if (!isLoggedIn) return;
    guide.toggle();
  });

  const value = useMemo(
    () => ({ searchOpen, openSearch, closeSearch, toggleSearch }),
    [searchOpen, openSearch, closeSearch, toggleSearch],
  );

  return (
    <NavigationContext.Provider value={value}>
      {children}
    </NavigationContext.Provider>
  );
}
