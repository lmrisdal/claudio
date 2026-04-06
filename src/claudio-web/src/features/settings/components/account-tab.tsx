import { useState } from "react";
import { api } from "../../core/api/client";
import { setIndexedRef as setIndexedReference } from "../../core/utils/dom";
import { useAuth } from "../../auth/hooks/use-auth";

export default function AccountTab({
  contentRefs,
}: {
  contentRefs: React.RefObject<(HTMLButtonElement | HTMLInputElement | null)[]>;
}) {
  const { user, providers } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setSuccess(false);

    if (newPassword !== confirmPassword) {
      setError("New passwords do not match");
      return;
    }

    setLoading(true);
    try {
      await api.put<void>("/auth/change-password", {
        currentPassword,
        newPassword,
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSuccess(true);
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : "Failed to change password");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
        <span className="text-text-muted">Username</span>
        <span className="font-mono text-text-primary">{user?.username}</span>
        <span className="text-text-muted">Role</span>
        <span>
          <span
            className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full font-medium ${
              user?.role === "admin"
                ? "bg-accent-dim text-accent"
                : "bg-surface-raised text-text-secondary ring-1 ring-border"
            }`}
          >
            {user?.role}
          </span>
        </span>
        <span className="text-text-muted">Member since</span>
        <span className="text-text-primary">
          {user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : "—"}
        </span>
      </div>

      {providers.localLoginEnabled && (
        <form onSubmit={handleSubmit} className="max-w-sm space-y-3 border-t border-border pt-5">
          <h3 className="text-sm font-medium text-text-primary">Change password</h3>

          {error && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}
          {success && (
            <div className="rounded-lg border border-accent/20 bg-accent-dim px-3 py-2">
              <p className="text-sm text-accent">Password changed successfully.</p>
            </div>
          )}

          <div>
            <label
              htmlFor="account-current-password"
              className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-text-muted"
            >
              Current password
            </label>
            <input
              ref={(element) => setIndexedReference(contentRefs, 0, element)}
              id="account-current-password"
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              required
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text-primary transition focus:border-focus-ring focus:outline-none focus:ring-1 focus:ring-focus-ring/30"
            />
          </div>

          <div>
            <label
              htmlFor="account-new-password"
              className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-text-muted"
            >
              New password
            </label>
            <input
              ref={(element) => setIndexedReference(contentRefs, 1, element)}
              id="account-new-password"
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              required
              minLength={8}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text-primary transition focus:border-focus-ring focus:outline-none focus:ring-1 focus:ring-focus-ring/30"
            />
          </div>

          <div>
            <label
              htmlFor="account-confirm-new-password"
              className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-text-muted"
            >
              Confirm new password
            </label>
            <input
              ref={(element) => setIndexedReference(contentRefs, 2, element)}
              id="account-confirm-new-password"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
              minLength={8}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text-primary transition focus:border-focus-ring focus:outline-none focus:ring-1 focus:ring-focus-ring/30"
            />
          </div>

          <button
            ref={(element) => setIndexedReference(contentRefs, 3, element)}
            type="submit"
            disabled={loading}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground transition hover:bg-accent-hover disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            {loading ? "Changing..." : "Change password"}
          </button>
        </form>
      )}
    </div>
  );
}
