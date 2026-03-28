import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../hooks/useAuth";
import { useGuide } from "../hooks/useGuide";
import { useGamepadEvent, useShortcut } from "../hooks/useShortcut";
import {
  formatShortcut,
  getShortcutDefaults,
  getShortcuts,
  setShortcut,
  type ShortcutMap,
} from "../utils/shortcuts";
import { isEmulatorFullscreenEnabled, setEmulatorFullscreenEnabled } from "../utils/preferences";
import { isSoundsEnabled, setSoundsEnabled } from "../utils/sounds";
import { sounds } from "../utils/sounds";

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

  const focusContent = useCallback(
    (index: number) => {
      const count = contentRefs.current.filter(Boolean).length;
      const clamped = Math.max(0, Math.min(count - 1, index));
      setContentIndex(clamped);
    },
    [],
  );

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
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
    </svg>
  );

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center"
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
              <h1 className="font-display text-lg font-bold text-white">Settings</h1>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-sm text-white/50 font-mono">{user?.username}</span>
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
              <SecurityTab contentRefs={contentRefs} onSuccess={onClose} />
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

function AccountTab() {
  const { user } = useAuth();

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
        <span className="text-white/50">Username</span>
        <span className="font-mono text-white">{user?.username}</span>
        <span className="text-white/50">Role</span>
        <span>
          <span
            className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full font-medium ${
              user?.role === "admin"
                ? "bg-accent-dim text-accent"
                : "bg-white/8 text-white/70 ring-1 ring-white/10"
            }`}
          >
            {user?.role}
          </span>
        </span>
        <span className="text-white/50">Member since</span>
        <span className="text-white">
          {user?.createdAt
            ? new Date(user.createdAt).toLocaleDateString()
            : "—"}
        </span>
      </div>
    </div>
  );
}

function PreferencesTab({
  contentRefs,
}: {
  contentRefs: React.RefObject<(HTMLButtonElement | HTMLInputElement | null)[]>;
}) {
  const [fullscreenOn, setFullscreenOn] = useState(isEmulatorFullscreenEnabled);
  const [soundsOn, setSoundsOn] = useState(isSoundsEnabled);
  const [shortcuts, setShortcuts] = useState(getShortcuts);
  const [recording, setRecording] = useState<keyof ShortcutMap | null>(null);
  const defaults = getShortcutDefaults();

  function startRecording(key: keyof ShortcutMap) {
    setRecording(key);
  }

  useEffect(() => {
    if (!recording) return;

    function handleKeyDown(e: KeyboardEvent) {
      // Ignore bare modifier keys
      if (["Control", "Meta", "Shift", "Alt"].includes(e.key)) return;

      e.preventDefault();
      e.stopImmediatePropagation();

      // Build pattern
      const parts: string[] = [];
      if (e.metaKey || e.ctrlKey) parts.push("mod");
      if (e.shiftKey) parts.push("shift");
      if (e.altKey) parts.push("alt");
      parts.push(e.key.toLowerCase());
      const pattern = parts.join("+");

      setShortcut(recording!, pattern);
      setShortcuts(getShortcuts());
      setRecording(null);
    }

    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        setRecording(null);
      }
    }

    // Escape listener on capture to cancel before other handlers
    window.addEventListener("keydown", handleEscape, true);
    // Main listener on next tick so the Enter that started recording doesn't fire
    const timer = setTimeout(() => {
      window.addEventListener("keydown", handleKeyDown, true);
    }, 0);

    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keydown", handleEscape, true);
    };
  }, [recording]);

  return (
    <div className="space-y-6">
      {/* Sounds */}
      <label className="flex items-center justify-between cursor-pointer">
        <span className="text-sm text-white/80">Navigation sounds</span>
        <button
          ref={(el) => {
            contentRefs.current![0] = el;
          }}
          type="button"
          role="switch"
          aria-checked={soundsOn}
          onClick={() => {
            const next = !soundsOn;
            setSoundsOn(next);
            setSoundsEnabled(next);
          }}
          className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent ring-1 ${soundsOn ? "bg-white/14 ring-white/20" : "bg-white/8 ring-white/12"}`}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${soundsOn ? "translate-x-5" : "translate-x-0"}`}
          />
        </button>
      </label>

      {/* Emulator fullscreen */}
      <label className="flex items-center justify-between cursor-pointer">
        <span className="text-sm text-white/80">Start emulator in fullscreen</span>
        <button
          ref={(el) => {
            contentRefs.current![1] = el;
          }}
          type="button"
          role="switch"
          aria-checked={fullscreenOn}
          onClick={() => {
            const next = !fullscreenOn;
            setFullscreenOn(next);
            setEmulatorFullscreenEnabled(next);
          }}
          className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent ring-1 ${fullscreenOn ? "bg-white/14 ring-white/20" : "bg-white/8 ring-white/12"}`}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${fullscreenOn ? "translate-x-5" : "translate-x-0"}`}
          />
        </button>
      </label>

      {/* Keyboard shortcuts */}
      <div>
        <h3 className="text-xs font-medium text-white/50 uppercase tracking-wider mb-3">
          Keyboard shortcuts
        </h3>
        <div className="space-y-2">
          <ShortcutRow
            label="Open Guide"
            shortcutKey="guide"
            value={shortcuts.guide}
            defaultValue={defaults.guide}
            recording={recording === "guide"}
            onRecord={() => startRecording("guide")}
            onReset={() => {
              setShortcut("guide", defaults.guide);
              setShortcuts(getShortcuts());
            }}
            buttonRef={(el) => {
              contentRefs.current![2] = el;
            }}
          />
        </div>
      </div>
    </div>
  );
}

function ShortcutRow({
  label,
  shortcutKey: _shortcutKey,
  value,
  defaultValue,
  recording,
  onRecord,
  onReset,
  buttonRef,
}: {
  label: string;
  shortcutKey: string;
  value: string;
  defaultValue: string;
  recording: boolean;
  onRecord: () => void;
  onReset: () => void;
  buttonRef: (el: HTMLButtonElement | null) => void;
}) {
  const isCustom = value !== defaultValue;

  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-white/80">{label}</span>
      <div className="flex items-center gap-2">
        {isCustom && !recording && (
          <button
            type="button"
            onClick={onReset}
            className="text-[11px] text-white/30 hover:text-white/60 transition-colors"
            title={`Reset to ${formatShortcut(defaultValue)}`}
          >
            Reset
          </button>
        )}
        <button
          ref={buttonRef}
          type="button"
          onClick={onRecord}
          className={`inline-flex items-center gap-1.5 min-w-20 justify-center px-3 py-1.5 rounded-lg text-xs font-mono transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent ${
            recording
              ? "bg-accent/20 text-accent ring-1 ring-accent/40 animate-pulse"
              : "bg-white/14 text-white/90 ring-1 ring-white/20 hover:bg-white/20 hover:text-white"
          }`}
        >
          {recording ? "Press keys\u2026" : formatShortcut(value)}
        </button>
      </div>
    </div>
  );
}

function SecurityTab({
  contentRefs,
  onSuccess: _onSuccess,
}: {
  contentRefs: React.RefObject<(HTMLButtonElement | HTMLInputElement | null)[]>;
  onSuccess: () => void;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess(false);

    if (newPassword !== confirmPassword) {
      setError("New passwords do not match");
      return;
    }

    setLoading(true);
    try {
      const res = await api.put<void>("/auth/change-password", {
        currentPassword,
        newPassword,
      });
      void res;
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSuccess(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to change password",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-sm">
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2.5">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}
      {success && (
        <div className="bg-accent-dim border border-accent/20 rounded-lg px-4 py-2.5">
          <p className="text-accent text-sm">Password changed successfully.</p>
        </div>
      )}

      <div>
        <label
          htmlFor="account-current-password"
          className="block text-xs font-medium text-white/50 mb-1.5 uppercase tracking-wider"
        >
          Current password
        </label>
        <input
          ref={(el) => {
            contentRefs.current![0] = el;
          }}
          id="account-current-password"
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          required
          className="w-full bg-white/6 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition"
        />
      </div>
      <div>
        <label
          htmlFor="account-new-password"
          className="block text-xs font-medium text-white/50 mb-1.5 uppercase tracking-wider"
        >
          New password
        </label>
        <input
          ref={(el) => {
            contentRefs.current![1] = el;
          }}
          id="account-new-password"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
          minLength={8}
          className="w-full bg-white/6 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition"
        />
      </div>
      <div>
        <label
          htmlFor="account-confirm-new-password"
          className="block text-xs font-medium text-white/50 mb-1.5 uppercase tracking-wider"
        >
          Confirm new password
        </label>
        <input
          ref={(el) => {
            contentRefs.current![2] = el;
          }}
          id="account-confirm-new-password"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          minLength={8}
          className="w-full bg-white/6 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition"
        />
      </div>
      <button
        ref={(el) => {
          contentRefs.current![3] = el;
        }}
        type="submit"
        disabled={loading}
        className="bg-accent hover:bg-accent-hover disabled:opacity-50 text-neutral-950 font-semibold px-5 py-2.5 rounded-lg transition text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black/50"
      >
        {loading ? "Changing\u2026" : "Change password"}
      </button>
    </form>
  );
}
