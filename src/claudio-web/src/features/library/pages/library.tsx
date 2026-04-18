import { useQuery } from "@tanstack/react-query";
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { api } from "../../core/api/client";
import {
  GAMEPAD_NAV_DOWN_EVENT,
  GAMEPAD_NAV_LEFT_EVENT,
  GAMEPAD_NAV_RIGHT_EVENT,
  GAMEPAD_NAV_UP_EVENT,
} from "../../core/hooks/use-gamepad";
import { useInputScope, useInputScopeState } from "../../core/hooks/use-input-scope";
import { useGamepadEvent, useShortcut } from "../../core/hooks/use-shortcut";
import type { Game, TasksStatus } from "../../core/types/models";
import { formatPlatform } from "../../core/utils/platforms";
import { isDesktop } from "../../desktop/hooks/use-desktop";
import { useDesktopShellNavigation } from "../../desktop/hooks/use-desktop-shell-navigation";
import { loadGameDetailPage } from "../../gamedetail/load-game-detail-page";
import LibraryVirtualContent from "../components/library-virtual-content";
import {
  buildLibraryLayoutModel,
  getDirectionalNavigation,
  getGameFocusKey,
  getGridColumns,
  getGroupJumpTarget,
  type ViewMode,
} from "../library-layout";

let lastFocusedGameId: string | null = null;

function focusVisible(element: HTMLElement, preventScroll = false) {
  element.focus({ focusVisible: true, preventScroll } as FocusOptions);
}

function getFocusKeyFromElement(element: HTMLElement | null) {
  const toggle = element?.closest<HTMLElement>("[data-group-toggle]");
  if (toggle?.dataset.groupToggle) {
    return `toggle:${toggle.dataset.groupToggle}`;
  }

  const gameId = element?.closest<HTMLElement>("[data-game-id]")?.dataset.gameId;
  return gameId ? `game:${gameId}` : null;
}

export default function Library() {
  const cardWidth = 160;
  const navigate = useNavigate();
  const { focusSidebar } = useDesktopShellNavigation();
  const { isActionBlocked } = useInputScopeState();
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem("library-platforms");
      return saved ? new Set(JSON.parse(saved) as string[]) : new Set();
    } catch {
      return new Set();
    }
  });
  const [platformOrder, setPlatformOrder] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem("library-platform-order");
      return saved ? (JSON.parse(saved) as string[]) : [];
    } catch {
      return [];
    }
  });
  const [platformDropdownOpen, setPlatformDropdownOpen] = useState(false);
  const [view, setView] = useState<ViewMode>(
    () => (localStorage.getItem("library-view") as ViewMode) || "grouped",
  );
  const [sortBy, setSortBy] = useState<"platform" | "title" | "year" | "size">("title");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem("library-collapsed");
      return saved ? new Set(JSON.parse(saved) as string[]) : new Set();
    } catch {
      return new Set();
    }
  });
  const [pendingFocusKey, setPendingFocusKey] = useState<string | null>(null);
  const [contentWidth, setContentWidth] = useState(1280);
  const [scrollMargin, setScrollMargin] = useState(0);
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null);
  const platformDropdownReference = useRef<HTMLDivElement>(null);
  const focusAnchorReference = useRef<HTMLDivElement>(null);
  const toolbarReference = useRef<HTMLDivElement>(null);
  const contentReference = useRef<HTMLDivElement>(null);
  const activeFocusKey = useRef<string | null>(null);
  const hasInitializedFocus = useRef(false);
  const keyRepeatState = useRef({ count: 0, key: "", time: 0 });
  const preloadedHeaderUrls = useRef(new Set<string>());

  useInputScope({ id: "library-page", kind: "page" });
  useInputScope({
    blocks: ["guide", "page-nav", "search"],
    enabled: platformDropdownOpen,
    id: "library-platform-dropdown",
    kind: "menu",
  });

  const { data: tasksData } = useQuery({
    enabled: false,
    queryFn: () => api.get<TasksStatus>("/admin/tasks/status"),
    queryKey: ["tasksStatus"],
  });
  const hasActiveTasks = tasksData?.igdb.isRunning || tasksData?.steamGridDb.isRunning;

  const { data: games = [], isLoading } = useQuery({
    queryFn: () => api.get<Game[]>("/games"),
    queryKey: ["games"],
    refetchInterval: hasActiveTasks ? 5000 : false,
  });

  const { allPlatforms, filtered } = useMemo(() => {
    const platformSet = new Set<string>();
    const filteredGames: Game[] = [];

    for (const game of games) {
      platformSet.add(game.platform);
      if (selectedPlatforms.size === 0 || selectedPlatforms.has(game.platform)) {
        filteredGames.push(game);
      }
    }

    return {
      allPlatforms: [...platformSet].sort(),
      filtered: filteredGames,
    };
  }, [games, selectedPlatforms]);

  const platforms = useMemo(
    () => [
      ...platformOrder.filter((platform) => allPlatforms.includes(platform)),
      ...allPlatforms.filter((platform) => !platformOrder.includes(platform)),
    ],
    [allPlatforms, platformOrder],
  );

  const sorted = useMemo(() => {
    if (view !== "list") {
      return filtered;
    }

    const direction = sortDir === "asc" ? 1 : -1;

    return [...filtered].sort((left, right) => {
      switch (sortBy) {
        case "platform": {
          return direction * left.platform.localeCompare(right.platform);
        }
        case "size": {
          return direction * (left.sizeBytes - right.sizeBytes);
        }
        case "title": {
          return direction * left.title.localeCompare(right.title);
        }
        case "year": {
          return direction * ((left.releaseYear ?? 0) - (right.releaseYear ?? 0));
        }
        default: {
          return 0;
        }
      }
    });
  }, [filtered, sortBy, sortDir, view]);

  const columns = view === "list" ? 1 : getGridColumns(contentWidth, cardWidth);
  const model = useMemo(
    () =>
      buildLibraryLayoutModel({
        collapsedGroups,
        columns,
        games: view === "list" ? sorted : filtered,
        platforms,
        view,
      }),
    [collapsedGroups, columns, filtered, platforms, sorted, view],
  );

  const preloadHeaderImage = useCallback((headerUrl?: string) => {
    if (!headerUrl || preloadedHeaderUrls.current.has(headerUrl)) {
      return;
    }

    preloadedHeaderUrls.current.add(headerUrl);
    const image = new Image();
    image.decoding = "async";
    image.src = headerUrl;
    image.addEventListener("error", () => {
      preloadedHeaderUrls.current.delete(headerUrl);
    });
  }, []);

  const handleGamePreviewStart = useCallback(
    (game: Game) => {
      preloadHeaderImage(game.heroUrl);
      void loadGameDetailPage();
    },
    [preloadHeaderImage],
  );

  const saveFocusedGameId = useCallback((gameId?: number | string | null) => {
    if (gameId !== null && gameId !== undefined) {
      lastFocusedGameId = String(gameId);
    }
  }, []);

  const queueFocus = useCallback((key: string) => {
    activeFocusKey.current = key;
    setPendingFocusKey(key);
  }, []);

  const scrollToTop = useCallback(() => {
    scrollElement?.scrollTo({ behavior: "smooth", top: 0 });
  }, [scrollElement]);

  const handleDirectionalNavigation = useCallback(
    (direction: string) => {
      if (isActionBlocked("page-nav")) {
        return false;
      }

      const activeElement = document.activeElement as HTMLElement | null;

      if (focusAnchorReference.current && activeElement === focusAnchorReference.current) {
        switch (direction) {
          case "ArrowDown":
          case "ArrowRight": {
            if (!model.firstFocusableKey) {
              return false;
            }

            queueFocus(model.firstFocusableKey);
            return true;
          }
          case "ArrowLeft": {
            return focusSidebar();
          }
          case "ArrowUp": {
            return true;
          }
          default: {
            return false;
          }
        }
      }

      if (
        toolbarReference.current &&
        activeElement instanceof Node &&
        toolbarReference.current.contains(activeElement)
      ) {
        if (direction === "ArrowLeft") {
          return focusSidebar();
        }

        if (direction !== "ArrowDown" || !model.firstFocusableKey) {
          return false;
        }

        queueFocus(model.firstFocusableKey);
        return true;
      }

      const currentKey = activeFocusKey.current ?? activeElement?.dataset.focusKey ?? null;

      if (!currentKey) {
        return false;
      }

      const result = getDirectionalNavigation(model, currentKey, direction);
      if (!result) {
        return false;
      }

      switch (result.type) {
        case "anchor": {
          activeFocusKey.current = null;
          if (focusAnchorReference.current) {
            focusVisible(focusAnchorReference.current, true);
          }
          scrollToTop();
          return true;
        }
        case "key": {
          queueFocus(result.key);
          return true;
        }
        case "sidebar": {
          return focusSidebar();
        }
        default: {
          return false;
        }
      }
    },
    [focusSidebar, isActionBlocked, model, queueFocus, scrollToTop],
  );

  const handleFocusableKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      const focusKey = getFocusKeyFromElement(event.target as HTMLElement);
      if (focusKey) {
        activeFocusKey.current = focusKey;
      }

      if (event.key === "Enter" && focusKey) {
        const target = model.focusableByKey.get(focusKey);
        if (target?.kind === "game") {
          saveFocusedGameId(target.game.id);
        }
        return;
      }

      if (!["ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp"].includes(event.key)) {
        return;
      }

      if (event.repeat) {
        const now = performance.now();
        const state = keyRepeatState.current;

        if (state.key !== event.key) {
          state.key = event.key;
          state.count = 0;
          state.time = now;
        }

        const interval = Math.max(50, 180 * 0.8 ** state.count);
        if (now - state.time < interval) {
          event.preventDefault();
          return;
        }

        state.count += 1;
        state.time = now;
      } else {
        keyRepeatState.current = {
          count: 0,
          key: event.key,
          time: performance.now(),
        };
      }

      if (handleDirectionalNavigation(event.key)) {
        event.preventDefault();
      }
    },
    [handleDirectionalNavigation, model, saveFocusedGameId],
  );

  const handleFocusAnchorKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (handleDirectionalNavigation(event.key)) {
        event.preventDefault();
      }
    },
    [handleDirectionalNavigation],
  );

  const handleToolbarKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "ArrowDown" && handleDirectionalNavigation(event.key)) {
        event.preventDefault();
      }
    },
    [handleDirectionalNavigation],
  );

  const jumpGroup = useCallback(
    (direction: 1 | -1) => {
      if (isActionBlocked("page-nav")) {
        return;
      }

      const targetKey = getGroupJumpTarget(model, activeFocusKey.current, direction);
      if (!targetKey) {
        return;
      }

      queueFocus(targetKey);
    },
    [isActionBlocked, model, queueFocus],
  );

  useGamepadEvent(GAMEPAD_NAV_UP_EVENT, () => handleDirectionalNavigation("ArrowUp"));
  useGamepadEvent(GAMEPAD_NAV_DOWN_EVENT, () => handleDirectionalNavigation("ArrowDown"));
  useGamepadEvent(GAMEPAD_NAV_LEFT_EVENT, () => handleDirectionalNavigation("ArrowLeft"));
  useGamepadEvent(GAMEPAD_NAV_RIGHT_EVENT, () => handleDirectionalNavigation("ArrowRight"));
  useGamepadEvent(
    "gamepad-rt",
    () => jumpGroup(1),
    view === "grouped" && !isActionBlocked("page-nav"),
  );
  useGamepadEvent(
    "gamepad-lt",
    () => jumpGroup(-1),
    view === "grouped" && !isActionBlocked("page-nav"),
  );

  useShortcut(
    "escape",
    (event) => {
      event.preventDefault();
      setPlatformDropdownOpen(false);
    },
    { enabled: platformDropdownOpen },
  );

  useEffect(() => {
    if (!platformDropdownOpen) {
      return;
    }

    function handleClick(event: MouseEvent) {
      if (!platformDropdownReference.current?.contains(event.target as Node)) {
        setPlatformDropdownOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [platformDropdownOpen]);

  useEffect(() => {
    function handleMouseDown(event: MouseEvent) {
      if (
        !(event.target as HTMLElement).closest('a, button, input, [role="link"], [role="listbox"]')
      ) {
        event.preventDefault();
        if (focusAnchorReference.current) {
          focusVisible(focusAnchorReference.current, true);
        }
      }
    }

    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, []);

  useEffect(() => {
    const element = contentReference.current;
    if (!element) {
      return;
    }

    const updateMeasurements = () => {
      const nextWidth = element.clientWidth || element.getBoundingClientRect().width || 1280;
      setContentWidth(nextWidth);
      setScrollMargin(element.offsetTop);
    };

    updateMeasurements();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(updateMeasurements);
    observer.observe(element);

    if (scrollElement) {
      observer.observe(scrollElement);
    }

    return () => observer.disconnect();
  }, [filtered.length, scrollElement, view]);

  useEffect(() => {
    if (isLoading) {
      hasInitializedFocus.current = false;
      return;
    }

    if (hasInitializedFocus.current) {
      return;
    }

    hasInitializedFocus.current = true;
    const gameId = lastFocusedGameId;
    lastFocusedGameId = null;

    if (gameId) {
      const targetKey = getGameFocusKey(gameId);
      if (model.focusableByKey.has(targetKey)) {
        queueFocus(targetKey);
        return;
      }
    }

    if (focusAnchorReference.current) {
      activeFocusKey.current = null;
      focusVisible(focusAnchorReference.current, true);
    }
  }, [isLoading, model, queueFocus]);

  useEffect(() => {
    if (activeFocusKey.current && !model.focusableByKey.has(activeFocusKey.current)) {
      activeFocusKey.current = null;
    }
  }, [model]);

  const movePlatform = useCallback(
    (index: number, direction: -1 | 1) => {
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= platforms.length) {
        return;
      }

      const nextOrder = [...platforms];
      [nextOrder[index], nextOrder[targetIndex]] = [nextOrder[targetIndex], nextOrder[index]];
      setPlatformOrder(nextOrder);
      localStorage.setItem("library-platform-order", JSON.stringify(nextOrder));
    },
    [platforms],
  );

  const toggleSort = useCallback(
    (column: typeof sortBy) => {
      if (sortBy === column) {
        setSortDir((current) => (current === "asc" ? "desc" : "asc"));
        return;
      }

      setSortBy(column);
      setSortDir("asc");
    },
    [sortBy],
  );

  const setViewMode = useCallback((nextView: ViewMode) => {
    startTransition(() => setView(nextView));
    localStorage.setItem("library-view", nextView);
  }, []);

  const toggleGroup = useCallback((platform: string) => {
    setCollapsedGroups((current) => {
      const next = new Set(current);

      if (next.has(platform)) {
        next.delete(platform);
      } else {
        next.add(platform);
      }

      localStorage.setItem("library-collapsed", JSON.stringify([...next]));
      return next;
    });
  }, []);

  const handleGameActivate = useCallback(
    (game: Game) => {
      saveFocusedGameId(game.id);
      activeFocusKey.current = getGameFocusKey(game.id);
      void navigate(`/games/${game.id}`);
    },
    [navigate, saveFocusedGameId],
  );

  const handleGameCardActivate = useCallback(
    (game: Game) => {
      saveFocusedGameId(game.id);
      activeFocusKey.current = getGameFocusKey(game.id);
    },
    [saveFocusedGameId],
  );

  const handleDownloadGame = useCallback(async (game: Game) => {
    const { ticket } = await api.post<{ ticket: string }>(`/games/${game.id}/download-ticket`);
    const anchor = document.createElement("a");
    anchor.href = `/api/games/${game.id}/download?ticket=${encodeURIComponent(ticket)}`;
    anchor.download = "";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  }, []);

  const togglePlatformSelection = useCallback((platform: string) => {
    setSelectedPlatforms((current) => {
      const next = new Set(current);

      if (next.has(platform)) {
        next.delete(platform);
      } else {
        next.add(platform);
      }

      localStorage.setItem("library-platforms", JSON.stringify([...next]));
      return next;
    });
  }, []);

  return (
    <main
      ref={setScrollElement}
      className={`${isDesktop ? "px-6 py-8 flex-1 flex flex-col w-full overflow-y-auto overflow-x-hidden" : "max-w-7xl mx-auto px-6 py-8 flex-1 flex flex-col w-full overflow-y-auto"}`}
    >
      <div
        ref={toolbarReference}
        className="flex gap-3 mb-8 items-center"
        onKeyDown={handleToolbarKeyDown}
      >
        <div className="relative min-w-40" ref={platformDropdownReference}>
          <button
            onClick={() => setPlatformDropdownOpen((current) => !current)}
            className="w-full bg-surface border border-border rounded-lg px-4 py-2.5 text-sm text-left focus:outline-none focus:border-focus-ring focus:ring-1 focus:ring-focus-ring/30 transition flex items-center justify-between gap-2"
          >
            <span className="truncate">
              {selectedPlatforms.size === 0
                ? "All platforms"
                : selectedPlatforms.size === 1
                  ? formatPlatform([...selectedPlatforms][0])
                  : `${selectedPlatforms.size} platforms`}
            </span>
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
          </button>
          {platformDropdownOpen && (
            <div className="absolute z-20 mt-1 w-full min-w-50 max-h-80 overflow-auto rounded-lg bg-surface border border-border shadow-lg py-1 text-sm">
              <button
                onClick={() => {
                  setSelectedPlatforms(new Set());
                  localStorage.setItem("library-platforms", "[]");
                }}
                className={`w-full px-4 py-2 text-left transition-colors hover:bg-surface-raised ${selectedPlatforms.size === 0 ? "text-accent" : ""}`}
              >
                All platforms
              </button>
              {platforms.map((platform, index) => (
                <div
                  key={platform}
                  className="flex items-center gap-2 px-4 py-2 hover:bg-surface-raised transition-colors cursor-pointer"
                  onClick={() => togglePlatformSelection(platform)}
                >
                  <div
                    className={`w-3.5 h-3.5 rounded border shrink-0 flex items-center justify-center transition-colors ${selectedPlatforms.has(platform) ? "bg-accent border-accent" : "border-border"}`}
                  >
                    {selectedPlatforms.has(platform) && (
                      <svg
                        className="w-2.5 h-2.5 text-accent-foreground"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={3}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M4.5 12.75l6 6 9-13.5"
                        />
                      </svg>
                    )}
                  </div>
                  <span className="flex-1">{formatPlatform(platform)}</span>
                  {view === "grouped" && (
                    <div className="flex flex-col -my-1">
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          movePlatform(index, -1);
                        }}
                        disabled={index === 0}
                        className="text-text-muted hover:text-text-primary disabled:opacity-20 disabled:hover:text-text-muted transition-colors p-0.5"
                      >
                        <svg
                          className="w-3 h-3"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2.5}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M4.5 15.75l7.5-7.5 7.5 7.5"
                          />
                        </svg>
                      </button>
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          movePlatform(index, 1);
                        }}
                        disabled={index === platforms.length - 1}
                        className="text-text-muted hover:text-text-primary disabled:opacity-20 disabled:hover:text-text-muted transition-colors p-0.5"
                      >
                        <svg
                          className="w-3 h-3"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2.5}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M19.5 8.25l-7.5 7.5-7.5-7.5"
                          />
                        </svg>
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="ml-auto flex rounded-lg border border-border overflow-hidden">
          <button
            onClick={() => setViewMode("grid")}
            className={`p-2 transition ${view === "grid" ? "bg-surface-raised text-text-primary" : "text-text-muted hover:text-text-primary"}`}
            title="Grid view"
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
                d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z"
              />
            </svg>
          </button>
          <button
            onClick={() => setViewMode("grouped")}
            className={`p-2 transition ${view === "grouped" ? "bg-surface-raised text-text-primary" : "text-text-muted hover:text-text-primary"}`}
            title="Grouped by platform"
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
                d="M2.25 7.125C2.25 6.504 2.754 6 3.375 6h6c.621 0 1.125.504 1.125 1.125v3.75c0 .621-.504 1.125-1.125 1.125h-6a1.125 1.125 0 01-1.125-1.125v-3.75zM14.25 8.625c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v8.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 01-1.125-1.125v-8.25zM2.25 16.875c0-.621.504-1.125 1.125-1.125h6c.621 0 1.125.504 1.125 1.125v2.25c0 .621-.504 1.125-1.125 1.125h-6a1.125 1.125 0 01-1.125-1.125v-2.25z"
              />
            </svg>
          </button>
          <button
            onClick={() => setViewMode("list")}
            className={`p-2 transition ${view === "list" ? "bg-surface-raised text-text-primary" : "text-text-muted hover:text-text-primary"}`}
            title="List view"
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
                d="M3.75 12h16.5m-16.5 5.25h16.5m-16.5-10.5h16.5"
              />
            </svg>
          </button>
        </div>
      </div>

      {!isLoading && (
        <p className="text-xs text-text-muted mb-4 font-mono">
          {filtered.length} {filtered.length === 1 ? "game" : "games"}
          {selectedPlatforms.size === 1 && ` in ${formatPlatform([...selectedPlatforms][0])}`}
          {selectedPlatforms.size > 1 && ` across ${selectedPlatforms.size} platforms`}
        </p>
      )}

      <div
        ref={focusAnchorReference}
        tabIndex={0}
        className="outline-none h-0 overflow-hidden"
        onKeyDown={handleFocusAnchorKeyDown}
      />

      <div ref={contentReference}>
        <LibraryVirtualContent
          collapsedGroups={collapsedGroups}
          containerWidth={contentWidth}
          isLoading={isLoading}
          model={model}
          onDownloadGame={handleDownloadGame}
          onFocusItem={(key) => {
            activeFocusKey.current = key;
          }}
          onItemClick={(key) => {
            activeFocusKey.current = key;
            if (key.startsWith("game:")) {
              saveFocusedGameId(key.slice(5));
            }
          }}
          onGameActivate={view === "list" ? handleGameActivate : handleGameCardActivate}
          onGamePreviewStart={handleGamePreviewStart}
          onKeyDown={handleFocusableKeyDown}
          onPendingFocusHandled={(key) => {
            if (pendingFocusKey === key) {
              setPendingFocusKey(null);
            }
          }}
          onToggleGroup={toggleGroup}
          pendingFocusKey={pendingFocusKey}
          scrollElement={scrollElement}
          scrollMargin={scrollMargin}
          sortBy={sortBy}
          sortDir={sortDir}
          toggleSort={toggleSort}
          totalGames={filtered.length}
        />
      </div>
    </main>
  );
}
