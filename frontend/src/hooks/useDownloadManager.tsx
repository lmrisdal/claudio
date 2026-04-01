import { useCallback, useEffect, useState } from "react";
import {
  DownloadManagerContext,
  type ActiveDownload,
  type DownloadManagerContextValue,
} from "./downloadManagerContext";
import {
  installGame,
  isDesktop,
  listenToInstallProgress,
  type DesktopInstallGameInput,
  type InstalledGame,
  type InstallProgress,
} from "./useDesktop";

export function DownloadManagerProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [activeDownloads, setActiveDownloads] = useState<
    Map<number, ActiveDownload>
  >(new Map());

  useEffect(() => {
    if (!isDesktop) return;

    let cancelled = false;
    let unlisten: (() => void) | undefined;

    listenToInstallProgress((progress) => {
      if (cancelled) return;
      setActiveDownloads((prev) => {
        const existing = prev.get(progress.gameId);
        if (!existing) return prev;

        const next = new Map(prev);
        if (progress.status === "completed" || progress.status === "failed") {
          next.delete(progress.gameId);
        } else {
          next.set(progress.gameId, { ...existing, progress });
        }
        return next;
      });
    }).then((dispose) => {
      if (cancelled) {
        dispose();
        return;
      }
      unlisten = dispose;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const startDownload = useCallback(
    async (game: DesktopInstallGameInput): Promise<InstalledGame> => {
      const token = localStorage.getItem("token");
      if (!token) {
        throw new Error("You need to sign in before installing games.");
      }

      setActiveDownloads((prev) => {
        const next = new Map(prev);
        next.set(game.id, {
          game,
          progress: { gameId: game.id, status: "starting", percent: 0 },
        });
        return next;
      });

      try {
        const result = await installGame(game, token);
        setActiveDownloads((prev) => {
          const next = new Map(prev);
          next.delete(game.id);
          return next;
        });
        return result;
      } catch (error) {
        setActiveDownloads((prev) => {
          const next = new Map(prev);
          next.delete(game.id);
          return next;
        });
        throw error;
      }
    },
    [],
  );

  const getProgress = useCallback(
    (gameId: number): InstallProgress | null => {
      return activeDownloads.get(gameId)?.progress ?? null;
    },
    [activeDownloads],
  );

  const value: DownloadManagerContextValue = {
    activeDownloads,
    activeCount: activeDownloads.size,
    startDownload,
    getProgress,
  };

  return (
    <DownloadManagerContext.Provider value={value}>
      {children}
    </DownloadManagerContext.Provider>
  );
}
