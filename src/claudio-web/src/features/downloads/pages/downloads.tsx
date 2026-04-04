import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { Game } from "../../core/types/models";
import { cancelInstall, restartInstallInteractive } from "../../desktop/hooks/use-desktop";
import CoverThumb from "../components/cover-thumb";
import { useDownloadManager } from "../hooks/use-download-manager-hook";

function formatSpeed(bytesPerSecond: number): string {
  const mbps = bytesPerSecond / 1_000_000;
  if (mbps >= 100) return `${Math.round(mbps)} MB/s`;
  if (mbps >= 10) return `${mbps.toFixed(1)} MB/s`;
  return `${mbps.toFixed(2)} MB/s`;
}

export default function Downloads() {
  const queryClient = useQueryClient();
  const { activeDownloads } = useDownloadManager();
  const [restartRequestedByGameId, setRestartRequestedByGameId] = useState<Set<number>>(new Set());

  const games = queryClient.getQueryData<Game[]>(["games"]);

  function getCover(remoteGameId: number): string | undefined {
    return games?.find((g) => g.id === remoteGameId)?.coverUrl;
  }

  const activeList = [...activeDownloads.values()];

  return (
    <main className="max-w-7xl mx-auto px-6 py-8 flex-1 flex flex-col w-full">
      {activeList.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center py-16">
          <svg
            className="w-12 h-12 mx-auto text-text-muted/40 mb-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
            />
          </svg>
          <p className="text-text-muted text-sm">No active downloads</p>
          <p className="text-text-muted/60 text-xs mt-1">
            Install games from the library to see them here
          </p>
        </div>
      ) : (
        <section>
          <h2 className="text-sm font-semibold text-text-muted uppercase tracking-wider mb-3">
            Active
          </h2>
          <div className="space-y-2">
            {activeList.map(({ game, progress, speedBps }) => {
              const isIndeterminate = progress.indeterminate === true;
              const hasPercent = typeof progress.percent === "number";
              const canRestartInteractive =
                game.installType === "installer" &&
                progress.status === "installing" &&
                game.forceInteractive !== true;
              const isRestartingInteractive = restartRequestedByGameId.has(game.id);

              return (
                <div
                  key={game.id}
                  className="flex items-center gap-4 bg-surface rounded-lg p-4 ring-1 ring-border"
                >
                  <CoverThumb coverUrl={getCover(game.id)} title={game.title} size="lg" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{game.title}</div>
                    <div className="text-sm text-text-muted mt-0.5">
                      <span>
                        {progress.detail ??
                          progress.status.charAt(0).toUpperCase() + progress.status.slice(1)}
                      </span>
                      {speedBps != null && (
                        <span className="ml-2 font-mono tabular-nums">{formatSpeed(speedBps)}</span>
                      )}
                    </div>
                    {(isIndeterminate || hasPercent) && (
                      <div className="mt-2.5 h-2 rounded-full bg-surface-raised overflow-hidden">
                        {isIndeterminate ? (
                          <div className="h-full bg-accent rounded-full progress-indeterminate-bar" />
                        ) : (
                          <div
                            className="h-full bg-accent rounded-full transition-[width] duration-300"
                            style={{ width: `${Math.min(100, progress.percent ?? 0)}%` }}
                          />
                        )}
                      </div>
                    )}
                  </div>
                  {!isIndeterminate && hasPercent && (
                    <span className="text-sm text-text-muted font-mono tabular-nums shrink-0">
                      {Math.round(progress.percent ?? 0)}%
                    </span>
                  )}
                  <div className="flex items-center gap-2">
                    {canRestartInteractive && (
                      <button
                        onClick={async () => {
                          setRestartRequestedByGameId((previous) => new Set(previous).add(game.id));
                          try {
                            await restartInstallInteractive(game.id);
                          } finally {
                            setRestartRequestedByGameId((previous) => {
                              const next = new Set(previous);
                              next.delete(game.id);
                              return next;
                            });
                          }
                        }}
                        disabled={isRestartingInteractive}
                        className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-text-secondary transition hover:border-accent hover:text-text-primary disabled:opacity-50 disabled:cursor-not-allowed"
                        title="Restart installer interactively"
                      >
                        {isRestartingInteractive ? "Restarting..." : "Run interactively"}
                      </button>
                    )}
                    <button
                      onClick={() => cancelInstall(game.id)}
                      className="p-1.5 rounded-lg text-text-muted hover:text-red-400 hover:bg-surface-raised transition"
                      title="Cancel download"
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </main>
  );
}
