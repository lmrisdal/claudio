import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router";
import type { LastPlayedGame } from "../hooks/guideTypes";
import { useGamepadEvent, useShortcut } from "../hooks/useShortcut";
import { sounds } from "../utils/sounds";

interface GuideOverlayProps {
  open: boolean;
  gameName: string;
  hasActiveGame: boolean;
  lastPlayed: LastPlayedGame | null;
  onClose: () => void;
  onResumeGame: () => void;
  onQuitGame: () => void;
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
  hasActiveGame,
  lastPlayed,
  onClose,
  onResumeGame,
  onQuitGame,
}: GuideOverlayProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [visible, setVisible] = useState(false);
  const [animState, setAnimState] = useState<
    "entering" | "open" | "exiting" | "closed"
  >("closed");
  const [activeTab, setActiveTab] = useState<TabId>("home");
  const [tabDir, setTabDir] = useState<"left" | "right">("right");
  const [focusZone, setFocusZone] = useState<"tabs" | "menu" | "toolbar">(
    "menu",
  );
  const [focusIndex, setFocusIndex] = useState(0);
  const [tabFocusIndex, setTabFocusIndex] = useState(0);
  const [toolbarFocusIndex, setToolbarFocusIndex] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const toolbarRefs = useRef<(HTMLButtonElement | null)[]>([]);
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
    const currentIdx = tabs.findIndex((t) => t.id === activeTab);
    const nextIdx = tabs.findIndex((t) => t.id === tabId);
    setTabDir(nextIdx > currentIdx ? "right" : "left");
    setActiveTab(tabId);
    setFocusZone("menu");
    setFocusIndex(0);
    sounds.navigate();
  }

  function navigateTo(path: string) {
    sounds.navigate();
    onClose();
    if (location.pathname !== path) {
      navigate(path);
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
      action: () => navigateTo("/account"),
    },
  ];

  const nowPlayingItems: MenuItem[] = hasActiveGame
    ? [
        {
          id: "resume",
          label: "Resume Game",
          icon: PlayIcon,
          action: () => {
            sounds.back();
            onResumeGame();
          },
        },
        {
          id: "quit",
          label: "Close Game",
          icon: QuitIcon,
          action: () => {
            sounds.back();
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

  // Handle open/close transitions (adjusting state during render pattern)
  const [prevOpen, setPrevOpen] = useState(false);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setVisible(true);
      setAnimState("entering");
      setActiveTab(hasActiveGame ? "nowplaying" : "home");
      setFocusZone("menu");
      setFocusIndex(0);
      setTabFocusIndex(0);
      setToolbarFocusIndex(0);
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
        itemRefs.current[0]?.focus({
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
      itemRefs.current[clamped]?.focus({ focusVisible: true } as FocusOptions);
      sounds.navigate();
    },
    [items.length],
  );

  // The tab bar includes tab buttons + the close button at the end
  const tabBarLength = tabs.length + 1; // +1 for close button

  const focusTabItem = useCallback(
    (index: number) => {
      const clamped = Math.max(0, Math.min(tabBarLength - 1, index));
      setTabFocusIndex(clamped);
      tabRefs.current[clamped]?.focus({ focusVisible: true } as FocusOptions);
      sounds.navigate();
    },
    [tabBarLength],
  );

  const focusToolbarItem = useCallback((index: number) => {
    const count = toolbarRefs.current.filter(Boolean).length;
    const clamped = Math.max(0, Math.min(count - 1, index));
    setToolbarFocusIndex(clamped);
    toolbarRefs.current[clamped]?.focus({ focusVisible: true } as FocusOptions);
    sounds.navigate();
  }, []);

  // Keyboard navigation for the guide overlay (capture phase to intercept before other handlers)
  useShortcut(
    "escape",
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    },
    { enabled: open, capture: true },
  );

  useShortcut(
    "arrowup",
    (e) => {
      e.preventDefault();
      if (focusZone === "menu") {
        if (focusIndex === 0) {
          setFocusZone("tabs");
          const tabIdx = tabs.findIndex((t) => t.id === activeTab);
          setTabFocusIndex(tabIdx >= 0 ? tabIdx : 0);
          tabRefs.current[tabIdx >= 0 ? tabIdx : 0]?.focus({
            focusVisible: true,
          } as FocusOptions);
          sounds.navigate();
        } else {
          focusItem(focusIndex - 1);
        }
      } else if (focusZone === "toolbar") {
        setFocusZone("menu");
        const lastIdx = items.length - 1;
        setFocusIndex(lastIdx);
        itemRefs.current[lastIdx]?.focus({
          focusVisible: true,
        } as FocusOptions);
        sounds.navigate();
      }
    },
    { enabled: open, capture: true },
  );

  useShortcut(
    "arrowdown",
    (e) => {
      e.preventDefault();
      if (focusZone === "tabs") {
        setFocusZone("menu");
        setFocusIndex(0);
        itemRefs.current[0]?.focus({
          focusVisible: true,
        } as FocusOptions);
        sounds.navigate();
      } else if (focusZone === "menu") {
        if (focusIndex === items.length - 1) {
          setFocusZone("toolbar");
          setToolbarFocusIndex(0);
          toolbarRefs.current[0]?.focus({
            focusVisible: true,
          } as FocusOptions);
          sounds.navigate();
        } else {
          focusItem(focusIndex + 1);
        }
      }
    },
    { enabled: open, capture: true },
  );

  useShortcut(
    "arrowleft",
    (e) => {
      e.preventDefault();
      if (focusZone === "tabs") {
        focusTabItem(tabFocusIndex - 1);
      } else if (focusZone === "toolbar") {
        focusToolbarItem(toolbarFocusIndex - 1);
      }
    },
    { enabled: open, capture: true },
  );

  useShortcut(
    "arrowright",
    (e) => {
      e.preventDefault();
      if (focusZone === "tabs") {
        focusTabItem(tabFocusIndex + 1);
      } else if (focusZone === "toolbar") {
        focusToolbarItem(toolbarFocusIndex + 1);
      }
    },
    { enabled: open, capture: true },
  );

  useShortcut(
    "enter",
    (e) => {
      e.preventDefault();
      if (focusZone === "tabs") {
        if (tabFocusIndex >= tabs.length) {
          onClose();
        } else {
          const tab = tabs[tabFocusIndex];
          if (tab && tab.id !== activeTab) {
            switchTab(tab.id);
          }
        }
      } else if (focusZone === "toolbar") {
        toolbarRefs.current[toolbarFocusIndex]?.click();
      } else {
        items[focusIndex]?.action();
      }
    },
    { enabled: open, capture: true },
  );

  const handleBumper = useCallback(
    (direction: 1 | -1) => {
      const currentIdx = tabs.findIndex((t) => t.id === activeTab);
      const nextIdx = (currentIdx + direction + tabs.length) % tabs.length;
      setTabDir(direction === 1 ? "right" : "left");
      setActiveTab(tabs[nextIdx].id);
      setFocusZone("menu");
      setFocusIndex(0);
      sounds.navigate();
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
        style={
          exiting ? { transitionDuration: `${ANIM_DURATION}ms` } : undefined
        }
        onClick={onClose}
      />

      {/* Panel + floating tabs */}
      <div
        className={`relative z-10 m-4 flex w-130 flex-col ${exiting ? "animate-[slideOutLeft_220ms_ease-in_forwards]" : "animate-[slideInLeft_250ms_cubic-bezier(0.16,1,0.3,1)]"}`}
      >
        {/* ── Floating tab bar (above the panel) ── */}
        <div className="flex items-center justify-center gap-2 px-2 pb-2">
          {tabs.map((tab, i) => (
            <button
              key={tab.id}
              ref={(el) => {
                tabRefs.current[i] = el;
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
            ref={(el) => {
              tabRefs.current[tabs.length] = el;
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
          ref={panelRef}
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
            <nav className="flex-1 overflow-y-auto p-8">
              {items.map((item, i) => (
                <button
                  key={item.id}
                  ref={(el) => {
                    itemRefs.current[i] = el;
                  }}
                  type="button"
                  onClick={item.action}
                  onMouseEnter={() => {
                    setFocusIndex(i);
                    itemRefs.current[i]?.focus({
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
          </div>
          {/* end animated tab content */}

          {/* ── Bottom toolbar (icon buttons like Xbox) ── */}
          <div className="flex items-center border-t border-white/6 px-4 py-3">
            <div className="flex-1" />
            <button
              ref={(el) => {
                toolbarRefs.current[0] = el;
              }}
              type="button"
              onClick={() => {
                if (document.fullscreenElement) {
                  document.exitFullscreen();
                } else {
                  document.documentElement.requestFullscreen();
                }
              }}
              className="rounded-lg p-2.5 text-white/40 transition-colors outline-none hover:bg-white/6 hover:text-white/70 focus-visible:ring-2 focus-visible:ring-accent"
              title="Toggle Fullscreen"
            >
              <FullscreenIcon className="h-5 w-5" />
            </button>
            <div className="mx-3 h-5 w-px bg-white/8" />
            <button
              ref={(el) => {
                toolbarRefs.current[1] = el;
              }}
              type="button"
              onClick={() => navigateTo("/account")}
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

/* ── Icons ──────────────────────────────────────────── */

function ClaudioIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m2.25 12 8.954-8.955a1.126 1.126 0 0 1 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25"
      />
    </svg>
  );
}

function GamepadIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6 12h4m-2-2v4m5 0h.01M17 12h.01M15 16h.01M5.2 20h13.6c1.12 0 1.68 0 2.1-.22a2 2 0 0 0 .88-.87C22 18.48 22 17.92 22 16.8V11a6 6 0 0 0-6-6h-1l-1.5 2h-3L9 5H8a6 6 0 0 0-6 6v5.8c0 1.12 0 1.68.22 2.1a2 2 0 0 0 .87.88c.43.22.99.22 2.1.22Z"
      />
    </svg>
  );
}

function LibraryIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6Zm0 9.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25Zm9.75-9.75A2.25 2.25 0 0 1 15.75 3.75H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6Zm0 9.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25a2.25 2.25 0 0 1-2.25-2.25v-2.25Z"
      />
    </svg>
  );
}

function AccountIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z"
      />
    </svg>
  );
}

function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7 7 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.248a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a7 7 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.282c-.062-.373-.312-.686-.644-.87a7 7 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.992a7 7 0 0 1 0-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124q.108-.066.22-.128c.332-.183.582-.495.644-.869l.214-1.28Z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
      />
    </svg>
  );
}

function PlayIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24">
      <path d="M8 5.14v13.72c0 .79.87 1.27 1.54.84l10.28-6.86a1 1 0 0 0 0-1.68L9.54 4.3A1 1 0 0 0 8 5.14Z" />
    </svg>
  );
}

function QuitIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14 5-5-5-5m5 5H9"
      />
    </svg>
  );
}

function FullscreenIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15"
      />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6 18 18 6M6 6l12 12"
      />
    </svg>
  );
}
