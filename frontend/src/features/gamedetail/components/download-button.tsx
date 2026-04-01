import { useState } from "react";
import { api } from "../../core/api/client";
import { formatSize } from "../../core/utils/format";
import { sounds } from "../../core/utils/sounds";

export default function DownloadButton({
  gameId,
  size,
}: {
  gameId: number;
  size: number;
}) {
  const [preparing, setPreparing] = useState(false);

  async function handleDownload() {
    setPreparing(true);
    try {
      const { ticket } = await api.post<{ ticket: string }>(
        `/games/${gameId}/download-ticket`,
      );
      const url = `/api/games/${gameId}/download?ticket=${encodeURIComponent(ticket)}`;
      const a = document.createElement("a");
      a.href = url;
      a.download = "";
      document.body.append(a);
      a.click();
      a.remove();
    } finally {
      setTimeout(() => setPreparing(false), 1000);
    }
  }

  return (
    <button
      onClick={handleDownload}
      onKeyDown={(e) => {
        if (e.key === "Enter") sounds.download();
      }}
      disabled={preparing}
      data-nav
      aria-label={preparing ? "Preparing download" : `Download ${size} bytes`}
      title={preparing ? "Preparing download" : `Download ${formatSize(size)}`}
      className="inline-flex items-center justify-center gap-2 bg-accent hover:bg-accent-hover disabled:opacity-75 text-neutral-950 font-semibold px-3 py-3 sm:px-6 rounded-lg transition text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-(--bg)"
    >
      {preparing ? (
        <>
          <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
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
          <span className="hidden sm:inline">Preparing...</span>
        </>
      ) : (
        <>
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
            />
          </svg>
          <span className="hidden sm:inline">
            Download ({formatSize(size)})
          </span>
        </>
      )}
    </button>
  );
}
