import { setIndexedRef as setIndexedReference } from "../../core/utils/dom";
import type { AppSettingsFormState } from "../hooks/use-app-settings-form";

export default function AppServerSettingsTab({
  contentRefs,
  settings,
}: {
  contentRefs: React.RefObject<(HTMLButtonElement | HTMLInputElement | null)[]>;
  settings: AppSettingsFormState;
}) {
  const addHeaderIndex = 2 + settings.headers.length * 3;
  const testButtonIndex = settings.showHeaders ? addHeaderIndex + 1 : 2;
  const saveButtonIndex = testButtonIndex + 1;

  return (
    <div className="space-y-5">
      <div className="mb-2">
        <label
          htmlFor="settings-server-url"
          className="mb-1.5 block text-sm font-medium text-text-secondary"
        >
          Server URL
        </label>
        <input
          ref={(element) => setIndexedReference(contentRefs, 0, element)}
          id="settings-server-url"
          type="url"
          value={settings.serverUrl}
          onChange={(event) => settings.setServerUrl(event.target.value)}
          placeholder="https://claudio.example.com..."
          spellCheck={false}
          autoComplete="url"
          className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:border-transparent focus:outline-none focus:ring-2 focus:ring-focus-ring"
        />
      </div>

      <div className="space-y-2">
        <button
          ref={(element) => setIndexedReference(contentRefs, 1, element)}
          type="button"
          onClick={() => settings.setShowHeaders(!settings.showHeaders)}
          className="flex items-center gap-1 text-xs text-text-muted transition hover:text-text-secondary"
        >
          <svg
            className={`h-3 w-3 transition-transform ${settings.showHeaders ? "rotate-90" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          Custom headers
        </button>

        {settings.showHeaders && (
          <div className="space-y-2">
            {settings.headers.map((header, index) => {
              const baseIndex = 2 + index * 3;

              return (
                <div key={index} className="flex gap-2">
                  <input
                    ref={(element) => setIndexedReference(contentRefs, baseIndex, element)}
                    type="text"
                    value={header.name}
                    onChange={(event) => {
                      const next = [...settings.headers];
                      next[index] = { ...header, name: event.target.value };
                      settings.setHeaders(next);
                    }}
                    placeholder="Header name..."
                    spellCheck={false}
                    className="flex-1 rounded-lg border border-border bg-bg px-2.5 py-1.5 text-xs text-text-primary placeholder-text-muted focus:border-transparent focus:outline-none focus:ring-2 focus:ring-focus-ring"
                  />
                  <input
                    ref={(element) => setIndexedReference(contentRefs, baseIndex + 1, element)}
                    type="text"
                    value={header.value}
                    onChange={(event) => {
                      const next = [...settings.headers];
                      next[index] = { ...header, value: event.target.value };
                      settings.setHeaders(next);
                    }}
                    placeholder="Value..."
                    spellCheck={false}
                    className="flex-1 rounded-lg border border-border bg-bg px-2.5 py-1.5 text-xs text-text-primary placeholder-text-muted focus:border-transparent focus:outline-none focus:ring-2 focus:ring-focus-ring"
                  />
                  <button
                    ref={(element) => setIndexedReference(contentRefs, baseIndex + 2, element)}
                    type="button"
                    onClick={() =>
                      settings.setHeaders(
                        settings.headers.filter((_, listIndex) => listIndex !== index),
                      )
                    }
                    className="rounded-lg p-1.5 text-text-muted transition hover:bg-surface-raised hover:text-red-400"
                    aria-label="Remove header"
                  >
                    <svg
                      className="h-3.5 w-3.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              );
            })}

            <button
              ref={(element) => setIndexedReference(contentRefs, addHeaderIndex, element)}
              type="button"
              onClick={() => settings.setHeaders([...settings.headers, { name: "", value: "" }])}
              className="text-xs text-accent transition hover:text-accent-hover"
            >
              + Add header
            </button>
          </div>
        )}
      </div>

      {settings.saveMessage && (
        <p
          className={`text-sm ${settings.saveMessage.includes("saved") ? "text-accent" : "text-red-400"}`}
          role="alert"
        >
          {settings.saveMessage}
        </p>
      )}

      <div className="flex items-start justify-between pt-2">
        <div>
          <button
            ref={(element) => setIndexedReference(contentRefs, testButtonIndex, element)}
            type="button"
            onClick={settings.handleTest}
            disabled={settings.testing || !settings.serverUrl.trim()}
            className="rounded-lg border border-border px-4 py-2 text-sm text-text-secondary transition hover:bg-surface-raised hover:text-text-primary disabled:opacity-60"
          >
            {settings.testing ? "Testing..." : "Test connection"}
          </button>
          {settings.connectionMessage && (
            <p
              className={`mt-2 text-sm ${settings.connectionMessage.includes("successful") ? "text-accent" : "text-red-400"}`}
              role="alert"
            >
              {settings.connectionMessage}
            </p>
          )}
        </div>

        <button
          ref={(element) => setIndexedReference(contentRefs, saveButtonIndex, element)}
          type="button"
          onClick={settings.handleSave}
          disabled={settings.saving}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition hover:bg-accent-hover disabled:opacity-60"
        >
          {settings.saving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}
