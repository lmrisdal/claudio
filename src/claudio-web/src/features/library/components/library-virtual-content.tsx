import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useRef } from "react";
import type { Game } from "../../core/types/models";
import type { LibraryLayoutModel, LibraryRow } from "../library-layout";
import LibraryGridView from "./library-grid-view";
import LibraryGroupedView from "./library-grouped-view";
import LibraryListHeader from "./library-list-header";
import LibraryListView from "./library-list-view";

type SortColumn = "platform" | "title" | "year" | "size";

type LibraryVirtualContentProps = {
  collapsedGroups: Set<string>;
  containerWidth: number;
  isLoading: boolean;
  model: LibraryLayoutModel;
  onDownloadGame: (game: Game) => void;
  onFocusItem: (key: string) => void;
  onItemClick: (key: string) => void;
  onGameActivate: (game: Game) => void;
  onGamePreviewStart: (game: Game) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
  onPendingFocusHandled: (key: string) => void;
  onToggleGroup: (platform: string) => void;
  pendingFocusKey: string | null;
  scrollElement: HTMLElement | null;
  scrollMargin: number;
  sortBy: SortColumn;
  sortDir: "asc" | "desc";
  toggleSort: (column: SortColumn) => void;
  totalGames: number;
};

function focusVisible(element: HTMLElement) {
  element.focus({ focusVisible: true } as FocusOptions);
}

function getFocusKeyFromElement(element: HTMLElement | null) {
  const toggle = element?.closest<HTMLElement>("[data-group-toggle]");
  if (toggle?.dataset.groupToggle) {
    return `toggle:${toggle.dataset.groupToggle}`;
  }

  const gameId = element?.closest<HTMLElement>("[data-game-id]")?.dataset.gameId;
  return gameId ? `game:${gameId}` : null;
}

function getCardRowHeight(width: number, columns: number) {
  const safeWidth = Math.max(width, columns * 160);
  const cardWidth = (safeWidth - Math.max(columns - 1, 0) * 20) / columns;
  return cardWidth * 1.5 + 64;
}

function getRowEstimate(row: LibraryRow, width: number, columns: number) {
  switch (row.kind) {
    case "grid-games":
    case "group-games": {
      return getCardRowHeight(width, columns) + 20;
    }
    case "group-toggle": {
      return 52;
    }
    case "list-game": {
      return 46;
    }
    default: {
      return 0;
    }
  }
}

function renderLoadingState(view: LibraryLayoutModel["view"], columns: number) {
  if (view === "list") {
    return (
      <div className="space-y-1 animate-pulse">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="h-12 bg-surface-raised rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div
      className="grid gap-5"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {Array.from({ length: 12 }).map((_, index) => (
        <div key={index} className="animate-pulse">
          <div className="aspect-2/3 bg-surface-raised rounded-lg mb-2" />
          <div className="h-3 bg-surface-raised rounded w-3/4 mb-1.5" />
          <div className="h-2.5 bg-surface-raised rounded w-1/2" />
        </div>
      ))}
    </div>
  );
}

function renderEmptyState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center py-24 text-text-muted">
      <svg
        className="w-12 h-12 mb-4 text-text-muted"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M14.25 6.087c0-.355.186-.676.401-.959.221-.29.349-.634.349-1.003 0-1.036-1.007-1.875-2.25-1.875s-2.25.84-2.25 1.875c0 .369.128.713.349 1.003.215.283.401.604.401.959v0a.64.64 0 01-.657.643 48.39 48.39 0 01-4.163-.3c.186 1.613.293 3.25.315 4.907a.656.656 0 01-.658.663v0c-.355 0-.676-.186-.959-.401a1.647 1.647 0 00-1.003-.349c-1.036 0-1.875 1.007-1.875 2.25s.84 2.25 1.875 2.25c.369 0 .713-.128 1.003-.349.283-.215.604-.401.959-.401v0c.31 0 .555.26.532.57a48.039 48.039 0 01-.642 5.056c1.518.19 3.058.309 4.616.354a.64.64 0 00.657-.643v0c0-.355-.186-.676-.401-.959a1.647 1.647 0 01-.349-1.003c0-1.035 1.008-1.875 2.25-1.875 1.243 0 2.25.84 2.25 1.875 0 .369-.128.713-.349 1.003-.215.283-.4.604-.4.959v0c0 .333.277.599.61.58a48.1 48.1 0 005.427-.63 48.05 48.05 0 00.582-4.717.532.532 0 00-.533-.57v0c-.355 0-.676.186-.959.401-.29.221-.634.349-1.003.349-1.035 0-1.875-1.007-1.875-2.25s.84-2.25 1.875-2.25c.37 0 .713.128 1.003.349.283.215.604.401.959.401v0a.656.656 0 00.658-.663 48.422 48.422 0 00-.37-5.36c-1.886.342-3.81.574-5.766.689a.578.578 0 01-.61-.58v0z"
        />
      </svg>
      <p className="text-sm">No games found</p>
      <p className="text-xs mt-1">Try adjusting your search or filters</p>
    </div>
  );
}

export default function LibraryVirtualContent({
  collapsedGroups,
  containerWidth,
  isLoading,
  model,
  onDownloadGame,
  onFocusItem,
  onItemClick,
  onGameActivate,
  onGamePreviewStart,
  onKeyDown,
  onPendingFocusHandled,
  onToggleGroup,
  pendingFocusKey,
  scrollElement,
  scrollMargin,
  sortBy,
  sortDir,
  toggleSort,
  totalGames,
}: LibraryVirtualContentProps) {
  const focusableElements = useRef(new Map<string, HTMLElement>());
  const rootReference = useRef<HTMLDivElement>(null);
  const shouldVirtualize = import.meta.env.MODE !== "test";

  const virtualizer = useVirtualizer({
    count: model.rows.length,
    estimateSize: (index) => getRowEstimate(model.rows[index], containerWidth, model.columns),
    getItemKey: (index) => model.rows[index]?.key ?? index,
    getScrollElement: () => scrollElement ?? document.documentElement,
    initialRect: { height: 800, width: containerWidth },
    overscan: model.view === "list" ? 12 : 6,
    scrollMargin,
  });

  useEffect(() => {
    if (!pendingFocusKey) {
      return;
    }

    const target = model.focusableByKey.get(pendingFocusKey);
    if (!target) {
      return;
    }

    virtualizer.scrollToIndex(target.rowIndex, { align: "auto" });

    const animationFrame = requestAnimationFrame(() => {
      const element =
        focusableElements.current.get(pendingFocusKey) ??
        (pendingFocusKey.startsWith("toggle:")
          ? rootReference.current?.querySelector<HTMLElement>(
              `[data-group-toggle="${pendingFocusKey.slice(7)}"]`,
            )
          : rootReference.current?.querySelector<HTMLElement>(
              `[data-game-id="${pendingFocusKey.slice(5)}"]`,
            ));
      if (!element) {
        return;
      }

      focusVisible(element);
      onPendingFocusHandled(pendingFocusKey);
    });

    return () => cancelAnimationFrame(animationFrame);
  }, [model, onPendingFocusHandled, pendingFocusKey, virtualizer]);

  if (isLoading) {
    return renderLoadingState(model.view, model.columns);
  }

  if (totalGames === 0) {
    return renderEmptyState();
  }

  function renderRow(row: LibraryRow) {
    if (row.kind === "grid-games") {
      return (
        <LibraryGridView
          focusableElements={focusableElements}
          model={model}
          onFocusItem={onFocusItem}
          onGameActivate={onGameActivate}
          onGamePreviewStart={onGamePreviewStart}
          onKeyDown={onKeyDown}
          row={row}
        />
      );
    }

    if (row.kind === "group-toggle" || row.kind === "group-games") {
      return (
        <LibraryGroupedView
          collapsedGroups={collapsedGroups}
          focusableElements={focusableElements}
          model={model}
          onFocusItem={onFocusItem}
          onGameActivate={onGameActivate}
          onGamePreviewStart={onGamePreviewStart}
          onKeyDown={onKeyDown}
          onToggleGroup={onToggleGroup}
          row={row}
        />
      );
    }

    return (
      <LibraryListView
        focusableElements={focusableElements}
        onDownloadGame={onDownloadGame}
        onFocusItem={onFocusItem}
        onGameActivate={onGameActivate}
        onGamePreviewStart={onGamePreviewStart}
        onKeyDown={onKeyDown}
        row={row}
      />
    );
  }

  return (
    <div
      ref={rootReference}
      onClickCapture={(event) => {
        const key = getFocusKeyFromElement(event.target as HTMLElement);
        if (key) {
          onItemClick(key);
        }
      }}
      onFocusCapture={(event) => {
        const key = getFocusKeyFromElement(event.target as HTMLElement);
        if (key) {
          onFocusItem(key);
        }
      }}
      onKeyDown={onKeyDown}
    >
      {model.view === "list" && (
        <LibraryListHeader sortBy={sortBy} sortDir={sortDir} toggleSort={toggleSort} />
      )}
      {shouldVirtualize ? (
        <div className="relative" style={{ height: `${virtualizer.getTotalSize()}px` }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = model.rows[virtualRow.index];

            if (!row) {
              return null;
            }

            return (
              <div
                key={virtualRow.key}
                className="absolute left-0 top-0 w-full"
                style={{ transform: `translateY(${virtualRow.start - scrollMargin}px)` }}
              >
                {renderRow(row)}
              </div>
            );
          })}
        </div>
      ) : (
        <div>
          {model.rows.map((row) => (
            <div key={row.key}>{renderRow(row)}</div>
          ))}
        </div>
      )}
    </div>
  );
}
