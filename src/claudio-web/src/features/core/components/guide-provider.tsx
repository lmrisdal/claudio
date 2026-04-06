import { useCallback, useMemo, useState, type ReactNode } from "react";
import { loadLastPlayed, saveLastPlayed, type LastPlayedGame } from "../hooks/guide-types";
import { GuideContext, type GuideActions } from "../hooks/use-guide";
import GuideOverlay from "./guide-overlay";

export default function GuideProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [lastPlayed, setLastPlayed] = useState<LastPlayedGame | null>(loadLastPlayed);
  const [activeActions, setActiveActions] = useState<GuideActions | null>(null);

  const open = useCallback(() => {
    setIsOpen(true);
  }, []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((previous) => !previous), []);

  const register = useCallback((actions: GuideActions) => {
    setActiveActions(actions);
    const lp: LastPlayedGame = {
      gameId: actions.gameId,
      gameName: actions.gameName,
      coverUrl: actions.coverUrl,
    };
    saveLastPlayed(lp);
    setLastPlayed(lp);
    return () => {
      setActiveActions((current) => (current === actions ? null : current));
    };
  }, []);

  const value = useMemo(
    () => ({ isOpen, open, close, toggle, register }),
    [isOpen, open, close, toggle, register],
  );

  return (
    <GuideContext.Provider value={value}>
      {children}
      <GuideOverlay
        open={isOpen}
        gameName={activeActions?.gameName ?? ""}
        gameId={activeActions?.gameId ?? null}
        hasActiveGame={activeActions !== null}
        lastPlayed={lastPlayed}
        onClose={() => {
          setIsOpen(false);
          activeActions?.onResume?.();
        }}
        onResumeGame={() => {
          setIsOpen(false);
          activeActions?.onResume?.();
        }}
        onQuitGame={() => {
          setIsOpen(false);
          activeActions?.onQuitGame?.();
        }}
        onRequestSaveState={() => {
          activeActions?.onRequestSaveState?.();
        }}
        onLoadState={(stateData) => {
          activeActions?.onLoadState?.(stateData);
        }}
      />
    </GuideContext.Provider>
  );
}
