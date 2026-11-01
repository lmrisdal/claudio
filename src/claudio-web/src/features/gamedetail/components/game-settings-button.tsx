import { useState } from "react";
import type { InstalledGame } from "../../desktop/hooks/use-desktop";
import GameSettingsDialog from "./game-settings-dialog";

export default function GameSettingsButton({ game }: { game: InstalledGame }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        data-nav
        aria-label="Game settings"
        title="Game settings"
        onClick={() => setOpen(true)}
        className="rounded-lg p-3 text-text-secondary ring-1 ring-border transition hover:text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
      >
        <svg
          aria-hidden="true"
          className="h-5 w-5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.7}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="m9.5 3-.6 2.3-2 .9-2.2-.6-2.5 4.3 1.6 1.7v2.3l-1.6 1.7 2.5 4.3 2.2-.6 2 .9.6 2.3h5l.6-2.3 2-.9 2.2.6 2.5-4.3-1.6-1.7v-2.3l1.6-1.7-2.5-4.3-2.2.6-2-.9L14.5 3h-5Z"
          />
          <circle cx="12" cy="12.75" r="3" />
        </svg>
      </button>
      {open && <GameSettingsDialog game={game} onClose={() => setOpen(false)} />}
    </>
  );
}
