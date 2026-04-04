import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router";
import { api } from "../api/client";
import type { LastPlayedGame } from "../hooks/guide-types";
import { useGamepadEvent, useShortcut } from "../hooks/use-shortcut";
import { sounds } from "../utils/sounds";
import AccountIcon from "./icons/account-icon";
import ClaudioIcon from "./icons/claudio-icon";
import CloseIcon from "./icons/close-icon";
import FullscreenIcon from "./icons/fullscreen-icon";
import GamepadIcon from "./icons/gamepad-icon";
import LibraryIcon from "./icons/library-icon";
import LoadingSpinner from "./icons/loading-spinner";
import PlayIcon from "./icons/play-icon";
import PlusIcon from "./icons/plus-icon";
import QuitIcon from "./icons/quit-icon";
import SettingsIcon from "./icons/settings-icon";
import SaveSlotCard from "./save-slot-card";

interface SaveStateDto {
  id: number;
  gameId: number;
  screenshotUrl: string;
  createdAt: string;
}

interface GuideOverlayProperties {
  open: boolean;
  gameName: string;
  gameId: number | null;
  hasActiveGame: boolean;
  lastPlayed: LastPlayedGame | null;
  onClose: () => void;
  onResumeGame: () => void;
  onQuitGame: () => void;
  onRequestSaveState: () => void;
  onLoadState: (stateData: ArrayBuffer) => void;
}

const ANIM_DURATION = 220;

type TabId = "home" | "nowplaying";

interface MenuItem {
  id: string;
  label: string;
  icon: React.FC<{ className?: string }>;
  action: () => void;
}

export default function GuideOverlay({
  open,
  gameName,
  gameId,
  hasActiveGame,
  lastPlayed,
  onClose,
  onResumeGame,
  onQuitGame,
  onRequestSaveState,
  onLoadState,
}: GuideOverlayProperties) {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

  function openAccountDialog() {
    globalThis.dispatchEvent(new CustomEvent("claudio:open-account"));
  }
  const [visible, setVisible] = useState(false);
  const [animState, setAnimState] = useState<"entering" | "open" | "exiting" | "closed">("closed");
  const [activeTab, setActiveTab] = useState<TabId>("home");
  const [tabDir, setTabDir] = useState<"left" | "right">("right");
  const [focusZone, setFocusZone] = useState<"tabs" | "menu" | "savestates" | "toolbar">("menu");
  const [focusIndex, setFocusIndex] = useState(0);
  const [tabFocusIndex, setTabFocusIndex] = useState(0);
  const [toolbarFocusIndex, setToolbarFocusIndex] = useState(0);
  const panelReference = useRef<HTMLDivElement>(null);
  const itemReferences = useRef<(HTMLButtonElement | null)[]>([]);
  const tabReferences = useRef<(HTMLButtonElement | null)[]>([]);
  const toolbarReferences = useRef<(HTMLButtonElement | null)[]>([]);
  const [portalTarget, setPortalTarget] = useState<Element | null>(null);

  // Track fullscreen changes to portal into the fullscreened element
  useEffect(() => {
    function update() {
      setPortalTarget(document.fullscreenElement ?? null);
    }
    update();
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);

  const tabs = useMemo<{ id: TabId; icon: React.FC<{ className?: string }> }[]>(
    () => [
      { id: "home", icon: ClaudioIcon },
      { id: "nowplaying", icon: GamepadIcon },
    ],
    [],
  );

  function switchTab(tabId: TabId) {
    const currentIndex = tabs.findIndex((t) => t.id === activeTab);
    const nextIndex = tabs.findIndex((t) => t.id === tabId);
    setTabDir(nextIndex > currentIndex ? "right" : "left");
    setActiveTab(tabId);
    setFocusZone("menu");
    setFocusIndex(0);
    void sounds.navigate();
  }

  function navigateTo(path: string) {
    void sounds.navigate();
    onClose();
    if (location.pathname !== path) {
      void navigate(path);
    }
  }

  const homeItems: MenuItem[] = [
    {
      id: "library",
      label: "Library",
      icon: LibraryIcon,
      action: () => navigateTo("/"),
    },
    {
      id: "account",
      label: "Account",
      icon: AccountIcon,
      action: () => {
        void sounds.navigate();
        onClose();
        openAccountDialog();
      },
    },
  ];

  const nowPlayingItems: MenuItem[] = hasActiveGame
    ? [
        {
          id: "resume",
          label: "Resume Game",
          icon: PlayIcon,
          action: () => {
            void sounds.back();
            onResumeGame();
          },
        },
        {
          id: "quit",
          label: "Close Game",
          icon: QuitIcon,
          action: () => {
            void sounds.back();
            onQuitGame();
          },
        },
      ]
    : lastPlayed
      ? [
          {
            id: "play",
            label: "Play",
            icon: PlayIcon,
            action: () => navigateTo(`/games/${lastPlayed.gameId}/play`),
          },
        ]
      : [];

  const items = activeTab === "nowplaying" ? nowPlayingItems : homeItems;

  // ── Save states ──
  const { data: saveStates } = useQuery({
    queryKey: ["saveStates", gameId],
    queryFn: () => api.get<SaveStateDto[]>(`/games/${gameId}/save-states`),
    enabled: hasActiveGame && gameId !== null && open,
  });

  const hasSaveStatesSection = activeTab === "nowplaying" && hasActiveGame;
  // Total navigable save slots: existing saves + 1 "New Save" button
  const saveSlotCount = hasSaveStatesSection ? (saveStates?.length ?? 0) + 1 : 0;

  const [savingState, setSavingState] = useState(false);
  const [loadingSlotId, setLoadingSlotId] = useState<number | null>(null);
  const [saveSlotFocusIndex, setSaveSlotFocusIndex] = useState(0);
  const [expandedSlotIndex, setExpandedSlotIndex] = useState<number | null>(null);
  const [actionFocusIndex, setActionFocusIndex] = useState(0);
  const saveSlotReferences = useRef<(HTMLButtonElement | null)[]>([]);

  const [overwriteSlotId, setOverwriteSlotId] = useState<number | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (saveId: number) => api.delete(`/games/${gameId}/save-states/${saveId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["saveStates", gameId] });
    },
  });

  // Listen for save state data from iframe
  useEffect(() => {
    if (!savingState || !gameId) return;

    function handleMessage(event: MessageEvent) {
      if (event.data?.type !== "claudio:stateData") return;

      const stateBlob = new Blob([new Uint8Array(event.data.state)], {
        type: "application/octet-stream",
      });
      const screenshotBlob = new Blob([new Uint8Array(event.data.screenshot)], {
        type: "image/png",
      });

      const isOverwrite = overwriteSlotId !== null;
      const path = isOverwrite
        ? `/games/${gameId}/save-states/${overwriteSlotId}`
        : `/games/${gameId}/save-states`;

      void api
        .uploadBinary<SaveStateDto>(
          path,
          {
            state: stateBlob,
            screenshot: screenshotBlob,
          },
          isOverwrite ? "PUT" : "POST",
        )
        .then(() => {
          void queryClient.invalidateQueries({
            queryKey: ["saveStates", gameId],
          });
        })
        .finally(() => {
          setSavingState(false);
          setOverwriteSlotId(null);
        });
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [savingState, gameId, queryClient, overwriteSlotId]);

  const handleSaveState = useCallback(() => {
    setSavingState(true);
    onRequestSaveState();
  }, [onRequestSaveState]);

  const handleLoadState = useCallback(
    async (saveId: number) => {
      if (!gameId) return;
      setLoadingSlotId(saveId);
      try {
        const stateData = await api.getBinary(`/games/${gameId}/save-states/${saveId}/state`);
        onLoadState(stateData);
        onClose();
      } finally {
        setLoadingSlotId(null);
      }
    },
    [gameId, onLoadState, onClose],
  );

  const handleOverwriteState = useCallback(
    (saveId: number) => {
      setOverwriteSlotId(saveId);
      setSavingState(true);
      onRequestSaveState();
    },
    [onRequestSaveState],
  );

  const handleDeleteState = useCallback(
    (saveId: number) => {
      deleteMutation.mutate(saveId);
    },
    [deleteMutation],
  );

  // Handle open/close transitions (adjusting state during render pattern)
  const [previousOpen, setPreviousOpen] = useState(false);
  if (open !== previousOpen) {
    setPreviousOpen(open);
    if (open) {
      setVisible(true);
      setAnimState("entering");
      setActiveTab(hasActiveGame ? "nowplaying" : "home");
      setFocusZone("menu");
      setFocusIndex(0);
      setTabFocusIndex(0);
      setToolbarFocusIndex(0);
      setExpandedSlotIndex(null);
    } else {
      setAnimState("exiting");
    }
  }

  // Timers for animation state transitions
  useEffect(() => {
    if (animState === "entering") {
      const timer = setTimeout(() => setAnimState("open"), 250);
      return () => clearTimeout(timer);
    } else if (animState === "exiting") {
      const timer = setTimeout(() => {
        setAnimState("closed");
        setVisible(false);
      }, ANIM_DURATION);
      return () => clearTimeout(timer);
    }
  }, [animState]);

  // Focus first menu item when entering or switching tabs
  useEffect(() => {
    if (animState === "entering" || animState === "open") {
      requestAnimationFrame(() => {
        itemReferences.current[0]?.focus({
          focusVisible: true,
        } as FocusOptions);
      });
    }
    // Only run on initial open and tab switches, not on every focus zone change
  }, [animState, activeTab]);

  const focusItem = useCallback(
    (index: number) => {
      const clamped = Math.max(0, Math.min(items.length - 1, index));
      setFocusIndex(clamped);
      itemReferences.current[clamped]?.focus({
        focusVisible: true,
      } as FocusOptions);
      void sounds.navigate();
    },
    [items.length],
  );

  // The tab bar includes tab buttons + the close button at the end
  const tabBarLength = tabs.length + 1; // +1 for close button

  const focusTabItem = useCallback(
    (index: number) => {
      const clamped = Math.max(0, Math.min(tabBarLength - 1, index));
      setTabFocusIndex(clamped);
      tabReferences.current[clamped]?.focus({
        focusVisible: true,
      } as FocusOptions);
      void sounds.navigate();
    },
    [tabBarLength],
  );

  const focusToolbarItem = useCallback((index: number) => {
    const count = toolbarReferences.current.filter(Boolean).length;
    const clamped = Math.max(0, Math.min(count - 1, index));
    setToolbarFocusIndex(clamped);
    toolbarReferences.current[clamped]?.focus({
      focusVisible: true,
    } as FocusOptions);
    void sounds.navigate();
  }, []);

  const focusSaveSlot = useCallback(
    (index: number) => {
      const clamped = Math.max(0, Math.min(saveSlotCount - 1, index));
      setSaveSlotFocusIndex(clamped);
      setExpandedSlotIndex(null);
      saveSlotReferences.current[clamped]?.focus({
        focusVisible: true,
      } as FocusOptions);
      void sounds.navigate();
    },
    [saveSlotCount],
  );

  // Keyboard navigation for the guide overlay (capture phase to intercept before other handlers)
  useShortcut(
    "escape",
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (expandedSlotIndex === null) {
        onClose();
      } else {
        setExpandedSlotIndex(null);
      }
    },
    { enabled: open, capture: true },
  );

  useShortcut(
    "arrowup",
    (e) => {
      e.preventDefault();
      switch (focusZone) {
        case "menu": {
          if (focusIndex === 0) {
            setFocusZone("tabs");
            const tabIndex = tabs.findIndex((t) => t.id === activeTab);
            setTabFocusIndex(Math.max(tabIndex, 0));
            tabReferences.current[Math.max(tabIndex, 0)]?.focus({
              focusVisible: true,
            } as FocusOptions);
            void sounds.navigate();
          } else {
            focusItem(focusIndex - 1);
          }

          break;
        }
        case "savestates": {
          if (expandedSlotIndex !== null) {
            setExpandedSlotIndex(null);
            return;
          }
          // Move up a row (subtract 2 for 2-col grid), or exit to menu
          const newIndex = saveSlotFocusIndex - 2;
          if (newIndex >= 0) {
            focusSaveSlot(newIndex);
          } else {
            setFocusZone("menu");
            const lastIndex = items.length - 1;
            setFocusIndex(lastIndex);
            itemReferences.current[lastIndex]?.focus({
              focusVisible: true,
            } as FocusOptions);
            void sounds.navigate();
          }

          break;
        }
        case "toolbar": {
          if (saveSlotCount > 0) {
            setFocusZone("savestates");
            const lastSlot = saveSlotCount - 1;
            setSaveSlotFocusIndex(lastSlot);
            saveSlotReferences.current[lastSlot]?.focus({
              focusVisible: true,
            } as FocusOptions);
            void sounds.navigate();
          } else {
            setFocusZone("menu");
            const lastIndex = items.length - 1;
            setFocusIndex(lastIndex);
            itemReferences.current[lastIndex]?.focus({
              focusVisible: true,
            } as FocusOptions);
            void sounds.navigate();
          }

          break;
        }
        // No default
      }
    },
    { enabled: open, capture: true },
  );

  useShortcut(
    "arrowdown",
    (e) => {
      e.preventDefault();
      switch (focusZone) {
        case "tabs": {
          setFocusZone("menu");
          setFocusIndex(0);
          itemReferences.current[0]?.focus({
            focusVisible: true,
          } as FocusOptions);
          void sounds.navigate();

          break;
        }
        case "menu": {
          if (focusIndex === items.length - 1) {
            if (saveSlotCount > 0) {
              setFocusZone("savestates");
              setSaveSlotFocusIndex(0);
              saveSlotReferences.current[0]?.focus({
                focusVisible: true,
              } as FocusOptions);
              void sounds.navigate();
            } else {
              setFocusZone("toolbar");
              setToolbarFocusIndex(0);
              toolbarReferences.current[0]?.focus({
                focusVisible: true,
              } as FocusOptions);
              void sounds.navigate();
            }
          } else {
            focusItem(focusIndex + 1);
          }

          break;
        }
        case "savestates": {
          if (expandedSlotIndex !== null) {
            setExpandedSlotIndex(null);
            return;
          }
          // Move down a row (add 2 for 2-col grid), or exit to toolbar
          const newIndex = saveSlotFocusIndex + 2;
          if (newIndex < saveSlotCount) {
            focusSaveSlot(newIndex);
          } else {
            setFocusZone("toolbar");
            setToolbarFocusIndex(0);
            toolbarReferences.current[0]?.focus({
              focusVisible: true,
            } as FocusOptions);
            void sounds.navigate();
          }

          break;
        }
        // No default
      }
    },
    { enabled: open, capture: true },
  );

  useShortcut(
    "arrowleft",
    (e) => {
      e.preventDefault();
      switch (focusZone) {
        case "tabs": {
          focusTabItem(tabFocusIndex - 1);

          break;
        }
        case "savestates": {
          if (expandedSlotIndex !== null) {
            setActionFocusIndex((previous) => Math.max(0, previous - 1));
            void sounds.navigate();
          } else if (saveSlotFocusIndex % 2 === 1) {
            focusSaveSlot(saveSlotFocusIndex - 1);
          }

          break;
        }
        case "toolbar": {
          focusToolbarItem(toolbarFocusIndex - 1);

          break;
        }
        // No default
      }
    },
    { enabled: open, capture: true },
  );

  useShortcut(
    "arrowright",
    (e) => {
      e.preventDefault();
      switch (focusZone) {
        case "tabs": {
          focusTabItem(tabFocusIndex + 1);

          break;
        }
        case "savestates": {
          if (expandedSlotIndex !== null) {
            setActionFocusIndex((previous) => Math.min(2, previous + 1));
            void sounds.navigate();
          } else if (saveSlotFocusIndex % 2 === 0 && saveSlotFocusIndex + 1 < saveSlotCount) {
            focusSaveSlot(saveSlotFocusIndex + 1);
          }

          break;
        }
        case "toolbar": {
          focusToolbarItem(toolbarFocusIndex + 1);

          break;
        }
        // No default
      }
    },
    { enabled: open, capture: true },
  );

  useShortcut(
    "enter",
    (e) => {
      e.preventDefault();
      switch (focusZone) {
        case "tabs": {
          if (tabFocusIndex >= tabs.length) {
            onClose();
          } else {
            const tab = tabs[tabFocusIndex];
            if (tab && tab.id !== activeTab) {
              switchTab(tab.id);
            }
          }

          break;
        }
        case "savestates": {
          if (expandedSlotIndex !== null) {
            // Execute the focused action
            const save = saveStates?.[expandedSlotIndex];
            if (save) {
              switch (actionFocusIndex) {
                case 0: {
                  void handleLoadState(save.id);
                  break;
                }
                case 1: {
                  handleOverwriteState(save.id);
                  break;
                }
                case 2: {
                  {
                    handleDeleteState(save.id);
                    // No default
                  }
                  break;
                }
              }
            }
            setExpandedSlotIndex(null);
          } else if (saveSlotFocusIndex === 0) {
            // "New Save" slot (first slot) — trigger save directly
            saveSlotReferences.current[0]?.click();
          } else {
            // Expand the action overlay for this existing save slot
            setExpandedSlotIndex(saveSlotFocusIndex - 1);
            setActionFocusIndex(0);
            void sounds.navigate();
          }

          break;
        }
        case "toolbar": {
          toolbarReferences.current[toolbarFocusIndex]?.click();

          break;
        }
        default: {
          items[focusIndex]?.action();
        }
      }
    },
    { enabled: open, capture: true },
  );

  const handleBumper = useCallback(
    (direction: 1 | -1) => {
      const currentIndex = tabs.findIndex((t) => t.id === activeTab);
      const nextIndex = (currentIndex + direction + tabs.length) % tabs.length;
      setTabDir(direction === 1 ? "right" : "left");
      setActiveTab(tabs[nextIndex].id);
      setFocusZone("menu");
      setFocusIndex(0);
      void sounds.navigate();
    },
    [tabs, activeTab],
  );

  useGamepadEvent("gamepad-rb", () => handleBumper(1), open);
  useGamepadEvent("gamepad-lb", () => handleBumper(-1), open);

  if (!visible) return null;

  const exiting = animState === "exiting";

  const overlay = (
    <div className="fixed inset-0 z-9999 flex">
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-black/80 backdrop-blur-sm transition-opacity ${exiting ? "opacity-0" : "opacity-100 animate-[fadeIn_200ms_ease-out]"}`}
        style={exiting ? { transitionDuration: `${ANIM_DURATION}ms` } : undefined}
        onClick={onClose}
      />

      {/* Panel + floating tabs */}
      <div
        className={`relative z-10 m-4 flex w-130 flex-col ${exiting ? "animate-[slideOutLeft_220ms_ease-in_forwards]" : "animate-[slideInLeft_250ms_cubic-bezier(0.16,1,0.3,1)]"}`}
      >
        {/* ── Floating tab bar (above the panel) ── */}
        <div className="flex items-center justify-center gap-2 px-2 pb-2">
          {tabs.map((tab, index) => (
            <button
              key={tab.id}
              ref={(element) => {
                tabReferences.current[index] = element;
              }}
              type="button"
              onClick={() => {
                switchTab(tab.id);
              }}
              className={`relative flex items-center justify-center rounded-xl p-3 transition-all duration-150 outline-none ${
                activeTab === tab.id
                  ? "bg-white/18 text-white shadow-[0_1px_8px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.15)] ring-1 ring-white/12"
                  : "text-white/40 hover:bg-white/10 hover:text-white/80 hover:shadow-[0_1px_6px_rgba(0,0,0,0.25),inset_0_1px_0_rgba(255,255,255,0.08)] hover:ring-1 hover:ring-white/8"
              } focus-visible:ring-2 focus-visible:ring-accent`}
            >
              <tab.icon className="h-6 w-6" />
            </button>
          ))}

          <div className="mx-1 h-5 w-px bg-white/10" />

          <button
            ref={(element) => {
              tabReferences.current[tabs.length] = element;
            }}
            type="button"
            onClick={onClose}
            className="flex items-center justify-center rounded-xl p-3 text-white/40 transition-all duration-150 outline-none hover:bg-white/10 hover:text-white/80 hover:shadow-[0_1px_6px_rgba(0,0,0,0.25),inset_0_1px_0_rgba(255,255,255,0.08)] hover:ring-1 hover:ring-white/8 focus-visible:ring-2 focus-visible:ring-accent"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        {/* ── Main panel body ── */}
        <div
          ref={panelReference}
          className="flex flex-1 flex-col overflow-hidden rounded-2xl bg-white/6 shadow-[0_8px_80px_rgba(0,0,0,0.6)] ring-1 ring-white/8 backdrop-blur-2xl"
        >
          {/* Animated tab content */}
          <div
            key={activeTab}
            className={`flex flex-1 flex-col overflow-hidden ${tabDir === "right" ? "animate-[slideInFromRight_200ms_cubic-bezier(0.16,1,0.3,1)]" : "animate-[slideInFromLeft_200ms_cubic-bezier(0.16,1,0.3,1)]"}`}
          >
            {/* ── Game card (Now Playing tab) ── */}
            {activeTab === "nowplaying" && (hasActiveGame || lastPlayed) && (
              <div className="flex flex-col items-center border-b border-white/6 px-8 py-8">
                {lastPlayed?.coverUrl ? (
                  <img
                    src={lastPlayed.coverUrl}
                    alt={lastPlayed.gameName}
                    className="h-50 w-50 rounded-2xl object-cover ring-1 ring-white/8"
                  />
                ) : (
                  <div className="flex h-50 w-50 items-center justify-center rounded-2xl bg-white/6 ring-1 ring-white/8">
                    <GamepadIcon className="h-20 w-20 text-accent" />
                  </div>
                )}
                <p className="mt-4 text-sm text-white/50">
                  {hasActiveGame ? "Now Playing" : "Last Played"}
                </p>
                <p className="mt-1 text-center text-xl font-semibold text-white">
                  {hasActiveGame ? gameName : lastPlayed?.gameName}
                </p>
              </div>
            )}

            {/* ── Menu items ── */}
            <div className="flex-1 overflow-y-auto p-8 flex flex-col gap-2">
              <nav className="flex flex-col gap-2">
                {items.map((item, index) => (
                  <button
                    key={item.id}
                    ref={(element) => {
                      itemReferences.current[index] = element;
                    }}
                    type="button"
                    onClick={item.action}
                    onMouseEnter={() => {
                      setFocusIndex(index);
                      itemReferences.current[index]?.focus({
                        focusVisible: true,
                      } as FocusOptions);
                    }}
                    className="group flex w-full items-center gap-5 rounded-xl px-5 py-4 text-[17px] font-normal text-white/80 transition-colors outline-none hover:bg-white/6 hover:text-white focus-visible:bg-white/8 focus-visible:text-white"
                  >
                    <item.icon className="h-6 w-6 shrink-0 text-white/50 transition-colors group-hover:text-white/70 group-focus-visible:text-accent" />
                    {item.label}
                  </button>
                ))}
              </nav>

              {/* ── Save States grid (Now Playing tab only) ── */}
              {activeTab === "nowplaying" && hasActiveGame && (
                <div className="mt-4 border-t border-white/6 pt-4">
                  <p className="mb-3 px-1 text-xs font-medium uppercase tracking-[0.18em] text-white/40">
                    Save States
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    {/* New save slot button (always first) */}
                    <button
                      ref={(element) => {
                        saveSlotReferences.current[0] = element;
                      }}
                      type="button"
                      disabled={savingState}
                      onClick={handleSaveState}
                      onMouseEnter={() => {
                        setFocusZone("savestates");
                        setSaveSlotFocusIndex(0);
                      }}
                      onFocus={() => {
                        setFocusZone("savestates");
                        setSaveSlotFocusIndex(0);
                      }}
                      className="group flex aspect-video flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/10 bg-white/3 text-white/40 transition-all outline-none hover:border-white/20 hover:bg-white/6 hover:text-white/60 focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
                    >
                      {savingState ? (
                        <LoadingSpinner className="h-5 w-5" />
                      ) : (
                        <PlusIcon className="h-5 w-5" />
                      )}
                      <span className="text-xs font-medium">
                        {savingState ? "Saving\u2026" : "New Save"}
                      </span>
                    </button>
                    {(saveStates ?? []).map((save, index) => (
                      <SaveSlotCard
                        key={save.id}
                        ref={(element) => {
                          saveSlotReferences.current[index + 1] = element;
                        }}
                        screenshotUrl={save.screenshotUrl}
                        createdAt={save.createdAt}
                        isLoading={loadingSlotId === save.id}
                        isExpanded={expandedSlotIndex === index}
                        activeActionIndex={expandedSlotIndex === index ? actionFocusIndex : 0}
                        onToggleExpand={() => {
                          setExpandedSlotIndex((previous) => (previous === index ? null : index));
                          setActionFocusIndex(0);
                        }}
                        onCollapse={() => setExpandedSlotIndex(null)}
                        onSave={() => handleOverwriteState(save.id)}
                        onLoad={() => handleLoadState(save.id)}
                        onDelete={() => handleDeleteState(save.id)}
                        onMouseEnter={() => {
                          setFocusZone("savestates");
                          setSaveSlotFocusIndex(index + 1);
                        }}
                        onFocus={() => {
                          setFocusZone("savestates");
                          setSaveSlotFocusIndex(index + 1);
                        }}
                        onActionHover={(index) => setActionFocusIndex(index)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
          {/* end animated tab content */}

          {/* ── Bottom toolbar (icon buttons like Xbox) ── */}
          <div className="flex items-center border-t border-white/6 px-4 py-3">
            <div className="flex-1" />
            <button
              ref={(element) => {
                toolbarReferences.current[0] = element;
              }}
              type="button"
              onClick={() => {
                if (document.fullscreenElement) {
                  void document.exitFullscreen();
                } else {
                  void document.documentElement.requestFullscreen();
                }
              }}
              className="rounded-lg p-2.5 text-white/40 transition-colors outline-none hover:bg-white/6 hover:text-white/70 focus-visible:ring-2 focus-visible:ring-accent"
              title="Toggle Fullscreen"
            >
              <FullscreenIcon className="h-5 w-5" />
            </button>
            <div className="mx-3 h-5 w-px bg-white/8" />
            <button
              ref={(element) => {
                toolbarReferences.current[1] = element;
              }}
              type="button"
              onClick={() => {
                void sounds.navigate();
                onClose();
                openAccountDialog();
              }}
              className="rounded-lg p-2.5 text-white/40 transition-colors outline-none hover:bg-white/6 hover:text-white/70 focus-visible:ring-2 focus-visible:ring-accent"
              title="Settings"
            >
              <SettingsIcon className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return portalTarget ? createPortal(overlay, portalTarget) : overlay;
}
