import { useEffect, useState } from "react";
import type { ThemePreference } from "../../core/hooks/use-theme";
import { useTheme } from "../../core/hooks/use-theme";
import { setIndexedRef as setIndexedReference } from "../../core/utils/dom";
import {
  isEmulatorFullscreenEnabled,
  setEmulatorFullscreenEnabled,
} from "../../core/utils/preferences";
import {
  getShortcutDefaults,
  getShortcuts,
  setShortcut,
  type ShortcutMap,
} from "../../core/utils/shortcuts";
import { isSoundsEnabled, setSoundsEnabled } from "../../core/utils/sounds";
import ShortcutRow from "./shortcut-row";

export default function PreferencesTab({
  contentRefs,
}: {
  contentRefs: React.RefObject<(HTMLButtonElement | HTMLInputElement | null)[]>;
}) {
  const [fullscreenOn, setFullscreenOn] = useState(isEmulatorFullscreenEnabled);
  const [soundsOn, setSoundsOn] = useState(isSoundsEnabled);
  const [shortcuts, setShortcuts] = useState(getShortcuts);
  const [recording, setRecording] = useState<keyof ShortcutMap | null>(null);
  const defaults = getShortcutDefaults();
  const { theme, setTheme } = useTheme();

  const themeOptions: { value: ThemePreference; label: string }[] = [
    { value: "system", label: "System" },
    { value: "dark", label: "Dark" },
    { value: "light", label: "Light" },
  ];

  function startRecording(key: keyof ShortcutMap) {
    setRecording(key);
  }

  useEffect(() => {
    if (!recording) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (["Control", "Meta", "Shift", "Alt"].includes(e.key)) return;

      e.preventDefault();
      e.stopImmediatePropagation();

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

    globalThis.addEventListener("keydown", handleEscape, true);
    const timer = setTimeout(() => {
      globalThis.addEventListener("keydown", handleKeyDown, true);
    }, 0);

    return () => {
      clearTimeout(timer);
      globalThis.removeEventListener("keydown", handleKeyDown, true);
      globalThis.removeEventListener("keydown", handleEscape, true);
    };
  }, [recording]);

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-text-secondary">Theme</span>
        </div>
        <div className="flex overflow-hidden rounded-lg ring-1 ring-border">
          {themeOptions.map((opt, index) => (
            <button
              key={opt.value}
              ref={(element) => setIndexedReference(contentRefs, index, element)}
              type="button"
              onClick={() => setTheme(opt.value)}
              className={`flex-1 py-1.5 text-sm font-medium transition outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${
                theme === opt.value
                  ? "bg-surface-raised text-text-primary"
                  : "text-text-muted hover:bg-surface hover:text-text-secondary"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <label className="flex items-center justify-between cursor-pointer">
        <span className="text-sm text-text-secondary">Navigation sounds</span>
        <button
          ref={(element) => setIndexedReference(contentRefs, 3, element)}
          type="button"
          role="switch"
          aria-checked={soundsOn}
          onClick={() => {
            const next = !soundsOn;
            setSoundsOn(next);
            setSoundsEnabled(next);
          }}
          className={`ring-1 relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent ${soundsOn ? "bg-surface-raised ring-border" : "bg-bg ring-border"}`}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${soundsOn ? "translate-x-5" : "translate-x-0"}`}
          />
        </button>
      </label>

      <label className="flex items-center justify-between cursor-pointer">
        <span className="text-sm text-text-secondary">Start emulator in fullscreen</span>
        <button
          ref={(element) => setIndexedReference(contentRefs, 4, element)}
          type="button"
          role="switch"
          aria-checked={fullscreenOn}
          onClick={() => {
            const next = !fullscreenOn;
            setFullscreenOn(next);
            setEmulatorFullscreenEnabled(next);
          }}
          className={`ring-1 relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent ${fullscreenOn ? "bg-surface-raised ring-border" : "bg-bg ring-border"}`}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${fullscreenOn ? "translate-x-5" : "translate-x-0"}`}
          />
        </button>
      </label>

      <div>
        <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-text-muted">
          Keyboard shortcuts
        </h3>
        <div className="space-y-2">
          <ShortcutRow
            label="Open Guide"
            value={shortcuts.guide}
            defaultValue={defaults.guide}
            recording={recording === "guide"}
            onRecord={() => startRecording("guide")}
            onReset={() => {
              setShortcut("guide", defaults.guide);
              setShortcuts(getShortcuts());
            }}
            buttonRef={(element) => setIndexedReference(contentRefs, 5, element)}
          />
        </div>
      </div>
    </div>
  );
}
