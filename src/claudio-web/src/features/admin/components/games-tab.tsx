import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { api } from "../../core/api/client";
import type { Game } from "../../core/types/models";
import { formatPlatform } from "../../core/utils/platforms";

export default function GamesTab() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [showMissingOnly, setShowMissingOnly] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Game | null>(null);
  const [deleteFiles, setDeleteFiles] = useState(false);

  const { data: games = [], isLoading } = useQuery({
    queryKey: ["games"],
    queryFn: () => api.get<Game[]>("/games"),
  });

  const deleteMutation = useMutation({
    mutationFn: ({ id, deleteFiles }: { id: number; deleteFiles: boolean }) =>
      api.delete(`/admin/games/${id}?deleteFiles=${deleteFiles}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["games"] });
      setDeleteTarget(null);
      setDeleteFiles(false);
    },
  });

  const removeMissingMutation = useMutation({
    mutationFn: () => api.delete<{ removed: number }>("/admin/games/missing"),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["games"] });
      setShowMissingOnly(false);
    },
  });

  const filtered = games.filter((g) => {
    if (showMissingOnly && !g.isMissing) return false;
    if (search) {
      const q = search.toLowerCase();
      return g.title.toLowerCase().includes(q) || g.platform.toLowerCase().includes(q);
    }
    return true;
  });
  const missingCount = games.filter((g) => g.isMissing).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
            />
          </svg>
          <input
            type="text"
            placeholder="Filter games..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-surface-raised border border-border rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-accent transition placeholder:text-text-muted"
          />
        </div>
        <p className="text-sm text-text-secondary whitespace-nowrap">
          {filtered.length}/{games.length}
          {missingCount > 0 && <span className="text-red-400 ml-1">({missingCount} missing)</span>}
        </p>
        {missingCount > 0 && (
          <>
            <button
              onClick={() => setShowMissingOnly(!showMissingOnly)}
              className={`text-xs px-3 py-1.5 rounded-lg transition whitespace-nowrap ${
                showMissingOnly
                  ? "bg-red-500/20 text-red-400 ring-1 ring-red-500/30"
                  : "bg-surface-raised text-text-secondary ring-1 ring-border hover:ring-accent/50"
              }`}
            >
              {showMissingOnly ? "Show all" : "Show missing only"}
            </button>
            <button
              onClick={() => {
                if (
                  confirm(
                    `Remove ${missingCount} missing game${missingCount > 1 ? "s" : ""} from the library?`,
                  )
                )
                  removeMissingMutation.mutate();
              }}
              disabled={removeMissingMutation.isPending}
              className="text-xs px-3 py-1.5 rounded-lg transition whitespace-nowrap bg-surface-raised text-red-400 ring-1 ring-border hover:ring-red-500/50 disabled:opacity-50"
            >
              Remove all missing
            </button>
          </>
        )}
      </div>

      <div className="card bg-surface rounded-xl ring-1 ring-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-text-muted border-b border-border bg-surface-raised">
              <th className="px-5 py-3 font-medium text-xs uppercase tracking-wider">Title</th>
              <th className="px-5 py-3 font-medium text-xs uppercase tracking-wider">Platform</th>
              <th className="px-5 py-3 font-medium text-xs uppercase tracking-wider">Status</th>
              <th className="px-5 py-3 font-medium text-xs uppercase tracking-wider text-right">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={4} className="px-5 py-8 text-center text-text-muted">
                  Loading...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-5 py-8 text-center text-text-muted">
                  {showMissingOnly ? "No missing games" : "No games"}
                </td>
              </tr>
            ) : (
              filtered.map((game) => (
                <tr
                  key={game.id}
                  className="border-b border-border/50 hover:bg-surface-raised/50 transition-colors"
                >
                  <td className="px-5 py-3.5 font-medium">
                    <Link to={`/games/${game.id}`} className="text-accent hover:underline">
                      {game.title}
                    </Link>
                  </td>
                  <td className="px-5 py-3.5 text-text-secondary">
                    {formatPlatform(game.platform)}
                  </td>
                  <td className="px-5 py-3.5">
                    {game.isMissing ? (
                      <span className="inline-flex items-center text-xs px-2 py-0.5 rounded-full font-medium bg-red-500/15 text-red-400">
                        missing
                      </span>
                    ) : (
                      <span className="inline-flex items-center text-xs px-2 py-0.5 rounded-full font-medium bg-accent-dim text-accent">
                        ok
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <button
                      onClick={() => setDeleteTarget(game)}
                      disabled={deleteMutation.isPending}
                      className="px-2.5 py-1 rounded-md text-xs text-red-400/70 hover:text-red-400 hover:bg-red-500/10 transition"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <div
          className="app-modal-backdrop fixed inset-0 z-50 flex items-center justify-center"
          onClick={() => {
            setDeleteTarget(null);
            setDeleteFiles(false);
          }}
        >
          <div
            className="bg-surface rounded-xl ring-1 ring-border p-6 max-w-sm w-full mx-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-text-primary font-medium mb-2">Delete game</h3>
            <p className="text-sm text-text-secondary mb-4">
              Remove{" "}
              <span className="font-medium text-text-primary">
                &quot;{deleteTarget.title}&quot;
              </span>{" "}
              from the database?
            </p>
            {!deleteTarget.isMissing && (
              <label className="flex items-center gap-2.5 mb-5 text-sm cursor-pointer group">
                <input
                  type="checkbox"
                  checked={deleteFiles}
                  onChange={(e) => setDeleteFiles(e.target.checked)}
                  className="w-4 h-4 rounded border-border accent-red-500"
                />
                <span className="text-red-400">Also delete files from disk</span>
              </label>
            )}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setDeleteTarget(null);
                  setDeleteFiles(false);
                }}
                className="px-4 py-2 rounded-lg text-sm text-text-secondary hover:text-text-primary hover:bg-surface-overlay ring-1 ring-border transition"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteMutation.mutate({ id: deleteTarget.id, deleteFiles })}
                disabled={deleteMutation.isPending}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-red-500/20 text-red-400 hover:bg-red-500/30 ring-1 ring-red-500/30 transition disabled:opacity-50"
              >
                {deleteMutation.isPending ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
