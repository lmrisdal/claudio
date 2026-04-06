import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useAuth } from "../../auth/hooks/use-auth";
import { api } from "../../core/api/client";
import type { User } from "../../core/types/models";

export default function UsersTab() {
  const { user: currentUser, providers } = useAuth();
  const queryClient = useQueryClient();
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [addError, setAddError] = useState("");

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["users"],
    queryFn: () => api.get<User[]>("/admin/users"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/admin/users/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["users"] }),
  });

  const toggleRoleMutation = useMutation({
    mutationFn: (user: User) =>
      api.put(`/admin/users/${user.id}/role`, {
        role: user.role === "admin" ? "user" : "admin",
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["users"] }),
  });

  const addUserMutation = useMutation({
    mutationFn: () =>
      api.post("/auth/register", {
        username: newUsername,
        password: newPassword,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["users"] });
      setShowAddUser(false);
      setNewUsername("");
      setNewPassword("");
      setAddError("");
    },
    onError: (error: Error) => setAddError(error.message),
  });

  return (
    <div className="space-y-6">
      {/* Add user */}
      {providers.localLoginEnabled && providers.userCreationEnabled ? (
        <div className="flex justify-end">
          <button
            onClick={() => setShowAddUser(!showAddUser)}
            className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-surface-raised ring-1 ring-border hover:ring-accent/50 text-text-secondary transition"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Add user
          </button>
        </div>
      ) : (
        <p className="text-sm text-text-muted">
          {providers.userCreationEnabled
            ? "Local username/password accounts are disabled. Users must sign in through a configured external provider."
            : "User creation is disabled. Existing users can still sign in, but new accounts cannot be created here."}
        </p>
      )}

      {providers.localLoginEnabled && providers.userCreationEnabled && showAddUser && (
        <div className="card bg-surface rounded-xl p-5 ring-1 ring-border">
          <h3 className="text-sm font-medium mb-4">New user</h3>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              addUserMutation.mutate();
            }}
            className="flex flex-col sm:flex-row gap-3"
          >
            <input
              type="text"
              placeholder="Username"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              required
              className="input-field flex-1 bg-surface-raised border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-focus-ring transition"
            />
            <input
              type="password"
              placeholder="Password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={8}
              className="input-field flex-1 bg-surface-raised border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-focus-ring transition"
            />
            <button
              type="submit"
              disabled={addUserMutation.isPending}
              className="bg-accent hover:bg-accent-hover disabled:opacity-50 text-accent-foreground font-medium px-4 py-2 rounded-lg transition text-sm whitespace-nowrap"
            >
              {addUserMutation.isPending ? "Adding..." : "Add"}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowAddUser(false);
                setNewUsername("");
                setNewPassword("");
                setAddError("");
              }}
              className="px-4 py-2 rounded-lg text-sm text-text-secondary hover:text-text-primary hover:bg-surface-overlay ring-1 ring-border transition whitespace-nowrap"
            >
              Cancel
            </button>
          </form>
          {addError && <p className="text-red-400 text-sm mt-2">{addError}</p>}
        </div>
      )}

      {/* Users table */}
      <div className="card bg-surface rounded-xl ring-1 ring-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-text-muted border-b border-border bg-surface-raised">
              <th className="px-5 py-3 font-medium text-xs uppercase tracking-wider">Username</th>
              <th className="px-5 py-3 font-medium text-xs uppercase tracking-wider">Role</th>
              <th className="px-5 py-3 font-medium text-xs uppercase tracking-wider">Created</th>
              <th className="px-5 py-3 font-medium text-xs uppercase tracking-wider text-right">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={4} className="px-5 py-8 text-center text-text-muted">
                  Loading...
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-5 py-8 text-center text-text-muted">
                  No users
                </td>
              </tr>
            ) : (
              users.map((user) => (
                <tr
                  key={user.id}
                  className="border-b border-border/50 hover:bg-surface-raised/50 transition-colors"
                >
                  <td className="px-5 py-3.5 font-mono text-sm">{user.username}</td>
                  <td className="px-5 py-3.5">
                    <span
                      className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full font-medium ${
                        user.role === "admin"
                          ? "bg-accent-dim text-accent"
                          : "bg-surface-raised text-text-secondary ring-1 ring-border"
                      }`}
                    >
                      {user.role}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-text-muted">
                    {new Date(user.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <div className="inline-flex gap-1">
                      {user.username !== currentUser?.username && (
                        <>
                          {user.role !== "admin" && (
                            <button
                              onClick={() => toggleRoleMutation.mutate(user)}
                              disabled={toggleRoleMutation.isPending}
                              className="px-2.5 py-1 rounded-md text-xs text-text-secondary hover:text-text-primary hover:bg-surface-overlay transition"
                            >
                              Promote
                            </button>
                          )}
                          {user.role === "admin" && (
                            <button
                              onClick={() => toggleRoleMutation.mutate(user)}
                              disabled={toggleRoleMutation.isPending}
                              className="px-2.5 py-1 rounded-md text-xs text-text-secondary hover:text-text-primary hover:bg-surface-overlay transition"
                            >
                              Demote
                            </button>
                          )}
                          <button
                            onClick={() => {
                              if (confirm(`Delete user "${user.username}"?`))
                                deleteMutation.mutate(user.id);
                            }}
                            disabled={deleteMutation.isPending}
                            className="px-2.5 py-1 rounded-md text-xs text-red-400/70 hover:text-red-400 hover:bg-red-500/10 transition"
                          >
                            Delete
                          </button>
                        </>
                      )}
                      {user.username === currentUser?.username && (
                        <span className="px-2.5 py-1 text-xs text-text-muted">You</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
