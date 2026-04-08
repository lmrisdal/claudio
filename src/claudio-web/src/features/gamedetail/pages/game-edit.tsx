import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useShortcut } from "../../core/hooks/use-shortcut";
import type { Game } from "../../core/types/models";
import { api } from "../../core/api/client";
import GameEditForm from "../components/game-edit-form";
import IgdbMatchDialog from "../components/igdb-match-dialog";
import SteamGridDbDialog from "../components/steamgriddb-dialog";
import {
  buildGameUpdateInput,
  createGameEditForm,
  isPcPlatform,
  type GameEditFormState,
  type IgdbCandidate,
  type PendingFiles,
  type SgdbMode,
} from "../shared";

export default function GameEdit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const coverFileReference = useRef<HTMLInputElement>(null);
  const heroFileReference = useRef<HTMLInputElement>(null);
  const sgdbRequestReference = useRef(0);
  const [editForm, setEditForm] = useState<GameEditFormState | null>(null);
  const [pendingFiles, setPendingFiles] = useState<PendingFiles>({});
  const [candidates, setCandidates] = useState<IgdbCandidate[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [igdbQuery, setIgdbQuery] = useState("");
  const [sgdbDialog, setSgdbDialog] = useState<{ open: boolean; mode: SgdbMode }>({
    open: false,
    mode: "covers",
  });
  const [sgdbQuery, setSgdbQuery] = useState("");
  const [sgdbSearching, setSgdbSearching] = useState(false);
  const [sgdbGames, setSgdbGames] = useState<{ id: number; name: string; year?: number }[] | null>(
    null,
  );
  const [sgdbImages, setSgdbImages] = useState<string[] | null>(null);
  const [sgdbLoadingImages, setSgdbLoadingImages] = useState(false);

  useShortcut("escape", () => {
    if (sgdbDialog.open) {
      setSgdbDialog((current) => ({ ...current, open: false }));
      return;
    }

    if (candidates) {
      setCandidates(null);
      setSearchError(null);
      return;
    }

    void navigate(`/games/${id}`);
  });

  const { data: game, isLoading } = useQuery({
    queryKey: ["game", id],
    queryFn: () => api.get<Game>(`/games/${id}`),
    enabled: !!id,
  });

  const { data: exeList = [] } = useQuery({
    queryKey: ["executables", id],
    queryFn: () => api.get<string[]>(`/games/${id}/executables`),
    enabled: !!id && !!game && isPcPlatform(game.platform),
  });

  useEffect(() => {
    if (!game) {
      return;
    }

    setEditForm(createGameEditForm(game));
    setPendingFiles({});
  }, [game]);

  const applyMutation = useMutation({
    mutationFn: (igdbId: number) => api.post<Game>(`/admin/games/${id}/igdb/apply`, { igdbId }),
    onSuccess: (data) => {
      queryClient.setQueryData(["game", id], data);
      void queryClient.invalidateQueries({ queryKey: ["games"] });
      setEditForm(createGameEditForm(data));
      setCandidates(null);
      setSearchError(null);
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: ReturnType<typeof buildGameUpdateInput>) =>
      api.put<Game>(`/admin/games/${id}`, data),
    onSuccess: (data) => {
      queryClient.setQueryData(["game", id], data);
      void queryClient.invalidateQueries({ queryKey: ["games"] });
      setPendingFiles({});
      void navigate(`/games/${id}`);
    },
  });

  const compressMutation = useMutation({
    mutationFn: (format: string) => api.post(`/admin/games/${id}/compress?format=${format}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["game", id] });
      void queryClient.invalidateQueries({ queryKey: ["tasksStatus"] });
    },
  });

  const tagFolderMutation = useMutation({
    mutationFn: () => api.post<Game>(`/admin/games/${id}/tag-folder`),
    onSuccess: (data) => {
      queryClient.setQueryData(["game", id], data);
      void queryClient.invalidateQueries({ queryKey: ["games"] });
      setEditForm(createGameEditForm(data));
    },
  });

  async function searchIgdb(customQuery?: string) {
    setSearching(true);
    setSearchError(null);

    try {
      const results = customQuery
        ? await api.post<IgdbCandidate[]>("/admin/igdb/search", { query: customQuery })
        : await api.post<IgdbCandidate[]>(`/admin/games/${id}/igdb/search`);

      const gamePlatformSlug = game?.platform;

      if (results.length === 0) {
        setSearchError("No results found on IGDB.");
        setCandidates([]);
        return;
      }

      const sorted = gamePlatformSlug
        ? results.sort((a, b) => {
            const aMatch = a.platformSlug === gamePlatformSlug ? 0 : 1;
            const bMatch = b.platformSlug === gamePlatformSlug ? 0 : 1;
            return aMatch - bMatch;
          })
        : results;

      setCandidates(sorted);
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : "Search failed");
    } finally {
      setSearching(false);
    }
  }

  async function runSteamGridDbSearch(query: string, mode: SgdbMode) {
    const requestId = ++sgdbRequestReference.current;
    setSgdbGames(null);
    setSgdbImages(null);
    setSgdbLoadingImages(false);
    setSgdbSearching(true);

    try {
      const games = await api.get<{ id: number; name: string; year?: number }[]>(
        `/admin/steamgriddb/search?query=${encodeURIComponent(query)}`,
      );

      if (sgdbRequestReference.current !== requestId) {
        return;
      }

      setSgdbGames(games);
      if (games.length === 1) {
        await selectSgdbGame(games[0].id, mode);
      }
    } catch {
      if (sgdbRequestReference.current !== requestId) {
        return;
      }

      setSgdbGames([]);
    } finally {
      if (sgdbRequestReference.current === requestId) {
        setSgdbSearching(false);
      }
    }
  }

  async function openSgdbDialog(mode: SgdbMode) {
    const query = game?.title ?? "";
    setSgdbQuery(query);
    setSgdbDialog({ open: true, mode });
    await runSteamGridDbSearch(query, mode);
  }

  async function selectSgdbGame(sgdbGameId: number, mode: SgdbMode = sgdbDialog.mode) {
    setSgdbImages(null);
    setSgdbLoadingImages(true);

    try {
      const urls = await api.get<string[]>(`/admin/steamgriddb/${sgdbGameId}/${mode}`);
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
    void searchIgdb();
  }

  function handleImageSelect(type: "cover" | "hero", file: File) {
    const field = type === "cover" ? "coverUrl" : "heroUrl";
    const blobUrl = URL.createObjectURL(file);
    setEditForm((current) => (current ? { ...current, [field]: blobUrl } : current));
    setPendingFiles((current) => ({ ...current, [type]: file }));
  }

  async function handleSubmit() {
    if (!game || !editForm) {
      return;
    }

    let coverUrl = editForm.coverUrl || null;
    let heroUrl = editForm.heroUrl || null;
    const cacheBust = `?v=${Date.now()}`;

    if (pendingFiles.cover) {
      const response = await api.upload<{ url: string }>(
        `/admin/games/${id}/upload-image?type=cover`,
        pendingFiles.cover,
      );
      coverUrl = response.url + cacheBust;
    }

    if (pendingFiles.hero) {
      const response = await api.upload<{ url: string }>(
        `/admin/games/${id}/upload-image?type=hero`,
        pendingFiles.hero,
      );
      heroUrl = response.url + cacheBust;
    }

    updateMutation.mutate(
      buildGameUpdateInput(game, {
        title: editForm.title,
        summary: editForm.summary || null,
        genre: editForm.genre || null,
        releaseYear: editForm.releaseYear ? Number.parseInt(editForm.releaseYear, 10) : null,
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
        igdbId: editForm.igdbId ? Number.parseInt(editForm.igdbId, 10) : null,
        igdbSlug: editForm.igdbSlug || null,
      }),
    );
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

  if (!game || !editForm) {
    return (
      <main className="max-w-5xl mx-auto px-6 py-24 text-center flex-1 w-full">
        <p className="text-text-muted">Game not found</p>
        <Link to="/" className="text-accent hover:underline text-sm mt-2 inline-block">
          Back to library
        </Link>
      </main>
    );
  }

  const heroUrl = editForm.heroUrl || game.heroUrl;
  const coverUrl = editForm.coverUrl || game.coverUrl;

  return (
    <div className="relative flex-1 w-full">
      {heroUrl && (
        <div
          className="game-hero-backdrop pointer-events-none absolute inset-x-0 top-0 h-72 overflow-hidden"
          aria-hidden="true"
        >
          <img src={heroUrl} alt="" className="w-full h-full object-cover" />
          <div className="game-hero-overlay absolute inset-0" />
        </div>
      )}

      <main className="relative z-10 max-w-5xl mx-auto px-6 py-12 flex-1 w-full">
        <Link
          to={`/games/${game.id}`}
          className={`inline-flex items-center gap-1.5 text-sm transition mb-8 rounded-lg px-3 py-2 outline-none focus-visible:[box-shadow:0_0_0_4px_var(--bg),0_0_0_6px_var(--focus-ring)] ${
            heroUrl
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
          Back to game
        </Link>

        <div className="flex flex-col md:flex-row gap-10">
          <div className="w-72 shrink-0 mx-auto md:mx-0">
            <button
              type="button"
              onClick={() => void openSgdbDialog("covers")}
              className="w-full aspect-2/3 bg-surface-raised rounded-xl overflow-hidden ring-1 ring-border hover:ring-accent transition"
            >
              {coverUrl ? (
                <img src={coverUrl} alt={game.title} className="w-full h-full object-cover" />
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
                  <span className="text-xs">Choose cover</span>
                </div>
              )}
            </button>
          </div>

          <div className="flex-1 min-w-0">
            <GameEditForm
              game={game}
              hasHeroImage={!!heroUrl}
              editForm={editForm}
              exeOptions={exeList}
              coverFileReference={coverFileReference}
              heroFileReference={heroFileReference}
              savePending={updateMutation.isPending}
              saveError={
                updateMutation.error instanceof Error
                  ? updateMutation.error.message
                  : updateMutation.isError
                    ? "Update failed"
                    : null
              }
              compressPending={compressMutation.isPending}
              compressError={
                compressMutation.error instanceof Error
                  ? compressMutation.error.message
                  : compressMutation.isError
                    ? "Compression failed"
                    : null
              }
              tagFolderPending={tagFolderMutation.isPending}
              onChange={(patch) =>
                setEditForm((current) => (current ? { ...current, ...patch } : current))
              }
              onSubmit={() => void handleSubmit()}
              onCancel={() => void navigate(`/games/${game.id}`)}
              onOpenIgdbSearch={openIgdbSearch}
              onOpenSgdb={(mode) => void openSgdbDialog(mode)}
              onImageSelect={handleImageSelect}
              onTagFolder={() => tagFolderMutation.mutate()}
              onCompress={(format) => compressMutation.mutate(format)}
            />
          </div>
        </div>
      </main>

      <SteamGridDbDialog
        open={sgdbDialog.open}
        mode={sgdbDialog.mode}
        query={sgdbQuery}
        searching={sgdbSearching}
        games={sgdbGames}
        images={sgdbImages}
        loadingImages={sgdbLoadingImages}
        selectedImageUrl={sgdbDialog.mode === "covers" ? editForm.coverUrl : editForm.heroUrl}
        onClose={() => setSgdbDialog((current) => ({ ...current, open: false }))}
        onQueryChange={setSgdbQuery}
        onSearch={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!sgdbQuery.trim()) {
            return;
          }
          void runSteamGridDbSearch(sgdbQuery.trim(), sgdbDialog.mode);
        }}
        onBackToResults={() => setSgdbImages(null)}
        onSelectGame={(sgdbGameId) => void selectSgdbGame(sgdbGameId)}
        onSelectImage={(url) => {
          setEditForm((current) =>
            current
              ? {
                  ...current,
                  [sgdbDialog.mode === "covers" ? "coverUrl" : "heroUrl"]: url,
                }
              : current,
          );
          setSgdbDialog((current) => ({ ...current, open: false }));
        }}
      />

      <IgdbMatchDialog
        open={candidates !== null}
        query={igdbQuery}
        searching={searching}
        searchError={searchError}
        candidates={candidates ?? []}
        isApplying={applyMutation.isPending}
        onClose={() => {
          setCandidates(null);
          setSearchError(null);
        }}
        onQueryChange={setIgdbQuery}
        onSearch={(event) => {
          event.preventDefault();
          if (igdbQuery.trim()) {
            void searchIgdb(igdbQuery.trim());
          }
        }}
        onSelectCandidate={(igdbId) => applyMutation.mutate(igdbId)}
      />
    </div>
  );
}
