import { useEffect, useRef, useState } from "react";
import {
  getSettings,
  updateSettings,
  type DesktopSettings,
} from "../hooks/useDesktop";
import { useShortcut } from "../hooks/useShortcut";

export default function DesktopSettingsDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [settings, setSettings] = useState<DesktopSettings | null>(null);
  const [serverUrl, setServerUrl] = useState("");
  const [installPath, setInstallPath] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  // Load settings when opened
  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    getSettings().then((s) => {
      setSettings(s);
      setServerUrl(s.serverUrl ?? "");
      setInstallPath(s.defaultInstallPath ?? "");
      setMessage("");
    });
  }, [open]);

  // Restore focus on close
  useEffect(() => {
    if (!open && previousFocusRef.current) {
      previousFocusRef.current.focus();
      previousFocusRef.current = null;
    }
  }, [open]);

  useShortcut("Escape", () => {
    if (open) onClose();
  });

  if (!open) return null;

  async function handleSave() {
    if (!settings) return;
    const trimmedUrl = serverUrl.trim().replace(/\/+$/, "");
    if (!trimmedUrl) {
      setMessage("Server URL is required.");
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      // Validate the server URL
      const res = await fetch(`${trimmedUrl}/api/auth/providers`);
      if (!res.ok) {
        setMessage(
          `Server responded with ${res.status}. Make sure this is a Claudio server.`,
        );
        setSaving(false);
        return;
      }
    } catch {
      setMessage("Could not connect. Check the URL and try again.");
      setSaving(false);
      return;
    }

    try {
      const updated: DesktopSettings = {
        ...settings,
        serverUrl: trimmedUrl,
        defaultInstallPath: installPath.trim() || null,
      };
      await updateSettings(updated);
      localStorage.setItem("claudio_server_url", trimmedUrl);

      const serverChanged = trimmedUrl !== (settings.serverUrl ?? "");
      if (serverChanged) {
        window.location.reload();
        return;
      }

      setSettings(updated);
      onClose();
    } catch {
      setMessage("Failed to save settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-lg mx-4 bg-surface border border-border rounded-xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Desktop Settings"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-text-primary">
            Desktop Settings
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-raised transition"
            aria-label="Close"
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
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          <div>
            <label
              htmlFor="settings-server-url"
              className="block text-sm font-medium text-text-secondary mb-1.5"
            >
              Server URL
            </label>
            <input
              id="settings-server-url"
              type="url"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="https://claudio.example.com…"
              spellCheck={false}
              autoComplete="url"
              className="w-full px-3 py-2 rounded-lg bg-bg border border-border text-text-primary placeholder-text-muted text-sm focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
            />
          </div>

          <div>
            <label
              htmlFor="settings-install-path"
              className="block text-sm font-medium text-text-secondary mb-1.5"
            >
              Default install path
            </label>
            <input
              id="settings-install-path"
              type="text"
              value={installPath}
              onChange={(e) => setInstallPath(e.target.value)}
              placeholder="Leave empty for default…"
              spellCheck={false}
              className="w-full px-3 py-2 rounded-lg bg-bg border border-border text-text-primary placeholder-text-muted text-sm focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
            />
          </div>

          {message && (
            <p
              className={`text-sm ${message.includes("saved") ? "text-accent" : "text-red-400"}`}
              role="alert"
            >
              {message}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-border">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-text-secondary hover:text-text-primary hover:bg-surface-raised transition"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-neutral-950 font-medium text-sm transition disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
