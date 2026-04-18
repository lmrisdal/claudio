import type { MutableRefObject } from "react";
import { formatPlatform } from "../../core/utils/platforms";
import type { Game } from "../../core/types/models";
import type { LibraryRow } from "../library-layout";
type ListGameRow = Extract<LibraryRow, { kind: "list-game" }>;

type LibraryListViewProps = {
  focusableElements: MutableRefObject<Map<string, HTMLElement>>;
  onDownloadGame: (game: Game) => void;
  onFocusItem: (key: string) => void;
  onGameActivate: (game: Game) => void;
  onGamePreviewStart: (game: Game) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
  row: ListGameRow;
};

function formatSize(bytes: number) {
  if (bytes === 0) return "0 B";

  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** index).toFixed(index > 0 ? 1 : 0)} ${units[index]}`;
}

export default function LibraryListView({
  focusableElements,
  onDownloadGame,
  onFocusItem,
  onGameActivate,
  onGamePreviewStart,
  onKeyDown,
  row,
}: LibraryListViewProps) {
  return (
    <div
      className="border-b border-border/50 hover:bg-surface-raised/50 transition-colors cursor-pointer"
      onClick={() => onGameActivate(row.game)}
    >
      <div className="flex items-center py-2.5">
        <div className="w-25 pl-3 pr-4 text-text-secondary truncate">
          {formatPlatform(row.game.platform)}
        </div>
        <div
          ref={(node) => {
            if (node) {
              focusableElements.current.set(row.gameKey, node);
            } else {
              focusableElements.current.delete(row.gameKey);
            }
          }}
          data-focus-key={row.gameKey}
          data-game-id={row.game.id}
          onFocus={() => {
            onFocusItem(row.gameKey);
            onGamePreviewStart(row.game);
          }}
          onKeyDown={onKeyDown}
          role="link"
          tabIndex={-1}
          className={`min-w-0 flex-1 pr-4 font-medium outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-1 focus-visible:ring-offset-(--bg) rounded-sm ${row.game.isMissing ? "opacity-50" : ""}`}
        >
          <span className="hover:text-accent transition-colors">{row.game.title}</span>
        </div>
        <div className="w-17.5 pr-4 text-text-secondary hidden md:block">
          {row.game.releaseYear ?? ""}
        </div>
        <div className="w-50 pr-4 text-text-secondary truncate hidden lg:block">
          {row.game.genre ?? ""}
        </div>
        <div className="w-22.5 pr-3 text-right text-text-secondary font-mono text-xs hidden sm:block">
          {formatSize(row.game.sizeBytes)}
        </div>
        <div className="w-10 pr-3 text-right">
          {!row.game.isMissing && (
            <button
              onClick={(event) => {
                event.stopPropagation();
                onDownloadGame(row.game);
              }}
              className="text-text-muted hover:text-accent transition-colors"
              title="Download"
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
                  d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
                />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
