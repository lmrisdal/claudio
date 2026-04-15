import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { resolveServerUrl } from "../../core/api/client";
import Logo from "../../core/components/logo";
import { useServerStatus } from "../../core/hooks/use-server-status";
import {
  desktopOpenExternalLogin,
  getSettings,
  isDesktop,
  updateSettings,
} from "../../desktop/hooks/use-desktop";
import { useAuth } from "../hooks/use-auth";

const secureStorageErrorPrefix = "Secure storage unavailable:";

function getDesktopConnectionMessage(serverUrl: string | null): string {
  if (serverUrl && serverUrl !== "Not configured" && serverUrl !== "Unavailable") {
    return `Can't connect to the Claudio server at ${serverUrl}. Check that the server is running and the URL is correct.`;
  }

  return "Can't connect to the Claudio server. Check that the server URL is configured and the server is running.";
}

function toLoginErrorMessage(error_: unknown, connectionMessage: string): string {
  const message = error_ instanceof Error ? error_.message : "";

  if (message.startsWith(secureStorageErrorPrefix)) {
    return message;
  }

  return connectionMessage || message || "Login failed";
}

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, providers } = useAuth();
  const { isConnected } = useServerStatus();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [fallbackLoading, setFallbackLoading] = useState(false);
  const [providerLoading, setProviderLoading] = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState<string | null>(null);
  const connectionMessage = isDesktop && !isConnected ? getDesktopConnectionMessage(serverUrl) : "";
  const displayedError = error || connectionMessage;
  const canUseInsecureFallback = isDesktop && error.startsWith(secureStorageErrorPrefix);

  useEffect(() => {
    const parameters = new URLSearchParams(location.search);
    const authError = parameters.get("error");

    if (authError) {
      setError(authError);
    } else {
      setError("");
    }
  }, [location.search]);

  useEffect(() => {
    if (!isDesktop) return;

    let cancelled = false;

    void getSettings()
      .then((settings) => {
        if (cancelled) return;

        setServerUrl(settings.serverUrl ?? "Not configured");
      })
      .catch(() => {
        if (!cancelled) {
          setServerUrl("Unavailable");
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isDesktop) return;

    const unlistenComplete = listen("deep-link-auth-complete", () => {
      setProviderLoading(null);
    });
    const unlistenError = listen<string>("deep-link-auth-error", (event) => {
      setProviderLoading(null);
      setError(event.payload || "External login failed");
    });

    return () => {
      void unlistenComplete.then((fn) => fn());
      void unlistenError.then((fn) => fn());
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(username, password);
      void navigate("/");
    } catch (error_) {
      setError(toLoginErrorMessage(error_, connectionMessage));
    } finally {
      setLoading(false);
    }
  }

  async function handleEnableInsecureFallback() {
    setError("");
    setFallbackLoading(true);

    try {
      const settings = await getSettings();
      await updateSettings({ ...settings, allowInsecureAuthStorage: true });
      await login(username, password);
      void navigate("/");
    } catch (error_) {
      setError(toLoginErrorMessage(error_, connectionMessage));
    } finally {
      setFallbackLoading(false);
    }
  }

  return (
    <div className="auth-shell min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className={`text-center ${isDesktop ? "mb-2" : "mb-10"}`}>
          <Logo className="text-5xl" />
          <p className="text-text-muted text-sm mt-3">
            {providers.localLoginEnabled
              ? "Sign in to your library"
              : "Sign in with your identity provider"}
          </p>
          {isDesktop && serverUrl !== null && (
            <Link
              to="/desktop-setup"
              className="mt-8 inline-block text-xs text-accent hover:underline"
            >
              URL: {serverUrl}
            </Link>
          )}
        </div>

        <div className="card auth-card bg-surface rounded-xl p-6 ring-1 ring-border">
          {displayedError && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2.5 mb-4">
              <p className="text-red-400 text-sm">{displayedError}</p>
            </div>
          )}

          {canUseInsecureFallback && (
            <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
              <p className="text-sm text-amber-200">
                Secure storage is unavailable. You can continue with an insecure plaintext file on
                this machine, but your desktop session will not be protected by the OS keyring.
              </p>
              <button
                type="button"
                onClick={handleEnableInsecureFallback}
                disabled={
                  fallbackLoading || loading || providerLoading !== null || !username || !password
                }
                className="mt-3 w-full rounded-lg border border-amber-400/40 px-4 py-2.5 text-sm font-semibold text-amber-100 transition hover:bg-amber-500/10 disabled:opacity-50"
              >
                {fallbackLoading ? "Switching to insecure storage..." : "Use insecure file storage"}
              </button>
            </div>
          )}

          {providers.localLoginEnabled && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="username"
                  className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wider"
                >
                  Username
                </label>
                <input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoCapitalize="none"
                  autoComplete="username"
                  autoCorrect="off"
                  spellCheck="false"
                  required
                  autoFocus
                  className="input-field w-full bg-surface-raised border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-focus-ring focus:ring-1 focus:ring-focus-ring/30 transition"
                />
              </div>
              <div>
                <label
                  htmlFor="password"
                  className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wider"
                >
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  autoCorrect="off"
                  spellCheck="false"
                  className="input-field w-full bg-surface-raised border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-focus-ring focus:ring-1 focus:ring-focus-ring/30 transition"
                />
              </div>
              <button
                type="submit"
                disabled={loading || providerLoading !== null || Boolean(connectionMessage)}
                className="w-full bg-accent hover:bg-accent-hover disabled:opacity-50 text-accent-foreground font-semibold py-2.5 rounded-lg transition text-sm mt-2"
              >
                {loading ? "Signing in…" : connectionMessage ? "Server unavailable" : "Sign in"}
              </button>
            </form>
          )}

          {providers.providers.length > 0 && (
            <>
              {providers.localLoginEnabled && (
                <div className="my-4 flex items-center gap-3">
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-xs uppercase tracking-[0.2em] text-text-muted">or</span>
                  <div className="h-px flex-1 bg-border" />
                </div>
              )}

              {providers.providers.map((provider) => (
                <a
                  key={provider.slug}
                  href={isDesktop ? "#" : resolveServerUrl(provider.startUrl)}
                  onClick={(event) => {
                    if (connectionMessage) {
                      event.preventDefault();
                      return;
                    }

                    if (isDesktop) {
                      event.preventDefault();
                      setProviderLoading(provider.displayName);
                      desktopOpenExternalLogin(provider.startUrl).catch((error) => {
                        setProviderLoading(null);
                        setError(error instanceof Error ? error.message : "Failed to open browser");
                      });
                      return;
                    }

                    setProviderLoading(provider.displayName);
                  }}
                  aria-disabled={providerLoading !== null || Boolean(connectionMessage)}
                  className={`${providers.localLoginEnabled ? "mt-3 " : ""}flex not-last:mb-3 min-h-11 w-full items-center justify-center rounded-lg border border-border bg-surface-raised px-4 py-2.5 text-sm font-semibold text-text-primary transition hover:border-accent/40 hover:bg-surface ${connectionMessage ? "pointer-events-none opacity-50" : ""}`}
                >
                  {provider.logoUrl ? (
                    <img
                      src={provider.logoUrl}
                      alt=""
                      aria-hidden="true"
                      className="mr-3 h-5 w-5 rounded-sm object-contain"
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="mr-3 flex h-5 w-5 items-center justify-center rounded-sm bg-border text-[10px] uppercase tracking-wide text-text-secondary"
                    >
                      {provider.displayName.slice(0, 1)}
                    </span>
                  )}
                  {providerLoading === provider.displayName
                    ? `Completing ${provider.displayName} sign-in…`
                    : `Continue with ${provider.displayName}`}
                </a>
              ))}
            </>
          )}

          {!providers.localLoginEnabled && providers.providers.length === 0 && (
            <p className="text-sm text-text-muted">
              Local login is disabled and no external providers are configured.
            </p>
          )}
        </div>

        {providers.localLoginEnabled && providers.userCreationEnabled && (
          <p className="text-center text-text-muted text-sm mt-6">
            No account?{" "}
            <Link to="/register" className="text-accent hover:underline">
              Register
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
