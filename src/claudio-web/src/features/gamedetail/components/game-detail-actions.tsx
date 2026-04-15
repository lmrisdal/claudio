import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import UninstallDialog from "../../core/components/uninstall-dialog";
import type { Game } from "../../core/types/models";
import { sounds } from "../../core/utils/sounds";
import {
  launchGame,
  listGameExecutables,
  listRunningGames,
  openInstallFolder,
  setGameExe,
  stopGame,
  uninstallGame,
  validateInstallTarget,
  type InstalledGame,
  type RunningGame,
} from "../../desktop/hooks/use-desktop";
import { useDownloadManager } from "../../downloads/hooks/use-download-manager-hook";
import CompressionProgress from "./compression-progress";
import DownloadButton from "./download-button";
import InstallDialog from "./install-dialog";
import PickExeDialog from "./pick-exe-dialog";
import PlayContextMenu from "./play-context-menu";

interface GameDetailActionsProperties {
  gameId: string;
  game?: Game;
  displayGame: Game;
  installedGame: InstalledGame | null | undefined;
  isInstalledGameLoading: boolean;
  isDesktop: boolean;
  isDesktopPcGame: boolean;
  isDesktopPcDownload: boolean;
  emulationSupported: boolean;
  installExeLabel?: string;
  needsInstallerExe: boolean;
  needsGameExe: boolean;
  refetchInstalledGame: () => Promise<unknown>;
}

export default function GameDetailActions({
  gameId,
  game,
  displayGame,
  installedGame,
  isInstalledGameLoading,
  isDesktop,
  isDesktopPcGame,
  isDesktopPcDownload,
  emulationSupported,
  installExeLabel,
  needsInstallerExe,
  needsGameExe,
  refetchInstalledGame,
}: GameDetailActionsProperties) {
  const queryClient = useQueryClient();
  const {
    startDownload,
    startPackageDownload,
    getProgress,
    cancelDownload,
    restartDownloadInteractive,
  } = useDownloadManager();
  const [pickExeOpen, setPickExeOpen] = useState(false);
  const [pickExeOptions, setPickExeOptions] = useState<string[]>([]);
  const [playContextMenu, setPlayContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  const [showInstallConfirm, setShowInstallConfirm] = useState(false);
  const [defaultInstallPath, setDefaultInstallPath] = useState("");
  const [installerDownloadOverride, setInstallerDownloadOverride] = useState(false);
  const [installButtonMenu, setInstallButtonMenu] = useState<{ x: number; y: number } | null>(null);
  const [showUninstallConfirm, setShowUninstallConfirm] = useState(false);
  const [launchingGameId, setLaunchingGameId] = useState<number | null>(null);
  const [stoppingGameId, setStoppingGameId] = useState<number | null>(null);

  const { data: exeList } = useQuery({
    queryKey: ["executables", gameId],
    queryFn: () => fetchExecutables(gameId),
    enabled: showInstallConfirm && (needsInstallerExe || needsGameExe),
  });

  const { data: runningGames = [] } = useQuery({
    queryKey: ["runningGames"],
    queryFn: listRunningGames,
    enabled: isDesktop,
    refetchInterval: 3000,
  });

  const installMutation = useMutation({
    mutationFn: async (
      input: Game & {
        installPath?: string;
        desktopShortcut?: boolean;
        runAsAdministrator?: boolean;
        forceInteractive?: boolean;
      },
    ) => {
      return startDownload({
        id: input.id,
        title: input.title,
        platform: input.platform,
        installType: input.installType,
        installerExe: input.installerExe ?? null,
        gameExe: input.gameExe ?? null,
        installPath: input.installPath ?? null,
        desktopShortcut: input.desktopShortcut,
        runAsAdministrator: input.runAsAdministrator,
        forceInteractive: input.forceInteractive,
        summary: input.summary ?? null,
        genre: input.genre ?? null,
        releaseYear: input.releaseYear ?? null,
        coverUrl: input.coverUrl ?? null,
        heroUrl: input.heroUrl ?? null,
        developer: input.developer ?? null,
        publisher: input.publisher ?? null,
        gameMode: input.gameMode ?? null,
        series: input.series ?? null,
        franchise: input.franchise ?? null,
        gameEngine: input.gameEngine ?? null,
      });
    },
    onMutate: () => {
      setInstallError(null);
    },
    onSuccess: async (installed) => {
      setInstallError(null);
      queryClient.setQueryData(["installedGame", gameId], installed);
      void queryClient.invalidateQueries({ queryKey: ["installedGames"] });
      await refetchInstalledGame();
    },
    onError: (error: unknown) => {
      const message =
        typeof error === "string"
          ? error
          : error instanceof Error
            ? error.message
            : "Installation failed unexpectedly. Please try again.";
      if (message.toLowerCase().includes("cancel")) {
        return;
      }
      setInstallError(message);
    },
  });

  const packageDownloadMutation = useMutation({
    mutationFn: async (input: { targetDir: string; extract: boolean }) => {
      return startPackageDownload(
        {
          id: displayGame.id,
          title: displayGame.title,
          targetDir: input.targetDir,
          extract: input.extract,
        },
        {
          id: displayGame.id,
          title: displayGame.title,
          platform: displayGame.platform,
        },
      );
    },
    onMutate: () => {
      setInstallError(null);
    },
    onError: (error: unknown) => {
      const message =
        typeof error === "string"
          ? error
          : error instanceof Error
            ? error.message
            : "Download failed unexpectedly. Please try again.";
      if (message.toLowerCase().includes("cancel")) {
        return;
      }
      setInstallError(message);
    },
  });

  const stopGameMutation = useMutation({
    mutationFn: async (remoteGameId: number) => {
      await stopGame(remoteGameId);
    },
    onMutate: async (remoteGameId) => {
      setStoppingGameId(remoteGameId);
      setLaunchingGameId((current) => (current === remoteGameId ? null : current));
      await queryClient.cancelQueries({ queryKey: ["runningGames"] });
      const previous = queryClient.getQueryData<RunningGame[]>(["runningGames"]) ?? [];
      queryClient.setQueryData<RunningGame[]>(
        ["runningGames"],
        previous.filter((runningGame) => runningGame.gameId !== remoteGameId),
      );
      return { previous };
    },
    onError: (error, _remoteGameId, context) => {
      setStoppingGameId(null);
      if (context?.previous) {
        queryClient.setQueryData(["runningGames"], context.previous);
      }
      setInstallError(error instanceof Error ? error.message : "Could not stop game.");
    },
    onSettled: async () => {
      setStoppingGameId(null);
      await queryClient.invalidateQueries({ queryKey: ["runningGames"] });
    },
  });

  const installProgress = getProgress(displayGame.id);
  const hasActiveInstallProgress =
    installProgress?.gameId === displayGame.id &&
    installProgress.status !== "completed" &&
    installProgress.status !== "failed";
  const isGameRunning = runningGames.some((runningGame) => runningGame.gameId === displayGame.id);
  const isLaunchingGame = launchingGameId === displayGame.id;
  const isStoppingGame = stoppingGameId === displayGame.id;
  const canRestartInstallerInteractively =
    hasActiveInstallProgress &&
    installProgress?.status === "installing" &&
    displayGame.installType === "installer";

  const desktopInstallLabel = hasActiveInstallProgress
    ? installProgress?.status === "stopping" || installProgress?.status === "installing-interactive"
      ? (installProgress.detail ??
        (installProgress.status === "installing-interactive"
          ? "Running installer interactively..."
          : "Stopping installation..."))
      : typeof installProgress?.percent === "number"
        ? `Installing ${Math.round(installProgress.percent)}%`
        : "Installing..."
    : installMutation.isPending
      ? "Starting install..."
      : "Install";

  async function handleInstallClick() {
    try {
      setInstallError(null);

      const { resolveInstallPath } = await import("../../desktop/hooks/use-desktop");
      const fullPath = await resolveInstallPath(displayGame.title);
      setDefaultInstallPath(fullPath);
      setShowInstallConfirm(true);
    } catch (error) {
      setInstallError(
        error instanceof Error ? error.message : `Failed to load settings. ${String(error)}`,
      );
    }
  }

  async function promptExecutableSelection() {
    try {
      const exes = await listGameExecutables(displayGame.id);
      setPickExeOptions(exes);
      setPickExeOpen(true);
    } catch (error) {
      setInstallError(error instanceof Error ? error.message : "Could not list game executables.");
    }
  }

  async function handlePlayButtonClick() {
    if (isLaunchingGame || isStoppingGame) {
      return;
    }

    if (isGameRunning) {
      stopGameMutation.mutate(displayGame.id);
      return;
    }

    if (installedGame?.gameExe) {
      try {
        setLaunchingGameId(displayGame.id);
        setInstallError(null);
        await launchGame(displayGame.id);
        await queryClient.invalidateQueries({ queryKey: ["runningGames"] });
      } catch (error) {
        setLaunchingGameId(null);
        setInstallError(error instanceof Error ? error.message : "Could not launch game.");
        return;
      }
      setLaunchingGameId(null);
      return;
    }

    await promptExecutableSelection();
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        {emulationSupported && !displayGame.isMissing && (
          <Link
            to={`/games/${displayGame.id}/play`}
            data-nav
            onClick={(event) => {
              if (event.detail === 0) {
                void sounds.download();
              }
            }}
            className="inline-flex items-center gap-2 rounded-lg bg-surface-raised px-6 py-3 text-sm font-semibold text-text-primary ring-1 ring-border transition hover:border-accent hover:text-accent outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-(--bg)"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.25}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5.25 5.653c0-1.427 1.54-2.33 2.79-1.637l10.5 5.847c1.297.722 1.297 2.552 0 3.274l-10.5 5.847c-1.25.693-2.79-.21-2.79-1.637V5.653Z"
              />
            </svg>
            Play
          </Link>
        )}

        {displayGame.isMissing ? (
          <span className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm text-red-400 bg-red-500/10 ring-1 ring-red-500/30">
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
                d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
              />
            </svg>
            Missing from disk
          </span>
        ) : displayGame.isProcessing ? (
          <CompressionProgress gameId={displayGame.id} />
        ) : isDesktopPcGame ? (
          installedGame ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handlePlayButtonClick()}
                onContextMenu={(event) => {
                  if (isGameRunning || isStoppingGame) {
                    return;
                  }
                  event.preventDefault();
                  setPlayContextMenu({ x: event.clientX, y: event.clientY });
                }}
                className={`inline-flex items-center gap-2 rounded-lg px-6 py-3 text-sm font-semibold transition outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-(--bg) ${
                  isGameRunning || isStoppingGame
                    ? "bg-red-500 text-white hover:bg-red-400 focus-visible:ring-red-400"
                    : "bg-accent text-accent-foreground hover:bg-accent-hover focus-visible:ring-focus-ring"
                }`}
                disabled={isLaunchingGame || isStoppingGame}
              >
                <svg
                  className={`h-4 w-4 ${isLaunchingGame || isStoppingGame ? "animate-spin" : ""}`}
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  {isLaunchingGame || isStoppingGame ? (
                    <path d="M12 2.25a.75.75 0 0 1 .75.75v2.5a.75.75 0 0 1-1.5 0V3a.75.75 0 0 1 .75-.75ZM12 18.5a.75.75 0 0 1 .75.75v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 .75-.75ZM4.398 4.398a.75.75 0 0 1 1.06 0l1.768 1.768a.75.75 0 1 1-1.06 1.06L4.398 5.46a.75.75 0 0 1 0-1.061ZM16.774 16.774a.75.75 0 0 1 1.06 0l1.768 1.768a.75.75 0 1 1-1.06 1.06l-1.768-1.768a.75.75 0 0 1 0-1.06ZM2.25 12a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5H3a.75.75 0 0 1-.75-.75ZM18.5 12a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 1-.75-.75ZM6.167 16.774a.75.75 0 0 1 1.06 1.06L5.46 19.602a.75.75 0 1 1-1.06-1.06l1.767-1.768ZM18.542 4.398a.75.75 0 0 1 1.06 1.061l-1.768 1.767a.75.75 0 0 1-1.06-1.06l1.768-1.768Z" />
                  ) : isGameRunning ? (
                    <path d="M7.5 6.75A2.25 2.25 0 0 1 9.75 4.5h4.5a2.25 2.25 0 0 1 2.25 2.25v4.5a2.25 2.25 0 0 1-2.25 2.25h-4.5A2.25 2.25 0 0 1 7.5 11.25v-4.5Z" />
                  ) : (
                    <path d="M5.25 5.653c0-1.427 1.54-2.33 2.79-1.637l10.5 5.847c1.297.722 1.297 2.552 0 3.274l-10.5 5.847c-1.25.693-2.79-.21-2.79-1.637V5.653Z" />
                  )}
                </svg>
                {isLaunchingGame
                  ? "Launching..."
                  : isStoppingGame
                    ? "Stopping..."
                    : isGameRunning
                      ? "Stop"
                      : "Play"}
              </button>

              <button
                type="button"
                onClick={() => setShowUninstallConfirm(true)}
                className="inline-flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium text-text-secondary ring-1 ring-border hover:text-red-400 hover:ring-red-400/30 transition outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-(--bg)"
              >
                <svg
                  className="h-4 w-4"
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
                Uninstall
              </button>

              <button
                type="button"
                aria-label="Open install folder"
                onClick={() => {
                  openInstallFolder(displayGame.id).catch((error) => {
                    setInstallError(
                      error instanceof Error ? error.message : "Could not open the install folder.",
                    );
                  });
                }}
                className="inline-flex items-center justify-center rounded-lg px-3 py-3 text-text-secondary ring-1 ring-border hover:text-text-primary hover:ring-border/80 transition outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-(--bg)"
              >
                <svg
                  className="h-4 w-4"
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
            </div>
          ) : game ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                data-nav
                disabled={
                  installMutation.isPending || hasActiveInstallProgress || isInstalledGameLoading
                }
                onClick={() => void handleInstallClick()}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setInstallButtonMenu({ x: event.clientX, y: event.clientY });
                }}
                className="inline-flex items-center gap-2 rounded-lg bg-accent px-6 py-3 text-sm font-semibold text-accent-foreground transition enabled:hover:bg-accent-hover disabled:bg-text-muted/20 disabled:text-text-muted disabled:cursor-not-allowed! outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-(--bg)"
              >
                <svg
                  className={`h-4 w-4 ${installMutation.isPending || hasActiveInstallProgress ? "animate-spin" : ""}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.25}
                >
                  {installMutation.isPending || hasActiveInstallProgress ? (
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 3v3m0 12v3m9-9h-3M6 12H3m15.364 6.364-2.121-2.121M8.757 8.757 6.636 6.636m10.728 0-2.121 2.121M8.757 15.243l-2.121 2.121"
                    />
                  ) : (
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
                    />
                  )}
                </svg>
                {desktopInstallLabel}
              </button>

              {(installMutation.isPending || hasActiveInstallProgress) && (
                <div className="flex items-center gap-2">
                  {canRestartInstallerInteractively && (
                    <button
                      type="button"
                      data-nav
                      onClick={() => void restartDownloadInteractive(displayGame.id)}
                      disabled={installProgress?.status === "stopping"}
                      className="inline-flex items-center rounded-lg border border-border px-3 py-3 text-xs font-medium text-text-secondary transition hover:border-accent hover:text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-(--bg)"
                    >
                      Run interactively
                    </button>
                  )}
                  <button
                    type="button"
                    data-nav
                    onClick={() => void cancelDownload(displayGame.id)}
                    aria-label="Cancel install"
                    disabled={installProgress?.status === "stopping"}
                    className="inline-flex items-center justify-center rounded-lg border border-border px-3 py-3 text-sm text-text-secondary transition hover:border-red-400 hover:text-red-400 outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2 focus-visible:ring-offset-(--bg)"
                  >
                    <svg
                      className="h-4 w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2.25}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
          ) : null
        ) : isDesktopPcDownload ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-nav
              disabled={packageDownloadMutation.isPending || hasActiveInstallProgress}
              onClick={() => void handleInstallClick()}
              className="inline-flex items-center gap-2 rounded-lg bg-accent px-6 py-3 text-sm font-semibold text-accent-foreground transition enabled:hover:bg-accent-hover disabled:bg-text-muted/20 disabled:text-text-muted disabled:cursor-not-allowed! outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-(--bg)"
            >
              <svg
                className={`h-4 w-4 ${packageDownloadMutation.isPending || hasActiveInstallProgress ? "animate-spin" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.25}
              >
                {packageDownloadMutation.isPending || hasActiveInstallProgress ? (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 3v3m0 12v3m9-9h-3M6 12H3m15.364 6.364-2.121-2.121M8.757 8.757 6.636 6.636m10.728 0-2.121 2.121M8.757 15.243l-2.121 2.121"
                  />
                ) : (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
                  />
                )}
              </svg>
              {hasActiveInstallProgress
                ? installProgress?.status === "stopping"
                  ? (installProgress.detail ?? "Stopping download...")
                  : installProgress?.status === "extracting"
                    ? typeof installProgress?.percent === "number"
                      ? `Extracting ${Math.round(installProgress.percent)}%`
                      : "Extracting..."
                    : typeof installProgress?.percent === "number"
                      ? `Downloading ${Math.round(installProgress.percent)}%`
                      : "Downloading..."
                : packageDownloadMutation.isPending
                  ? "Starting download..."
                  : "Download"}
            </button>

            {(packageDownloadMutation.isPending || hasActiveInstallProgress) && (
              <button
                type="button"
                data-nav
                onClick={() => void cancelDownload(displayGame.id)}
                aria-label="Cancel download"
                disabled={installProgress?.status === "stopping"}
                className="inline-flex items-center justify-center rounded-lg border border-border px-3 py-3 text-sm text-text-secondary transition hover:border-red-400 hover:text-red-400 outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2 focus-visible:ring-offset-(--bg)"
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.25}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        ) : (
          <DownloadButton gameId={displayGame.id} size={displayGame.sizeBytes} />
        )}
      </div>

      {installError && (
        <p className="mt-3 text-sm text-red-400" role="alert">
          {installError}
        </p>
      )}

      <InstallDialog
        key={showInstallConfirm ? "open" : "closed"}
        open={showInstallConfirm}
        gameId={displayGame.id}
        title={displayGame.title}
        defaultPath={defaultInstallPath}
        isPortable={displayGame.installType === "portable"}
        exeLabel={installExeLabel}
        exeOptions={exeList ?? []}
        installerPath={
          displayGame.installType === "installer" ? displayGame.installerExe : undefined
        }
        downloadMode={isDesktopPcDownload || installerDownloadOverride}
        errorMessage={installError}
        onPathChange={() => setInstallError(null)}
        onClose={() => {
          setShowInstallConfirm(false);
          setInstallerDownloadOverride(false);
        }}
        onConfirm={async (
          path,
          exe,
          desktopShortcut,
          runAsAdministrator,
          forceInteractive,
          extract,
        ) => {
          const isDownloadFlow = isDesktopPcDownload || installerDownloadOverride;

          if (isDownloadFlow) {
            if (!path) {
              setInstallError("Please choose a download location.");
              return;
            }

            setShowInstallConfirm(false);
            setInstallerDownloadOverride(false);
            packageDownloadMutation.mutate({ targetDir: path, extract: extract ?? true });
            return;
          }

          if (!game) {
            setInstallError("This game is not available for installation right now.");
            return;
          }

          const installTarget = path ?? defaultInstallPath;
          try {
            await validateInstallTarget(installTarget);
          } catch (error) {
            setInstallError(
              error instanceof Error ? error.message : "Could not validate the install location.",
            );
            return;
          }

          setShowInstallConfirm(false);
          setInstallerDownloadOverride(false);
          installMutation.mutate({
            ...game,
            installPath: path,
            desktopShortcut,
            runAsAdministrator,
            forceInteractive,
            installerExe: needsInstallerExe ? exe : game.installerExe,
            gameExe: needsGameExe ? exe : game.gameExe,
          });
        }}
      />

      {playContextMenu && (
        <PlayContextMenu
          x={playContextMenu.x}
          y={playContextMenu.y}
          onClose={() => setPlayContextMenu(null)}
          onChangeExecutable={() => {
            setPlayContextMenu(null);
            void promptExecutableSelection();
          }}
        />
      )}

      <UninstallDialog
        open={showUninstallConfirm}
        title={displayGame.title}
        onClose={() => setShowUninstallConfirm(false)}
        onConfirm={async (deleteFiles) => {
          await uninstallGame(displayGame.id, deleteFiles);
          setShowUninstallConfirm(false);
          queryClient.setQueryData(["installedGame", gameId], null);
          void queryClient.invalidateQueries({ queryKey: ["installedGames"] });
          await refetchInstalledGame();
        }}
      />

      <PickExeDialog
        open={pickExeOpen}
        title={displayGame.title}
        exeOptions={pickExeOptions}
        onClose={() => setPickExeOpen(false)}
        onConfirm={async (exe) => {
          setPickExeOpen(false);

          if (!installedGame) {
            return;
          }

          try {
            const fullExe = `${installedGame.installPath}\\${exe}`;
            await setGameExe(displayGame.id, fullExe);
            setLaunchingGameId(displayGame.id);
            setInstallError(null);
            await launchGame(displayGame.id);
            await queryClient.invalidateQueries({ queryKey: ["runningGames"] });
          } catch (error) {
            setLaunchingGameId(null);
            setInstallError(error instanceof Error ? error.message : "Could not launch game.");
            return;
          }
          setLaunchingGameId(null);
        }}
      />

      {installButtonMenu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setInstallButtonMenu(null)}
            onContextMenu={(event) => {
              event.preventDefault();
              setInstallButtonMenu(null);
            }}
          />
          <div
            className="fixed z-50 min-w-48 rounded-lg border border-border bg-surface shadow-xl py-1"
            style={{ left: installButtonMenu.x, top: installButtonMenu.y }}
          >
            <button
              type="button"
              className="w-full px-3 py-2 text-left text-sm text-text-primary hover:bg-surface-raised transition"
              onClick={() => {
                setInstallButtonMenu(null);
                setInstallerDownloadOverride(true);
                void handleInstallClick();
              }}
            >
              Download installer
            </button>
          </div>
        </>
      )}
    </>
  );
}

async function fetchExecutables(gameId: string) {
  const { api } = await import("../../core/api/client");
  return api.get<string[]>(`/games/${gameId}/executables`);
}
