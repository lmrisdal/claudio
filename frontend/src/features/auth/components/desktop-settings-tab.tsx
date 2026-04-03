import { useEffect, useState } from "react";
import { getSettings, updateSettings, type DesktopSettings } from "../../desktop/hooks/use-desktop";

export default function DesktopSettingsTab({ active }: { active: boolean }) {
  const [settings, setSettings] = useState<DesktopSettings | null>(null);
  const [serverUrl, setServerUrl] = useState("");
  const [installPath, setInstallPath] = useState("");
  const [closeToTray, setCloseToTray] = useState(false);
  const [speedLimit, setSpeedLimit] = useState("");
  const [headers, setHeaders] = useState<{ name: string; value: string }[]>([]);
  const [showHeaders, setShowHeaders] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [connectionMessage, setConnectionMessage] = useState("");
  const [saveMessage, setSaveMessage] = useState("");

  useEffect(() => {
    if (!active) return;
    void getSettings().then((loadedSettings) => {
      setSettings(loadedSettings);
      setServerUrl(loadedSettings.serverUrl ?? "");
      setInstallPath(loadedSettings.defaultInstallPath ?? "");
      setCloseToTray(loadedSettings.closeToTray ?? false);
      setSpeedLimit(
        loadedSettings.downloadSpeedLimitKbs ? String(loadedSettings.downloadSpeedLimitKbs) : "",
      );
      const customHeaders = loadedSettings.customHeaders ?? {};
      const entries = Object.entries(customHeaders).map(([name, value]) => ({ name, value }));
      setHeaders(entries);
      setShowHeaders(entries.length > 0);
      setConnectionMessage("");
      setSaveMessage("");
    });
  }, [active]);

  function buildCustomHeaders() {
    const customHeaders: Record<string, string> = {};
    for (const header of headers) {
      const name = header.name.trim();
      const value = header.value.trim();
      if (name && value) customHeaders[name] = value;
    }
    return customHeaders;
  }

  async function handleTest() {
    const trimmedUrl = serverUrl.trim().replace(/\/+$/, "");
    if (!trimmedUrl) {
      setConnectionMessage("Server URL is required.");
      return;
    }

    setTesting(true);
    setConnectionMessage("");

    try {
      const response = await fetch(`${trimmedUrl}/api/auth/providers`, {
        headers: buildCustomHeaders(),
      });
      if (response.ok) {
        setConnectionMessage("Connection successful.");
      } else {
        setConnectionMessage(`Server responded with ${response.status}.`);
      }
    } catch {
      setConnectionMessage("Could not connect. Check the URL and try again.");
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    if (!settings) return;
    const trimmedUrl = serverUrl.trim().replace(/\/+$/, "");
    if (!trimmedUrl) {
      setSaveMessage("Server URL is required.");
      return;
    }

    const customHeaders = buildCustomHeaders();

    setSaving(true);
    setSaveMessage("");

    try {
      const parsedLimit = Number.parseFloat(speedLimit);
      const updated: DesktopSettings = {
        ...settings,
        serverUrl: trimmedUrl,
        defaultInstallPath: installPath.trim() || null,
        closeToTray,
        customHeaders,
        downloadSpeedLimitKbs: parsedLimit > 0 ? parsedLimit : null,
      };
      await updateSettings(updated);
      localStorage.setItem("claudio_server_url", trimmedUrl);
      localStorage.setItem("claudio_custom_headers", JSON.stringify(customHeaders));

      const serverChanged = trimmedUrl !== (settings.serverUrl ?? "");
      const headersChanged =
        JSON.stringify(customHeaders) !== JSON.stringify(settings.customHeaders ?? {});
      if (serverChanged || headersChanged) {
        globalThis.location.reload();
        return;
      }

      setSettings(updated);
      setSaveMessage("Settings saved.");
    } catch {
      setSaveMessage("Failed to save settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <label htmlFor="settings-server-url" className="mb-1.5 block text-sm font-medium text-text-secondary">
          Server URL
        </label>
        <input
          id="settings-server-url"
          type="url"
          value={serverUrl}
          onChange={(event) => setServerUrl(event.target.value)}
          placeholder="https://claudio.example.com..."
          spellCheck={false}
          autoComplete="url"
          className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:border-transparent focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </div>

      <div className="space-y-2">
        <button
          type="button"
          onClick={() => setShowHeaders(!showHeaders)}
          className="flex items-center gap-1 text-xs text-text-muted transition hover:text-text-secondary"
        >
          <svg
            className={`h-3 w-3 transition-transform ${showHeaders ? "rotate-90" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          Custom headers
        </button>
        {showHeaders && (
          <div className="space-y-2">
            {headers.map((header, index) => (
              <div key={index} className="flex gap-2">
                <input
                  type="text"
                  value={header.name}
                  onChange={(event) => {
                    const next = [...headers];
                    next[index] = { ...header, name: event.target.value };
                    setHeaders(next);
                  }}
                  placeholder="Header name..."
                  spellCheck={false}
                  className="flex-1 rounded-lg border border-border bg-bg px-2.5 py-1.5 text-xs text-text-primary placeholder-text-muted focus:border-transparent focus:outline-none focus:ring-2 focus:ring-accent"
                />
                <input
                  type="text"
                  value={header.value}
                  onChange={(event) => {
                    const next = [...headers];
                    next[index] = { ...header, value: event.target.value };
                    setHeaders(next);
                  }}
                  placeholder="Value..."
                  spellCheck={false}
                  className="flex-1 rounded-lg border border-border bg-bg px-2.5 py-1.5 text-xs text-text-primary placeholder-text-muted focus:border-transparent focus:outline-none focus:ring-2 focus:ring-accent"
                />
                <button
                  type="button"
                  onClick={() => setHeaders(headers.filter((_, listIndex) => listIndex !== index))}
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
            ))}
            <button
              type="button"
              onClick={() => setHeaders([...headers, { name: "", value: "" }])}
              className="text-xs text-accent transition hover:text-accent-hover"
            >
              + Add header
            </button>
          </div>
        )}
        <div className="border-t border-border pt-3">
          <button
            onClick={handleTest}
            disabled={testing || !serverUrl.trim()}
            className="rounded-lg border border-border px-4 py-2 text-sm text-text-secondary transition hover:bg-surface-raised hover:text-text-primary disabled:opacity-60"
          >
            {testing ? "Testing..." : "Test connection"}
          </button>
          {connectionMessage && (
            <p
              className={`mt-2 text-sm ${connectionMessage.includes("successful") ? "text-accent" : "text-red-400"}`}
              role="alert"
            >
              {connectionMessage}
            </p>
          )}
        </div>
      </div>

      <div>
        <label
          htmlFor="settings-install-path"
          className="mb-1.5 block text-sm font-medium text-text-secondary"
        >
          Default install path
        </label>
        <input
          id="settings-install-path"
          type="text"
          value={installPath}
          onChange={(event) => setInstallPath(event.target.value)}
          placeholder="Leave empty for default..."
          spellCheck={false}
          className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:border-transparent focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </div>

      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-bg px-3 py-3">
        <input
          type="checkbox"
          checked={closeToTray}
          onChange={(event) => setCloseToTray(event.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-border bg-surface text-accent focus:ring-2 focus:ring-accent"
        />
        <span className="min-w-0">
          <span className="block text-sm font-medium text-text-primary">Close to tray</span>
          <span className="mt-1 block text-xs text-text-muted">
            Keep Claudio running in the system tray when the window is closed.
          </span>
        </span>
      </label>

      <div>
        <label
          htmlFor="settings-speed-limit"
          className="mb-1.5 block text-sm font-medium text-text-secondary"
        >
          Download speed limit
        </label>
        <div className="flex items-center gap-2">
          <input
            id="settings-speed-limit"
            type="number"
            min="0"
            step="any"
            value={speedLimit}
            onChange={(event) => setSpeedLimit(event.target.value)}
            placeholder="Unlimited"
            className="flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:border-transparent focus:outline-none focus:ring-2 focus:ring-accent"
          />
          <span className="shrink-0 text-sm text-text-muted">KB/s</span>
        </div>
      </div>

      {saveMessage && (
        <p className={`text-sm ${saveMessage.includes("saved") ? "text-accent" : "text-red-400"}`} role="alert">
          {saveMessage}
        </p>
      )}

      <div className="flex justify-end border-t border-border pt-4">
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-neutral-950 transition hover:bg-accent-hover disabled:opacity-60"
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}
