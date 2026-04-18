import type { Game } from "../core/types/models";

export type ViewMode = "grid" | "grouped" | "list";

export type NavigationResult =
  | { type: "anchor" }
  | { type: "key"; key: string }
  | { type: "sidebar" };

type GridGamesRow = {
  key: string;
  kind: "grid-games";
  rowIndex: number;
  gameKeys: string[];
  games: Game[];
};

type GroupToggleRow = {
  count: number;
  key: string;
  kind: "group-toggle";
  platform: string;
  rowIndex: number;
};

type GroupGamesRow = {
  gameKeys: string[];
  games: Game[];
  groupIndex: number;
  key: string;
  kind: "group-games";
  platform: string;
  rowIndex: number;
  rowInGroup: number;
};

type ListGameRow = {
  game: Game;
  gameKey: string;
  key: string;
  kind: "list-game";
  rowIndex: number;
};

export type LibraryRow = GridGamesRow | GroupGamesRow | GroupToggleRow | ListGameRow;

type BaseFocusable = {
  key: string;
  rowIndex: number;
};

export type GameFocusable = BaseFocusable & {
  column: number;
  game: Game;
  globalIndex: number;
  groupIndex: number | null;
  indexInGroup: number;
  kind: "game";
};

export type ToggleFocusable = BaseFocusable & {
  groupIndex: number;
  kind: "toggle";
  platform: string;
};

export type FocusableItem = GameFocusable | ToggleFocusable;

type GroupLayout = {
  gameKeys: string[];
  groupIndex: number;
  platform: string;
  rowStarts: string[];
  toggleKey: string;
};

export type LibraryLayoutModel = {
  columns: number;
  firstFocusableKey: string | null;
  focusableByKey: Map<string, FocusableItem>;
  groups: GroupLayout[];
  rows: LibraryRow[];
  view: ViewMode;
};

type BuildModelOptions = {
  collapsedGroups: Set<string>;
  columns: number;
  games: Game[];
  platforms: string[];
  view: ViewMode;
};

function chunkGames(games: Game[], size: number) {
  const rows: Game[][] = [];

  for (let index = 0; index < games.length; index += size) {
    rows.push(games.slice(index, index + size));
  }

  return rows;
}

export function getGameFocusKey(gameId: number | string) {
  return `game:${String(gameId)}`;
}

export function getGridColumns(width: number, targetCardWidth: number) {
  const gap = 20;
  const columns = Math.floor((width + gap) / (targetCardWidth + gap));
  return Math.max(1, columns);
}

export function buildLibraryLayoutModel({
  collapsedGroups,
  columns,
  games,
  platforms,
  view,
}: BuildModelOptions): LibraryLayoutModel {
  const rows: LibraryRow[] = [];
  const focusableByKey = new Map<string, FocusableItem>();
  const groups: GroupLayout[] = [];
  let firstFocusableKey: string | null = null;
  let rowIndex = 0;
  let globalGameIndex = 0;

  const registerFirstFocusable = (key: string) => {
    if (firstFocusableKey === null) {
      firstFocusableKey = key;
    }
  };

  if (view === "grouped") {
    let groupIndex = 0;

    for (const platform of platforms) {
      const platformGames = games.filter((game) => game.platform === platform);

      if (platformGames.length === 0) {
        continue;
      }

      const toggleKey = `toggle:${platform}`;
      rows.push({
        count: platformGames.length,
        key: `row:toggle:${platform}`,
        kind: "group-toggle",
        platform,
        rowIndex,
      });
      focusableByKey.set(toggleKey, {
        groupIndex,
        key: toggleKey,
        kind: "toggle",
        platform,
        rowIndex,
      });
      registerFirstFocusable(toggleKey);
      rowIndex += 1;

      const gameKeys: string[] = [];
      const rowStarts: string[] = [];

      if (!collapsedGroups.has(platform)) {
        const rowGames = chunkGames(platformGames, columns);

        for (const [rowInGroup, gamesInRow] of rowGames.entries()) {
          const keys = gamesInRow.map((game) => getGameFocusKey(game.id));
          const rowKey = `row:group:${platform}:${rowInGroup}`;

          rowStarts.push(keys[0]);
          gameKeys.push(...keys);
          rows.push({
            gameKeys: keys,
            games: gamesInRow,
            groupIndex,
            key: rowKey,
            kind: "group-games",
            platform,
            rowIndex,
            rowInGroup,
          });

          for (const [column, game] of gamesInRow.entries()) {
            const key = keys[column];
            focusableByKey.set(key, {
              column,
              game,
              globalIndex: globalGameIndex,
              groupIndex,
              indexInGroup: gameKeys.length - gamesInRow.length + column,
              key,
              kind: "game",
              rowIndex,
            });
            registerFirstFocusable(key);
            globalGameIndex += 1;
          }

          rowIndex += 1;
        }
      }

      groups.push({
        gameKeys,
        groupIndex,
        platform,
        rowStarts,
        toggleKey,
      });
      groupIndex += 1;
    }

    return { columns, firstFocusableKey, focusableByKey, groups, rows, view };
  }

  if (view === "grid") {
    const rowGames = chunkGames(games, columns);

    for (const [gameRowIndex, gamesInRow] of rowGames.entries()) {
      const keys = gamesInRow.map((game) => getGameFocusKey(game.id));
      rows.push({
        gameKeys: keys,
        games: gamesInRow,
        key: `row:grid:${gameRowIndex}`,
        kind: "grid-games",
        rowIndex,
      });

      for (const [column, game] of gamesInRow.entries()) {
        const key = keys[column];
        focusableByKey.set(key, {
          column,
          game,
          globalIndex: globalGameIndex,
          groupIndex: null,
          indexInGroup: globalGameIndex,
          key,
          kind: "game",
          rowIndex,
        });
        registerFirstFocusable(key);
        globalGameIndex += 1;
      }

      rowIndex += 1;
    }

    return { columns, firstFocusableKey, focusableByKey, groups, rows, view };
  }

  for (const game of games) {
    const key = getGameFocusKey(game.id);
    rows.push({
      game,
      gameKey: key,
      key: `row:list:${game.id}`,
      kind: "list-game",
      rowIndex,
    });
    focusableByKey.set(key, {
      column: 0,
      game,
      globalIndex: globalGameIndex,
      groupIndex: null,
      indexInGroup: globalGameIndex,
      key,
      kind: "game",
      rowIndex,
    });
    registerFirstFocusable(key);
    globalGameIndex += 1;
    rowIndex += 1;
  }

  return { columns: 1, firstFocusableKey, focusableByKey, groups, rows, view };
}

export function getDirectionalNavigation(
  model: LibraryLayoutModel,
  currentKey: string,
  direction: string,
): NavigationResult | null {
  const current = model.focusableByKey.get(currentKey);

  if (!current) {
    return null;
  }

  if (model.view === "grouped") {
    if (current.kind === "toggle") {
      const previousGroup = model.groups[current.groupIndex - 1];
      const nextGroup = model.groups[current.groupIndex + 1];

      switch (direction) {
        case "ArrowDown": {
          if (model.groups[current.groupIndex]?.gameKeys[0]) {
            return { type: "key", key: model.groups[current.groupIndex].gameKeys[0] };
          }

          if (nextGroup) {
            return { type: "key", key: nextGroup.toggleKey };
          }

          return null;
        }
        case "ArrowLeft": {
          return { type: "sidebar" };
        }
        case "ArrowRight": {
          const firstGameKey = model.groups[current.groupIndex]?.gameKeys[0];
          return firstGameKey ? { type: "key", key: firstGameKey } : null;
        }
        case "ArrowUp": {
          if (!previousGroup) {
            return { type: "anchor" };
          }

          const lastRowStart = previousGroup.rowStarts.at(-1);
          if (lastRowStart) {
            return { type: "key", key: lastRowStart };
          }

          return { type: "key", key: previousGroup.toggleKey };
        }
        default: {
          return null;
        }
      }
    }

    const group = model.groups[current.groupIndex ?? -1];
    if (!group) {
      return null;
    }

    switch (direction) {
      case "ArrowDown": {
        const nextIndex = current.indexInGroup + model.columns;
        if (nextIndex < group.gameKeys.length) {
          return { type: "key", key: group.gameKeys[nextIndex] };
        }

        const currentRowStart = Math.floor(current.indexInGroup / model.columns) * model.columns;
        const lastRowStart =
          Math.floor((group.gameKeys.length - 1) / model.columns) * model.columns;

        if (currentRowStart < lastRowStart) {
          const targetIndex = Math.min(lastRowStart + current.column, group.gameKeys.length - 1);
          return { type: "key", key: group.gameKeys[targetIndex] };
        }

        const nextGroup = model.groups[(current.groupIndex ?? 0) + 1];
        return nextGroup ? { type: "key", key: nextGroup.toggleKey } : null;
      }
      case "ArrowLeft": {
        if (current.indexInGroup === 0) {
          return { type: "sidebar" };
        }

        return {
          type: "key",
          key: model.groups.flatMap((item) => item.gameKeys)[current.globalIndex - 1],
        };
      }
      case "ArrowRight": {
        const orderedGameKeys = model.groups.flatMap((item) => item.gameKeys);
        const nextKey = orderedGameKeys[current.globalIndex + 1];
        return nextKey ? { type: "key", key: nextKey } : null;
      }
      case "ArrowUp": {
        const previousIndex = current.indexInGroup - model.columns;
        if (previousIndex >= 0) {
          return { type: "key", key: group.gameKeys[previousIndex] };
        }

        return { type: "key", key: group.toggleKey };
      }
      default: {
        return null;
      }
    }
  }

  const orderedGameKeys = [...model.focusableByKey.values()]
    .filter((item): item is GameFocusable => item.kind === "game")
    .sort((left, right) => left.globalIndex - right.globalIndex)
    .map((item) => item.key);

  if (current.kind !== "game") {
    return null;
  }

  switch (model.view) {
    case "grid": {
      const nextIndex = current.globalIndex + 1;
      const previousIndex = current.globalIndex - 1;
      const downIndex = current.globalIndex + model.columns;
      const upIndex = current.globalIndex - model.columns;

      switch (direction) {
        case "ArrowDown": {
          if (downIndex < orderedGameKeys.length) {
            return { type: "key", key: orderedGameKeys[downIndex] };
          }

          const currentRowStart = Math.floor(current.globalIndex / model.columns) * model.columns;
          const lastRowStart =
            Math.floor((orderedGameKeys.length - 1) / model.columns) * model.columns;

          if (currentRowStart < lastRowStart) {
            const targetIndex = Math.min(lastRowStart + current.column, orderedGameKeys.length - 1);
            return { type: "key", key: orderedGameKeys[targetIndex] };
          }

          return null;
        }
        case "ArrowLeft": {
          return previousIndex >= 0
            ? { type: "key", key: orderedGameKeys[previousIndex] }
            : { type: "sidebar" };
        }
        case "ArrowRight": {
          return nextIndex < orderedGameKeys.length
            ? { type: "key", key: orderedGameKeys[nextIndex] }
            : null;
        }
        case "ArrowUp": {
          return upIndex >= 0 ? { type: "key", key: orderedGameKeys[upIndex] } : { type: "anchor" };
        }
        default: {
          return null;
        }
      }
    }
    case "list": {
      const nextKey = orderedGameKeys[current.globalIndex + 1];
      const previousKey = orderedGameKeys[current.globalIndex - 1];

      switch (direction) {
        case "ArrowDown": {
          return nextKey ? { type: "key", key: nextKey } : null;
        }
        case "ArrowLeft": {
          return previousKey ? { type: "key", key: previousKey } : { type: "sidebar" };
        }
        case "ArrowRight": {
          return nextKey ? { type: "key", key: nextKey } : null;
        }
        case "ArrowUp": {
          return previousKey ? { type: "key", key: previousKey } : { type: "anchor" };
        }
        default: {
          return null;
        }
      }
    }
    default: {
      return null;
    }
  }
}

export function getGroupJumpTarget(
  model: LibraryLayoutModel,
  currentKey: string | null,
  direction: 1 | -1,
) {
  if (model.view !== "grouped" || model.groups.length === 0) {
    return null;
  }

  const current = currentKey ? model.focusableByKey.get(currentKey) : null;
  const currentGroupIndex =
    current?.kind === "toggle" ? current.groupIndex : (current?.groupIndex ?? -1);
  const targetIndex =
    currentGroupIndex === -1
      ? direction === 1
        ? 0
        : model.groups.length - 1
      : currentGroupIndex + direction;

  const targetGroup = model.groups[targetIndex];
  if (!targetGroup) {
    return null;
  }

  return targetGroup.gameKeys[0] ?? targetGroup.toggleKey;
}
