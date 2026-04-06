import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useAuth } from "../../auth/hooks/use-auth";
import { api } from "../../core/api/client";
import { useArrowNav } from "../../core/hooks/use-arrow-nav";
import { useShortcut } from "../../core/hooks/use-shortcut";
import type { Game } from "../../core/types/models";
import { isMac } from "../../core/utils/os";
import { sounds } from "../../core/utils/sounds";
import { useDesktop, type InstalledGame } from "../../desktop/hooks/use-desktop";
import BrowseFilesDialog from "../components/browse-files-dialog";
import GameDetailActions from "../components/game-detail-actions";
import GameDetailOverview from "../components/game-detail-overview";
import { isPcPlatform, type BrowseResponse } from "../shared";

export default function GameDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { isDesktop, getInstalledGame: getDesktopInstalledGame } = useDesktop();
  const mainReference = useRef<HTMLElement>(null);
  const focusAnchorReference = useRef<HTMLDivElement>(null);
  const [browsePath, setBrowsePath] = useState<string | null>(null);

  useShortcut("escape", () => {
    if (browsePath !== null) {
      setBrowsePath(null);
      void sounds.back();
      return;
    }

    void sounds.back();
    void navigate("/");
  });

  const handleMainKeyDown = useArrowNav(mainReference, {
    enabled: browsePath === null,
  });

  const { data: game, isLoading } = useQuery({
    queryKey: ["game", id],
    queryFn: () => api.get<Game>(`/games/${id}`),
    refetchInterval: (query) => (query.state.data?.isProcessing ? 3000 : false),
    enabled: !!id,
  });

  const {
    data: installedGame,
    refetch: refetchInstalledGame,
    isFetching: isInstalledGameLoading,
  } = useQuery({
    queryKey: ["installedGame", id],
    queryFn: () => getDesktopInstalledGame(Number(id)),
    enabled: isDesktop && !!id,
  });

  const { data: browseData, isLoading: browseLoading } = useQuery({
    queryKey: ["browse", id, browsePath],
    queryFn: () =>
      api.get<BrowseResponse>(`/games/${id}/browse?path=${encodeURIComponent(browsePath ?? "")}`),
    enabled: browsePath !== null,
  });

  const { data: emulation } = useQuery({
    queryKey: ["emulation", id],
    queryFn: () =>
      api.get<{
        supported: boolean;
        reason?: string;
      }>(`/games/${id}/emulation`),
    enabled: !!id,
  });

  const displayGame = useMemo(() => mergeDisplayGame(game, installedGame), [game, installedGame]);
  const isDesktopPcGame =
    isDesktop && !isMac && !!displayGame && isPcPlatform(displayGame.platform);
  const isDesktopPcDownload =
    isDesktop && isMac && !!displayGame && isPcPlatform(displayGame.platform);
  const needsInstallerExe = game?.installType === "installer" && !game.installerExe;
  const needsGameExe = game?.installType === "portable" && !game.gameExe;
  const installExeLabel = needsInstallerExe
    ? "Setup Executable"
    : needsGameExe
      ? "Game Executable"
      : undefined;

  useEffect(() => {
    if (!isLoading && game) {
      requestAnimationFrame(() => focusAnchorReference.current?.focus());
    }
  }, [isLoading, game]);

  if (isLoading) {
    return (
      <main className="max-w-5xl mx-auto px-6 py-12 flex-1 w-full">
        <div className="flex flex-col md:flex-row gap-10 animate-pulse">
          <div className="w-72 shrink-0 aspect-2/3 bg-surface-raised rounded-xl" />
          <div className="flex-1 space-y-4 pt-2">
            <div className="h-8 bg-surface-raised rounded w-2/3" />
            <div className="h-4 bg-surface-raised rounded w-1/3" />
            <div className="h-20 bg-surface-raised rounded w-full mt-6" />
          </div>
        </div>
      </main>
    );
  }

  if (!displayGame) {
    return (
      <main className="max-w-5xl mx-auto px-6 py-24 text-center flex-1 w-full">
        <p className="text-text-muted">Game not found</p>
        <Link to="/" className="text-accent hover:underline text-sm mt-2 inline-block">
          Back to library
        </Link>
      </main>
    );
  }

  return (
    <div className="relative flex-1 w-full">
      {displayGame.heroUrl && (
        <div
          className="pointer-events-none fixed inset-x-0 top-0 h-72 overflow-hidden"
          aria-hidden="true"
        >
          <img src={displayGame.heroUrl} alt="" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-linear-to-t from-(--bg) via-(--bg)/60 to-transparent" />
        </div>
      )}

      <main
        ref={mainReference}
        onKeyDown={handleMainKeyDown}
        className="relative z-10 max-w-5xl mx-auto px-6 py-12 flex-1 w-full"
      >
        <div
          ref={focusAnchorReference}
          tabIndex={0}
          className="outline-none h-0 overflow-hidden"
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowRight") {
              event.preventDefault();
              const first = mainReference.current?.querySelector<HTMLElement>("[data-nav]");
              if (first) {
                first.focus();
                void sounds.navigate();
              }
            }
          }}
        />

        <Link
          to="/"
          data-nav
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              void sounds.back();
            }
          }}
          className={`inline-flex items-center gap-1.5 text-sm transition mb-8 rounded-lg px-3 py-2 outline-none focus-visible:[box-shadow:0_0_0_4px_var(--bg),0_0_0_6px_#00d9b8] ${
            displayGame.heroUrl
              ? "hero-glass-chip bg-black/30 text-white/85 ring-1 ring-white/10 backdrop-blur-sm hover:bg-black/40 hover:text-white shadow-[0_4px_20px_rgba(0,0,0,0.2)]"
              : "text-text-muted hover:text-text-primary"
          }`}
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          Library
        </Link>

        <div className="flex flex-col md:flex-row gap-10">
          <div className="w-72 shrink-0 mx-auto md:mx-0">
            <div className="aspect-2/3 bg-surface-raised rounded-xl overflow-hidden ring-1 ring-border">
              {displayGame.coverUrl ? (
                <img
                  src={displayGame.coverUrl}
                  alt={displayGame.title}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-text-muted gap-2">
                  <svg
                    className="w-12 h-12"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5a1.5 1.5 0 001.5-1.5V5.25a1.5 1.5 0 00-1.5-1.5H3.75a1.5 1.5 0 00-1.5 1.5v14.25a1.5 1.5 0 001.5 1.5z"
                    />
                  </svg>
                  <span className="text-xs">No cover</span>
                </div>
              )}
            </div>
          </div>

          <div className="flex-1 min-w-0">
            <GameDetailOverview
              game={displayGame}
              isAdmin={user?.role === "admin"}
              onBrowseFiles={() => setBrowsePath("")}
            >
              <GameDetailActions
                gameId={id ?? String(displayGame.id)}
                game={game}
                displayGame={displayGame}
                installedGame={installedGame}
                isInstalledGameLoading={isInstalledGameLoading}
                isDesktop={isDesktop}
                isDesktopPcGame={isDesktopPcGame}
                isDesktopPcDownload={isDesktopPcDownload}
                emulationSupported={!!emulation?.supported}
                installExeLabel={installExeLabel}
                needsInstallerExe={needsInstallerExe}
                needsGameExe={needsGameExe}
                refetchInstalledGame={refetchInstalledGame}
              />
            </GameDetailOverview>
          </div>
        </div>
      </main>

      <BrowseFilesDialog
        browsePath={browsePath}
        browseData={browseData}
        browseLoading={browseLoading}
        onClose={() => setBrowsePath(null)}
        onNavigate={setBrowsePath}
      />
    </div>
  );
}

function mergeDisplayGame(game?: Game, installedGame?: InstalledGame | null) {
  if (!game && !installedGame) {
    return null;
  }

  if (!game && installedGame) {
    return {
      id: installedGame.remoteGameId,
      title: installedGame.title,
      platform: installedGame.platform,
      installType: installedGame.installType,
      summary: installedGame.summary ?? undefined,
      genre: installedGame.genre ?? undefined,
      releaseYear: installedGame.releaseYear ?? undefined,
      coverUrl: installedGame.coverUrl ?? undefined,
      heroUrl: installedGame.heroUrl ?? undefined,
      developer: installedGame.developer ?? undefined,
      publisher: installedGame.publisher ?? undefined,
      gameMode: installedGame.gameMode ?? undefined,
      series: installedGame.series ?? undefined,
      franchise: installedGame.franchise ?? undefined,
      gameEngine: installedGame.gameEngine ?? undefined,
      igdbId: installedGame.igdbId ?? undefined,
      igdbSlug: installedGame.igdbSlug ?? undefined,
      sizeBytes: 0,
      folderName: "",
      isArchive: false,
      isMissing: false,
      isProcessing: false,
    } satisfies Game;
  }

  if (!game || !installedGame) {
    return game ?? null;
  }

  return {
    ...game,
    title: installedGame.title || game.title,
    summary: installedGame.summary || game.summary,
    genre: installedGame.genre || game.genre,
    releaseYear: installedGame.releaseYear || game.releaseYear,
    coverUrl: installedGame.coverUrl || game.coverUrl,
    heroUrl: installedGame.heroUrl || game.heroUrl,
    developer: installedGame.developer || game.developer,
    publisher: installedGame.publisher || game.publisher,
    gameMode: installedGame.gameMode || game.gameMode,
    series: installedGame.series || game.series,
    franchise: installedGame.franchise || game.franchise,
    gameEngine: installedGame.gameEngine || game.gameEngine,
    igdbId: installedGame.igdbId || game.igdbId,
    igdbSlug: installedGame.igdbSlug || game.igdbSlug,
  } satisfies Game;
}
