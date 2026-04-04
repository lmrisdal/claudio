import { useEffect, useState } from "react";
import Logo from "../../core/components/logo";
import { useDesktop } from "../hooks/use-desktop";
import { buildDesktopCustomHeaders } from "../utils/custom-headers";

export default function DesktopSetup({
  onConnected,
}: {
  onConnected: (serverUrl: string) => void;
}) {
  const { getSettings, updateSettings } = useDesktop();
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

      const res = await fetch(`${trimmed}/api/auth/providers`, {
        headers: customHeaders,
      });
      if (res.ok) {
        setTestResult("success");
      } else {
        setTestResult("error");
        setError(`Server responded with ${res.status}.`);
      }
    } catch {
      setTestResult("error");
      setError("Could not connect. Check the URL and make sure the server is running.");
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
    <div className="min-h-screen bg-bg flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Logo className="text-3xl mx-auto mb-4" />
          <p className="text-text-secondary text-sm">
            Connect to your Claudio server to get started.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="server-url"
              className="block text-sm font-medium text-text-secondary mb-1.5"
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
              className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-text-primary placeholder-text-muted text-sm focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
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
                      className="flex-1 px-2.5 py-1.5 rounded-lg bg-surface border border-border text-text-primary placeholder-text-muted text-xs focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
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
                      className="flex-1 px-2.5 py-1.5 rounded-lg bg-surface border border-border text-text-primary placeholder-text-muted text-xs focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
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

          <div className="flex gap-3">
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
              className="flex-1 py-2.5 rounded-lg bg-accent hover:bg-accent-hover text-neutral-950 font-medium text-sm transition disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save & continue"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
