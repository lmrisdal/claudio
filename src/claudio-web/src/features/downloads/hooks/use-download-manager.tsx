import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  cancelInstall,
  installGame,
  isDesktop,
  listenToInstallProgress,
  restartInstallInteractive,
  type DesktopInstallGameInput,
  type InstalledGame,
  type InstallProgress,
} from "../../desktop/hooks/use-desktop";
import {
  DownloadManagerContext,
  type ActiveDownload,
  type DownloadManagerContextValue,
} from "./download-manager-context";

interface SpeedState {
  lastBytes: number;
  lastTime: number;
  speed: number | null;
  sampleCount: number;
}

function updateActionProgress(
  previous: Map<number, ActiveDownload>,
  gameId: number,
  progress: InstallProgress,
) {
  const existing = previous.get(gameId);
  if (!existing) return previous;

  return new Map([
    ...previous,
    [gameId, { ...existing, progress, speedBps: null }],
  ]);
}

export function DownloadManagerProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [activeDownloads, setActiveDownloads] = useState<Map<number, ActiveDownload>>(new Map());
  const speedState = useRef<Map<number, SpeedState>>(new Map());

  useEffect(() => {
    if (!isDesktop) return;

    let cancelled = false;
    let unlisten: (() => void) | undefined;

    void listenToInstallProgress((progress) => {
      if (cancelled) return;

      // Compute speed outside the state updater to avoid issues with
      // React strict mode re-running updaters and corrupting the ref.
      let speedBps: number | null = null;

      if (progress.status === "downloading" && progress.bytesDownloaded != null) {
        const now = performance.now();
        const prev = speedState.current.get(progress.gameId);

        if (prev) {
          const elapsed = (now - prev.lastTime) / 1000;
          if (elapsed >= 0.5 && progress.bytesDownloaded > prev.lastBytes) {
            const instantSpeed = (progress.bytesDownloaded - prev.lastBytes) / elapsed;
            const count = prev.sampleCount + 1;
            // Skip the first sample (often a burst), use second as baseline
            if (count <= 1) {
              speedBps = null;
            } else if (prev.speed === null) {
              speedBps = instantSpeed;
            } else {
              speedBps = 0.3 * instantSpeed + 0.7 * prev.speed;
            }
            speedState.current.set(progress.gameId, {
              lastBytes: progress.bytesDownloaded,
              lastTime: now,
              speed: speedBps,
              sampleCount: count,
            });
          } else {
            speedBps = prev.speed;
          }
        } else {
          // Store first baseline sample, don't compute speed yet
          speedState.current.set(progress.gameId, {
            lastBytes: progress.bytesDownloaded,
            lastTime: now,
            speed: null,
            sampleCount: 0,
          });
        }
      } else {
        speedState.current.delete(progress.gameId);
      }

      setActiveDownloads((previous) => {
        const existing = previous.get(progress.gameId);
        if (!existing) return previous;

        const next = new Map(previous);
        if (progress.status === "completed" || progress.status === "failed") {
          next.delete(progress.gameId);
          speedState.current.delete(progress.gameId);
        } else {
          next.set(progress.gameId, { ...existing, progress, speedBps });
        }
        return next;
      });

      if (progress.status === "completed") {
        void queryClient.invalidateQueries({ queryKey: ["installedGames"] });
      }
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
  }, [queryClient]);

  const startDownload = useCallback(
    async (game: DesktopInstallGameInput): Promise<InstalledGame> => {
      setActiveDownloads((previous) => {
        const next = new Map([
          ...previous,
          [
            game.id,
            {
              game,
              progress: { gameId: game.id, status: "starting", percent: 0 },
              speedBps: null,
            },
          ],
        ]);
        return next;
      });

      try {
        const result = await installGame(game);
        setActiveDownloads((previous) => {
          const next = new Map(previous);
          next.delete(game.id);
          return next;
        });
        speedState.current.delete(game.id);
        return result;
      } catch (error) {
        setActiveDownloads((previous) => {
          const next = new Map(previous);
          next.delete(game.id);
          return next;
        });
        speedState.current.delete(game.id);
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

  const cancelDownload = useCallback(async (gameId: number) => {
    let previousProgress: InstallProgress | null = null;
    setActiveDownloads((previous) =>
      {
        previousProgress = previous.get(gameId)?.progress ?? null;
        return updateActionProgress(previous, gameId, {
          gameId,
          status: "stopping",
          detail: "Stopping installation...",
          indeterminate: true,
        });
      },
    );
    try {
      await cancelInstall(gameId);
    } catch (error) {
      const restoreProgress = previousProgress;
      if (restoreProgress !== null) {
        setActiveDownloads((previous) => updateActionProgress(previous, gameId, restoreProgress));
      }
      throw error;
    }
  }, []);

  const restartDownloadInteractive = useCallback(async (gameId: number) => {
    let previousProgress: InstallProgress | null = null;
    setActiveDownloads((previous) =>
      {
        previousProgress = previous.get(gameId)?.progress ?? null;
        return updateActionProgress(previous, gameId, {
          gameId,
          status: "stopping",
          detail: "Stopping installation to restart interactively...",
          indeterminate: true,
        });
      },
    );
    try {
      await restartInstallInteractive(gameId);
    } catch (error) {
      const restoreProgress = previousProgress;
      if (restoreProgress !== null) {
        setActiveDownloads((previous) => updateActionProgress(previous, gameId, restoreProgress));
      }
      throw error;
    }
  }, []);

  const value: DownloadManagerContextValue = {
    activeDownloads,
    activeCount: activeDownloads.size,
    startDownload,
    getProgress,
    cancelDownload,
    restartDownloadInteractive,
  };

  return (
    <DownloadManagerContext.Provider value={value}>{children}</DownloadManagerContext.Provider>
  );
}
