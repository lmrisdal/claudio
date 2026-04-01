import { Dialog, DialogBackdrop, DialogPanel } from "@headlessui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useAuth } from "../../auth/hooks/useAuth";
import { api } from "../../core/api/client";
import UninstallDialog from "../../core/components/UninstallDialog";
import { useArrowNav } from "../../core/hooks/useArrowNav";
import { useShortcut } from "../../core/hooks/useShortcut";
import type { Game } from "../../core/types/models";
import { formatSize } from "../../core/utils/format";
import { formatPlatform } from "../../core/utils/platforms";
import { sounds } from "../../core/utils/sounds";
import { uninstallGame, useDesktop } from "../../desktop/hooks/useDesktop";
import { useDownloadManager } from "../../downloads/hooks/useDownloadManagerHook";
import CompressionProgress from "../components/CompressionProgress";
import DownloadButton from "../components/DownloadButton";
import ExeListbox from "../components/ExeListbox";
import InstallDialog from "../components/InstallDialog";

const pcPlatforms = new Set(["win", "mac", "linux"]);
function isPcPlatform(platform: string) {
  return pcPlatforms.has(platform.toLowerCase());
}

interface BrowseEntry {
  name: string;
  isDirectory: boolean;
  size?: number;
}

interface BrowseResponse {
  path: string;
  insideArchive: boolean;
  entries: BrowseEntry[];
}

interface IgdbCandidate {
  igdbId: number;
  name: string;
  summary?: string;
  genre?: string;
  releaseYear?: number;
  coverUrl?: string;
  developer?: string;
  publisher?: string;
  gameMode?: string;
  series?: string;
  franchise?: string;
  gameEngine?: string;
  platform?: string;
  platformSlug?: string;
}

export default function GameDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const {
    isDesktop,
    getInstalledGame: getDesktopInstalledGame,
    openInstallFolder: openDesktopInstallFolder,
  } = useDesktop();
  const { startDownload, getProgress } = useDownloadManager();
  const [candidates, setCandidates] = useState<IgdbCandidate[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [igdbQuery, setIgdbQuery] = useState("");
  const [browsePath, setBrowsePath] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  const [showInstallConfirm, setShowInstallConfirm] = useState(false);
  const [defaultInstallPath, setDefaultInstallPath] = useState("");
  const [showUninstallConfirm, setShowUninstallConfirm] = useState(false);

  const [editing, setEditing] = useState(false);
  const [sgdbDialog, setSgdbDialog] = useState<{
    open: boolean;
    mode: "covers" | "heroes";
  }>({ open: false, mode: "covers" });
  const [sgdbQuery, setSgdbQuery] = useState("");
  const [sgdbSearching, setSgdbSearching] = useState(false);
  const [sgdbGames, setSgdbGames] = useState<
    { id: number; name: string; year?: number }[] | null
  >(null);
  const [sgdbImages, setSgdbImages] = useState<string[] | null>(null);
  const [sgdbLoadingImages, setSgdbLoadingImages] = useState(false);
  const [editForm, setEditForm] = useState({
    title: "",
    summary: "",
    genre: "",
    releaseYear: "",
    coverUrl: "",
    heroUrl: "",
    installType: "" as "portable" | "installer",
    installerExe: "",
    gameExe: "",
    developer: "",
    publisher: "",
    gameMode: "",
    series: "",
    franchise: "",
    gameEngine: "",
    igdbId: "",
    igdbSlug: "",
  });

  useShortcut("escape", () => {
    // Don't navigate back if search dialog or other overlay is open
    if (document.querySelector("[data-search-dialog]")) return;
    if (browsePath !== null) {
      setBrowsePath(null);
      sounds.back();
    } else if (!editing && !sgdbDialog.open && !candidates) {
      sounds.back();
      navigate("/");
    }
  });

  const mainRef = useRef<HTMLElement>(null);
  const backLinkRef = useRef<HTMLAnchorElement>(null);
  const focusAnchorRef = useRef<HTMLDivElement>(null);
  const coverFileRef = useRef<HTMLInputElement>(null);
  const heroFileRef = useRef<HTMLInputElement>(null);
  const [pendingFiles, setPendingFiles] = useState<{
    cover?: File;
    hero?: File;
  }>({});

  // Arrow key navigation between back link and download button
  const handleMainKeyDown = useArrowNav(mainRef, {
    enabled: !editing && !sgdbDialog.open && !candidates && browsePath === null,
  });

  const { data: exeList } = useQuery({
    queryKey: ["executables", id],
    queryFn: () => api.get<string[]>(`/admin/games/${id}/executables`),
    enabled: editing && user?.role === "admin",
  });

  const { data: game, isLoading } = useQuery({
    queryKey: ["game", id],
    queryFn: () => api.get<Game>(`/games/${id}`),
    refetchInterval: (query) => (query.state.data?.isProcessing ? 3000 : false),
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
      api.get<BrowseResponse>(
        `/games/${id}/browse?path=${encodeURIComponent(browsePath ?? "")}`,
      ),
    enabled: browsePath !== null,
  });

  const { data: emulation } = useQuery({
    queryKey: ["emulation", id],
    queryFn: () =>
      api.get<{
        supported: boolean;
        reason?: string;
      }>(`/games/${id}/emulation`),
  });

  const displayGame = useMemo(() => {
    if (!game && !installedGame) return null;

    if (!game && installedGame) {
      // Offline/mismatch mode: construct a partial Game object from local metadata
      return {
        id: installedGame.remoteGameId,
        title: installedGame.title,
        platform: installedGame.platform,
        installType: installedGame.installType,
        summary: installedGame.summary,
        genre: installedGame.genre,
        releaseYear: installedGame.releaseYear,
        coverUrl: installedGame.coverUrl,
        heroUrl: installedGame.heroUrl,
        developer: installedGame.developer,
        publisher: installedGame.publisher,
        gameMode: installedGame.gameMode,
        series: installedGame.series,
        franchise: installedGame.franchise,
        gameEngine: installedGame.gameEngine,
        igdbId: installedGame.igdbId,
        igdbSlug: installedGame.igdbSlug,
        // Default values for server-only fields
        sizeBytes: 0,
        folderName: "",
        isArchive: false,
        isMissing: false,
        isProcessing: false,
        lastPlayed: null,
        playCount: 0,
        playTimeSeconds: 0,
        isFavorite: false,
      } as Game;
    }

    if (!installedGame) return game;

    return {
      ...game!,
      title: installedGame.title || game!.title,
      summary: installedGame.summary || game!.summary,
      genre: installedGame.genre || game!.genre,
      releaseYear: installedGame.releaseYear || game!.releaseYear,
      coverUrl: installedGame.coverUrl || game!.coverUrl,
      heroUrl: installedGame.heroUrl || game!.heroUrl,
      developer: installedGame.developer || game!.developer,
      publisher: installedGame.publisher || game!.publisher,
      gameMode: installedGame.gameMode || game!.gameMode,
      series: installedGame.series || game!.series,
      franchise: installedGame.franchise || game!.franchise,
      gameEngine: installedGame.gameEngine || game!.gameEngine,
      igdbId: installedGame.igdbId || game!.igdbId,
      igdbSlug: installedGame.igdbSlug || game!.igdbSlug,
    };
  }, [game, installedGame]);

  const isDesktopPcGame =
    isDesktop && !!displayGame && isPcPlatform(displayGame.platform);

  const installMutation = useMutation({
    mutationFn: async (input: Game & { installPath?: string }) => {
      return startDownload({
        id: input.id,
        title: input.title,
        platform: input.platform,
        installType: input.installType,
        installerExe: input.installerExe ?? null,
        gameExe: input.gameExe ?? null,
        installPath: input.installPath ?? null,
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
      queryClient.setQueryData(["installedGame", id], installed);
      queryClient.invalidateQueries({ queryKey: ["installedGames"] });
      await refetchInstalledGame();
    },
    onError: (error) => {
      setInstallError(
        error instanceof Error ? error.message : "Install failed.",
      );
    },
  });

  useEffect(() => {
    if (!isLoading && game) {
      requestAnimationFrame(() => focusAnchorRef.current?.focus());
    }
  }, [isLoading, game]);

  async function searchIgdb(customQuery?: string) {
    setSearching(true);
    setSearchError(null);
    try {
      const results = customQuery
        ? await api.post<IgdbCandidate[]>("/admin/igdb/search", {
            query: customQuery,
          })
        : await api.post<IgdbCandidate[]>(`/admin/games/${id}/igdb/search`);

      const gamePlatformSlug = game?.platform;

      if (results.length === 0) {
        setSearchError("No results found on IGDB.");
        if (!candidates) setCandidates([]); // open modal even with no results so user can refine
      } else {
        const sorted = gamePlatformSlug
          ? results.sort((a, b) => {
              const aMatch = a.platformSlug === gamePlatformSlug ? 0 : 1;
              const bMatch = b.platformSlug === gamePlatformSlug ? 0 : 1;
              return aMatch - bMatch;
            })
          : results;
        setCandidates(sorted);
        setSearchError(null);
      }
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setSearching(false);
    }
  }

  const sgdbRequestRef = useRef(0);

  async function openSgdbDialog(mode: "covers" | "heroes") {
    const q = game?.title ?? "";
    const requestId = ++sgdbRequestRef.current;
    setSgdbQuery(q);
    setSgdbGames(null);
    setSgdbImages(null);
    setSgdbLoadingImages(false);
    setSgdbDialog({ open: true, mode });
    setSgdbSearching(true);
    try {
      const games = await api.get<
        { id: number; name: string; year?: number }[]
      >(`/admin/steamgriddb/search?query=${encodeURIComponent(q)}`);
      if (sgdbRequestRef.current !== requestId) return;
      setSgdbGames(games);
      if (games.length === 1) selectSgdbGame(games[0].id, mode);
    } catch {
      if (sgdbRequestRef.current !== requestId) return;
      setSgdbGames([]);
    } finally {
      if (sgdbRequestRef.current === requestId) setSgdbSearching(false);
    }
  }

  async function selectSgdbGame(
    sgdbGameId: number,
    mode?: "covers" | "heroes",
  ) {
    setSgdbImages(null);
    setSgdbLoadingImages(true);
    const endpoint = mode ?? sgdbDialog.mode;
    try {
      const urls = await api.get<string[]>(
        `/admin/steamgriddb/${sgdbGameId}/${endpoint}`,
      );
      setSgdbImages(urls);
    } catch {
      setSgdbImages([]);
    } finally {
      setSgdbLoadingImages(false);
    }
  }

  function openIgdbSearch() {
    setIgdbQuery(game?.title ?? "");
    setCandidates([]);
    searchIgdb();
  }

  function handleIgdbCustomSearch(e: React.FormEvent) {
    e.preventDefault();
    if (igdbQuery.trim()) searchIgdb(igdbQuery.trim());
  }

  const applyMutation = useMutation({
    mutationFn: (igdbId: number) =>
      api.post<Game>(`/admin/games/${id}/igdb/apply`, { igdbId }),
    onSuccess: (data) => {
      queryClient.setQueryData(["game", id], data);
      queryClient.invalidateQueries({ queryKey: ["games"] });
      setCandidates(null);
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: {
      title: string;
      summary: string | null;
      genre: string | null;
      releaseYear: number | null;
      coverUrl: string | null;
      heroUrl: string | null;
      installType: string;
      installerExe: string | null;
      gameExe: string | null;
      developer: string | null;
      publisher: string | null;
      gameMode: string | null;
      series: string | null;
      franchise: string | null;
      gameEngine: string | null;
      igdbId: number | null;
      igdbSlug: string | null;
    }) => api.put<Game>(`/admin/games/${id}`, data),
    onSuccess: (data) => {
      queryClient.setQueryData(["game", id], data);
      queryClient.invalidateQueries({ queryKey: ["games"] });
      setEditing(false);
    },
  });

  const compressMutation = useMutation({
    mutationFn: (format: string) =>
      api.post(`/admin/games/${id}/compress?format=${format}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["game", id] });
      queryClient.invalidateQueries({ queryKey: ["tasksStatus"] });
    },
  });

  const tagFolderMutation = useMutation({
    mutationFn: () => api.post<Game>(`/admin/games/${id}/tag-folder`),
    onSuccess: (data) => {
      queryClient.setQueryData(["game", id], data);
      queryClient.invalidateQueries({ queryKey: ["games"] });
    },
  });

  function startEditing() {
    if (!displayGame) return;
    setEditForm({
      title: displayGame.title,
      summary: displayGame.summary ?? "",
      genre: displayGame.genre ?? "",
      releaseYear: displayGame.releaseYear?.toString() ?? "",
      coverUrl: displayGame.coverUrl ?? "",
      heroUrl: displayGame.heroUrl ?? "",
      installType: displayGame.installType,
      installerExe: displayGame.installerExe ?? "",
      gameExe: displayGame.gameExe ?? "",
      developer: displayGame.developer ?? "",
      publisher: displayGame.publisher ?? "",
      gameMode: displayGame.gameMode ?? "",
      series: displayGame.series ?? "",
      franchise: displayGame.franchise ?? "",
      gameEngine: displayGame.gameEngine ?? "",
      igdbId: displayGame.igdbId?.toString() ?? "",
      igdbSlug: displayGame.igdbSlug ?? "",
    });
    setEditing(true);
  }

  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    let coverUrl = editForm.coverUrl || null;
    let heroUrl = editForm.heroUrl || null;

    // Upload any pending files first
    const cacheBust = `?v=${Date.now()}`;
    if (pendingFiles.cover) {
      const res = await api.upload<{ url: string }>(
        `/admin/games/${id}/upload-image?type=cover`,
        pendingFiles.cover,
      );
      coverUrl = res.url + cacheBust;
    }
    if (pendingFiles.hero) {
      const res = await api.upload<{ url: string }>(
        `/admin/games/${id}/upload-image?type=hero`,
        pendingFiles.hero,
      );
      heroUrl = res.url + cacheBust;
    }

    updateMutation.mutate({
      title: editForm.title,
      summary: editForm.summary || null,
      genre: editForm.genre || null,
      releaseYear: editForm.releaseYear ? parseInt(editForm.releaseYear) : null,
      coverUrl,
      heroUrl,
      installType: editForm.installType,
      installerExe: editForm.installerExe || null,
      gameExe: editForm.gameExe || null,
      developer: editForm.developer || null,
      publisher: editForm.publisher || null,
      gameMode: editForm.gameMode || null,
      series: editForm.series || null,
      franchise: editForm.franchise || null,
      gameEngine: editForm.gameEngine || null,
      igdbId: editForm.igdbId ? parseInt(editForm.igdbId) : null,
      igdbSlug: editForm.igdbSlug || null,
    });
    setPendingFiles({});
  }

  function handleImageSelect(type: "cover" | "hero", file: File) {
    const field = type === "cover" ? "coverUrl" : "heroUrl";
    const blobUrl = URL.createObjectURL(file);
    setEditForm((f) => ({ ...f, [field]: blobUrl }));
    setPendingFiles((p) => ({ ...p, [type]: file }));
  }

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
        <Link
          to="/"
          className="text-accent hover:underline text-sm mt-2 inline-block"
        >
          Back to library
        </Link>
      </main>
    );
  }

  const installProgress = displayGame ? getProgress(displayGame.id) : null;
  const hasActiveInstallProgress =
    installProgress?.gameId === displayGame.id &&
    installProgress.status !== "completed" &&
    installProgress.status !== "failed";

  const desktopInstallLabel = hasActiveInstallProgress
    ? typeof installProgress?.percent === "number"
      ? `Installing ${Math.round(installProgress.percent)}%`
      : "Installing..."
    : installMutation.isPending
      ? "Starting install…"
      : "Install";

  async function handleInstallClick() {
    if (!displayGame) return;
    try {
      setInstallError(null);

      const { getSettings } = await import("../../desktop/hooks/useDesktop");
      const settings = await getSettings();
      setDefaultInstallPath(settings.defaultInstallPath || "");
      setShowInstallConfirm(true);
    } catch (err) {
      setInstallError(
        err instanceof Error
          ? err.message
          : "Failed to load settings. " + String(err),
      );
    }
  }

  return (
    <>
      {/* Hero banner */}
      {(editing ? editForm.heroUrl : displayGame.heroUrl) && (
        <div className="absolute inset-x-0 top-0 h-72 overflow-hidden -z-10">
          <img
            src={editing ? editForm.heroUrl : displayGame.heroUrl}
            alt=""
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-linear-to-t from-(--bg) via-(--bg)/60 to-transparent" />
        </div>
      )}
      <main
        ref={mainRef}
        onKeyDown={handleMainKeyDown}
        className="max-w-5xl mx-auto px-6 py-12 relative flex-1 w-full"
      >
        {user?.role === "admin" && (
          <button
            onClick={() => openSgdbDialog("heroes")}
            className={`fixed top-18 right-4 z-10 p-2 rounded-lg transition flex items-center gap-1.5 text-xs ${
              displayGame.heroUrl
                ? "bg-black/40 text-white/70 hover:text-white opacity-0 hover:opacity-100"
                : "text-text-muted hover:text-text-primary bg-surface-raised ring-1 ring-border"
            }`}
            title={displayGame.heroUrl ? "Change hero image" : "Add hero image"}
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5a1.5 1.5 0 001.5-1.5V5.25a1.5 1.5 0 00-1.5-1.5H3.75a1.5 1.5 0 00-1.5 1.5v14.25a1.5 1.5 0 001.5 1.5z"
              />
            </svg>
            {!displayGame.heroUrl && "Add hero"}
          </button>
        )}
        {/* Focus anchor for gamepad navigation */}
        <div
          ref={focusAnchorRef}
          tabIndex={0}
          className="outline-none h-0 overflow-hidden"
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowRight") {
              e.preventDefault();
              const first =
                mainRef.current?.querySelector<HTMLElement>("[data-nav]");
              if (first) {
                first.focus();
                sounds.navigate();
              }
            }
          }}
        />
        {/* Back link */}
        <Link
          ref={backLinkRef}
          to="/"
          data-nav
          onKeyDown={(e) => {
            if (e.key === "Enter") sounds.back();
          }}
          className={`inline-flex items-center gap-1.5 text-sm transition mb-8 rounded outline-none focus-visible:[box-shadow:0_0_0_4px_var(--bg),0_0_0_6px_#00d9b8] ${
            displayGame.heroUrl
              ? "text-text-primary/80 hover:text-text-primary drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]"
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
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15.75 19.5L8.25 12l7.5-7.5"
            />
          </svg>
          Library
        </Link>

        <div className="flex flex-col md:flex-row gap-10">
          {/* Cover */}
          <div className="w-72 shrink-0 mx-auto md:mx-0">
            <div
              className={`aspect-2/3 bg-surface-raised rounded-xl overflow-hidden ring-1 ring-border${user?.role === "admin" ? " cursor-pointer hover:ring-accent transition" : ""}`}
              onClick={
                user?.role === "admin"
                  ? () => openSgdbDialog("covers")
                  : undefined
              }
            >
              {(editing ? editForm.coverUrl : displayGame.coverUrl) ? (
                <img
                  src={editing ? editForm.coverUrl : displayGame.coverUrl}
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

          {/* Info */}
          <div className="flex-1 min-w-0">
            {editing ? (
              /* Edit form */
              <form onSubmit={handleEditSubmit} className="space-y-4">
                <div>
                  <label className="text-xs font-medium text-text-muted uppercase tracking-wider">
                    Title
                  </label>
                  <input
                    type="text"
                    value={editForm.title}
                    onChange={(e) =>
                      setEditForm({ ...editForm, title: e.target.value })
                    }
                    required
                    className="mt-1 w-full bg-surface-raised border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent transition"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-text-muted uppercase tracking-wider">
                    Summary
                  </label>
                  <textarea
                    value={editForm.summary}
                    onChange={(e) =>
                      setEditForm({ ...editForm, summary: e.target.value })
                    }
                    rows={4}
                    className="mt-1 w-full bg-surface-raised border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent transition resize-y"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-medium text-text-muted uppercase tracking-wider">
                      Genre
                    </label>
                    <input
                      type="text"
                      value={editForm.genre}
                      onChange={(e) =>
                        setEditForm({ ...editForm, genre: e.target.value })
                      }
                      className="mt-1 w-full bg-surface-raised border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent transition"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-text-muted uppercase tracking-wider">
                      Release Year
                    </label>
                    <input
                      type="number"
                      value={editForm.releaseYear}
                      onChange={(e) =>
                        setEditForm({
                          ...editForm,
                          releaseYear: e.target.value,
                        })
                      }
                      placeholder="e.g. 2025"
                      className="mt-1 w-full bg-surface-raised border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent transition"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-medium text-text-muted uppercase tracking-wider">
                      Developer
                    </label>
                    <input
                      type="text"
                      value={editForm.developer}
                      onChange={(e) =>
                        setEditForm({ ...editForm, developer: e.target.value })
                      }
                      className="mt-1 w-full bg-surface-raised border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent transition"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-text-muted uppercase tracking-wider">
                      Publisher
                    </label>
                    <input
                      type="text"
                      value={editForm.publisher}
                      onChange={(e) =>
                        setEditForm({ ...editForm, publisher: e.target.value })
                      }
                      className="mt-1 w-full bg-surface-raised border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent transition"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-medium text-text-muted uppercase tracking-wider">
                      Game Mode
                    </label>
                    <input
                      type="text"
                      value={editForm.gameMode}
                      onChange={(e) =>
                        setEditForm({ ...editForm, gameMode: e.target.value })
                      }
                      placeholder="e.g. Single player, Multiplayer"
                      className="mt-1 w-full bg-surface-raised border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent transition"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-text-muted uppercase tracking-wider">
                      Engine
                    </label>
                    <input
                      type="text"
                      value={editForm.gameEngine}
                      onChange={(e) =>
                        setEditForm({ ...editForm, gameEngine: e.target.value })
                      }
                      className="mt-1 w-full bg-surface-raised border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent transition"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-medium text-text-muted uppercase tracking-wider">
                      Series
                    </label>
                    <input
                      type="text"
                      value={editForm.series}
                      onChange={(e) =>
                        setEditForm({ ...editForm, series: e.target.value })
                      }
                      className="mt-1 w-full bg-surface-raised border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent transition"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-text-muted uppercase tracking-wider">
                      Franchise
                    </label>
                    <input
                      type="text"
                      value={editForm.franchise}
                      onChange={(e) =>
                        setEditForm({ ...editForm, franchise: e.target.value })
                      }
                      className="mt-1 w-full bg-surface-raised border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent transition"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-medium text-text-muted uppercase tracking-wider">
                      IGDB ID
                    </label>
                    <div className="mt-1 flex gap-2">
                      <input
                        type="number"
                        value={editForm.igdbId}
                        onChange={(e) =>
                          setEditForm({ ...editForm, igdbId: e.target.value })
                        }
                        placeholder="e.g. 12345"
                        className="flex-1 bg-surface-raised border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent transition"
                      />
                      {displayGame.igdbId &&
                        !displayGame.folderName.includes(
                          `igdb-${displayGame.igdbId}`,
                        ) && (
                          <button
                            type="button"
                            onClick={() => tagFolderMutation.mutate()}
                            disabled={tagFolderMutation.isPending}
                            className="shrink-0 px-3 py-2 rounded-lg text-xs text-text-secondary hover:text-text-primary hover:bg-surface-overlay ring-1 ring-border transition disabled:opacity-50"
                            title={`Rename folder to add (igdb-${displayGame.igdbId})`}
                          >
                            {tagFolderMutation.isPending
                              ? "Tagging..."
                              : "Tag folder"}
                          </button>
                        )}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-text-muted uppercase tracking-wider">
                      IGDB Slug
                    </label>
                    <input
                      type="text"
                      value={editForm.igdbSlug}
                      onChange={(e) =>
                        setEditForm({ ...editForm, igdbSlug: e.target.value })
                      }
                      placeholder="e.g. the-witcher-3"
                      className="mt-1 w-full bg-surface-raised border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent transition"
                    />
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-text-muted uppercase tracking-wider">
                      Cover URL
                    </label>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => coverFileRef.current?.click()}
                        className="text-xs text-accent hover:underline"
                      >
                        Upload
                      </button>
                      <input
                        ref={coverFileRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/gif"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleImageSelect("cover", file);
                          e.target.value = "";
                        }}
                      />
                      <span className="text-text-muted">|</span>
                      <button
                        type="button"
                        onClick={() => openSgdbDialog("covers")}
                        className="text-xs text-accent hover:underline"
                      >
                        SteamGridDB
                      </button>
                    </div>
                  </div>
                  <input
                    type="text"
                    value={editForm.coverUrl}
                    onChange={(e) =>
                      setEditForm({ ...editForm, coverUrl: e.target.value })
                    }
                    placeholder="https://..."
                    className="mt-1 w-full bg-surface-raised border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent transition"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-text-muted uppercase tracking-wider">
                      Hero URL
                    </label>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => heroFileRef.current?.click()}
                        className="text-xs text-accent hover:underline"
                      >
                        Upload
                      </button>
                      <input
                        ref={heroFileRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/gif"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleImageSelect("hero", file);
                          e.target.value = "";
                        }}
                      />
                      <span className="text-text-muted">|</span>
                      <button
                        type="button"
                        onClick={() => openSgdbDialog("heroes")}
                        className="text-xs text-accent hover:underline"
                      >
                        SteamGridDB
                      </button>
                    </div>
                  </div>
                  <input
                    type="text"
                    value={editForm.heroUrl}
                    onChange={(e) =>
                      setEditForm({ ...editForm, heroUrl: e.target.value })
                    }
                    placeholder="https://..."
                    className="mt-1 w-full bg-surface-raised border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent transition"
                  />
                </div>
                {/* Install type & executables (PC games) */}
                {isPcPlatform(displayGame.platform) && (
                  <>
                    <div>
                      <label className="text-xs font-medium text-text-muted uppercase tracking-wider">
                        Install Type
                      </label>
                      <div className="mt-1 flex gap-2">
                        {(["portable", "installer"] as const).map((type) => (
                          <button
                            key={type}
                            type="button"
                            onClick={() =>
                              setEditForm({ ...editForm, installType: type })
                            }
                            className={`px-4 py-2 rounded-lg text-sm font-medium ring-1 transition ${
                              editForm.installType === type
                                ? "bg-accent/15 text-accent ring-accent/30"
                                : "bg-surface-raised text-text-secondary ring-border hover:ring-accent/30"
                            }`}
                          >
                            {type === "portable" ? "Portable" : "Installer"}
                          </button>
                        ))}
                      </div>
                    </div>
                    {editForm.installType === "installer" && (
                      <ExeListbox
                        label="Installer Executable"
                        value={editForm.installerExe}
                        onChange={(v) =>
                          setEditForm({ ...editForm, installerExe: v })
                        }
                        options={exeList ?? []}
                      />
                    )}
                    {editForm.installType === "portable" && (
                      <ExeListbox
                        label="Game Executable"
                        value={editForm.gameExe}
                        onChange={(v) =>
                          setEditForm({ ...editForm, gameExe: v })
                        }
                        options={exeList ?? []}
                      />
                    )}
                  </>
                )}
                {updateMutation.isError && (
                  <p className="text-sm text-red-400">
                    {updateMutation.error instanceof Error
                      ? updateMutation.error.message
                      : "Update failed"}
                  </p>
                )}
                <div className="flex gap-2 pt-2">
                  <button
                    type="submit"
                    disabled={updateMutation.isPending}
                    className="bg-accent hover:bg-accent-hover disabled:opacity-50 text-neutral-950 font-medium px-5 py-2.5 rounded-lg transition text-sm"
                  >
                    {updateMutation.isPending ? "Saving..." : "Save"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(false);
                      setPendingFiles({});
                    }}
                    className="px-5 py-2.5 rounded-lg text-sm text-text-secondary hover:text-text-primary hover:bg-surface-overlay ring-1 ring-border transition"
                  >
                    Cancel
                  </button>
                  {!displayGame.isArchive && !displayGame.isProcessing && (
                    <div className="ml-auto flex gap-2">
                      <button
                        type="button"
                        onClick={() => compressMutation.mutate("zip")}
                        disabled={compressMutation.isPending}
                        className="px-4 py-2.5 rounded-lg text-sm text-text-secondary hover:text-text-primary hover:bg-surface-overlay ring-1 ring-border transition disabled:opacity-50"
                      >
                        {compressMutation.isPending
                          ? "Queuing..."
                          : "Package as ZIP"}
                      </button>
                      <button
                        type="button"
                        onClick={() => compressMutation.mutate("tar")}
                        disabled={compressMutation.isPending}
                        className="px-4 py-2.5 rounded-lg text-sm text-text-secondary hover:text-text-primary hover:bg-surface-overlay ring-1 ring-border transition disabled:opacity-50"
                      >
                        {compressMutation.isPending
                          ? "Queuing..."
                          : "Package as TAR"}
                      </button>
                    </div>
                  )}
                </div>
                {compressMutation.isError && (
                  <p className="text-sm text-red-400">
                    {compressMutation.error instanceof Error
                      ? compressMutation.error.message
                      : "Compression failed"}
                  </p>
                )}
              </form>
            ) : (
              /* Display view */
              <>
                <div className="flex items-start gap-3 mb-3">
                  <h1 className="font-display text-4xl font-bold text-text-primary">
                    {displayGame.title}
                  </h1>
                  {user?.role === "admin" && (
                    <>
                      <button
                        onClick={startEditing}
                        disabled={displayGame.isProcessing}
                        className="mt-2 shrink-0 p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-raised transition disabled:opacity-50 disabled:cursor-not-allowed"
                        title={
                          displayGame.isProcessing
                            ? "Cannot edit while processing"
                            : "Edit game"
                        }
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
                            d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125"
                          />
                        </svg>
                      </button>
                      <button
                        onClick={openIgdbSearch}
                        disabled={searching}
                        className="mt-2 shrink-0 p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-raised transition disabled:opacity-50"
                        title={
                          displayGame.igdbId
                            ? "Re-match on IGDB"
                            : "Match on IGDB"
                        }
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
                            d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
                          />
                        </svg>
                      </button>
                    </>
                  )}
                </div>

                {/* Meta tags */}
                <div className="flex flex-wrap gap-2 mb-6">
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-surface-raised ring-1 ring-border text-xs font-medium text-text-secondary">
                    <svg
                      className="w-3 h-3 text-text-muted"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25"
                      />
                    </svg>
                    {formatPlatform(displayGame.platform)}
                  </span>
                  {displayGame.releaseYear && (
                    <span className="inline-flex items-center px-2.5 py-1 rounded-md bg-surface-raised ring-1 ring-border text-xs font-medium text-text-secondary">
                      {displayGame.releaseYear}
                    </span>
                  )}
                  {displayGame.genre && (
                    <span className="inline-flex items-center px-2.5 py-1 rounded-md bg-surface-raised ring-1 ring-border text-xs font-medium text-text-secondary">
                      {displayGame.genre}
                    </span>
                  )}
                  <span className="inline-flex items-center px-2.5 py-1 rounded-md bg-surface-raised ring-1 ring-border text-xs font-mono text-text-secondary">
                    {formatSize(displayGame.sizeBytes)}
                  </span>
                  {isPcPlatform(displayGame.platform) && (
                    <span
                      className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium ring-1 ${
                        displayGame.installType === "installer"
                          ? "bg-blue-500/10 ring-blue-500/20 text-blue-400"
                          : "bg-accent-dim ring-accent/20 text-accent"
                      }`}
                    >
                      {displayGame.installType === "installer"
                        ? "Installer"
                        : "Portable"}
                    </span>
                  )}
                  {displayGame.igdbSlug && (
                    <a
                      href={`https://www.igdb.com/games/${displayGame.igdbSlug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-purple-500/10 ring-1 ring-purple-500/20 text-xs font-medium text-purple-400 hover:bg-purple-500/20 transition"
                    >
                      IGDB
                      <svg
                        className="w-3 h-3"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                        />
                      </svg>
                    </a>
                  )}
                </div>

                <div className="mb-8 -mt-4">
                  <p className="text-xs text-text-muted font-mono">
                    /{displayGame.platform}/{displayGame.folderName}
                  </p>
                  <button
                    onClick={() => setBrowsePath("")}
                    className="inline-flex items-center gap-1 mt-2 text-xs text-text-muted hover:text-accent transition"
                  >
                    <svg
                      className="w-3.5 h-3.5"
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
                    Browse files
                  </button>
                </div>

                {/* Summary */}
                {displayGame.summary && (
                  <div className="mb-8">
                    <h2 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-2">
                      About
                    </h2>
                    <p className="text-text-secondary leading-relaxed">
                      {displayGame.summary}
                    </p>
                  </div>
                )}

                {/* Details */}
                {(displayGame.developer ||
                  displayGame.publisher ||
                  displayGame.gameMode ||
                  displayGame.series ||
                  displayGame.franchise ||
                  displayGame.gameEngine) && (
                  <div className="grid grid-cols-2 gap-x-8 gap-y-3 mb-8 text-sm">
                    {displayGame.developer && (
                      <div>
                        <span className="text-text-muted text-xs uppercase tracking-wider font-medium">
                          Developer
                        </span>
                        <p className="text-text-secondary mt-0.5">
                          {displayGame.developer}
                        </p>
                      </div>
                    )}
                    {displayGame.publisher && (
                      <div>
                        <span className="text-text-muted text-xs uppercase tracking-wider font-medium">
                          Publisher
                        </span>
                        <p className="text-text-secondary mt-0.5">
                          {displayGame.publisher}
                        </p>
                      </div>
                    )}
                    {displayGame.gameMode && (
                      <div>
                        <span className="text-text-muted text-xs uppercase tracking-wider font-medium">
                          Game Mode
                        </span>
                        <p className="text-text-secondary mt-0.5">
                          {displayGame.gameMode}
                        </p>
                      </div>
                    )}
                    {displayGame.gameEngine && (
                      <div>
                        <span className="text-text-muted text-xs uppercase tracking-wider font-medium">
                          Engine
                        </span>
                        <p className="text-text-secondary mt-0.5">
                          {displayGame.gameEngine}
                        </p>
                      </div>
                    )}
                    {displayGame.series && (
                      <div>
                        <span className="text-text-muted text-xs uppercase tracking-wider font-medium">
                          Series
                        </span>
                        <p className="text-text-secondary mt-0.5">
                          {displayGame.series}
                        </p>
                      </div>
                    )}
                    {displayGame.franchise && (
                      <div>
                        <span className="text-text-muted text-xs uppercase tracking-wider font-medium">
                          Franchise
                        </span>
                        <p className="text-text-secondary mt-0.5">
                          {displayGame.franchise}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Actions */}
                <div className="flex flex-wrap items-center gap-3">
                  {emulation?.supported && !displayGame.isMissing && (
                    <Link
                      to={`/games/${displayGame.id}/play`}
                      data-nav
                      onClick={(e) => {
                        if (e.detail === 0) sounds.download();
                      }}
                      className="inline-flex items-center gap-2 rounded-lg bg-surface-raised px-6 py-3 text-sm font-semibold text-text-primary ring-1 ring-border transition hover:border-accent hover:text-accent outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-(--bg)"
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
                          onClick={() => {
                            openDesktopInstallFolder(displayGame.id).catch(
                              (error) => {
                                setInstallError(
                                  error instanceof Error
                                    ? error.message
                                    : "Could not open the install folder.",
                                );
                              },
                            );
                          }}
                          className="inline-flex items-center gap-2 rounded-lg bg-accent px-6 py-3 text-sm font-semibold text-neutral-950 transition hover:bg-accent-hover outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-(--bg)"
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
                              d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
                            />
                          </svg>
                          Open Install Folder
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowUninstallConfirm(true)}
                          className="inline-flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium text-text-secondary ring-1 ring-border hover:text-red-400 hover:ring-red-400/30 transition outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-(--bg)"
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
                        <UninstallDialog
                          open={showUninstallConfirm}
                          title={displayGame.title}
                          onClose={() => setShowUninstallConfirm(false)}
                          onConfirm={async (deleteFiles) => {
                            await uninstallGame(displayGame.id, deleteFiles);
                            setShowUninstallConfirm(false);
                            queryClient.setQueryData(
                              ["installedGame", id],
                              null,
                            );
                            queryClient.invalidateQueries({
                              queryKey: ["installedGames"],
                            });
                            void refetchInstalledGame();
                          }}
                        />
                      </div>
                    ) : (
                      <button
                        type="button"
                        data-nav
                        disabled={
                          installMutation.isPending ||
                          hasActiveInstallProgress ||
                          isInstalledGameLoading
                        }
                        onClick={handleInstallClick}
                        className="inline-flex items-center gap-2 rounded-lg bg-accent px-6 py-3 text-sm font-semibold text-neutral-950 transition hover:bg-accent-hover disabled:opacity-60 outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-(--bg)"
                      >
                        <svg
                          className={`h-4 w-4 ${installMutation.isPending || hasActiveInstallProgress ? "animate-spin" : ""}`}
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2.25}
                        >
                          {installMutation.isPending ||
                          hasActiveInstallProgress ? (
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
                    )
                  ) : (
                    <DownloadButton
                      gameId={displayGame.id}
                      size={displayGame.sizeBytes}
                    />
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
                  title={displayGame.title}
                  defaultPath={defaultInstallPath}
                  onClose={() => setShowInstallConfirm(false)}
                  onConfirm={(path) => {
                    setShowInstallConfirm(false);
                    // game and displayGame are guaranteed non-null here due to the guard clause
                    installMutation.mutate({ ...game!, installPath: path });
                  }}
                />
              </>
            )}

            {/* File browser modal */}
            {browsePath !== null &&
              (() => {
                const resolvedPath = browseData?.path ?? browsePath;
                return (
                  <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
                    onClick={() => setBrowsePath(null)}
                  >
                    <div
                      className="bg-surface rounded-xl ring-1 ring-border p-6 max-w-2xl w-full mx-4 shadow-xl max-h-[80vh] flex flex-col"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-text-primary font-medium shrink-0">
                          Browse Files
                        </h3>
                        <button
                          onClick={() => setBrowsePath(null)}
                          className="text-text-muted hover:text-text-primary transition p-1 shrink-0"
                        >
                          <svg
                            className="w-5 h-5"
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

                      {/* Breadcrumb */}
                      <div className="flex items-center gap-1 text-xs text-text-muted mb-3 flex-wrap">
                        {resolvedPath ? (
                          <>
                            <button
                              onClick={() => setBrowsePath("")}
                              className="hover:text-text-primary transition"
                            >
                              /
                            </button>
                            {resolvedPath
                              .split("/")
                              .filter(Boolean)
                              .map((segment, i, arr) => {
                                const segPath = arr.slice(0, i + 1).join("/");
                                const isLast = i === arr.length - 1;
                                return (
                                  <span
                                    key={segPath}
                                    className="flex items-center gap-1"
                                  >
                                    {i > 0 && (
                                      <span className="text-text-muted/50">
                                        /
                                      </span>
                                    )}
                                    <button
                                      onClick={() => setBrowsePath(segPath)}
                                      className={`hover:text-text-primary transition ${isLast ? "text-text-primary font-medium" : ""}`}
                                    >
                                      {segment}
                                    </button>
                                  </span>
                                );
                              })}
                          </>
                        ) : (
                          <span className="text-text-primary font-medium">
                            /
                          </span>
                        )}
                      </div>

                      {/* Content */}
                      <div className="overflow-y-auto flex-1 -mx-2">
                        {browseLoading ? (
                          <div className="flex items-center justify-center py-12 text-text-muted text-sm">
                            Loading...
                          </div>
                        ) : !browseData?.entries.length ? (
                          <div className="flex items-center justify-center py-12 text-text-muted text-sm">
                            Empty directory
                          </div>
                        ) : (
                          <div className="divide-y divide-border/50">
                            {resolvedPath && (
                              <button
                                onClick={() => {
                                  const parts = resolvedPath
                                    .split("/")
                                    .filter(Boolean);
                                  parts.pop();
                                  setBrowsePath(parts.join("/"));
                                }}
                                className="w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-surface-raised/50 transition text-left"
                              >
                                <svg
                                  className="w-4 h-4 text-text-muted shrink-0"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  stroke="currentColor"
                                  strokeWidth={2}
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3"
                                  />
                                </svg>
                                <span className="text-text-muted">..</span>
                              </button>
                            )}
                            {browseData.entries.map((entry) => (
                              <button
                                key={entry.name}
                                onClick={() => {
                                  if (
                                    entry.isDirectory ||
                                    entry.name.toLowerCase().endsWith(".zip")
                                  )
                                    setBrowsePath(
                                      resolvedPath
                                        ? `${resolvedPath}/${entry.name}`
                                        : entry.name,
                                    );
                                }}
                                className={`w-full flex items-center gap-3 px-3 py-2 text-sm transition text-left ${
                                  entry.isDirectory ||
                                  entry.name.toLowerCase().endsWith(".zip")
                                    ? "hover:bg-surface-raised/50 cursor-pointer"
                                    : "cursor-default"
                                }`}
                              >
                                {entry.isDirectory ? (
                                  <svg
                                    className="w-4 h-4 text-accent shrink-0"
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
                                ) : (
                                  <svg
                                    className="w-4 h-4 text-text-muted shrink-0"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                    strokeWidth={2}
                                  >
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                                    />
                                  </svg>
                                )}
                                <span
                                  className={`truncate ${entry.isDirectory ? "text-text-primary" : "text-text-secondary"}`}
                                >
                                  {entry.name}
                                </span>
                                {entry.size != null && !entry.isDirectory && (
                                  <span className="ml-auto text-xs text-text-muted font-mono shrink-0">
                                    {formatSize(entry.size)}
                                  </span>
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}

            {/* SteamGridDB picker (covers & heroes) */}
            <Dialog
              open={sgdbDialog.open}
              onClose={() => setSgdbDialog({ ...sgdbDialog, open: false })}
              className="relative z-50"
            >
              <DialogBackdrop className="fixed inset-0 bg-black/60" />
              <div className="fixed inset-0 flex items-center justify-center p-4">
                <DialogPanel className="bg-surface rounded-xl ring-1 ring-border p-6 max-w-2xl w-full mx-4 shadow-xl max-h-[80vh] flex flex-col">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-text-primary font-medium">
                      SteamGridDB{" "}
                      {sgdbDialog.mode === "covers" ? "Covers" : "Heroes"}
                    </h3>
                    <button
                      type="button"
                      onClick={() =>
                        setSgdbDialog({ ...sgdbDialog, open: false })
                      }
                      className="text-text-muted hover:text-text-primary transition p-1"
                    >
                      <svg
                        className="w-5 h-5"
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
                  <form
                    className="flex gap-2 mb-4"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const requestId = ++sgdbRequestRef.current;
                      setSgdbGames(null);
                      setSgdbImages(null);
                      setSgdbLoadingImages(false);
                      setSgdbSearching(true);
                      try {
                        const games = await api.get<
                          { id: number; name: string; year?: number }[]
                        >(
                          `/admin/steamgriddb/search?query=${encodeURIComponent(sgdbQuery.trim())}`,
                        );
                        if (sgdbRequestRef.current !== requestId) return;
                        setSgdbGames(games);
                        if (games.length === 1) selectSgdbGame(games[0].id);
                      } catch {
                        if (sgdbRequestRef.current !== requestId) return;
                        setSgdbGames([]);
                      } finally {
                        if (sgdbRequestRef.current === requestId)
                          setSgdbSearching(false);
                      }
                    }}
                  >
                    <input
                      type="text"
                      value={sgdbQuery}
                      onChange={(e) => setSgdbQuery(e.target.value)}
                      placeholder="Search game..."
                      className="flex-1 bg-surface-raised border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500 transition"
                      autoFocus
                    />
                    <button
                      type="submit"
                      disabled={sgdbSearching || !sgdbQuery.trim()}
                      className="px-4 py-2 rounded-lg text-sm font-medium bg-purple-600 text-white hover:bg-purple-700 transition disabled:opacity-50"
                    >
                      {sgdbSearching ? "Searching..." : "Search"}
                    </button>
                  </form>

                  {/* Step 1: pick a game */}
                  {sgdbImages === null && (
                    <>
                      {sgdbSearching ? (
                        <p className="text-sm text-text-muted">Searching...</p>
                      ) : sgdbGames !== null && sgdbGames.length === 0 ? (
                        <p className="text-sm text-text-muted">
                          No games found.
                        </p>
                      ) : sgdbGames !== null ? (
                        <div className="overflow-y-auto flex-1 min-h-0 space-y-1">
                          {sgdbGames.map((g) => (
                            <button
                              key={g.id}
                              type="button"
                              onClick={() => selectSgdbGame(g.id)}
                              className="w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-surface-raised transition text-text-secondary hover:text-text-primary"
                            >
                              {g.name}
                              {g.year ? ` (${g.year})` : ""}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </>
                  )}

                  {/* Step 2: pick an image */}
                  {sgdbImages !== null && (
                    <>
                      <button
                        type="button"
                        onClick={() => setSgdbImages(null)}
                        className="text-xs text-text-muted hover:text-text-primary transition mb-3 self-start flex items-center gap-1"
                      >
                        <svg
                          className="w-3.5 h-3.5"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M15.75 19.5L8.25 12l7.5-7.5"
                          />
                        </svg>
                        Back to results
                      </button>
                      {sgdbLoadingImages ? (
                        <p className="text-sm text-text-muted">
                          Loading images...
                        </p>
                      ) : sgdbImages.length === 0 ? (
                        <p className="text-sm text-text-muted">
                          No {sgdbDialog.mode} found.
                        </p>
                      ) : sgdbDialog.mode === "covers" ? (
                        <div className="grid grid-cols-3 gap-3 overflow-y-auto p-1 flex-1 min-h-0">
                          {sgdbImages.map((url) => (
                            <button
                              key={url}
                              type="button"
                              onClick={() => {
                                if (editing) {
                                  setEditForm({ ...editForm, coverUrl: url });
                                } else {
                                  updateMutation.mutate({
                                    title: displayGame.title,
                                    summary: displayGame.summary ?? null,
                                    genre: displayGame.genre ?? null,
                                    releaseYear:
                                      displayGame.releaseYear ?? null,
                                    coverUrl: url,
                                    heroUrl: displayGame.heroUrl ?? null,
                                    installType: displayGame.installType,
                                    installerExe:
                                      displayGame.installerExe ?? null,
                                    gameExe: displayGame.gameExe ?? null,
                                    developer: displayGame.developer ?? null,
                                    publisher: displayGame.publisher ?? null,
                                    gameMode: displayGame.gameMode ?? null,
                                    series: displayGame.series ?? null,
                                    franchise: displayGame.franchise ?? null,
                                    gameEngine: displayGame.gameEngine ?? null,
                                    igdbId: displayGame.igdbId ?? null,
                                    igdbSlug: displayGame.igdbSlug ?? null,
                                  });
                                }
                                setSgdbDialog({ ...sgdbDialog, open: false });
                              }}
                              className={`aspect-2/3 rounded-lg ring-2 transition hover:ring-accent ${
                                (editing
                                  ? editForm.coverUrl
                                  : displayGame.coverUrl) === url
                                  ? "ring-accent"
                                  : "ring-transparent"
                              }`}
                            >
                              <img
                                src={url}
                                alt=""
                                className="w-full h-full object-cover rounded-lg"
                              />
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="flex flex-col gap-3 overflow-y-auto p-1 flex-1 min-h-0">
                          {sgdbImages.map((url) => (
                            <button
                              key={url}
                              type="button"
                              onClick={() => {
                                if (editing) {
                                  setEditForm({ ...editForm, heroUrl: url });
                                } else {
                                  updateMutation.mutate({
                                    title: displayGame.title,
                                    summary: displayGame.summary ?? null,
                                    genre: displayGame.genre ?? null,
                                    releaseYear:
                                      displayGame.releaseYear ?? null,
                                    coverUrl: displayGame.coverUrl ?? null,
                                    heroUrl: url,
                                    installType: displayGame.installType,
                                    installerExe:
                                      displayGame.installerExe ?? null,
                                    gameExe: displayGame.gameExe ?? null,
                                    developer: displayGame.developer ?? null,
                                    publisher: displayGame.publisher ?? null,
                                    gameMode: displayGame.gameMode ?? null,
                                    series: displayGame.series ?? null,
                                    franchise: displayGame.franchise ?? null,
                                    gameEngine: displayGame.gameEngine ?? null,
                                    igdbId: displayGame.igdbId ?? null,
                                    igdbSlug: displayGame.igdbSlug ?? null,
                                  });
                                }
                                setSgdbDialog({ ...sgdbDialog, open: false });
                              }}
                              className={`rounded-lg ring-2 transition hover:ring-accent ${
                                (editing
                                  ? editForm.heroUrl
                                  : displayGame.heroUrl) === url
                                  ? "ring-accent"
                                  : "ring-transparent"
                              }`}
                            >
                              <img
                                src={url}
                                alt=""
                                className="w-full rounded-lg object-cover"
                              />
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </DialogPanel>
              </div>
            </Dialog>

            {/* IGDB candidate picker */}
            {candidates && (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
                onClick={() => setCandidates(null)}
              >
                <div
                  className="bg-surface rounded-xl ring-1 ring-border p-6 max-w-2xl w-full mx-4 shadow-xl max-h-[80vh] flex flex-col"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-text-primary font-medium">
                      Match on IGDB
                    </h3>
                    <button
                      onClick={() => {
                        setCandidates(null);
                        setSearchError(null);
                      }}
                      className="text-text-muted hover:text-text-primary transition p-1"
                    >
                      <svg
                        className="w-5 h-5"
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
                  <form
                    onSubmit={handleIgdbCustomSearch}
                    className="flex gap-2 mb-4"
                  >
                    <input
                      type="text"
                      value={igdbQuery}
                      onChange={(e) => setIgdbQuery(e.target.value)}
                      placeholder="Search IGDB..."
                      className="flex-1 bg-surface-raised border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500 transition"
                    />
                    <button
                      type="submit"
                      disabled={searching || !igdbQuery.trim()}
                      className="px-4 py-2 rounded-lg text-sm font-medium bg-purple-600 text-white hover:bg-purple-700 transition disabled:opacity-50"
                    >
                      {searching ? "Searching..." : "Search"}
                    </button>
                  </form>
                  {searchError && (
                    <p className="text-sm text-red-400 mb-3">{searchError}</p>
                  )}
                  <div className="overflow-y-auto space-y-2 flex-1">
                    {searching &&
                      candidates.length === 0 &&
                      Array.from({ length: 3 }).map((_, i) => (
                        <div
                          key={i}
                          className="flex gap-4 p-3 rounded-lg animate-pulse"
                        >
                          <div className="w-16 h-20 shrink-0 rounded-md bg-surface-raised" />
                          <div className="flex-1 space-y-2 py-1">
                            <div className="h-4 bg-surface-raised rounded w-3/4" />
                            <div className="h-3 bg-surface-raised rounded w-1/3" />
                            <div className="h-3 bg-surface-raised rounded w-full mt-2" />
                          </div>
                        </div>
                      ))}
                    {candidates.map((c) => (
                      <button
                        key={c.igdbId}
                        onClick={() => applyMutation.mutate(c.igdbId)}
                        disabled={applyMutation.isPending}
                        className="w-full flex gap-4 p-3 rounded-lg hover:bg-surface-raised transition text-left disabled:opacity-50"
                      >
                        <div className="w-16 h-20 shrink-0 rounded-md overflow-hidden bg-surface-raised">
                          {c.coverUrl ? (
                            <img
                              src={c.coverUrl}
                              alt={c.name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-text-muted">
                              <svg
                                className="w-6 h-6"
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
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm text-text-primary truncate">
                            {c.name}
                          </p>
                          <div className="flex gap-2 mt-0.5 text-xs text-text-muted">
                            {c.releaseYear && <span>{c.releaseYear}</span>}
                            {c.genre && (
                              <span className="truncate">{c.genre}</span>
                            )}
                          </div>
                          {c.platform && (
                            <p className="text-xs text-text-muted mt-0.5 truncate">
                              {c.platform}
                            </p>
                          )}
                          {c.summary && (
                            <p className="text-xs text-text-secondary mt-1 line-clamp-2">
                              {c.summary}
                            </p>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
