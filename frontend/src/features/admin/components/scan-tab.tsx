import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api } from "../../core/api/client";
import type { TasksStatus } from "../../core/types/models";

export default function ScanTab() {
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
      void queryClient.invalidateQueries({ queryKey: ["games"] });
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
      void queryClient.invalidateQueries({ queryKey: ["games"] });
      void queryClient.invalidateQueries({ queryKey: ["tasksStatus"] });
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  }

  async function triggerIgdbScan() {
    setIgdbError(null);
    try {
      await api.post("/admin/scan/igdb");
      void queryClient.invalidateQueries({ queryKey: ["tasksStatus"] });
    } catch (error_) {
      setIgdbError(error_ instanceof Error ? error_.message : "IGDB scan failed");
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
              Walk the game library directories for new or changed games. Existing games will have
              their file sizes updated.
            </p>
            <button
              onClick={triggerScan}
              disabled={scanning}
              className="inline-flex items-center gap-2 bg-accent hover:bg-accent-hover disabled:opacity-50 text-neutral-950 font-semibold px-5 py-2.5 rounded-lg transition text-sm"
            >
              {scanning ? (
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
              Scan complete — {result.gamesFound} found, {result.gamesAdded} added,{" "}
              {result.gamesMissing} missing
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
            <h3 className="font-medium text-text-primary mb-1">IGDB Metadata</h3>
            <p className="text-text-secondary text-sm mb-4">
              Fetch metadata from IGDB for games that haven&apos;t been matched yet — covers,
              summaries, genres, and release years.
            </p>
            <button
              onClick={triggerIgdbScan}
              disabled={igdbStatus?.isRunning}
              className="inline-flex items-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-semibold px-5 py-2.5 rounded-lg transition text-sm"
            >
              {igdbStatus?.isRunning ? (
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
              <p className="text-xs text-text-muted mt-1.5">Matching: {igdbStatus.currentGame}</p>
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
