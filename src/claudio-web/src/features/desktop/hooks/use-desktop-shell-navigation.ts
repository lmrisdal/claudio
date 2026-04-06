import { createContext, useContext } from "react";

export interface DesktopShellNavigationContextValue {
  focusPage: () => boolean;
  focusSidebar: () => boolean;
}

const noop = () => false;

export const DesktopShellNavigationContext = createContext<DesktopShellNavigationContextValue>({
  focusPage: noop,
  focusSidebar: noop,
});

export function useDesktopShellNavigation() {
  return useContext(DesktopShellNavigationContext);
}
