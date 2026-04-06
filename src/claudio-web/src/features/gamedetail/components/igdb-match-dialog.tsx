import type { FormEvent } from "react";
import type { IgdbCandidate } from "../shared";

interface IgdbMatchDialogProperties {
  open: boolean;
  query: string;
  searching: boolean;
  searchError: string | null;
  candidates: IgdbCandidate[];
  isApplying: boolean;
  onClose: () => void;
  onQueryChange: (value: string) => void;
  onSearch: (event: FormEvent<HTMLFormElement>) => void;
  onSelectCandidate: (igdbId: number) => void;
}

export default function IgdbMatchDialog({
  open,
  query,
  searching,
  searchError,
  candidates,
  isApplying,
  onClose,
  onQueryChange,
  onSearch,
  onSelectCandidate,
}: IgdbMatchDialogProperties) {
  if (!open) {
    return null;
  }

  return (
    <div
      data-search-dialog
      className="app-modal-backdrop fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-xl ring-1 ring-border p-6 max-w-2xl w-full mx-4 shadow-xl max-h-[80vh] flex flex-col"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-text-primary font-medium">Match on IGDB</h3>
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

        <form onSubmit={onSearch} className="flex gap-2 mb-4">
          <input
            type="text"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search IGDB..."
            className="flex-1 bg-surface-raised border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500 transition"
          />
          <button
            type="submit"
            disabled={searching || !query.trim()}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-purple-600 text-white hover:bg-purple-700 transition disabled:opacity-50"
          >
            {searching ? "Searching..." : "Search"}
          </button>
        </form>

        {searchError && <p className="text-sm text-red-400 mb-3">{searchError}</p>}

        <div className="overflow-y-auto space-y-2 flex-1">
          {searching &&
            candidates.length === 0 &&
            Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="flex gap-4 p-3 rounded-lg animate-pulse">
                <div className="w-16 h-20 shrink-0 rounded-md bg-surface-raised" />
                <div className="flex-1 space-y-2 py-1">
                  <div className="h-4 bg-surface-raised rounded w-3/4" />
                  <div className="h-3 bg-surface-raised rounded w-1/3" />
                  <div className="h-3 bg-surface-raised rounded w-full mt-2" />
                </div>
              </div>
            ))}

          {candidates.map((candidate) => (
            <button
              key={candidate.igdbId}
              type="button"
              onClick={() => onSelectCandidate(candidate.igdbId)}
              disabled={isApplying}
              className="w-full flex gap-4 p-3 rounded-lg hover:bg-surface-raised transition text-left disabled:opacity-50"
            >
              <div className="w-16 h-20 shrink-0 rounded-md overflow-hidden bg-surface-raised">
                {candidate.coverUrl ? (
                  <img
                    src={candidate.coverUrl}
                    alt={candidate.name}
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
                <p className="font-medium text-sm text-text-primary truncate">{candidate.name}</p>
                <div className="flex gap-2 mt-0.5 text-xs text-text-muted">
                  {candidate.releaseYear && <span>{candidate.releaseYear}</span>}
                  {candidate.genre && <span className="truncate">{candidate.genre}</span>}
                </div>
                {candidate.platform && (
                  <p className="text-xs text-text-muted mt-0.5 truncate">{candidate.platform}</p>
                )}
                {candidate.summary && (
                  <p className="text-xs text-text-secondary mt-1 line-clamp-2">
                    {candidate.summary}
                  </p>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
