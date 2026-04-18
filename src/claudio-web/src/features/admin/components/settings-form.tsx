import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../core/api/client";

export interface AdminConfig {
  igdb: { clientId: string; clientSecret: string };
  steamgriddb: { apiKey: string };
}

export default function SettingsForm({ initialConfig }: { initialConfig: AdminConfig }) {
  const queryClient = useQueryClient();

  const [igdbClientId, setIgdbClientId] = useState(initialConfig.igdb.clientId);
  const [igdbClientSecret, setIgdbClientSecret] = useState(initialConfig.igdb.clientSecret);
  const [sgdbApiKey, setSgdbApiKey] = useState(initialConfig.steamgriddb.apiKey);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  const saveMutation = useMutation({
    mutationFn: (body: object) => api.put<AdminConfig>("/admin/config", body),
    onSuccess: (data) => {
      queryClient.setQueryData(["adminConfig"], data);
      setIgdbClientId(data.igdb.clientId);
      setIgdbClientSecret(data.igdb.clientSecret);
      setSgdbApiKey(data.steamgriddb.apiKey);
      setSuccess(true);
      setError("");
      setTimeout(() => setSuccess(false), 3000);
    },
    onError: (error_: Error) => {
      setError(error_.message);
      setSuccess(false);
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Only send fields that have been changed from the masked values
    const isMasked = (v: string) => v.includes("••••••");
    const body: Record<string, Record<string, string>> = {
      igdb: {},
      steamgriddb: {},
    };

    body.igdb.clientId = igdbClientId;
    if (!isMasked(igdbClientSecret)) body.igdb.clientSecret = igdbClientSecret;
    if (!isMasked(sgdbApiKey)) body.steamgriddb.apiKey = sgdbApiKey;

    saveMutation.mutate(body);
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm dark:text-amber-100">
          Saved settings are written to `config.toml`. Docker environment variables like
          `CLAUDIO_IGDB_CLIENT_ID`, `CLAUDIO_IGDB_CLIENT_SECRET`, and `CLAUDIO_STEAMGRIDDB_API_KEY`
          still override those saved values on container startup.
        </div>

        {/* IGDB */}
        <div className="card bg-surface rounded-xl p-6 ring-1 ring-border">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-lg bg-purple-500/15 flex items-center justify-center shrink-0">
              <svg
                className="w-5 h-5 text-purple-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418"
                />
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="font-medium text-text-primary mb-1">IGDB / Twitch</h3>
              <p className="text-text-secondary text-sm mb-4">
                Used for game metadata — covers, summaries, genres, and release dates. Get
                credentials from the{" "}
                <a
                  href="https://dev.twitch.tv/console"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:underline"
                >
                  Twitch Developer Console
                </a>
                .
              </p>
              <div className="grid gap-3 max-w-md">
                <div>
                  <label
                    htmlFor="igdb-client-id"
                    className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wider"
                  >
                    Client ID
                  </label>
                  <input
                    id="igdb-client-id"
                    type="text"
                    value={igdbClientId}
                    onChange={(e) => setIgdbClientId(e.target.value)}
                    placeholder="Twitch client ID…"
                    spellCheck={false}
                    className="w-full bg-surface-raised border border-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-focus-ring focus:ring-1 focus:ring-focus-ring/30 transition"
                  />
                </div>
                <div>
                  <label
                    htmlFor="igdb-client-secret"
                    className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wider"
                  >
                    Client Secret
                  </label>
                  <input
                    id="igdb-client-secret"
                    type="text"
                    value={igdbClientSecret}
                    onChange={(e) => setIgdbClientSecret(e.target.value)}
                    placeholder="Twitch client secret…"
                    spellCheck={false}
                    className="w-full bg-surface-raised border border-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-focus-ring focus:ring-1 focus:ring-focus-ring/30 transition"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* SteamGridDB */}
        <div className="card bg-surface rounded-xl p-6 ring-1 ring-border">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-lg bg-blue-500/15 flex items-center justify-center shrink-0">
              <svg
                className="w-5 h-5 text-blue-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z"
                />
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="font-medium text-text-primary mb-1">SteamGridDB</h3>
              <p className="text-text-secondary text-sm mb-4">
                Used for cover art and hero image search. Get an API key from{" "}
                <a
                  href="https://www.steamgriddb.com/profile/preferences/api"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:underline"
                >
                  SteamGridDB
                </a>
                .
              </p>
              <div className="max-w-md">
                <label
                  htmlFor="sgdb-api-key"
                  className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wider"
                >
                  API Key
                </label>
                <input
                  id="sgdb-api-key"
                  type="text"
                  value={sgdbApiKey}
                  onChange={(e) => setSgdbApiKey(e.target.value)}
                  placeholder="SteamGridDB API key…"
                  spellCheck={false}
                  className="w-full bg-surface-raised border border-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-focus-ring focus:ring-1 focus:ring-focus-ring/30 transition"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Save */}
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saveMutation.isPending}
            className="bg-accent hover:bg-accent-hover disabled:opacity-50 text-accent-foreground font-semibold px-5 py-2.5 rounded-lg transition text-sm"
          >
            {saveMutation.isPending ? "Saving…" : "Save"}
          </button>
          {success && <span className="text-sm text-accent">Settings saved.</span>}
          {error && <span className="text-sm text-red-400">{error}</span>}
        </div>
      </form>
    </div>
  );
}
