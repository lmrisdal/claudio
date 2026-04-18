import type { MutableRefObject } from "react";
import { formatPlatform } from "../../core/utils/platforms";
import type { Game } from "../../core/types/models";
import type { LibraryLayoutModel, LibraryRow } from "../library-layout";
import GameCard from "./game-card";

type GroupToggleRow = Extract<LibraryRow, { kind: "group-toggle" }>;
type GroupGamesRow = Extract<LibraryRow, { kind: "group-games" }>;

type LibraryGroupedViewProps = {
  collapsedGroups: Set<string>;
  focusableElements: MutableRefObject<Map<string, HTMLElement>>;
  model: LibraryLayoutModel;
  onFocusItem: (key: string) => void;
  onGameActivate: (game: Game) => void;
  onGamePreviewStart: (game: Game) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
  onToggleGroup: (platform: string) => void;
  row: GroupGamesRow | GroupToggleRow;
};

export default function LibraryGroupedView({
  collapsedGroups,
  focusableElements,
  model,
  onFocusItem,
  onGameActivate,
  onGamePreviewStart,
  onKeyDown,
  onToggleGroup,
  row,
}: LibraryGroupedViewProps) {
  if (row.kind === "group-toggle") {
    return (
      <div className="pb-4">
        <button
          ref={(node) => {
            if (node) {
              focusableElements.current.set(`toggle:${row.platform}`, node);
            } else {
              focusableElements.current.delete(`toggle:${row.platform}`);
            }
          }}
          data-focus-key={`toggle:${row.platform}`}
          data-group-toggle={row.platform}
          onClick={() => onToggleGroup(row.platform)}
          onFocus={() => onFocusItem(`toggle:${row.platform}`)}
          onKeyDown={onKeyDown}
          className="flex items-center gap-2 text-lg font-semibold text-text-primary hover:text-accent transition-colors outline-none focus-visible:text-accent focus-visible:ring-2 focus-visible:ring-focus-ring/50 focus-visible:ring-offset-4 focus-visible:ring-offset-surface rounded px-1 -ml-1"
        >
          <svg
            className={`w-4 h-4 transition-transform ${collapsedGroups.has(row.platform) ? "-rotate-90" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
          {formatPlatform(row.platform)}
          <span className="text-text-muted font-normal text-sm">({row.count})</span>
        </button>
      </div>
    );
  }

  return (
    <div
      className="pb-5"
      style={{
        display: "grid",
        gap: "1.25rem",
        gridTemplateColumns: `repeat(${model.columns}, minmax(0, 1fr))`,
      }}
    >
      {row.games.map((game, index) => {
        const key = row.gameKeys[index];
        return (
          <GameCard
            key={game.id}
            focusKey={key}
            game={game}
            linkRef={(node) => {
              if (node) {
                focusableElements.current.set(key, node);
              } else {
                focusableElements.current.delete(key);
              }
            }}
            onClick={() => onGameActivate(game)}
            onFocus={() => onFocusItem(key)}
            onKeyDown={onKeyDown}
            onPreviewStart={onGamePreviewStart}
          />
        );
      })}
    </div>
  );
}
