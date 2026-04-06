import { Dialog, DialogBackdrop, DialogPanel } from "@headlessui/react";
import type { FormEvent } from "react";
import type { SgdbMode } from "../shared";

interface SteamGridDbDialogProperties {
  open: boolean;
  mode: SgdbMode;
  query: string;
  searching: boolean;
  games: { id: number; name: string; year?: number }[] | null;
  images: string[] | null;
  loadingImages: boolean;
  selectedImageUrl?: string;
  onClose: () => void;
  onQueryChange: (value: string) => void;
  onSearch: (event: FormEvent<HTMLFormElement>) => void;
  onBackToResults: () => void;
  onSelectGame: (sgdbGameId: number) => void;
  onSelectImage: (url: string) => void;
}

export default function SteamGridDbDialog({
  open,
  mode,
  query,
  searching,
  games,
  images,
  loadingImages,
  selectedImageUrl,
  onClose,
  onQueryChange,
  onSearch,
  onBackToResults,
  onSelectGame,
  onSelectImage,
}: SteamGridDbDialogProperties) {
  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <DialogBackdrop className="app-modal-backdrop fixed inset-0" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="bg-surface rounded-xl ring-1 ring-border p-6 max-w-2xl w-full mx-4 shadow-xl max-h-[80vh] flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-text-primary font-medium">
              SteamGridDB {mode === "covers" ? "Covers" : "Heroes"}
            </h3>
            <button
              type="button"
              onClick={onClose}
              className="text-text-muted hover:text-text-primary transition p-1"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <form className="flex gap-2 mb-4" onSubmit={onSearch}>
            <input
              type="text"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Search game..."
              className="flex-1 bg-surface-raised border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500 transition"
              autoFocus
            />
            <button
              type="submit"
              disabled={searching || !query.trim()}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-purple-600 text-white hover:bg-purple-700 transition disabled:opacity-50"
            >
              {searching ? "Searching..." : "Search"}
            </button>
          </form>

          {images === null && (
            <>
              {searching ? (
                <p className="text-sm text-text-muted">Searching...</p>
              ) : games !== null && games.length === 0 ? (
                <p className="text-sm text-text-muted">No games found.</p>
              ) : games === null ? null : (
                <div className="overflow-y-auto flex-1 min-h-0 space-y-1">
                  {games.map((game) => (
                    <button
                      key={game.id}
                      type="button"
                      onClick={() => onSelectGame(game.id)}
                      className="w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-surface-raised transition text-text-secondary hover:text-text-primary"
                    >
                      {game.name}
                      {game.year ? ` (${game.year})` : ""}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {images !== null && (
            <>
              <button
                type="button"
                onClick={onBackToResults}
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

              {loadingImages ? (
                <p className="text-sm text-text-muted">Loading images...</p>
              ) : images.length === 0 ? (
                <p className="text-sm text-text-muted">No {mode} found.</p>
              ) : mode === "covers" ? (
                <div className="grid grid-cols-3 gap-3 overflow-y-auto p-1 flex-1 min-h-0">
                  {images.map((url) => (
                    <button
                      key={url}
                      type="button"
                      onClick={() => onSelectImage(url)}
                      className={`aspect-2/3 rounded-lg ring-2 transition hover:ring-accent ${
                        selectedImageUrl === url ? "ring-accent" : "ring-transparent"
                      }`}
                    >
                      <img src={url} alt="" className="w-full h-full object-cover rounded-lg" />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col gap-3 overflow-y-auto p-1 flex-1 min-h-0">
                  {images.map((url) => (
                    <button
                      key={url}
                      type="button"
                      onClick={() => onSelectImage(url)}
                      className={`rounded-lg ring-2 transition hover:ring-accent ${
                        selectedImageUrl === url ? "ring-accent" : "ring-transparent"
                      }`}
                    >
                      <img src={url} alt="" className="w-full rounded-lg object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </DialogPanel>
      </div>
    </Dialog>
  );
}
