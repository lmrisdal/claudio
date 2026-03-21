import {
  Listbox,
  ListboxButton,
  ListboxOption,
  ListboxOptions,
} from "@headlessui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { api } from "../api/client";
import { useAuth } from "../hooks/useAuth";
import type { Game } from "../types/models";
import { formatPlatform } from "../utils/platforms";

function DownloadButton({
  gameId,
  size,
}: {
  gameId: number;
  size: number;
}) {
  const [preparing, setPreparing] = useState(false);

  async function handleDownload() {
    setPreparing(true);
    try {
      const { ticket } = await api.post<{ ticket: string }>(`/games/${gameId}/download-ticket`);
      const url = `/api/games/${gameId}/download?ticket=${encodeURIComponent(ticket)}`;
      const a = document.createElement('a');
      a.href = url;
      a.download = '';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } finally {
      // Keep spinner briefly so user sees feedback before browser download starts
      setTimeout(() => setPreparing(false), 2000);
    }
  }

  return (
    <button
      onClick={handleDownload}
      disabled={preparing}
      className="inline-flex items-center gap-2 bg-accent hover:bg-accent-hover disabled:opacity-75 text-neutral-950 font-semibold px-6 py-3 rounded-lg transition text-sm"
    >
      {preparing ? (
        <>
          <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Preparing...
        </>
      ) : (
        <>
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
            />
          </svg>
          Download ({formatSize(size)})
        </>
      )}
    </button>
  );
}

const pcPlatforms = new Set(["pc", "mac", "linux"]);
function isPcPlatform(platform: string) {
  return pcPlatforms.has(platform.toLowerCase());
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function ExeListbox({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <div>
      <label className="text-xs font-medium text-text-muted uppercase tracking-wider">
        {label}
      </label>
      <Listbox value={value} onChange={onChange}>
        <div className="relative mt-1">
          <ListboxButton className="w-full bg-surface-raised border border-border rounded-lg px-3 py-2 text-sm text-left focus:outline-none focus:border-accent transition flex items-center justify-between gap-2">
            <span className="truncate">{value || "None"}</span>
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
                d="M8.25 15L12 18.75 15.75 15m-7.5-6L12 5.25 15.75 9"
              />
            </svg>
          </ListboxButton>
          <ListboxOptions anchor="bottom start" className="z-20 w-[var(--button-width)] max-h-48 overflow-auto rounded-lg bg-surface border border-border shadow-lg py-1 text-sm focus:outline-none">
            <ListboxOption
              value=""
              className="px-3 py-2 cursor-pointer data-[focus]:bg-surface-raised data-[selected]:text-accent transition-colors"
            >
              None
            </ListboxOption>
            {options.map((exe) => (
              <ListboxOption
                key={exe}
                value={exe}
                className="px-3 py-2 cursor-pointer data-[focus]:bg-surface-raised data-[selected]:text-accent transition-colors truncate"
              >
                {exe}
              </ListboxOption>
            ))}
          </ListboxOptions>
        </div>
      </Listbox>
    </div>
  );
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
}

export default function GameDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [candidates, setCandidates] = useState<IgdbCandidate[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [igdbQuery, setIgdbQuery] = useState("");
  const [browsePath, setBrowsePath] = useState<string | null>(null);

  useEffect(() => {
    if (browsePath === null) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setBrowsePath(null);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [browsePath]);

  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    title: "",
    summary: "",
    genre: "",
    releaseYear: "",
    coverUrl: "",
    installType: "" as "portable" | "installer",
    installerExe: "",
    gameExe: "",
    developer: "",
    publisher: "",
    gameMode: "",
    series: "",
    franchise: "",
    gameEngine: "",
  });

  const { data: exeList } = useQuery({
    queryKey: ["executables", id],
    queryFn: () => api.get<string[]>(`/admin/games/${id}/executables`),
    enabled: editing && user?.role === "admin",
  });

  const { data: game, isLoading } = useQuery({
    queryKey: ["game", id],
    queryFn: () => api.get<Game>(`/games/${id}`),
  });

  const { data: browseData, isLoading: browseLoading } = useQuery({
    queryKey: ["browse", id, browsePath],
    queryFn: () =>
      api.get<BrowseResponse>(
        `/games/${id}/browse?path=${encodeURIComponent(browsePath ?? "")}`,
      ),
    enabled: browsePath !== null,
  });

  async function searchIgdb(customQuery?: string) {
    setSearching(true);
    setSearchError(null);
    try {
      const results = customQuery
        ? await api.post<IgdbCandidate[]>("/admin/igdb/search", {
            query: customQuery,
          })
        : await api.post<IgdbCandidate[]>(`/admin/games/${id}/igdb/search`);
      if (results.length === 0) {
        setSearchError("No results found on IGDB.");
        if (!candidates) setCandidates([]); // open modal even with no results so user can refine
      } else {
        setCandidates(results);
        setSearchError(null);
      }
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setSearching(false);
    }
  }

  function openIgdbSearch() {
    setIgdbQuery(game?.title ?? "");
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
      installType: string;
      installerExe: string | null;
      gameExe: string | null;
      developer: string | null;
      publisher: string | null;
      gameMode: string | null;
      series: string | null;
      franchise: string | null;
      gameEngine: string | null;
    }) => api.put<Game>(`/admin/games/${id}`, data),
    onSuccess: (data) => {
      queryClient.setQueryData(["game", id], data);
      queryClient.invalidateQueries({ queryKey: ["games"] });
      setEditing(false);
    },
  });

  function startEditing() {
    if (!game) return;
    setEditForm({
      title: game.title,
      summary: game.summary ?? "",
      genre: game.genre ?? "",
      releaseYear: game.releaseYear?.toString() ?? "",
      coverUrl: game.coverUrl ?? "",
      installType: game.installType,
      installerExe: game.installerExe ?? "",
      gameExe: game.gameExe ?? "",
      developer: game.developer ?? "",
      publisher: game.publisher ?? "",
      gameMode: game.gameMode ?? "",
      series: game.series ?? "",
      franchise: game.franchise ?? "",
      gameEngine: game.gameEngine ?? "",
    });
    setEditing(true);
  }

  function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    updateMutation.mutate({
      title: editForm.title,
      summary: editForm.summary || null,
      genre: editForm.genre || null,
      releaseYear: editForm.releaseYear ? parseInt(editForm.releaseYear) : null,
      coverUrl: editForm.coverUrl || null,
      installType: editForm.installType,
      installerExe: editForm.installerExe || null,
      gameExe: editForm.gameExe || null,
      developer: editForm.developer || null,
      publisher: editForm.publisher || null,
      gameMode: editForm.gameMode || null,
      series: editForm.series || null,
      franchise: editForm.franchise || null,
      gameEngine: editForm.gameEngine || null,
    });
  }

  if (isLoading) {
    return (
      <main className="max-w-5xl mx-auto px-6 py-12">
        <div className="flex flex-col md:flex-row gap-10 animate-pulse">
          <div className="w-72 shrink-0 aspect-[3/4] bg-surface-raised rounded-xl" />
          <div className="flex-1 space-y-4 pt-2">
            <div className="h-8 bg-surface-raised rounded w-2/3" />
            <div className="h-4 bg-surface-raised rounded w-1/3" />
            <div className="h-20 bg-surface-raised rounded w-full mt-6" />
          </div>
        </div>
      </main>
    );
  }

  if (!game) {
    return (
      <main className="max-w-5xl mx-auto px-6 py-24 text-center">
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

  return (
    <main className="max-w-5xl mx-auto px-6 py-12">
      {/* Back link */}
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text-primary transition mb-8"
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
        <div className="w-72 shrink-0">
          <div className="aspect-[3/4] bg-surface-raised rounded-xl overflow-hidden ring-1 ring-border">
            {game.coverUrl ? (
              <img
                src={game.coverUrl}
                alt={game.title}
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
                      setEditForm({ ...editForm, releaseYear: e.target.value })
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
              <div>
                <label className="text-xs font-medium text-text-muted uppercase tracking-wider">
                  Cover URL
                </label>
                <input
                  type="url"
                  value={editForm.coverUrl}
                  onChange={(e) =>
                    setEditForm({ ...editForm, coverUrl: e.target.value })
                  }
                  placeholder="https://..."
                  className="mt-1 w-full bg-surface-raised border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent transition"
                />
              </div>
              {/* Install type & executables (PC games) */}
              {isPcPlatform(game.platform) && (
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
                      onChange={(v) => setEditForm({ ...editForm, gameExe: v })}
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
                  onClick={() => setEditing(false)}
                  className="px-5 py-2.5 rounded-lg text-sm text-text-secondary hover:text-text-primary hover:bg-surface-overlay ring-1 ring-border transition"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            /* Display view */
            <>
              <div className="flex items-start gap-3 mb-3">
                <h1 className="font-display text-4xl font-bold text-text-primary">
                  {game.title}
                </h1>
                {user?.role === "admin" && (
                  <button
                    onClick={startEditing}
                    className="mt-2 shrink-0 p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-raised transition"
                    title="Edit game"
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
                  {formatPlatform(game.platform)}
                </span>
                {game.releaseYear && (
                  <span className="inline-flex items-center px-2.5 py-1 rounded-md bg-surface-raised ring-1 ring-border text-xs font-medium text-text-secondary">
                    {game.releaseYear}
                  </span>
                )}
                {game.genre && (
                  <span className="inline-flex items-center px-2.5 py-1 rounded-md bg-surface-raised ring-1 ring-border text-xs font-medium text-text-secondary">
                    {game.genre}
                  </span>
                )}
                <span className="inline-flex items-center px-2.5 py-1 rounded-md bg-surface-raised ring-1 ring-border text-xs font-mono text-text-muted">
                  {formatSize(game.sizeBytes)}
                </span>
                {isPcPlatform(game.platform) && (
                  <span
                    className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium ring-1 ${
                      game.installType === "installer"
                        ? "bg-blue-500/10 ring-blue-500/20 text-blue-400"
                        : "bg-accent-dim ring-accent/20 text-accent"
                    }`}
                  >
                    {game.installType === "installer" ? "Installer" : "Portable"}
                  </span>
                )}
              </div>

              <p className="text-xs text-text-muted font-mono mb-8 -mt-4">
                /{game.platform}/{game.folderName}
              </p>

              {/* Summary */}
              {game.summary && (
                <div className="mb-8">
                  <h2 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-2">
                    About
                  </h2>
                  <p className="text-text-secondary leading-relaxed">
                    {game.summary}
                  </p>
                </div>
              )}

              {/* Details */}
              {(game.developer ||
                game.publisher ||
                game.gameMode ||
                game.series ||
                game.franchise ||
                game.gameEngine) && (
                <div className="grid grid-cols-2 gap-x-8 gap-y-3 mb-8 text-sm">
                  {game.developer && (
                    <div>
                      <span className="text-text-muted text-xs uppercase tracking-wider font-medium">
                        Developer
                      </span>
                      <p className="text-text-secondary mt-0.5">
                        {game.developer}
                      </p>
                    </div>
                  )}
                  {game.publisher && (
                    <div>
                      <span className="text-text-muted text-xs uppercase tracking-wider font-medium">
                        Publisher
                      </span>
                      <p className="text-text-secondary mt-0.5">
                        {game.publisher}
                      </p>
                    </div>
                  )}
                  {game.gameMode && (
                    <div>
                      <span className="text-text-muted text-xs uppercase tracking-wider font-medium">
                        Game Mode
                      </span>
                      <p className="text-text-secondary mt-0.5">
                        {game.gameMode}
                      </p>
                    </div>
                  )}
                  {game.gameEngine && (
                    <div>
                      <span className="text-text-muted text-xs uppercase tracking-wider font-medium">
                        Engine
                      </span>
                      <p className="text-text-secondary mt-0.5">
                        {game.gameEngine}
                      </p>
                    </div>
                  )}
                  {game.series && (
                    <div>
                      <span className="text-text-muted text-xs uppercase tracking-wider font-medium">
                        Series
                      </span>
                      <p className="text-text-secondary mt-0.5">
                        {game.series}
                      </p>
                    </div>
                  )}
                  {game.franchise && (
                    <div>
                      <span className="text-text-muted text-xs uppercase tracking-wider font-medium">
                        Franchise
                      </span>
                      <p className="text-text-secondary mt-0.5">
                        {game.franchise}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="flex flex-wrap items-center gap-3">
                <DownloadButton gameId={game.id} size={game.sizeBytes} />
                {user?.role === "admin" && (
                  <button
                    onClick={openIgdbSearch}
                    disabled={searching}
                    className="inline-flex items-center gap-2 px-5 py-3 rounded-lg text-sm font-medium bg-purple-600 text-white hover:bg-purple-700 transition disabled:opacity-50"
                  >
                    {searching ? (
                      <>
                        <svg
                          className="w-4 h-4 animate-spin"
                          viewBox="0 0 24 24"
                          fill="none"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                          />
                        </svg>
                        Searching...
                      </>
                    ) : (
                      <>
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
                        {game.igdbId ? "Re-match on IGDB" : "Match on IGDB"}
                      </>
                    )}
                  </button>
                )}
                <button
                  onClick={() => setBrowsePath("")}
                  className="inline-flex items-center gap-2 px-5 py-3 rounded-lg text-sm font-medium bg-surface-raised ring-1 ring-border text-text-secondary hover:text-text-primary hover:ring-accent/30 transition"
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
                  Browse Files
                </button>
              </div>
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
                                  {i > 0 && <span className="text-text-muted/50">/</span>}
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
                        <span className="text-text-primary font-medium">/</span>
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
                  {candidates.map((c) => (
                    <button
                      key={c.igdbId}
                      onClick={() => applyMutation.mutate(c.igdbId)}
                      disabled={applyMutation.isPending}
                      className="w-full flex gap-4 p-3 rounded-lg ring-1 ring-border hover:ring-purple-500/50 hover:bg-surface-raised/50 transition text-left disabled:opacity-50"
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
  );
}
