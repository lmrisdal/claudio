import { useEffect, useRef, useState } from "react";
import { useShortcut } from "../../core/hooks/use-shortcut";
import { getSettings, updateSettings, type DesktopSettings } from "../hooks/use-desktop";

export default function DesktopSettingsDialog({
  open,
  onClose,
  embedded = false,
}: {
  open: boolean;
  onClose: () => void;
  embedded?: boolean;
}) {
  const previousFocusReference = useRef<HTMLElement | null>(null);
  const [settings, setSettings] = useState<DesktopSettings | null>(null);
  const [serverUrl, setServerUrl] = useState("");
  const [installPath, setInstallPath] = useState("");
  const [closeToTray, setCloseToTray] = useState(false);
  const [speedLimit, setSpeedLimit] = useState("");
  const [headers, setHeaders] = useState<{ name: string; value: string }[]>([]);
  const [showHeaders, setShowHeaders] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState("");

  // Load settings when opened
  useEffect(() => {
    if (!open) return;
    previousFocusReference.current = document.activeElement as HTMLElement | null;
    void getSettings().then((s) => {
      setSettings(s);
      setServerUrl(s.serverUrl ?? "");
      setInstallPath(s.defaultInstallPath ?? "");
      setCloseToTray(s.closeToTray ?? false);
      setSpeedLimit(s.downloadSpeedLimitKbs ? String(s.downloadSpeedLimitKbs) : "");
      const h = s.customHeaders ?? {};
      const entries = Object.entries(h).map(([name, value]) => ({
        name,
        value,
      }));
      setHeaders(entries);
      setShowHeaders(entries.length > 0);
      setMessage("");
    });
  }, [open]);

  // Restore focus on close
  useEffect(() => {
    if (!open && previousFocusReference.current) {
      previousFocusReference.current.focus();
      previousFocusReference.current = null;
    }
  }, [open]);

  useShortcut("Escape", () => {
    if (open) onClose();
  });

  if (!open) return null;

  const containerClassName = embedded
    ? "h-full w-full"
    : "fixed inset-0 z-[100] flex items-center justify-center";
  const panelClassName = embedded
    ? "relative flex h-full w-full flex-col bg-surface"
    : "relative w-full max-w-lg mx-4 bg-surface border border-border rounded-xl shadow-2xl";
  const contentClassName = embedded ? "flex-1 overflow-y-auto px-6 py-5 space-y-5" : "px-6 py-5 space-y-5";
  const footerClassName = embedded
    ? "flex justify-between px-6 py-4 border-t border-border"
    : "flex justify-between px-6 py-4 border-t border-border";

  function buildCustomHeaders() {
    const customHeaders: Record<string, string> = {};
    for (const h of headers) {
      const name = h.name.trim();
      const value = h.value.trim();
      if (name && value) customHeaders[name] = value;
    }
    return customHeaders;
  }

  async function handleTest() {
    const trimmedUrl = serverUrl.trim().replace(/\/+$/, "");
    if (!trimmedUrl) {
      setMessage("Server URL is required.");
      return;
    }

    setTesting(true);
    setMessage("");

    try {
      const res = await fetch(`${trimmedUrl}/api/auth/providers`, {
        headers: buildCustomHeaders(),
      });
      if (res.ok) {
        setMessage("Connection successful.");
      } else {
        setMessage(`Server responded with ${res.status}.`);
      }
    } catch {
      setMessage("Could not connect. Check the URL and try again.");
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    if (!settings) return;
    const trimmedUrl = serverUrl.trim().replace(/\/+$/, "");
    if (!trimmedUrl) {
      setMessage("Server URL is required.");
      return;
    }

    const customHeaders = buildCustomHeaders();

    setSaving(true);
    setMessage("");

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
      onClose();
    } catch {
      setMessage("Failed to save settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={containerClassName} onClick={embedded ? undefined : onClose}>
      {!embedded && <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />}
      <div
        className={panelClassName}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Desktop Settings"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-text-primary">Desktop Settings</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-raised transition"
            aria-label="Close"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className={contentClassName}>
          <div>
            <label
              htmlFor="settings-server-url"
              className="block text-sm font-medium text-text-secondary mb-1.5"
            >
              Server URL
            </label>
            <input
              id="settings-server-url"
              type="url"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="https://claudio.example.com…"
              spellCheck={false}
              autoComplete="url"
              className="w-full px-3 py-2 rounded-lg bg-bg border border-border text-text-primary placeholder-text-muted text-sm focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
            />
          </div>

          <div>
            <label
              htmlFor="settings-install-path"
              className="block text-sm font-medium text-text-secondary mb-1.5"
            >
              Default install path
            </label>
            <input
              id="settings-install-path"
              type="text"
              value={installPath}
              onChange={(e) => setInstallPath(e.target.value)}
              placeholder="Leave empty for default…"
              spellCheck={false}
              className="w-full px-3 py-2 rounded-lg bg-bg border border-border text-text-primary placeholder-text-muted text-sm focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
            />
          </div>

          <label className="flex items-start gap-3 rounded-xl border border-border bg-bg px-3 py-3 cursor-pointer">
            <input
              type="checkbox"
              checked={closeToTray}
              onChange={(e) => setCloseToTray(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-border bg-surface text-accent focus:ring-2 focus:ring-accent"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-text-primary">Close to tray</span>
              <span className="block text-xs text-text-muted mt-1">
                Keep Claudio running in the system tray when the window is closed.
              </span>
            </span>
          </label>

          <div>
            <label
              htmlFor="settings-speed-limit"
              className="block text-sm font-medium text-text-secondary mb-1.5"
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
                onChange={(e) => setSpeedLimit(e.target.value)}
                placeholder="Unlimited"
                className="flex-1 px-3 py-2 rounded-lg bg-bg border border-border text-text-primary placeholder-text-muted text-sm focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
              />
              <span className="text-sm text-text-muted shrink-0">KB/s</span>
            </div>
          </div>

          <div>
            <button
              type="button"
              onClick={() => setShowHeaders(!showHeaders)}
              className="text-xs text-text-muted hover:text-text-secondary transition flex items-center gap-1"
            >
              <svg
                className={`w-3 h-3 transition-transform ${showHeaders ? "rotate-90" : ""}`}
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
              <div className="mt-2 space-y-2">
                {headers.map((h, index) => (
                  <div key={index} className="flex gap-2">
                    <input
                      type="text"
                      value={h.name}
                      onChange={(e) => {
                        const next = [...headers];
                        next[index] = { ...h, name: e.target.value };
                        setHeaders(next);
                      }}
                      placeholder="Header name…"
                      spellCheck={false}
                      className="flex-1 px-2.5 py-1.5 rounded-lg bg-bg border border-border text-text-primary placeholder-text-muted text-xs focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
                    />
                    <input
                      type="text"
                      value={h.value}
                      onChange={(e) => {
                        const next = [...headers];
                        next[index] = { ...h, value: e.target.value };
                        setHeaders(next);
                      }}
                      placeholder="Value…"
                      spellCheck={false}
                      className="flex-1 px-2.5 py-1.5 rounded-lg bg-bg border border-border text-text-primary placeholder-text-muted text-xs focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
                    />
                    <button
                      type="button"
                      onClick={() => setHeaders(headers.filter((_, index_) => index_ !== index))}
                      className="p-1.5 rounded-lg text-text-muted hover:text-red-400 hover:bg-surface-raised transition"
                      aria-label="Remove header"
                    >
                      <svg
                        className="w-3.5 h-3.5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setHeaders([...headers, { name: "", value: "" }])}
                  className="text-xs text-accent hover:text-accent-hover transition"
                >
                  + Add header
                </button>
              </div>
            )}
          </div>

          {message && (
            <p
              className={`text-sm ${message.includes("successful") ? "text-accent" : "text-red-400"}`}
              role="alert"
            >
              {message}
            </p>
          )}
        </div>

        <div className={footerClassName}>
          <button
            onClick={handleTest}
            disabled={testing || !serverUrl.trim()}
            className="px-4 py-2 rounded-lg text-sm border border-border text-text-secondary hover:text-text-primary hover:bg-surface-raised transition disabled:opacity-60"
          >
            {testing ? "Testing…" : "Test connection"}
          </button>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm text-text-secondary hover:text-text-primary hover:bg-surface-raised transition"
            >
              {embedded ? "Close" : "Cancel"}
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-neutral-950 font-medium text-sm transition disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
