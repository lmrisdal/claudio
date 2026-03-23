import { createContext, useContext } from "react";

export interface NavigationContextValue {
  searchOpen: boolean;
  openSearch: () => void;
  closeSearch: () => void;
  toggleSearch: () => void;
}

export const NavigationContext = createContext<NavigationContextValue | null>(
  null,
);

export function useNavigation() {
  const ctx = useContext(NavigationContext);
  if (!ctx)
    throw new Error("useNavigation must be used within NavigationProvider");
  return ctx;
}
