import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import UninstallDialog from "../../core/components/UninstallDialog";
import type { Game } from "../../core/types/models";
import {
  cancelInstall,
  listInstalledGames,
  openInstallFolder,
  uninstallGame,
} from "../../desktop/hooks/useDesktop";
import CoverThumb from "../components/CoverThumb";
import { useDownloadManager } from "../hooks/useDownloadManagerHook";

export default function Downloads() {
  const queryClient = useQueryClient();
  const { activeDownloads } = useDownloadManager();
  const [confirmDelete, setConfirmDelete] = useState<{
    id: number;
    title: string;
  } | null>(null);

  const { data: installedGames = [] } = useQuery({
    queryKey: ["installedGames"],
    queryFn: listInstalledGames,
    refetchInterval: 10_000,
  });

  const games = queryClient.getQueryData<Game[]>(["games"]);

  function getCover(remoteGameId: number): string | undefined {
    return games?.find((g) => g.id === remoteGameId)?.coverUrl;
  }

  const activeList = Array.from(activeDownloads.values());

  return (
    <main className="max-w-7xl mx-auto px-6 py-8 flex-1 flex flex-col w-full">
      <h1 className="text-2xl font-semibold mb-6">Downloads</h1>

      {/* Active downloads */}
      {activeList.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-text-muted uppercase tracking-wider mb-3">
            Active
          </h2>
          <div className="space-y-2">
            {activeList.map(({ game, progress }) => (
              <div
                key={game.id}
                className="flex items-center gap-4 bg-surface rounded-lg p-4 ring-1 ring-border"
              >
                <CoverThumb
                  coverUrl={getCover(game.id)}
                  title={game.title}
                  size="lg"
                />
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{game.title}</div>
                  <div className="text-sm text-text-muted mt-0.5">
                    {progress.detail ??
                      progress.status.charAt(0).toUpperCase() +
                        progress.status.slice(1)}
                  </div>
                  {typeof progress.percent === "number" && (
                    <div className="mt-2.5 h-2 rounded-full bg-surface-raised overflow-hidden">
                      <div
                        className="h-full bg-accent rounded-full transition-[width] duration-300"
                        style={{ width: `${Math.min(100, progress.percent)}%` }}
                      />
                    </div>
                  )}
                </div>
                {typeof progress.percent === "number" && (
                  <span className="text-sm text-text-muted font-mono tabular-nums shrink-0">
                    {Math.round(progress.percent)}%
                  </span>
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
            ))}
          </div>
        </section>
      )}

      {/* Installed games */}
      <section className="flex-1 flex flex-col">
        <h2 className="text-sm font-semibold text-text-muted uppercase tracking-wider mb-3">
          Installed
        </h2>
        {installedGames.length === 0 && activeList.length === 0 ? (
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
            <p className="text-text-muted text-sm">No downloads yet</p>
            <p className="text-text-muted/60 text-xs mt-1">
              Install games from the library to see them here
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {installedGames.map((installed) => (
              <div
                key={installed.remoteGameId}
                className="flex items-center gap-4 rounded-lg p-3 hover:bg-surface-raised/50 transition group"
              >
                <CoverThumb
                  coverUrl={getCover(installed.remoteGameId)}
                  title={installed.title}
                  size="lg"
                />
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{installed.title}</div>
                  <div className="text-sm text-text-muted mt-0.5">
                    {installed.platform} · {installed.installType}
                  </div>
                </div>
                <button
                  onClick={() => openInstallFolder(installed.remoteGameId)}
                  className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-raised transition"
                  title="Open install folder"
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
                      d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
                    />
                  </svg>
                </button>
                <button
                  onClick={() =>
                    setConfirmDelete({
                      id: installed.remoteGameId,
                      title: installed.title,
                    })
                  }
                  className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-text-muted hover:text-red-400 hover:bg-surface-raised transition"
                  title="Uninstall"
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
                      d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
                    />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <UninstallDialog
        open={confirmDelete !== null}
        title={confirmDelete?.title ?? ""}
        onClose={() => setConfirmDelete(null)}
        onConfirm={async (deleteFiles) => {
          if (!confirmDelete) return;
          await uninstallGame(confirmDelete.id, deleteFiles);
          setConfirmDelete(null);
          queryClient.invalidateQueries({ queryKey: ["installedGames"] });
          queryClient.invalidateQueries({
            queryKey: ["installedGame", String(confirmDelete.id)],
          });
        }}
      />
    </main>
  );
}
