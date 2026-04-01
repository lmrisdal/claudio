import { useEffect, useState } from "react";
import { setIndexedRef } from "../../core/utils/dom";
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
import ShortcutRow from "./ShortcutRow";

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

    window.addEventListener("keydown", handleEscape, true);
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
      <label className="flex items-center justify-between cursor-pointer">
        <span className="text-sm text-white/80">Navigation sounds</span>
        <button
          ref={(el) => setIndexedRef(contentRefs, 0, el)}
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

      <label className="flex items-center justify-between cursor-pointer">
        <span className="text-sm text-white/80">
          Start emulator in fullscreen
        </span>
        <button
          ref={(el) => setIndexedRef(contentRefs, 1, el)}
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

      <div>
        <h3 className="text-xs font-medium text-white/50 uppercase tracking-wider mb-3">
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
            buttonRef={(el) => setIndexedRef(contentRefs, 2, el)}
          />
        </div>
      </div>
    </div>
  );
}
