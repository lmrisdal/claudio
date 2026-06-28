import { setIndexedRef as setIndexedReference } from "../../core/utils/dom";
import type { AppSettingsFormState } from "../hooks/use-app-settings-form";

export default function AppDownloadsSettingsTab({
  contentRefs,
  settings,
}: {
  contentRefs: React.RefObject<(HTMLElement | null)[]>;
  settings: AppSettingsFormState;
}) {
  const showLinuxRuntimeToggle = settings.linuxRuntimeOptions.length > 0;
  const bottlesOption = settings.linuxRuntimeOptions.find((option) => option.value === "bottles");
  const bottlesAvailable = bottlesOption?.available ?? false;
  const useBottles = settings.linuxRuntimeBackend === "bottles";

  return (
    <div className="space-y-5">
      {!useBottles && (
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
            onBlur={() => void settings.handleSave()}
            placeholder="Leave empty for default..."
            spellCheck={false}
            className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:border-transparent focus:outline-none focus:ring-2 focus:ring-focus-ring"
          />
        </div>
      )}

      <div>
        <label
          htmlFor="settings-download-path"
          className="mb-1.5 block text-sm font-medium text-text-secondary"
        >
          Default downloads path
        </label>
        <input
          ref={(element) => setIndexedReference(contentRefs, 1, element)}
          id="settings-download-path"
          type="text"
          value={settings.downloadPath}
          onChange={(event) => settings.setDownloadPath(event.target.value)}
          onBlur={() => void settings.handleSave()}
          placeholder="Leave empty for install path + /downloads..."
          spellCheck={false}
          className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:border-transparent focus:outline-none focus:ring-2 focus:ring-focus-ring"
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
            ref={(element) => setIndexedReference(contentRefs, 2, element)}
            id="settings-speed-limit"
            type="number"
            min="0"
            step="any"
            value={settings.speedLimit}
            onChange={(event) => settings.setSpeedLimit(event.target.value)}
            onBlur={() => void settings.handleSave()}
            placeholder="Unlimited"
            className="flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:border-transparent focus:outline-none focus:ring-2 focus:ring-focus-ring"
          />
          <span className="shrink-0 text-sm text-text-muted">KB/s</span>
        </div>
      </div>

      {!useBottles && (
        <div>
          <label
            htmlFor="settings-proton-version"
            className="mb-1.5 block text-sm font-medium text-text-secondary"
          >
            Default Proton version
          </label>
          <select
            ref={(element) => setIndexedReference(contentRefs, 3, element)}
            id="settings-proton-version"
            value={settings.protonPath}
            onChange={(event) => settings.setProtonPath(event.target.value)}
            onBlur={() => void settings.handleSave()}
            className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text-primary focus:border-transparent focus:outline-none focus:ring-2 focus:ring-focus-ring"
          >
            {(settings.protonOptions.length > 0
              ? settings.protonOptions
              : [{ label: "UMU Latest", value: "UMU-Latest" }]
            ).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {showLinuxRuntimeToggle && (
        <div>
          <label className="flex cursor-pointer items-start gap-3">
            <input
              ref={(element) => setIndexedReference(contentRefs, 4, element)}
              type="checkbox"
              checked={useBottles}
              disabled={!bottlesAvailable}
              onChange={(event) => {
                const value = event.target.checked ? "bottles" : "umu";
                settings.setLinuxRuntimeBackend(value);
                void settings.handleSave(value);
              }}
              className="mt-0.5 h-4 w-4 rounded border-border bg-surface text-accent focus:ring-2 focus:ring-focus-ring disabled:opacity-50"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-text-primary">Use Bottles</span>
              <span className="mt-1 block text-xs text-text-muted">
                Run games through Bottles.
              </span>
              {!bottlesAvailable && bottlesOption?.detail && (
                <span className="mt-1 block text-xs text-text-muted">{bottlesOption.detail}</span>
              )}
            </span>
          </label>
        </div>
      )}

      {settings.saveMessage && (
        <p className="text-sm text-red-400" role="alert">
          {settings.saveMessage}
        </p>
      )}
    </div>
  );
}
