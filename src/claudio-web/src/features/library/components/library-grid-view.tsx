import type { MutableRefObject } from "react";
import type { Game } from "../../core/types/models";
import type { LibraryLayoutModel, LibraryRow } from "../library-layout";
import GameCard from "./game-card";

type GridGamesRow = Extract<LibraryRow, { kind: "grid-games" }>;

type LibraryGridViewProps = {
  focusableElements: MutableRefObject<Map<string, HTMLElement>>;
  model: LibraryLayoutModel;
  onFocusItem: (key: string) => void;
  onGameActivate: (game: Game) => void;
  onGamePreviewStart: (game: Game) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
  row: GridGamesRow;
};

export default function LibraryGridView({
  focusableElements,
  model,
  onFocusItem,
  onGameActivate,
  onGamePreviewStart,
  onKeyDown,
  row,
}: LibraryGridViewProps) {
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
