import { useState } from "react";
import { useServerStatus } from "../hooks/use-server-status";

export default function RefreshButton() {
  const { refresh } = useServerStatus();
  const [isRefreshing, setIsRefreshing] = useState(false);

  async function handleClick() {
    setIsRefreshing(true);
    try {
      await refresh();
    } finally {
      setIsRefreshing(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      disabled={isRefreshing}
      aria-label="Refresh"
      title="Refresh"
      className="p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-raised transition"
    >
      <svg
        className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"
        />
      </svg>
    </button>
  );
}
