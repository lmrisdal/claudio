export default function LibraryOfflineState({ hasGames }: { hasGames: boolean }) {
  if (hasGames) {
    return (
      <p
        role="status"
        className="mb-4 rounded-lg bg-surface-raised px-4 py-2.5 text-sm text-text-secondary ring-1 ring-border"
      >
        Can&apos;t reach the server. Showing games installed on this device.
      </p>
    );
  }

  return (
    <div
      role="status"
      className="flex-1 flex flex-col items-center justify-center gap-2 py-24 text-center"
    >
      <p className="text-sm font-medium text-text-primary">Can&apos;t reach the server</p>
      <p className="text-xs text-text-muted">
        No games are installed on this device. Your library will load when the server is back.
      </p>
      <button
        type="button"
        onClick={() => globalThis.dispatchEvent(new CustomEvent("claudio:open-desktop-settings"))}
        className="mt-3 rounded-lg px-4 py-2 text-sm font-medium text-text-secondary ring-1 ring-border transition hover:text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
      >
        Open settings
      </button>
    </div>
  );
}
