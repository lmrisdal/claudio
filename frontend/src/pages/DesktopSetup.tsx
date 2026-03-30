import { useState } from "react";
import Logo from "../components/Logo";
import { useDesktop } from "../hooks/useDesktop";

export default function DesktopSetup({
  onConnected,
}: {
  onConnected: (serverUrl: string) => void;
}) {
  const { getSettings, updateSettings } = useDesktop();
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [connecting, setConnecting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const trimmed = url.trim().replace(/\/+$/, "");
    if (!trimmed) {
      setError("Please enter a server URL.");
      return;
    }

    setConnecting(true);
    try {
      const res = await fetch(`${trimmed}/api/auth/providers`);
      if (!res.ok) {
        setError(
          `Server responded with ${res.status}. Make sure this is a Claudio server.`,
        );
        return;
      }

      const settings = await getSettings();
      await updateSettings({ ...settings, serverUrl: trimmed });
      onConnected(trimmed);
    } catch {
      setError(
        "Could not connect to the server. Check the URL and make sure the server is running.",
      );
    } finally {
      setConnecting(false);
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
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://claudio.example.com…"
              autoFocus
              spellCheck={false}
              autoComplete="url"
              className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-text-primary placeholder-text-muted text-sm focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
            />
          </div>

          {error && (
            <p className="text-red-400 text-sm" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={connecting}
            className="w-full py-2.5 rounded-lg bg-accent hover:bg-accent-hover text-neutral-950 font-medium text-sm transition disabled:opacity-60"
          >
            {connecting ? (
              <span className="inline-flex items-center gap-2">
                <svg
                  className="animate-spin h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                Connecting…
              </span>
            ) : (
              "Connect"
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
