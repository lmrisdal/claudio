import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { api } from "../../core/api/client";
import {
  GAMEPAD_NAV_DOWN_EVENT,
  GAMEPAD_NAV_LEFT_EVENT,
  GAMEPAD_NAV_RIGHT_EVENT,
  GAMEPAD_NAV_UP_EVENT,
} from "../../core/hooks/use-gamepad";
import { useInputScope, useInputScopeState } from "../../core/hooks/use-input-scope";
import { useGamepadEvent } from "../../core/hooks/use-shortcut";
import { useShortcut } from "../../core/hooks/use-shortcut";
import type { Game, TasksStatus } from "../../core/types/models";
import { formatPlatform } from "../../core/utils/platforms";
import { useDesktopShellNavigation } from "../../desktop/hooks/use-desktop-shell-navigation";
import { loadGameDetailPage } from "../../gamedetail/load-game-detail-page";
import GameCard from "../components/game-card";

let lastFocusedGameId: string | null = null;

type ViewMode = "grid" | "grouped" | "list";

/** Focus with visible ring — needed after mouse interactions reset the :focus-visible heuristic */
function focusVisible(element: HTMLElement, preventScroll = false) {
  element.focus({ focusVisible: true, preventScroll } as FocusOptions);
}

function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** index).toFixed(index > 0 ? 1 : 0)} ${units[index]}`;
}

export default function Library() {
  const navigate = useNavigate();
  const { isActionBlocked } = useInputScopeState();
  const { focusSidebar } = useDesktopShellNavigation();
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
  const platformDropdownReference = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<ViewMode>(
    () => (localStorage.getItem("library-view") as ViewMode) || "grouped",
  );
  const [sortBy, setSortBy] = useState<"platform" | "title" | "year" | "size">("title");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  useInputScope({ id: "library-page", kind: "page" });
  useInputScope({
    id: "library-platform-dropdown",
    kind: "menu",
    blocks: ["guide", "page-nav", "search"],
    enabled: platformDropdownOpen,
  });

  useShortcut(
    "escape",
    (event) => {
      event.preventDefault();
      setPlatformDropdownOpen(false);
    },
    { enabled: platformDropdownOpen },
  );

  function toggleSort(col: typeof sortBy) {
    if (sortBy === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortBy(col);
      setSortDir("asc");
    }
  }

  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem("library-collapsed");
      return saved ? new Set(JSON.parse(saved) as string[]) : new Set();
    } catch {
      return new Set();
    }
  });

  // Subscribe to tasks status cache (populated by TasksPopover for admins)
  const { data: tasksData } = useQuery({
    queryKey: ["tasksStatus"],
    queryFn: () => api.get<TasksStatus>("/admin/tasks/status"),
    enabled: false,
  });
  const hasActiveTasks = tasksData?.igdb.isRunning || tasksData?.steamGridDb.isRunning;

  const { data: games = [], isLoading } = useQuery({
    queryKey: ["games"],
    queryFn: () => api.get<Game[]>("/games"),
    refetchInterval: hasActiveTasks ? 5000 : false,
  });

  const gridReference = useRef<HTMLDivElement>(null);
  const focusAnchorReference = useRef<HTMLDivElement>(null);
  const toolbarReference = useRef<HTMLDivElement>(null);

  const keyRepeatState = useRef<{ key: string; count: number; time: number }>({
    key: "",
    count: 0,
    time: 0,
  });
  const preloadedHeaderUrls = useRef(new Set<string>());

  const preloadHeaderImage = useCallback((headerUrl?: string) => {
    if (!headerUrl || preloadedHeaderUrls.current.has(headerUrl)) return;
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

  const saveFocusedGameId = useCallback((gameId?: string | number | null) => {
    if (gameId !== null && gameId !== undefined) {
      lastFocusedGameId = String(gameId);
    }
  }, []);

  const saveGridFocus = useCallback(
    (target?: EventTarget | null) => {
      if (target instanceof HTMLElement) {
        const gameId = target.closest<HTMLElement>("[data-game-id]")?.dataset.gameId;
        if (gameId) {
          saveFocusedGameId(gameId);
          return;
        }
      }

      const active = document.activeElement as HTMLElement;
      saveFocusedGameId(active?.closest<HTMLElement>("[data-game-id]")?.dataset.gameId);
    },
    [saveFocusedGameId],
  );

  const handleDirectionalNavigation = useCallback(
    (key: string) => {
      if (isActionBlocked("page-nav")) return false;

      const grid = gridReference.current;
      if (!grid) return false;

      const focusAnchor = focusAnchorReference.current;
      if (focusAnchor && document.activeElement === focusAnchor) {
        const firstElement = grid.querySelector<HTMLElement>("[data-group-toggle], a");
        switch (key) {
          case "ArrowDown":
          case "ArrowRight": {
            if (!firstElement) {
              return false;
            }

            focusVisible(firstElement);
            return true;
          }
          case "ArrowUp": {
            return true;
          }
          case "ArrowLeft": {
            return focusSidebar();
          }
          default: {
            return false;
          }
        }
      }

      const toolbar = toolbarReference.current;
      if (
        toolbar &&
        document.activeElement instanceof Node &&
        toolbar.contains(document.activeElement)
      ) {
        if (key === "ArrowLeft") {
          return focusSidebar();
        }

        if (key !== "ArrowDown") {
          return false;
        }

        const firstElement = grid.querySelector<HTMLElement>("[data-group-toggle], a");
        if (!firstElement) {
          return false;
        }

        focusVisible(firstElement);
        return true;
      }

      const activeElement = document.activeElement as HTMLElement;

      // Handle navigation from a group toggle button
      if (Object.hasOwn(activeElement.dataset, "groupToggle")) {
        const toggles = [...grid.querySelectorAll<HTMLElement>("[data-group-toggle]")];
        const toggleIndex = toggles.indexOf(activeElement);
        const section = activeElement.closest("section");
        const groupGrid = section?.querySelector<HTMLElement>(".grid");
        const firstLink = groupGrid?.querySelector<HTMLElement>("a");

        switch (key) {
          case "ArrowDown": {
            // If group is expanded, go to first game card; otherwise next toggle
            if (firstLink) {
              focusVisible(firstLink);
              return true;
            }

            if (toggleIndex + 1 < toggles.length) {
              focusVisible(toggles[toggleIndex + 1]);
              toggles[toggleIndex + 1].scrollIntoView({ block: "nearest" });
              return true;
            }

            return false;
          }
          case "ArrowUp": {
            if (toggleIndex > 0) {
              // Go to previous group's last row first column, or previous toggle if collapsed
              const previousSection = toggles[toggleIndex - 1].closest("section");
              const previousGrid = previousSection?.querySelector<HTMLElement>(".grid");
              const previousLinks = previousGrid
                ? [...previousGrid.querySelectorAll<HTMLElement>("a")]
                : [];
              if (previousLinks.length > 0) {
                const previousCols = previousGrid
                  ? getComputedStyle(previousGrid).gridTemplateColumns?.split(" ").length || 1
                  : 1;
                const lastRowStart =
                  Math.floor((previousLinks.length - 1) / previousCols) * previousCols;
                focusVisible(previousLinks[lastRowStart]);
              } else {
                focusVisible(toggles[toggleIndex - 1]);
                toggles[toggleIndex - 1].scrollIntoView({ block: "nearest" });
              }
              return true;
            }

            focusAnchorReference.current?.focus();
            window.scrollTo({ top: 0, behavior: "smooth" });
            return true;
          }
          case "ArrowRight": {
            if (firstLink) {
              focusVisible(firstLink);
              return true;
            }

            return false;
          }
          case "ArrowLeft": {
            return focusSidebar();
          }
          default: {
            return false;
          }
        }
      }

      const allLinks = [...grid.querySelectorAll<HTMLElement>("a")];
      const allIndex = allLinks.indexOf(activeElement);
      if (allIndex === -1) return false;

      // Find the nearest CSS grid container for accurate column count and scoped navigation
      const gridContainer = activeElement.closest<HTMLElement>(".grid") ?? grid;
      const cols = getComputedStyle(gridContainer).gridTemplateColumns?.split(" ").length || 1;
      const scopedLinks = [...gridContainer.querySelectorAll<HTMLElement>("a")];
      const scopedIndex = scopedLinks.indexOf(activeElement);
      const isGroupedSectionCard = activeElement.closest("section") !== null;

      switch (key) {
        case "ArrowRight": {
          const nextIndex = allIndex + 1;
          if (nextIndex < allLinks.length) {
            focusVisible(allLinks[nextIndex]);
            return true;
          }

          return false;
        }
        case "ArrowLeft": {
          if (isGroupedSectionCard && scopedIndex === 0) {
            return focusSidebar();
          }

          const nextIndex = allIndex - 1;
          if (nextIndex >= 0) {
            focusVisible(allLinks[nextIndex]);
            return true;
          }

          return focusSidebar();
        }
        case "ArrowDown": {
          const nextIndex = scopedIndex + cols;
          if (nextIndex < scopedLinks.length) {
            focusVisible(scopedLinks[nextIndex]);
            return true;
          }

          const currentCol = scopedIndex % cols;
          const lastRowStart = Math.floor((scopedLinks.length - 1) / cols) * cols;
          const currentRowStart = Math.floor(scopedIndex / cols) * cols;
          if (currentRowStart < lastRowStart) {
            // Not on the last row yet — go to same column on last row
            const target = Math.min(lastRowStart + currentCol, scopedLinks.length - 1);
            focusVisible(scopedLinks[target]);
            return true;
          }

          // On the last row — jump to next group's toggle button
          const section = activeElement.closest("section");
          const nextSection = section?.nextElementSibling as HTMLElement | null;
          const nextToggle = nextSection?.querySelector<HTMLElement>("[data-group-toggle]");
          if (nextToggle) {
            focusVisible(nextToggle);
            nextToggle.scrollIntoView({ block: "nearest" });
            return true;
          }

          return false;
        }
        case "ArrowUp": {
          const nextIndex = scopedIndex - cols;
          if (nextIndex >= 0) {
            focusVisible(scopedLinks[nextIndex]);
            return true;
          }

          // On first row — go to this group's toggle button
          const section = activeElement.closest("section");
          const toggle = section?.querySelector<HTMLElement>("[data-group-toggle]");
          if (toggle) {
            focusVisible(toggle);
            toggle.scrollIntoView({ block: "nearest" });
            return true;
          }

          focusAnchorReference.current?.focus();
          window.scrollTo({ top: 0, behavior: "smooth" });
          return true;
        }
        default: {
          return false;
        }
      }
    },
    [focusSidebar, isActionBlocked],
  );

  const handleFocusAnchorKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (handleDirectionalNavigation(e.key)) {
        e.preventDefault();
      }
    },
    [handleDirectionalNavigation],
  );

  const handleToolbarKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown" && handleDirectionalNavigation(e.key)) {
        e.preventDefault();
      }
    },
    [handleDirectionalNavigation],
  );

  const handleGridKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        saveGridFocus();
        return;
      }
      if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(e.key)) return;

      // Throttle held keys with acceleration.
      if (e.repeat) {
        const now = performance.now();
        const rs = keyRepeatState.current;
        if (rs.key !== e.key) {
          rs.key = e.key;
          rs.count = 0;
          rs.time = now;
        }
        const interval = Math.max(50, 180 * 0.8 ** rs.count);
        if (now - rs.time < interval) {
          e.preventDefault();
          return;
        }
        rs.count++;
        rs.time = now;
      } else {
        keyRepeatState.current = {
          key: e.key,
          count: 0,
          time: performance.now(),
        };
      }

      if (handleDirectionalNavigation(e.key)) {
        e.preventDefault();
      }
    },
    [handleDirectionalNavigation, saveGridFocus],
  );

  useGamepadEvent(GAMEPAD_NAV_UP_EVENT, () => handleDirectionalNavigation("ArrowUp"));
  useGamepadEvent(GAMEPAD_NAV_DOWN_EVENT, () => handleDirectionalNavigation("ArrowDown"));
  useGamepadEvent(GAMEPAD_NAV_LEFT_EVENT, () => handleDirectionalNavigation("ArrowLeft"));
  useGamepadEvent(GAMEPAD_NAV_RIGHT_EVENT, () => handleDirectionalNavigation("ArrowRight"));

  // RB/LB bumpers: jump to next/previous group toggle
  const jumpGroup = useCallback(
    (direction: 1 | -1) => {
      if (isActionBlocked("page-nav")) return;

      const grid = gridReference.current;
      if (!grid) return;
      const toggles = [...grid.querySelectorAll<HTMLElement>("[data-group-toggle]")];
      if (toggles.length === 0) return;
      const activeElement = document.activeElement as HTMLElement;
      // Find which group the active element belongs to
      const currentSection = activeElement?.closest("section");
      const currentToggle = currentSection?.querySelector<HTMLElement>("[data-group-toggle]");
      const currentIndex = currentToggle ? toggles.indexOf(currentToggle) : -1;
      let targetIndex: number;
      if (currentIndex === -1) {
        targetIndex = direction === 1 ? 0 : toggles.length - 1;
      } else {
        targetIndex = currentIndex + direction;
        if (targetIndex < 0 || targetIndex >= toggles.length) return;
      }
      const targetSection = toggles[targetIndex].closest("section");
      const firstLink = targetSection?.querySelector<HTMLElement>(".grid a");
      const target = firstLink ?? toggles[targetIndex];
      focusVisible(target);
      target.scrollIntoView({ block: "center", behavior: "smooth" });
    },
    [isActionBlocked],
  );

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

  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (!(e.target as HTMLElement).closest('a, button, input, [role="listbox"]')) {
        e.preventDefault();
        if (focusAnchorReference.current) focusVisible(focusAnchorReference.current, true);
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, []);

  const allPlatforms = [...new Set(games.map((g) => g.platform))].sort();

  // Merge saved order with any new platforms (new ones go at the end)
  const platforms = [
    ...platformOrder.filter((p) => allPlatforms.includes(p)),
    ...allPlatforms.filter((p) => !platformOrder.includes(p)),
  ];

  const filtered = games.filter((g) => {
    if (selectedPlatforms.size > 0 && !selectedPlatforms.has(g.platform)) return false;
    return true;
  });

  // Close dropdown on outside click
  useEffect(() => {
    if (!platformDropdownOpen) return;
    function handleClick(e: MouseEvent) {
      if (!platformDropdownReference.current?.contains(e.target as Node)) {
        setPlatformDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [platformDropdownOpen]);

  function movePlatform(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= platforms.length) return;
    const newOrder = [...platforms];
    [newOrder[index], newOrder[target]] = [newOrder[target], newOrder[index]];
    setPlatformOrder(newOrder);
    localStorage.setItem("library-platform-order", JSON.stringify(newOrder));
  }

  const sorted =
    view === "list"
      ? [...filtered].sort((a, b) => {
          const dir = sortDir === "asc" ? 1 : -1;
          switch (sortBy) {
            case "platform": {
              return dir * a.platform.localeCompare(b.platform);
            }
            case "title": {
              return dir * a.title.localeCompare(b.title);
            }
            case "year": {
              return dir * ((a.releaseYear ?? 0) - (b.releaseYear ?? 0));
            }
            case "size": {
              return dir * (a.sizeBytes - b.sizeBytes);
            }
            default: {
              return 0;
            }
          }
        })
      : filtered;

  const grouped =
    view === "grouped"
      ? platforms.reduce<Record<string, Game[]>>((accumulator, p) => {
          const games = filtered.filter((g) => g.platform === p);
          if (games.length > 0) accumulator[p] = games;
          return accumulator;
        }, {})
      : {};

  // Restore focus to previously selected game, or focus anchor (on mount only)
  useEffect(() => {
    if (isLoading) return;
    const gameId = lastFocusedGameId;
    lastFocusedGameId = null;
    if (gameId && filtered.length > 0) {
      requestAnimationFrame(() => {
        const link = gridReference.current?.querySelector<HTMLElement>(
          `[data-game-id="${gameId}"]`,
        );
        if (link) {
          focusVisible(link);
          link.scrollIntoView({ block: "center" });
        } else {
          if (focusAnchorReference.current) focusVisible(focusAnchorReference.current, true);
        }
      });
      return;
    }
    if (focusAnchorReference.current) focusVisible(focusAnchorReference.current, true);
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  return (
    <main className="max-w-7xl mx-auto px-6 py-8 flex-1 flex flex-col w-full">
      {/* Toolbar */}
      <div
        ref={toolbarReference}
        className="flex gap-3 mb-8 items-center"
        onKeyDown={handleToolbarKeyDown}
      >
        <div className="relative min-w-40" ref={platformDropdownReference}>
          <button
            onClick={() => setPlatformDropdownOpen((v) => !v)}
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
              {platforms.map((p, index) => (
                <div
                  key={p}
                  className="flex items-center gap-2 px-4 py-2 hover:bg-surface-raised transition-colors cursor-pointer"
                  onClick={() => {
                    setSelectedPlatforms((previous) => {
                      const next = new Set(previous);
                      if (next.has(p)) next.delete(p);
                      else next.add(p);
                      localStorage.setItem("library-platforms", JSON.stringify([...next]));
                      return next;
                    });
                  }}
                >
                  <div
                    className={`w-3.5 h-3.5 rounded border shrink-0 flex items-center justify-center transition-colors ${selectedPlatforms.has(p) ? "bg-accent border-accent" : "border-border"}`}
                  >
                    {selectedPlatforms.has(p) && (
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
                  <span className="flex-1">{formatPlatform(p)}</span>
                  {view === "grouped" && (
                    <div className="flex flex-col -my-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
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
                        onClick={(e) => {
                          e.stopPropagation();
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
        <div className="flex rounded-lg border border-border overflow-hidden ml-auto">
          <button
            onClick={() => {
              setView("grid");
              localStorage.setItem("library-view", "grid");
            }}
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
            onClick={() => {
              setView("grouped");
              localStorage.setItem("library-view", "grouped");
            }}
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
            onClick={() => {
              setView("list");
              localStorage.setItem("library-view", "list");
            }}
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

      {/* Game count */}
      {!isLoading && (
        <p className="text-xs text-text-muted mb-4 font-mono">
          {filtered.length} {filtered.length === 1 ? "game" : "games"}
          {selectedPlatforms.size === 1 && ` in ${formatPlatform([...selectedPlatforms][0])}`}
          {selectedPlatforms.size > 1 && ` across ${selectedPlatforms.size} platforms`}
        </p>
      )}

      {/* Focus anchor for keyboard/gamepad navigation */}
      <div
        ref={focusAnchorReference}
        tabIndex={0}
        className="outline-none h-0 overflow-hidden"
        onKeyDown={handleFocusAnchorKeyDown}
      />

      {/* Games */}
      {isLoading ? (
        view === "grid" || view === "grouped" ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-5">
            {Array.from({ length: 12 }).map((_, index) => (
              <div key={index} className="animate-pulse">
                <div className="aspect-2/3 bg-surface-raised rounded-lg mb-2" />
                <div className="h-3 bg-surface-raised rounded w-3/4 mb-1.5" />
                <div className="h-2.5 bg-surface-raised rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-1 animate-pulse">
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={index} className="h-12 bg-surface-raised rounded-lg" />
            ))}
          </div>
        )
      ) : filtered.length === 0 ? (
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
      ) : view === "grid" ? (
        <div
          ref={gridReference}
          onKeyDown={handleGridKeyDown}
          onClick={(event) => saveGridFocus(event.target)}
          className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-5"
        >
          {filtered.map((game) => (
            <GameCard key={game.id} game={game} onPreviewStart={handleGamePreviewStart} />
          ))}
        </div>
      ) : view === "grouped" ? (
        <div
          ref={gridReference}
          onKeyDown={handleGridKeyDown}
          onClick={(event) => saveGridFocus(event.target)}
        >
          {Object.entries(grouped).map(([p, games]) => (
            <section key={p} className="mb-10">
              <button
                data-group-toggle={p}
                onClick={() =>
                  setCollapsedGroups((previous) => {
                    const next = new Set(previous);
                    if (next.has(p)) next.delete(p);
                    else next.add(p);
                    localStorage.setItem("library-collapsed", JSON.stringify([...next]));
                    return next;
                  })
                }
                className="flex items-center gap-2 text-lg font-semibold text-text-primary mb-4 hover:text-accent transition-colors outline-none focus-visible:text-accent focus-visible:ring-2 focus-visible:ring-focus-ring/50 focus-visible:ring-offset-4 focus-visible:ring-offset-surface rounded px-1 -ml-1"
              >
                <svg
                  className={`w-4 h-4 transition-transform ${collapsedGroups.has(p) ? "-rotate-90" : ""}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M19.5 8.25l-7.5 7.5-7.5-7.5"
                  />
                </svg>
                {formatPlatform(p)}
                <span className="text-text-muted font-normal text-sm">({games.length})</span>
              </button>
              {!collapsedGroups.has(p) && (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-5">
                  {games.map((game) => (
                    <GameCard key={game.id} game={game} onPreviewStart={handleGamePreviewStart} />
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      ) : (
        <div
          ref={gridReference}
          onKeyDown={handleGridKeyDown}
          onClick={(event) => saveGridFocus(event.target)}
        >
          <table className="w-full text-sm table-fixed">
            <colgroup>
              <col className="w-25" />
              <col />
              <col className="w-17.5 hidden md:table-column" />
              <col className="w-50 hidden lg:table-column" />
              <col className="w-22.5 hidden sm:table-column" />
              <col className="w-10" />
            </colgroup>
            <thead>
              <tr className="border-b border-border text-left text-xs text-text-muted tracking-wider">
                {(
                  [
                    { col: "platform" as const, className: "pl-3 pr-4" },
                    { col: "title" as const, className: "pr-4" },
                    {
                      col: "year" as const,
                      className: "pr-4 hidden md:table-cell",
                    },
                  ] as const
                ).map(({ col, className }) => (
                  <th key={col} className={`pb-2 ${className} font-medium`}>
                    <button
                      onClick={() => toggleSort(col)}
                      className="hover:text-text-primary transition-colors inline-flex items-center gap-1"
                    >
                      {col.charAt(0).toUpperCase() + col.slice(1)}
                      {sortBy === col && <span>{sortDir === "asc" ? "\u2191" : "\u2193"}</span>}
                    </button>
                  </th>
                ))}
                <th className="pb-2 pr-4 font-medium hidden lg:table-cell">Genre</th>
                <th className="pb-2 pr-3 text-right font-medium hidden sm:table-cell">
                  <button
                    onClick={() => toggleSort("size")}
                    className="hover:text-text-primary transition-colors inline-flex items-center gap-1 ml-auto"
                  >
                    Size
                    {sortBy === "size" && <span>{sortDir === "asc" ? "\u2191" : "\u2193"}</span>}
                  </button>
                </th>
                <th className="pb-2 pr-3"></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((game) => (
                <tr
                  key={game.id}
                  onClick={() => {
                    saveFocusedGameId(game.id);
                    void navigate(`/games/${game.id}`);
                  }}
                  onMouseEnter={() => preloadHeaderImage(game.heroUrl)}
                  className="border-b border-border/50 hover:bg-surface-raised/50 transition-colors cursor-pointer"
                >
                  <td className="py-2.5 pl-3 pr-4 text-text-secondary truncate">
                    {formatPlatform(game.platform)}
                  </td>
                  <td className="py-2.5 pr-4 truncate">
                    <Link
                      to={`/games/${game.id}`}
                      data-game-id={game.id}
                      onFocus={() => preloadHeaderImage(game.heroUrl)}
                      className={`font-medium hover:text-accent transition-colors outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-1 focus-visible:ring-offset-(--bg) rounded-sm ${game.isMissing ? "opacity-50" : ""}`}
                    >
                      {game.title}
                    </Link>
                  </td>
                  <td className="py-2.5 pr-4 text-text-secondary hidden md:table-cell">
                    {game.releaseYear ?? ""}
                  </td>
                  <td className="py-2.5 pr-4 text-text-secondary truncate hidden lg:table-cell">
                    {game.genre ?? ""}
                  </td>
                  <td className="py-2.5 pr-3 text-right text-text-secondary font-mono text-xs hidden sm:table-cell">
                    {formatSize(game.sizeBytes)}
                  </td>
                  <td className="py-2.5 pr-3 text-right">
                    {!game.isMissing && (
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          const { ticket } = await api.post<{ ticket: string }>(
                            `/games/${game.id}/download-ticket`,
                          );
                          const a = document.createElement("a");
                          a.href = `/api/games/${game.id}/download?ticket=${encodeURIComponent(ticket)}`;
                          a.download = "";
                          document.body.append(a);
                          a.click();
                          a.remove();
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
