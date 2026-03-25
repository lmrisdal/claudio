import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import Logo from "../components/Logo";
import { useAuth } from "../hooks/useAuth";

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, providers } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [providerLoading, setProviderLoading] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const authError = params.get("error");

    if (authError) {
      setError(authError);
    } else {
      setError("");
    }
  }, [location.search]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(username, password);
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-grid">
      <div className="w-full max-w-sm">
        <div className="text-center mb-10">
          <Logo className="text-5xl" />
          <p className="text-text-muted text-sm mt-3">
            {providers.localLoginEnabled
              ? "Sign in to your library"
              : "Sign in with your identity provider"}
          </p>
        </div>

        <div className="card bg-surface rounded-xl p-6 ring-1 ring-border">
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2.5 mb-4">
              <p className="text-red-400 text-sm">{error}</p>
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
                  required
                  autoFocus
                  className="input-field w-full bg-surface-raised border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition"
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
                  className="input-field w-full bg-surface-raised border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition"
                />
              </div>
              <button
                type="submit"
                disabled={loading || providerLoading !== null}
                className="w-full bg-accent hover:bg-accent-hover disabled:opacity-50 text-neutral-950 font-semibold py-2.5 rounded-lg transition text-sm mt-2"
              >
                {loading ? "Signing in…" : "Sign in"}
              </button>
            </form>
          )}

          {providers.providers.length > 0 && (
            <>
              {providers.localLoginEnabled && (
                <div className="my-4 flex items-center gap-3">
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-xs uppercase tracking-[0.2em] text-text-muted">
                    or
                  </span>
                  <div className="h-px flex-1 bg-border" />
                </div>
              )}

              {providers.providers.map((provider) => (
                <a
                  key={provider.slug}
                  href={provider.startUrl}
                  onClick={() => setProviderLoading(provider.displayName)}
                  aria-disabled={providerLoading !== null}
                  className={`${providers.localLoginEnabled ? "mt-3 " : ""}flex not-last:mb-3 min-h-11 w-full items-center justify-center rounded-lg border border-border bg-surface-raised px-4 py-2.5 text-sm font-semibold text-text-primary transition hover:border-accent/40 hover:bg-surface disabled:opacity-50`}
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
