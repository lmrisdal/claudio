import { setIndexedRef as setIndexedReference } from "../../core/utils/dom";
import type { AppSettingsFormState } from "../hooks/use-app-settings-form";

export default function AppDownloadsSettingsTab({
  contentRefs,
  settings,
}: {
  contentRefs: React.RefObject<(HTMLButtonElement | HTMLInputElement | null)[]>;
  settings: AppSettingsFormState;
}) {
  return (
    <div className="space-y-5">
      <div>
        <label
          htmlFor="settings-install-path"
          className="mb-1.5 block text-sm font-medium text-text-secondary"
        >
          Default install path
        </label>
        <input
          ref={(element) => setIndexedReference(contentRefs, 0, element)}
          id="settings-install-path"
          type="text"
          value={settings.installPath}
          onChange={(event) => settings.setInstallPath(event.target.value)}
          placeholder="Leave empty for default..."
          spellCheck={false}
          className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:border-transparent focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </div>

      <div>
        <label
          htmlFor="settings-speed-limit"
          className="mb-1.5 block text-sm font-medium text-text-secondary"
        >
          Download speed limit
        </label>
        <div className="flex items-center gap-2">
          <input
            ref={(element) => setIndexedReference(contentRefs, 1, element)}
            id="settings-speed-limit"
            type="number"
            min="0"
            step="any"
            value={settings.speedLimit}
            onChange={(event) => settings.setSpeedLimit(event.target.value)}
            placeholder="Unlimited"
            className="flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:border-transparent focus:outline-none focus:ring-2 focus:ring-accent"
          />
          <span className="shrink-0 text-sm text-text-muted">KB/s</span>
        </div>
      </div>

      {settings.saveMessage && (
        <p
          className={`text-sm ${settings.saveMessage.includes("saved") ? "text-accent" : "text-red-400"}`}
          role="alert"
        >
          {settings.saveMessage}
        </p>
      )}

      <div className="flex justify-end border-t border-border pt-4">
        <button
          ref={(element) => setIndexedReference(contentRefs, 2, element)}
          onClick={settings.handleSave}
          disabled={settings.saving}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-neutral-950 transition hover:bg-accent-hover disabled:opacity-60"
        >
          {settings.saving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}
