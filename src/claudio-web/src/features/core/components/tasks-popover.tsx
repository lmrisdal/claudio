import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ButtonHTMLAttributes } from "react";
import { api } from "../api/client";
import type { TasksStatus } from "../types/models";

interface TasksPopoverProps {
  buttonClassName?: string;
  buttonTitle?: string;
  buttonProps?: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "title"> & {
    [key: `data-${string}`]: string | boolean | undefined;
  };
}

export default function TasksPopover({
  buttonClassName,
  buttonTitle = "Tasks",
  buttonProps,
}: TasksPopoverProps = {}) {
  const queryClient = useQueryClient();

  const { data: tasks } = useQuery({
    queryKey: ["tasksStatus"],
    queryFn: () => api.get<TasksStatus>("/admin/tasks/status"),
    refetchInterval: (query) => {
      const d = query.state.data;
      if (!d) return 30_000;
      return d.compression.current ||
        d.compression.queued.length > 0 ||
        d.igdb.isRunning ||
        d.steamGridDb.isRunning
        ? 2000
        : 30_000;
    },
  });

  const status = tasks?.compression;
  const igdbStatus = tasks?.igdb;
  const sgdbStatus = tasks?.steamGridDb;

  const cancelMutation = useMutation({
    mutationFn: (gameId: number) => api.post(`/admin/games/${gameId}/compress/cancel`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tasksStatus"] });
      void queryClient.invalidateQueries({ queryKey: ["games"] });
    },
  });

  const taskCount =
    (status?.current ? 1 : 0) +
    (status?.queued.length ?? 0) +
    (igdbStatus?.isRunning ? 1 : 0) +
    (sgdbStatus?.isRunning ? 1 : 0);

  return (
    <Popover className="relative">
      <PopoverButton
        {...buttonProps}
        title={buttonTitle}
        className={`relative p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-raised transition outline-none ${buttonClassName ?? ""}`}
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
            d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z"
          />
        </svg>
        {taskCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-accent text-[10px] font-bold text-accent-foreground flex items-center justify-center">
            {taskCount}
          </span>
        )}
      </PopoverButton>

      <PopoverPanel
        anchor="bottom end"
        className="z-50 mt-2 w-80 rounded-xl bg-surface-raised ring-1 ring-border shadow-xl p-4"
      >
        <h3 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-3">Tasks</h3>

        {!status?.current &&
        !status?.queued.length &&
        !igdbStatus?.isRunning &&
        !sgdbStatus?.isRunning ? (
          <p className="text-sm text-text-muted py-2">No active tasks</p>
        ) : (
          <div className="space-y-3">
            {igdbStatus?.isRunning && (
              <div className="space-y-2">
                <div className="min-w-0">
                  <p className="text-sm text-text-primary truncate">IGDB Scan</p>
                  <p className="text-xs text-text-muted">
                    {igdbStatus.currentGame ? `Matching: ${igdbStatus.currentGame}` : "Starting..."}
                    {igdbStatus.total > 0 && ` (${igdbStatus.processed}/${igdbStatus.total})`}
                  </p>
                </div>
                {igdbStatus.total > 0 && (
                  <div className="h-1.5 rounded-full bg-surface-overlay overflow-hidden">
                    <div
                      className="h-full rounded-full bg-accent transition-all duration-500"
                      style={{
                        width: `${Math.round((igdbStatus.processed / igdbStatus.total) * 100)}%`,
                      }}
                    />
                  </div>
                )}
              </div>
            )}

            {sgdbStatus?.isRunning && (
              <div>
                <div className="min-w-0">
                  <p className="text-sm text-text-primary truncate">SteamGridDB Heroes</p>
                  <p className="text-xs text-text-muted truncate">
                    {sgdbStatus.currentGame ? `Fetching: ${sgdbStatus.currentGame}` : "Starting..."}
                  </p>
                </div>
              </div>
            )}

            {status?.current && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm text-text-primary truncate">
                      {status.current.gameTitle || "Compressing..."}
                    </p>
                    <p className="text-xs text-text-muted">
                      Packaging to {status.current.format.toUpperCase()}{" "}
                      {status.current.progressPercent != undefined &&
                        `${status.current.progressPercent}%`}
                    </p>
                  </div>
                  <button
                    onClick={() => cancelMutation.mutate(status.current!.gameId)}
                    disabled={cancelMutation.isPending}
                    className="shrink-0 text-xs text-red-400 hover:text-red-300 transition disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
                {status.current.progressPercent != undefined && (
                  <div className="h-1.5 rounded-full bg-surface-overlay overflow-hidden">
                    <div
                      className="h-full rounded-full bg-accent transition-all duration-500"
                      style={{
                        width: `${status.current.progressPercent}%`,
                      }}
                    />
                  </div>
                )}
              </div>
            )}

            {status?.queued.map((job) => (
              <div key={job.gameId} className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm text-text-secondary truncate">
                    {job.gameTitle || `Game #${job.gameId}`}
                  </p>
                  <p className="text-xs text-text-muted">Queued ({job.format.toUpperCase()})</p>
                </div>
                <button
                  onClick={() => cancelMutation.mutate(job.gameId)}
                  disabled={cancelMutation.isPending}
                  className="shrink-0 text-xs text-red-400 hover:text-red-300 transition disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            ))}
          </div>
        )}
      </PopoverPanel>
    </Popover>
  );
}
