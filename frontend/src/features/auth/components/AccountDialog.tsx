import { useCallback, useEffect, useRef, useState } from "react";
import { useGuide } from "../../core/hooks/useGuide";
import { useGamepadEvent, useShortcut } from "../../core/hooks/useShortcut";
import { sounds } from "../../core/utils/sounds";
import { useAuth } from "../hooks/useAuth";
import AccountTab from "./AccountTab";
import PreferencesTab from "./PreferencesTab";
import SecurityTab from "./SecurityTab";

type Tab = "account" | "preferences" | "security";

const allTabs: { id: Tab; label: string }[] = [
  { id: "account", label: "Account" },
  { id: "preferences", label: "Preferences" },
  { id: "security", label: "Security" },
];

export default function AccountDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { user, providers, logout, authDisabled } = useAuth();
  const { isOpen: guideOpen } = useGuide();
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("account");
  const [focusZone, setFocusZone] = useState<"sidebar" | "content">("sidebar");
  const [sidebarIndex, setSidebarIndex] = useState(0);
  const [contentIndex, setContentIndex] = useState(0);

  const sidebarRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const contentRefs = useRef<(HTMLButtonElement | HTMLInputElement | null)[]>(
    [],
  );
  const panelRef = useRef<HTMLDivElement>(null);

  const visibleTabs = allTabs.filter(
    (t) => t.id !== "security" || providers.localLoginEnabled,
  );

  // Sidebar items: tabs + sign out (if auth enabled)
  const sidebarCount = visibleTabs.length + (authDisabled ? 0 : 1);

  // Reset state when reopening
  const [prevOpen, setPrevOpen] = useState(false);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setActiveTab("account");
      setFocusZone("sidebar");
      setSidebarIndex(0);
      setContentIndex(0);
    }
  }

  // Save/restore focus to element behind dialog
  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement as HTMLElement | null;
    } else if (previousFocusRef.current) {
      previousFocusRef.current.focus({ focusVisible: true } as FocusOptions);
      previousFocusRef.current = null;
    }
  }, [open]);

  // Focus the active element when zone/index changes
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => {
      if (focusZone === "sidebar") {
        sidebarRefs.current[sidebarIndex]?.focus({
          focusVisible: true,
        } as FocusOptions);
      } else {
        contentRefs.current[contentIndex]?.focus({
          focusVisible: true,
        } as FocusOptions);
      }
    });
  }, [open, focusZone, sidebarIndex, contentIndex, activeTab]);

  // Focus first sidebar item on open
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => {
        sidebarRefs.current[0]?.focus({
          focusVisible: true,
        } as FocusOptions);
      });
    }
  }, [open]);

  const focusSidebar = useCallback(
    (index: number) => {
      const clamped = Math.max(0, Math.min(sidebarCount - 1, index));
      setSidebarIndex(clamped);
    },
    [sidebarCount],
  );

  const focusContent = useCallback((index: number) => {
    const count = contentRefs.current.filter(Boolean).length;
    const clamped = Math.max(0, Math.min(count - 1, index));
    setContentIndex(clamped);
  }, []);

  function selectTab(tab: Tab) {
    setActiveTab(tab);
    setContentIndex(0);
  }

  // ── Keyboard navigation (capture phase) ──

  useShortcut(
    "escape",
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    },
    { enabled: open && !guideOpen, capture: true },
  );

  useShortcut(
    "arrowup",
    (e) => {
      e.preventDefault();
      if (focusZone === "sidebar") {
        focusSidebar(sidebarIndex - 1);
        sounds.navigate();
      } else {
        if (contentIndex === 0) {
          setFocusZone("sidebar");
          sounds.navigate();
        } else {
          focusContent(contentIndex - 1);
          sounds.navigate();
        }
      }
    },
    { enabled: open && !guideOpen, capture: true },
  );

  useShortcut(
    "arrowdown",
    (e) => {
      e.preventDefault();
      if (focusZone === "sidebar") {
        focusSidebar(sidebarIndex + 1);
        sounds.navigate();
      } else {
        focusContent(contentIndex + 1);
        sounds.navigate();
      }
    },
    { enabled: open && !guideOpen, capture: true },
  );

  useShortcut(
    "arrowright",
    (e) => {
      e.preventDefault();
      if (focusZone === "sidebar") {
        // Move into content
        setFocusZone("content");
        setContentIndex(0);
        sounds.navigate();
      }
    },
    { enabled: open && !guideOpen, capture: true },
  );

  useShortcut(
    "arrowleft",
    (e) => {
      e.preventDefault();
      if (focusZone === "content") {
        // Move back to sidebar
        setFocusZone("sidebar");
        sounds.navigate();
      }
    },
    { enabled: open && !guideOpen, capture: true },
  );

  useShortcut(
    "enter",
    (e) => {
      // Don't intercept Enter on form inputs — let the form submit naturally
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

      e.preventDefault();
      if (focusZone === "sidebar" && sidebarIndex < visibleTabs.length) {
        sounds.select();
      } else {
        sounds.navigate();
      }
      if (focusZone === "sidebar") {
        sidebarRefs.current[sidebarIndex]?.click();
      } else {
        contentRefs.current[contentIndex]?.click();
      }
    },
    { enabled: open && !guideOpen, capture: true },
  );

  // Gamepad bumpers cycle tabs
  const handleBumper = useCallback(
    (direction: 1 | -1) => {
      const currentIdx = visibleTabs.findIndex((t) => t.id === activeTab);
      const nextIdx =
        (currentIdx + direction + visibleTabs.length) % visibleTabs.length;
      setActiveTab(visibleTabs[nextIdx].id);
      setSidebarIndex(nextIdx);
      setContentIndex(0);
      sounds.select();
    },
    [visibleTabs, activeTab],
  );

  useGamepadEvent("gamepad-rb", () => handleBumper(1), open && !guideOpen);
  useGamepadEvent("gamepad-lb", () => handleBumper(-1), open && !guideOpen);

  if (!open) return null;

  // Build sidebar ref index: 0..visibleTabs.length-1 are tabs, last is sign out
  let sidebarRefIdx = 0;

  const closeIcon = (
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
        d="M6 18 18 6M6 6l12 12"
      />
    </svg>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      <div className="fixed inset-0 bg-black/80 backdrop-blur-sm animate-[fadeIn_150ms_ease-out]" />
      <div
        ref={panelRef}
        className="relative flex flex-col sm:flex-row w-full sm:max-w-2xl sm:mx-4 h-[85dvh] sm:h-[min(520px,80vh)] rounded-t-2xl sm:rounded-2xl bg-white/6 shadow-[0_8px_80px_rgba(0,0,0,0.6)] ring-1 ring-white/8 backdrop-blur-2xl overflow-hidden animate-[slideUpIn_200ms_cubic-bezier(0.16,1,0.3,1)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sidebar */}
        <nav className="flex flex-col bg-white/8 sm:w-52 sm:shrink-0 sm:border-r border-white/6">
          {/* Header */}
          <div className="flex items-start justify-between p-4 sm:p-5 sm:pb-0">
            <div>
              <h1 className="font-display text-lg font-bold text-white">
                Settings
              </h1>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-sm text-white/50 font-mono">
                  {user?.username}
                </span>
                {user?.role === "admin" && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-accent-dim text-accent">
                    {user.role}
                  </span>
                )}
              </div>
            </div>
            {/* Close button — mobile only */}
            <button
              onClick={onClose}
              className="sm:hidden p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/6 transition outline-none focus-visible:ring-2 focus-visible:ring-accent"
              aria-label="Close"
            >
              {closeIcon}
            </button>
          </div>

          {/* Tabs — horizontal scroll on mobile, vertical on desktop */}
          <div className="flex sm:flex-col gap-1 overflow-x-auto sm:overflow-visible [scrollbar-width:none] [&::-webkit-scrollbar]:hidden px-3 sm:px-5 py-3 sm:py-0 sm:mt-6 sm:flex-1 border-b sm:border-b-0 border-white/6">
            {visibleTabs.map((tab) => {
              const idx = sidebarRefIdx++;
              return (
                <button
                  key={tab.id}
                  ref={(el) => {
                    sidebarRefs.current[idx] = el;
                  }}
                  onClick={() => selectTab(tab.id)}
                  onMouseEnter={() => {
                    setFocusZone("sidebar");
                    setSidebarIndex(idx);
                    sidebarRefs.current[idx]?.focus();
                  }}
                  className={`shrink-0 sm:w-full text-left px-3 py-2 rounded-lg text-sm transition-colors outline-none ${
                    activeTab === tab.id
                      ? "bg-white/10 text-white font-medium"
                      : "text-white/60 hover:text-white hover:bg-white/6"
                  } focus-visible:ring-2 focus-visible:ring-accent`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Sign out — desktop sidebar only */}
          {!authDisabled && (
            <button
              ref={(el) => {
                sidebarRefs.current[visibleTabs.length] = el;
              }}
              onClick={() => {
                onClose();
                logout();
              }}
              onMouseEnter={() => {
                setFocusZone("sidebar");
                setSidebarIndex(visibleTabs.length);
                sidebarRefs.current[visibleTabs.length]?.focus();
              }}
              className="hidden sm:block text-left px-3 py-2 m-5 mt-0 rounded-lg text-sm text-white/40 hover:text-red-400 hover:bg-white/6 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Sign out
            </button>
          )}
        </nav>

        {/* Content */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          {/* Content header with close button — desktop only */}
          <div className="hidden sm:flex items-center justify-between px-6 pt-5 pb-4">
            <h2 className="font-display text-lg font-semibold text-white">
              {visibleTabs.find((t) => t.id === activeTab)?.label}
            </h2>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/6 transition outline-none focus-visible:ring-2 focus-visible:ring-accent"
              aria-label="Close"
            >
              {closeIcon}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 sm:px-6 pt-4 sm:pt-1 pb-4 sm:pb-6">
            {activeTab === "account" && <AccountTab />}
            {activeTab === "preferences" && (
              <PreferencesTab contentRefs={contentRefs} />
            )}
            {activeTab === "security" && (
              <SecurityTab contentRefs={contentRefs} />
            )}

            {/* Sign out — mobile only, at bottom of content */}
            {!authDisabled && (
              <button
                onClick={() => {
                  onClose();
                  logout();
                }}
                className="sm:hidden mt-6 w-full text-left px-3 py-2 rounded-lg text-sm text-white/40 hover:text-red-400 hover:bg-white/6 transition-colors"
              >
                Sign out
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
