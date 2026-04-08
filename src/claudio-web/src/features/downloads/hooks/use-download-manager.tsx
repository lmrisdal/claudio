import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  cancelInstall,
  downloadGamePackage,
  installGame,
  isDesktop,
  listenToInstallProgress,
  restartInstallInteractive,
  type DesktopInstallGameInput,
  type DownloadPackageInput,
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

interface FailureToast {
  id: number;
  title: string;
  message: string;
}

function messageFromError(error: unknown, fallback: string): string {
  if (typeof error === "string") return error;
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return fallback;
}

function isCancellationError(message: string): boolean {
  return message.toLowerCase().includes("cancel");
}

function updateActionProgress(
  previous: Map<number, ActiveDownload>,
  gameId: number,
  progress: InstallProgress,
) {
  const existing = previous.get(gameId);
  if (!existing) return previous;

  return new Map([...previous, [gameId, { ...existing, progress, speedBps: null }]]);
}

function updateDownloadEntry(
  previous: Map<number, ActiveDownload>,
  gameId: number,
  update: (existing: ActiveDownload) => ActiveDownload,
) {
  const existing = previous.get(gameId);
  if (!existing) return previous;

  return new Map([...previous, [gameId, update(existing)]]);
}

export function DownloadManagerProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [activeDownloads, setActiveDownloads] = useState<Map<number, ActiveDownload>>(new Map());
  const [failureToasts, setFailureToasts] = useState<FailureToast[]>([]);
  const speedState = useRef<Map<number, SpeedState>>(new Map());
  const seenFailures = useRef<Map<number, string>>(new Map());
  const toastIdCounter = useRef(0);

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
        if (progress.status === "completed") {
          next.delete(progress.gameId);
          speedState.current.delete(progress.gameId);
        } else if (progress.status === "failed") {
          next.set(progress.gameId, {
            ...existing,
            progress,
            speedBps: null,
            errorMessage: progress.detail ?? existing.errorMessage ?? "Install failed.",
            failedAt: existing.failedAt ?? Date.now(),
          });
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

  useEffect(() => {
    for (const [gameId, entry] of activeDownloads) {
      if (entry.progress.status !== "failed") {
        continue;
      }
      const failureKey = `${entry.failedAt ?? 0}:${entry.errorMessage ?? entry.progress.detail ?? "Install failed."}`;
      if (seenFailures.current.get(gameId) === failureKey) {
        continue;
      }
      seenFailures.current.set(gameId, failureKey);

      const id = ++toastIdCounter.current;
      setFailureToasts((previous) => [
        ...previous,
        {
          id,
          title: `${entry.game.title} failed`,
          message: entry.errorMessage ?? entry.progress.detail ?? "Install failed.",
        },
      ]);

      globalThis.setTimeout(() => {
        setFailureToasts((previous) => previous.filter((toast) => toast.id !== id));
      }, 6000);
    }
  }, [activeDownloads]);

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
              kind: "install",
              errorMessage: undefined,
              failedAt: undefined,
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
        const message = messageFromError(error, "Installation failed unexpectedly.");
        if (isCancellationError(message)) {
          setActiveDownloads((previous) => {
            const next = new Map(previous);
            next.delete(game.id);
            return next;
          });
        } else {
          setActiveDownloads((previous) =>
            updateDownloadEntry(previous, game.id, (existing) => ({
              ...existing,
              progress: {
                gameId: game.id,
                status: "failed",
                detail: message,
                indeterminate: false,
              },
              speedBps: null,
              errorMessage: message,
              failedAt: Date.now(),
            })),
          );
        }
        speedState.current.delete(game.id);
        throw error;
      }
    },
    [],
  );

  const startPackageDownload = useCallback(
    async (
      input: DownloadPackageInput,
      game: Pick<DesktopInstallGameInput, "id" | "title" | "platform">,
    ): Promise<string> => {
      const stub: DesktopInstallGameInput = {
        id: game.id,
        title: game.title,
        platform: game.platform,
        installType: "portable",
      };
      setActiveDownloads((previous) => {
        const next = new Map([
          ...previous,
          [
            input.id,
            {
              game: stub,
              progress: { gameId: input.id, status: "starting", percent: 0 },
              speedBps: null,
              kind: "package",
              packageInput: input,
              errorMessage: undefined,
              failedAt: undefined,
            },
          ],
        ]);
        return next;
      });

      try {
        const result = await downloadGamePackage(input);
        setActiveDownloads((previous) => {
          const next = new Map(previous);
          next.delete(input.id);
          return next;
        });
        speedState.current.delete(input.id);
        return result;
      } catch (error) {
        const message = messageFromError(error, "Download failed unexpectedly.");
        if (isCancellationError(message)) {
          setActiveDownloads((previous) => {
            const next = new Map(previous);
            next.delete(input.id);
            return next;
          });
        } else {
          setActiveDownloads((previous) =>
            updateDownloadEntry(previous, input.id, (existing) => ({
              ...existing,
              progress: {
                gameId: input.id,
                status: "failed",
                detail: message,
                indeterminate: false,
              },
              speedBps: null,
              errorMessage: message,
              failedAt: Date.now(),
            })),
          );
        }
        speedState.current.delete(input.id);
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
    setActiveDownloads((previous) => {
      previousProgress = previous.get(gameId)?.progress ?? null;
      return updateActionProgress(previous, gameId, {
        gameId,
        status: "stopping",
        detail: "Stopping installation...",
        indeterminate: true,
      });
    });
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
    setActiveDownloads((previous) => {
      previousProgress = previous.get(gameId)?.progress ?? null;
      return updateActionProgress(previous, gameId, {
        gameId,
        status: "stopping",
        detail: "Stopping installation to restart interactively...",
        indeterminate: true,
      });
    });
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

  const dismissDownload = useCallback((gameId: number) => {
    setActiveDownloads((previous) => {
      const next = new Map(previous);
      next.delete(gameId);
      return next;
    });
    seenFailures.current.delete(gameId);
    speedState.current.delete(gameId);
  }, []);

  const retryDownload = useCallback(
    async (gameId: number) => {
      const existing = activeDownloads.get(gameId);
      if (!existing) {
        return;
      }

      setActiveDownloads((previous) =>
        updateActionProgress(previous, gameId, {
          gameId,
          status: "starting",
          percent: 0,
          detail: "Retrying...",
        }),
      );

      try {
        if (existing.kind === "install") {
          await installGame(existing.game);
          setActiveDownloads((previous) => {
            const next = new Map(previous);
            next.delete(gameId);
            return next;
          });
          speedState.current.delete(gameId);
          void queryClient.invalidateQueries({ queryKey: ["installedGames"] });
          return;
        }

        if (!existing.packageInput) {
          throw new Error("Missing package download settings for retry.");
        }

        await downloadGamePackage(existing.packageInput);
        setActiveDownloads((previous) => {
          const next = new Map(previous);
          next.delete(gameId);
          return next;
        });
        speedState.current.delete(gameId);
      } catch (error) {
        const message = messageFromError(error, "Retry failed.");
        if (isCancellationError(message)) {
          setActiveDownloads((previous) => {
            const next = new Map(previous);
            next.delete(gameId);
            return next;
          });
          speedState.current.delete(gameId);
          throw error;
        }
        setActiveDownloads((previous) =>
          updateDownloadEntry(previous, gameId, (entry) => ({
            ...entry,
            progress: {
              gameId,
              status: "failed",
              detail: message,
              indeterminate: false,
            },
            speedBps: null,
            errorMessage: message,
            failedAt: Date.now(),
          })),
        );
        speedState.current.delete(gameId);
        throw error;
      }
    },
    [activeDownloads, queryClient],
  );

  const value: DownloadManagerContextValue = {
    activeDownloads,
    activeCount: activeDownloads.size,
    startDownload,
    startPackageDownload,
    getProgress,
    cancelDownload,
    restartDownloadInteractive,
    retryDownload,
    dismissDownload,
  };

  return (
    <DownloadManagerContext.Provider value={value}>
      {children}
      {failureToasts.length > 0 && (
        <div className="fixed right-4 bottom-4 z-[120] flex w-[min(420px,calc(100vw-2rem))] flex-col gap-2 pointer-events-none">
          {failureToasts.map((toast) => (
            <div
              key={toast.id}
              className="rounded-lg border border-red-500/40 bg-surface p-3 shadow-xl"
              role="alert"
              aria-live="assertive"
            >
              <h3 className="text-sm font-semibold text-red-400">{toast.title}</h3>
              <p className="mt-1 text-sm text-text-secondary">{toast.message}</p>
            </div>
          ))}
        </div>
      )}
    </DownloadManagerContext.Provider>
  );
}
