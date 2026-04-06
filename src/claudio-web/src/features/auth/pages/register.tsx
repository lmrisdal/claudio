import { useState } from "react";
import { Link, useNavigate } from "react-router";
import Logo from "../../core/components/logo";
import { useAuth } from "../hooks/use-auth";

export default function Register() {
  const navigate = useNavigate();
  const { register, providers } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);
    try {
      await register(username, password);
      void navigate("/");
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : "Registration failed");
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
            {providers.localLoginEnabled && providers.userCreationEnabled
              ? "Create your account"
              : "Sign in with your identity provider"}
          </p>
        </div>

        <div className="card bg-surface rounded-xl p-6 ring-1 ring-border">
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2.5 mb-4">
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}

          {providers.localLoginEnabled && providers.userCreationEnabled && (
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
                  minLength={8}
                  className="input-field w-full bg-surface-raised border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-focus-ring focus:ring-1 focus:ring-focus-ring/30 transition"
                />
              </div>
              <div>
                <label
                  htmlFor="confirm-password"
                  className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wider"
                >
                  Confirm password
                </label>
                <input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={8}
                  className="input-field w-full bg-surface-raised border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-focus-ring focus:ring-1 focus:ring-focus-ring/30 transition"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-accent hover:bg-accent-hover disabled:opacity-50 text-accent-foreground font-semibold py-2.5 rounded-lg transition text-sm mt-2"
              >
                {loading ? "Creating account…" : "Create account"}
              </button>
            </form>
          )}

          {providers.providers.length > 0 && (
            <>
              {providers.localLoginEnabled && providers.userCreationEnabled && (
                <div className="my-4 flex items-center gap-3">
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-xs uppercase tracking-[0.2em] text-text-muted">or</span>
                  <div className="h-px flex-1 bg-border" />
                </div>
              )}

              {providers.providers.map((provider) => (
                <a
                  key={provider.slug}
                  href={provider.startUrl}
                  className={`${providers.localLoginEnabled && providers.userCreationEnabled ? "mt-3 " : ""}flex min-h-11 w-full items-center justify-center rounded-lg border border-border bg-surface-raised px-4 py-2.5 text-sm font-semibold text-text-primary transition hover:border-accent/40 hover:bg-surface`}
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
                  {`Continue with ${provider.displayName}`}
                </a>
              ))}
            </>
          )}

          {!providers.userCreationEnabled && providers.providers.length > 0 && (
            <p className="text-sm text-text-muted">
              New accounts are disabled. Sign in with an existing external account.
            </p>
          )}

          {!providers.userCreationEnabled && providers.providers.length === 0 && (
            <p className="text-sm text-text-muted">
              User creation is disabled and no external providers are configured for existing users.
            </p>
          )}

          {providers.userCreationEnabled &&
            !providers.localLoginEnabled &&
            providers.providers.length === 0 && (
              <p className="text-sm text-text-muted">
                Local registration is disabled and no external providers are configured.
              </p>
            )}
        </div>

        <p className="text-center text-text-muted text-sm mt-6">
          <Link to="/login" className="text-accent hover:underline">
            {providers.localLoginEnabled && providers.userCreationEnabled
              ? "Already have an account? Sign in"
              : "Back to sign in"}
          </Link>
        </p>
      </div>
    </div>
  );
}
