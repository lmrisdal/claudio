import { useEffect, useState } from "react";
import Logo from "../../core/components/logo";
import { useDesktop } from "../hooks/use-desktop";
import { getConnectionErrorMessage } from "../utils/connection-check";
import { buildDesktopCustomHeaders } from "../utils/custom-headers";

export default function DesktopSetup({
  onConnected,
}: {
  onConnected: (serverUrl: string) => void;
}) {
  const { getSettings, updateSettings, desktopCheckServerConnection } = useDesktop();
  const [url, setUrl] = useState("");
  const [headers, setHeaders] = useState<{ name: string; value: string }[]>([]);
  const [showHeaders, setShowHeaders] = useState(false);
  const [error, setError] = useState("");
  const [testResult, setTestResult] = useState<"success" | "error" | "">("");
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void getSettings()
      .then((settings) => {
        if (cancelled) return;

        setUrl(settings.serverUrl ?? "");

        const customHeaders = settings.customHeaders ?? {};
        const loadedHeaders = Object.entries(customHeaders).map(([name, value]) => ({
          name,
          value,
        }));

        setHeaders(loadedHeaders);
        setShowHeaders(loadedHeaders.length > 0);
      })
      .catch(() => {
        if (!cancelled) {
          setUrl("");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [getSettings]);

  function buildCustomHeaders() {
    return buildDesktopCustomHeaders(headers);
  }

  async function handleTest() {
    const trimmed = url.trim().replace(/\/+$/, "");
    if (!trimmed) {
      setError("Please enter a server URL.");
      return;
    }

    setTesting(true);
    setError("");
    setTestResult("");

    try {
      const { customHeaders, forbiddenHeaders } = buildCustomHeaders();
      if (forbiddenHeaders.length > 0) {
        setTestResult("error");
        setError(
          `These headers are managed by desktop auth and cannot be set manually: ${forbiddenHeaders.join(", ")}.`,
        );
        return;
      }

      const result = await desktopCheckServerConnection({
        serverUrl: trimmed,
        customHeaders,
        path: "/api/auth/providers",
      });
      if (result.ok) {
        setTestResult("success");
      } else {
        setTestResult("error");
        setError(getConnectionErrorMessage(result.status));
      }
    } catch {
      setTestResult("error");
      setError(getConnectionErrorMessage());
    } finally {
      setTesting(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const trimmed = url.trim().replace(/\/+$/, "");
    if (!trimmed) {
      setError("Please enter a server URL.");
      return;
    }

    const { customHeaders, forbiddenHeaders } = buildCustomHeaders();
    if (forbiddenHeaders.length > 0) {
      setError(
        `These headers are managed by desktop auth and cannot be set manually: ${forbiddenHeaders.join(", ")}.`,
      );
      return;
    }

    setSaving(true);
    try {
      const settings = await getSettings();
      await updateSettings({ ...settings, serverUrl: trimmed, customHeaders });
      localStorage.setItem("claudio_custom_headers", JSON.stringify(customHeaders));
      onConnected(trimmed);
    } catch {
      setError("Failed to save settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="auth-shell min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-10">
          <Logo className="text-5xl mx-auto" />
          <p className="text-text-muted text-sm mt-3">
            Connect to your Claudio server to get started.
          </p>
        </div>

        <div className="card auth-card bg-surface rounded-xl p-6 ring-1 ring-border">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="server-url"
                className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wider"
              >
                Server URL
              </label>
              <input
                id="server-url"
                type="url"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setTestResult("");
                }}
                placeholder="https://claudio.example.com…"
                autoFocus
                spellCheck={false}
                autoComplete="url"
                className="input-field w-full bg-surface-raised border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-focus-ring focus:ring-1 focus:ring-focus-ring/30 transition"
              />
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
                <div className="mt-3 space-y-2">
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
                        className="flex-1 px-2.5 py-1.5 rounded-lg bg-surface-raised border border-border text-text-primary placeholder-text-muted text-xs focus:outline-none focus:border-focus-ring focus:ring-1 focus:ring-focus-ring/30 transition"
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
                        className="flex-1 px-2.5 py-1.5 rounded-lg bg-surface-raised border border-border text-text-primary placeholder-text-muted text-xs focus:outline-none focus:border-focus-ring focus:ring-1 focus:ring-focus-ring/30 transition"
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

            {error && (
              <p className="text-red-400 text-sm" role="alert">
                {error}
              </p>
            )}
            {testResult === "success" && (
              <p className="text-accent text-sm" role="status">
                Connection successful.
              </p>
            )}

            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={handleTest}
                disabled={testing || !url.trim()}
                className="px-4 py-2.5 rounded-lg border border-border text-text-secondary hover:text-text-primary hover:bg-surface-raised text-sm transition disabled:opacity-60"
              >
                {testing ? "Testing…" : "Test connection"}
              </button>
              <button
                type="submit"
                disabled={saving || !url.trim()}
                className="flex-1 py-2.5 rounded-lg bg-accent hover:bg-accent-hover text-accent-foreground font-semibold text-sm transition disabled:opacity-60"
              >
                {saving ? "Saving…" : "Save & continue"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
