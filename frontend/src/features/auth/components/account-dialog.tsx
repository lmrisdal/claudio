import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGuide } from "../../core/hooks/use-guide";
import { useGamepadEvent, useShortcut } from "../../core/hooks/use-shortcut";
import { sounds } from "../../core/utils/sounds";
import { isDesktop } from "../../desktop/hooks/use-desktop";
import { useAuth } from "../hooks/use-auth";
import AccountTab from "./account-tab";
import DesktopSettingsTab from "./desktop-settings-tab";
import PreferencesTab from "./preferences-tab";

type Tab = "account" | "preferences" | "desktop";

const allTabs: { id: Tab; label: string }[] = [
  { id: "account", label: "Account" },
  { id: "preferences", label: "Preferences" },
  { id: "desktop", label: "App" },
];

export default function AccountDialog({
  open,
  initialTab,
  onClose,
}: {
  open: boolean;
  initialTab: Tab;
  onClose: () => void;
}) {
  const { user, logout, authDisabled } = useAuth();
  const { isOpen: guideOpen } = useGuide();
  const previousFocusReference = useRef<HTMLElement | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("account");
  const [focusZone, setFocusZone] = useState<"sidebar" | "content">("sidebar");
  const [sidebarIndex, setSidebarIndex] = useState(0);
  const [contentIndex, setContentIndex] = useState(0);

  const sidebarReferences = useRef<(HTMLButtonElement | null)[]>([]);
  const contentReferences = useRef<(HTMLButtonElement | HTMLInputElement | null)[]>([]);
  const panelReference = useRef<HTMLDivElement>(null);

  const visibleTabs = useMemo(
    () =>
      allTabs.filter((tab) => {
        if (tab.id === "desktop" && !isDesktop) return false;
        return true;
      }),
    [],
  );

  // Sidebar items: tabs + sign out (if auth enabled)
  const sidebarCount = visibleTabs.length + (authDisabled ? 0 : 1);

  useEffect(() => {
    if (!open) return;
    const nextTab = visibleTabs.some((tab) => tab.id === initialTab) ? initialTab : "account";
    const tabIndex = visibleTabs.findIndex((tab) => tab.id === nextTab);
    setActiveTab(nextTab);
    setFocusZone("sidebar");
    setSidebarIndex(Math.max(0, tabIndex));
    setContentIndex(0);
  }, [open, initialTab, visibleTabs]);

  // Save/restore focus to element behind dialog
  useEffect(() => {
    if (open) {
      previousFocusReference.current = document.activeElement as HTMLElement | null;
    } else if (previousFocusReference.current) {
      previousFocusReference.current.focus({ focusVisible: true } as FocusOptions);
      previousFocusReference.current = null;
    }
  }, [open]);

  // Focus the active element when zone/index changes
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => {
      if (focusZone === "sidebar") {
        sidebarReferences.current[sidebarIndex]?.focus({
          focusVisible: true,
        } as FocusOptions);
      } else {
        contentReferences.current[contentIndex]?.focus({
          focusVisible: true,
        } as FocusOptions);
      }
    });
  }, [open, focusZone, sidebarIndex, contentIndex, activeTab]);

  // Focus first sidebar item on open
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => {
        sidebarReferences.current[0]?.focus({
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
    const count = contentReferences.current.filter(Boolean).length;
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
        void sounds.navigate();
      } else {
        if (contentIndex === 0) {
          setFocusZone("sidebar");
          void sounds.navigate();
        } else {
          focusContent(contentIndex - 1);
          void sounds.navigate();
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
        void sounds.navigate();
      } else {
        focusContent(contentIndex + 1);
        void sounds.navigate();
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
        void sounds.navigate();
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
        void sounds.navigate();
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
        void sounds.select();
      } else {
        void sounds.navigate();
      }
      if (focusZone === "sidebar") {
        sidebarReferences.current[sidebarIndex]?.click();
      } else {
        contentReferences.current[contentIndex]?.click();
      }
    },
    { enabled: open && !guideOpen, capture: true },
  );

  // Gamepad bumpers cycle tabs
  const handleBumper = useCallback(
    (direction: 1 | -1) => {
      const currentIndex = visibleTabs.findIndex((t) => t.id === activeTab);
      const nextIndex = (currentIndex + direction + visibleTabs.length) % visibleTabs.length;
      setActiveTab(visibleTabs[nextIndex].id);
      setSidebarIndex(nextIndex);
      setContentIndex(0);
      void sounds.select();
    },
    [visibleTabs, activeTab],
  );

  useGamepadEvent("gamepad-rb", () => handleBumper(1), open && !guideOpen);
  useGamepadEvent("gamepad-lb", () => handleBumper(-1), open && !guideOpen);

  if (!open) return null;

  // Build sidebar ref index: 0..visibleTabs.length-1 are tabs, last is sign out
  let sidebarReferenceIndex = 0;

  const closeIcon = (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
    </svg>
  );

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        ref={panelReference}
        className="relative flex h-[85dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-border bg-surface shadow-2xl sm:mx-4 sm:h-[min(620px,86vh)] sm:max-w-4xl sm:flex-row sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Settings"
      >
        <nav className="flex flex-col border-border bg-surface-raised sm:w-56 sm:shrink-0 sm:border-r">
          <div className="flex items-start justify-between border-b border-border p-4 sm:border-b-0 sm:p-5 sm:pb-0">
            <div>
              <h1 className="text-lg font-semibold text-text-primary">Settings</h1>
              <div className="flex items-center gap-2 mt-1">
                <span className="font-mono text-sm text-text-muted">{user?.username}</span>
                {user?.role === "admin" && (
                  <span className="rounded-full bg-accent-dim px-1.5 py-0.5 text-[10px] font-medium text-accent">
                    {user.role}
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-text-muted transition hover:bg-surface hover:text-text-primary focus-visible:ring-2 focus-visible:ring-accent sm:hidden"
              aria-label="Close"
            >
              {closeIcon}
            </button>
          </div>

          <div className="flex gap-1 overflow-x-auto border-b border-border px-3 py-3 [scrollbar-width:none] sm:mt-4 sm:flex-1 sm:flex-col sm:overflow-visible sm:border-b-0 sm:px-5 sm:py-0 [&::-webkit-scrollbar]:hidden">
            {visibleTabs.map((tab) => {
              const index = sidebarReferenceIndex++;
              return (
                <button
                  key={tab.id}
                  ref={(element) => {
                    sidebarReferences.current[index] = element;
                  }}
                  onClick={() => selectTab(tab.id)}
                  onMouseEnter={() => {
                    setFocusZone("sidebar");
                    setSidebarIndex(index);
                    sidebarReferences.current[index]?.focus();
                  }}
                  className={`shrink-0 rounded-lg px-3 py-2 text-left text-sm outline-none transition-colors sm:w-full ${
                    activeTab === tab.id
                      ? "bg-surface text-text-primary font-medium"
                      : "text-text-secondary hover:bg-surface hover:text-text-primary"
                  } focus-visible:ring-2 focus-visible:ring-accent`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {!authDisabled && (
            <button
              ref={(element) => {
                sidebarReferences.current[visibleTabs.length] = element;
              }}
              onClick={() => {
                onClose();
                logout();
              }}
              onMouseEnter={() => {
                setFocusZone("sidebar");
                setSidebarIndex(visibleTabs.length);
                sidebarReferences.current[visibleTabs.length]?.focus();
              }}
              className="m-5 mt-0 hidden rounded-lg px-3 py-2 text-left text-sm text-text-muted outline-none transition-colors hover:bg-surface hover:text-red-400 focus-visible:ring-2 focus-visible:ring-accent sm:block"
            >
              Sign out
            </button>
          )}
        </nav>

        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          <div className="hidden items-center justify-between border-b border-border px-6 py-4 sm:flex">
            <h2 className="text-base font-semibold text-text-primary">
              {visibleTabs.find((t) => t.id === activeTab)?.label}
            </h2>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-text-muted transition hover:bg-surface-raised hover:text-text-primary focus-visible:ring-2 focus-visible:ring-accent"
              aria-label="Close"
            >
              {closeIcon}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 pb-4 pt-4 sm:px-6 sm:pb-6 sm:pt-5">
            {activeTab === "account" && <AccountTab contentRefs={contentReferences} />}
            {activeTab === "preferences" && <PreferencesTab contentRefs={contentReferences} />}
            {activeTab === "desktop" && <DesktopSettingsTab active={open && activeTab === "desktop"} />}

            {!authDisabled && (
              <button
                onClick={() => {
                  onClose();
                  logout();
                }}
                className="mt-6 w-full rounded-lg px-3 py-2 text-left text-sm text-text-muted transition-colors hover:bg-surface-raised hover:text-red-400 sm:hidden"
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
