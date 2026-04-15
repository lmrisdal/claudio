import { useState } from "react";
import type { ThemePreference } from "../../core/hooks/use-theme";
import { useTheme } from "../../core/hooks/use-theme";
import { setIndexedRef as setIndexedReference } from "../../core/utils/dom";
import {
  isEmulatorFullscreenEnabled,
  setEmulatorFullscreenEnabled,
} from "../../core/utils/preferences";
import { isSoundsEnabled, setSoundsEnabled } from "../../core/utils/sounds";

export default function InterfaceTab({
  contentRefs,
}: {
  contentRefs: React.RefObject<(HTMLButtonElement | HTMLInputElement | null)[]>;
}) {
  const [fullscreenOn, setFullscreenOn] = useState(isEmulatorFullscreenEnabled);
  const [soundsOn, setSoundsOn] = useState(isSoundsEnabled);
  const { theme, setTheme } = useTheme();

  const themeOptions: { value: ThemePreference; label: string }[] = [
    { value: "system", label: "System" },
    { value: "dark", label: "Dark" },
    { value: "light", label: "Light" },
  ];

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
              className={`flex-1 py-1.5 text-sm font-medium transition outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring ${
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
          className={`ring-1 relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus-ring ${soundsOn ? "bg-surface-raised ring-border" : "bg-bg ring-border"}`}
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
          className={`ring-1 relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus-ring ${fullscreenOn ? "bg-surface-raised ring-border" : "bg-bg ring-border"}`}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${fullscreenOn ? "translate-x-5" : "translate-x-0"}`}
          />
        </button>
      </label>
    </div>
  );
}
