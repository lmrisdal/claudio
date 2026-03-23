import { createContext, useContext } from "react";

export interface GuideActions {
  gameId: number;
  gameName: string;
  coverUrl?: string;
  onResume?: () => void;
  onQuitGame?: () => void;
}

export interface GuideContextValue {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  /** Register the current page's actions. Returns an unregister function. */
  register: (actions: GuideActions) => () => void;
}

export const GuideContext = createContext<GuideContextValue | null>(null);

export function useGuide() {
  const ctx = useContext(GuideContext);
  if (!ctx) throw new Error("useGuide must be used within GuideProvider");
  return ctx;
}
