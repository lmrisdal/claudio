import { useState } from "react";
import { api } from "../../core/api/client";

import { setIndexedRef as setIndexedReference } from "../../core/utils/dom";

export default function SecurityTab({
  contentRefs,
}: {
  contentRefs: React.RefObject<(HTMLButtonElement | HTMLInputElement | null)[]>;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
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
    <form onSubmit={handleSubmit} className="space-y-4 max-w-sm">
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2.5">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}
      {success && (
        <div className="bg-accent-dim border border-accent/20 rounded-lg px-4 py-2.5">
          <p className="text-accent text-sm">Password changed successfully.</p>
        </div>
      )}

      <div>
        <label
          htmlFor="account-current-password"
          className="block text-xs font-medium text-white/50 mb-1.5 uppercase tracking-wider"
        >
          Current password
        </label>
        <input
          ref={(element) => setIndexedReference(contentRefs, 0, element)}
          id="account-current-password"
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          required
          className="w-full bg-white/6 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition"
        />
      </div>
      <div>
        <label
          htmlFor="account-new-password"
          className="block text-xs font-medium text-white/50 mb-1.5 uppercase tracking-wider"
        >
          New password
        </label>
        <input
          ref={(element) => setIndexedReference(contentRefs, 1, element)}
          id="account-new-password"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
          minLength={8}
          className="w-full bg-white/6 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition"
        />
      </div>
      <div>
        <label
          htmlFor="account-confirm-new-password"
          className="block text-xs font-medium text-white/50 mb-1.5 uppercase tracking-wider"
        >
          Confirm new password
        </label>
        <input
          ref={(element) => setIndexedReference(contentRefs, 2, element)}
          id="account-confirm-new-password"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          minLength={8}
          className="w-full bg-white/6 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition"
        />
      </div>
      <button
        ref={(element) => setIndexedReference(contentRefs, 3, element)}
        type="submit"
        disabled={loading}
        className="bg-accent hover:bg-accent-hover disabled:opacity-50 text-neutral-950 font-semibold px-5 py-2.5 rounded-lg transition text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black/50"
      >
        {loading ? "Changing\u2026" : "Change password"}
      </button>
    </form>
  );
}
