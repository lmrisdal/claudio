import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { api } from "../api/client";
import { useAuth } from "../hooks/useAuth";
import type { Game, TasksStatus, User } from "../types/models";
import { formatPlatform } from "../utils/platforms";

export default function Admin() {
  const [searchParams, setSearchParams] = useSearchParams();
  const validTabs = ["users", "games", "scan", "settings"] as const;
  type Tab = (typeof validTabs)[number];
  const tabParam = searchParams.get("tab") as Tab;
  const activeTab: Tab = validTabs.includes(tabParam) ? tabParam : "users";
  const setActiveTab = (tab: Tab) =>
    setSearchParams({ tab }, { replace: false });

  const tabs = [
    { id: "users" as const, label: "Users" },
    { id: "games" as const, label: "Games" },
    { id: "scan" as const, label: "Library Scan" },
    { id: "settings" as const, label: "Settings" },
  ];

  return (
    <main className="max-w-4xl mx-auto px-6 py-8">
      <h1 className="font-display text-3xl font-bold text-heading text-text-primary mb-8">
        Admin Panel
      </h1>

      {/* Tabs */}
      <div className="flex gap-1 mb-8 border-b border-border">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition ${
              activeTab === tab.id
                ? "border-accent text-accent"
                : "border-transparent text-text-muted hover:text-text-secondary"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "users" && <UsersTab />}
      {activeTab === "games" && <GamesTab />}
      {activeTab === "scan" && <ScanTab />}
      {activeTab === "settings" && <SettingsTab />}
    </main>
  );
}

function UsersTab() {
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users"] }),
  });

  const toggleRoleMutation = useMutation({
    mutationFn: (user: User) =>
      api.put(`/admin/users/${user.id}/role`, {
        role: user.role === "admin" ? "user" : "admin",
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users"] }),
  });

  const addUserMutation = useMutation({
    mutationFn: () =>
      api.post("/auth/register", {
        username: newUsername,
        password: newPassword,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      setShowAddUser(false);
      setNewUsername("");
      setNewPassword("");
      setAddError("");
    },
    onError: (err: Error) => setAddError(err.message),
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
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 4.5v15m7.5-7.5h-15"
              />
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

      {providers.localLoginEnabled &&
        providers.userCreationEnabled &&
        showAddUser && (
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
                className="input-field flex-1 bg-surface-raised border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent transition"
              />
              <input
                type="password"
                placeholder="Password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
                className="input-field flex-1 bg-surface-raised border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent transition"
              />
              <button
                type="submit"
                disabled={addUserMutation.isPending}
                className="bg-accent hover:bg-accent-hover disabled:opacity-50 text-neutral-950 font-medium px-4 py-2 rounded-lg transition text-sm whitespace-nowrap"
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
            {addError && (
              <p className="text-red-400 text-sm mt-2">{addError}</p>
            )}
          </div>
        )}

      {/* Users table */}
      <div className="card bg-surface rounded-xl ring-1 ring-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-text-muted border-b border-border bg-surface-raised">
              <th className="px-5 py-3 font-medium text-xs uppercase tracking-wider">
                Username
              </th>
              <th className="px-5 py-3 font-medium text-xs uppercase tracking-wider">
                Role
              </th>
              <th className="px-5 py-3 font-medium text-xs uppercase tracking-wider">
                Created
              </th>
              <th className="px-5 py-3 font-medium text-xs uppercase tracking-wider text-right">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td
                  colSpan={4}
                  className="px-5 py-8 text-center text-text-muted"
                >
                  Loading...
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="px-5 py-8 text-center text-text-muted"
                >
                  No users
                </td>
              </tr>
            ) : (
              users.map((user) => (
                <tr
                  key={user.id}
                  className="border-b border-border/50 hover:bg-surface-raised/50 transition-colors"
                >
                  <td className="px-5 py-3.5 font-mono text-sm">
                    {user.username}
                  </td>
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
                        <span className="px-2.5 py-1 text-xs text-text-muted">
                          You
                        </span>
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

function GamesTab() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [showMissingOnly, setShowMissingOnly] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Game | null>(null);
  const [deleteFiles, setDeleteFiles] = useState(false);

  const { data: games = [], isLoading } = useQuery({
    queryKey: ["games"],
    queryFn: () => api.get<Game[]>("/games"),
  });

  const deleteMutation = useMutation({
    mutationFn: ({ id, deleteFiles }: { id: number; deleteFiles: boolean }) =>
      api.delete(`/admin/games/${id}?deleteFiles=${deleteFiles}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["games"] });
      setDeleteTarget(null);
      setDeleteFiles(false);
    },
  });

  const removeMissingMutation = useMutation({
    mutationFn: () => api.delete<{ removed: number }>("/admin/games/missing"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["games"] });
      setShowMissingOnly(false);
    },
  });

  const filtered = games.filter((g) => {
    if (showMissingOnly && !g.isMissing) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        g.title.toLowerCase().includes(q) ||
        g.platform.toLowerCase().includes(q)
      );
    }
    return true;
  });
  const missingCount = games.filter((g) => g.isMissing).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
            />
          </svg>
          <input
            type="text"
            placeholder="Filter games..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-surface-raised border border-border rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-accent transition placeholder:text-text-muted"
          />
        </div>
        <p className="text-sm text-text-secondary whitespace-nowrap">
          {filtered.length}/{games.length}
          {missingCount > 0 && (
            <span className="text-red-400 ml-1">({missingCount} missing)</span>
          )}
        </p>
        {missingCount > 0 && (
          <>
            <button
              onClick={() => setShowMissingOnly(!showMissingOnly)}
              className={`text-xs px-3 py-1.5 rounded-lg transition whitespace-nowrap ${
                showMissingOnly
                  ? "bg-red-500/20 text-red-400 ring-1 ring-red-500/30"
                  : "bg-surface-raised text-text-secondary ring-1 ring-border hover:ring-accent/50"
              }`}
            >
              {showMissingOnly ? "Show all" : "Show missing only"}
            </button>
            <button
              onClick={() => {
                if (
                  confirm(
                    `Remove ${missingCount} missing game${missingCount > 1 ? "s" : ""} from the library?`,
                  )
                )
                  removeMissingMutation.mutate();
              }}
              disabled={removeMissingMutation.isPending}
              className="text-xs px-3 py-1.5 rounded-lg transition whitespace-nowrap bg-surface-raised text-red-400 ring-1 ring-border hover:ring-red-500/50 disabled:opacity-50"
            >
              Remove all missing
            </button>
          </>
        )}
      </div>

      <div className="card bg-surface rounded-xl ring-1 ring-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-text-muted border-b border-border bg-surface-raised">
              <th className="px-5 py-3 font-medium text-xs uppercase tracking-wider">
                Title
              </th>
              <th className="px-5 py-3 font-medium text-xs uppercase tracking-wider">
                Platform
              </th>
              <th className="px-5 py-3 font-medium text-xs uppercase tracking-wider">
                Status
              </th>
              <th className="px-5 py-3 font-medium text-xs uppercase tracking-wider text-right">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td
                  colSpan={4}
                  className="px-5 py-8 text-center text-text-muted"
                >
                  Loading...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="px-5 py-8 text-center text-text-muted"
                >
                  {showMissingOnly ? "No missing games" : "No games"}
                </td>
              </tr>
            ) : (
              filtered.map((game) => (
                <tr
                  key={game.id}
                  className="border-b border-border/50 hover:bg-surface-raised/50 transition-colors"
                >
                  <td className="px-5 py-3.5 font-medium">
                    <Link
                      to={`/games/${game.id}`}
                      className="text-accent hover:underline"
                    >
                      {game.title}
                    </Link>
                  </td>
                  <td className="px-5 py-3.5 text-text-secondary">
                    {formatPlatform(game.platform)}
                  </td>
                  <td className="px-5 py-3.5">
                    {game.isMissing ? (
                      <span className="inline-flex items-center text-xs px-2 py-0.5 rounded-full font-medium bg-red-500/15 text-red-400">
                        missing
                      </span>
                    ) : (
                      <span className="inline-flex items-center text-xs px-2 py-0.5 rounded-full font-medium bg-accent-dim text-accent">
                        ok
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <button
                      onClick={() => setDeleteTarget(game)}
                      disabled={deleteMutation.isPending}
                      className="px-2.5 py-1 rounded-md text-xs text-red-400/70 hover:text-red-400 hover:bg-red-500/10 transition"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => {
            setDeleteTarget(null);
            setDeleteFiles(false);
          }}
        >
          <div
            className="bg-surface rounded-xl ring-1 ring-border p-6 max-w-sm w-full mx-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-text-primary font-medium mb-2">Delete game</h3>
            <p className="text-sm text-text-secondary mb-4">
              Remove{" "}
              <span className="font-medium text-text-primary">
                "{deleteTarget.title}"
              </span>{" "}
              from the database?
            </p>
            {!deleteTarget.isMissing && (
              <label className="flex items-center gap-2.5 mb-5 text-sm cursor-pointer group">
                <input
                  type="checkbox"
                  checked={deleteFiles}
                  onChange={(e) => setDeleteFiles(e.target.checked)}
                  className="w-4 h-4 rounded border-border accent-red-500"
                />
                <span className="text-red-400">
                  Also delete files from disk
                </span>
              </label>
            )}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setDeleteTarget(null);
                  setDeleteFiles(false);
                }}
                className="px-4 py-2 rounded-lg text-sm text-text-secondary hover:text-text-primary hover:bg-surface-overlay ring-1 ring-border transition"
              >
                Cancel
              </button>
              <button
                onClick={() =>
                  deleteMutation.mutate({ id: deleteTarget.id, deleteFiles })
                }
                disabled={deleteMutation.isPending}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-red-500/20 text-red-400 hover:bg-red-500/30 ring-1 ring-red-500/30 transition disabled:opacity-50"
              >
                {deleteMutation.isPending ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ScanTab() {
  const queryClient = useQueryClient();
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<{
    gamesFound: number;
    gamesAdded: number;
    gamesMissing: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [igdbError, setIgdbError] = useState<string | null>(null);

  const { data: tasks } = useQuery({
    queryKey: ["tasksStatus"],
    queryFn: () => api.get<TasksStatus>("/admin/tasks/status"),
    enabled: false,
  });
  const igdbStatus = tasks?.igdb;

  const wasRunning = useRef(false);
  useEffect(() => {
    if (igdbStatus?.isRunning) {
      wasRunning.current = true;
    } else if (wasRunning.current) {
      wasRunning.current = false;
      queryClient.invalidateQueries({ queryKey: ["games"] });
    }
  }, [igdbStatus?.isRunning, queryClient]);

  async function triggerScan() {
    setScanning(true);
    setResult(null);
    setError(null);
    try {
      const res = await api.post<{
        gamesFound: number;
        gamesAdded: number;
        gamesMissing: number;
      }>("/admin/scan");
      setResult(res);
      queryClient.invalidateQueries({ queryKey: ["games"] });
      queryClient.invalidateQueries({ queryKey: ["tasksStatus"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  }

  async function triggerIgdbScan() {
    setIgdbError(null);
    try {
      await api.post("/admin/scan/igdb");
      queryClient.invalidateQueries({ queryKey: ["tasksStatus"] });
    } catch (err) {
      setIgdbError(err instanceof Error ? err.message : "IGDB scan failed");
    }
  }

  return (
    <div className="space-y-6">
      {/* Library scan */}
      <div className="card bg-surface rounded-xl p-6 ring-1 ring-border">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-lg bg-accent-dim flex items-center justify-center shrink-0">
            <svg
              className="w-5 h-5 text-accent"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
              />
            </svg>
          </div>
          <div className="flex-1">
            <h3 className="font-medium text-text-primary mb-1">Library Scan</h3>
            <p className="text-text-secondary text-sm mb-4">
              Walk the game library directories for new or changed games.
              Existing games will have their file sizes updated.
            </p>
            <button
              onClick={triggerScan}
              disabled={scanning}
              className="inline-flex items-center gap-2 bg-accent hover:bg-accent-hover disabled:opacity-50 text-neutral-950 font-semibold px-5 py-2.5 rounded-lg transition text-sm"
            >
              {scanning ? (
                <>
                  <svg
                    className="w-4 h-4 animate-spin"
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
                  Scanning...
                </>
              ) : (
                "Start Scan"
              )}
            </button>
          </div>
        </div>

        {result && (
          <div className="mt-4 ml-14 bg-accent-dim rounded-lg px-4 py-3">
            <p className="text-sm text-accent font-medium">
              Scan complete — {result.gamesFound} found, {result.gamesAdded}{" "}
              added, {result.gamesMissing} missing
            </p>
          </div>
        )}

        {error && (
          <div className="mt-4 ml-14 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}
      </div>

      {/* IGDB metadata scan */}
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
            <h3 className="font-medium text-text-primary mb-1">
              IGDB Metadata
            </h3>
            <p className="text-text-secondary text-sm mb-4">
              Fetch metadata from IGDB for games that haven't been matched yet —
              covers, summaries, genres, and release years.
            </p>
            <button
              onClick={triggerIgdbScan}
              disabled={igdbStatus?.isRunning}
              className="inline-flex items-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-semibold px-5 py-2.5 rounded-lg transition text-sm"
            >
              {igdbStatus?.isRunning ? (
                <>
                  <svg
                    className="w-4 h-4 animate-spin"
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
                  {igdbStatus.total > 0
                    ? `Matching ${igdbStatus.processed}/${igdbStatus.total}...`
                    : "Starting..."}
                </>
              ) : (
                "Fetch from IGDB"
              )}
            </button>
          </div>
        </div>

        {igdbStatus?.isRunning && igdbStatus.total > 0 && (
          <div className="mt-4 ml-14">
            <div className="h-1.5 rounded-full bg-surface-raised overflow-hidden">
              <div
                className="h-full rounded-full bg-purple-500 transition-all duration-500"
                style={{
                  width: `${Math.round((igdbStatus.processed / igdbStatus.total) * 100)}%`,
                }}
              />
            </div>
            {igdbStatus.currentGame && (
              <p className="text-xs text-text-muted mt-1.5">
                Matching: {igdbStatus.currentGame}
              </p>
            )}
          </div>
        )}

        {igdbError && (
          <div className="mt-4 ml-14 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">
            <p className="text-sm text-red-400">{igdbError}</p>
          </div>
        )}
      </div>
    </div>
  );
}

interface AdminConfig {
  igdb: { clientId: string; clientSecret: string };
  steamgriddb: { apiKey: string };
}

function SettingsTab() {
  const queryClient = useQueryClient();
  const { data: config, isLoading } = useQuery({
    queryKey: ["adminConfig"],
    queryFn: () => api.get<AdminConfig>("/admin/config"),
  });

  const [igdbClientId, setIgdbClientId] = useState("");
  const [igdbClientSecret, setIgdbClientSecret] = useState("");
  const [sgdbApiKey, setSgdbApiKey] = useState("");
  const [initialized, setInitialized] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  // Initialize form values from server data
  useEffect(() => {
    if (config && !initialized) {
      setIgdbClientId(config.igdb.clientId);
      setIgdbClientSecret(config.igdb.clientSecret);
      setSgdbApiKey(config.steamgriddb.apiKey);
      setInitialized(true);
    }
  }, [config, initialized]);

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
    onError: (err: Error) => {
      setError(err.message);
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

  if (isLoading) {
    return <p className="text-sm text-text-muted">Loading settings…</p>;
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="space-y-6">
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
              <h3 className="font-medium text-text-primary mb-1">
                IGDB / Twitch
              </h3>
              <p className="text-text-secondary text-sm mb-4">
                Used for game metadata — covers, summaries, genres, and release
                dates. Get credentials from the{" "}
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
                    className="w-full bg-surface-raised border border-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition"
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
                    className="w-full bg-surface-raised border border-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition"
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
              <h3 className="font-medium text-text-primary mb-1">
                SteamGridDB
              </h3>
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
                  className="w-full bg-surface-raised border border-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition"
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
            className="bg-accent hover:bg-accent-hover disabled:opacity-50 text-neutral-950 font-semibold px-5 py-2.5 rounded-lg transition text-sm"
          >
            {saveMutation.isPending ? "Saving…" : "Save"}
          </button>
          {success && (
            <span className="text-sm text-accent">Settings saved.</span>
          )}
          {error && <span className="text-sm text-red-400">{error}</span>}
        </div>
      </form>
    </div>
  );
}
