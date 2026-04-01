import { useQuery } from "@tanstack/react-query";
import { api } from "../../core/api/client";
import type { TasksStatus } from "../../core/types/models";

export default function CompressionProgress({ gameId }: { gameId: number }) {
  const { data: tasks } = useQuery({
    queryKey: ["tasksStatus"],
    queryFn: () => api.get<TasksStatus>("/admin/tasks/status"),
    refetchInterval: 2000,
  });
  const status = tasks?.compression;

  const job =
    status?.current?.gameId === gameId
      ? status.current
      : status?.queued.find((q) => q.gameId === gameId);
  const percent = job?.progressPercent ?? 0;
  const isQueued = status?.queued.some((q) => q.gameId === gameId);

  const circumference = 2 * Math.PI * 10;
  const offset = circumference - (percent / 100) * circumference;

  return (
    <span className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm text-amber-400 bg-amber-500/10 ring-1 ring-amber-500/30">
      {isQueued ? (
        <svg
          className="w-5 h-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
          />
        </svg>
      ) : (
        <svg className="w-5 h-5 -rotate-90" viewBox="0 0 24 24">
          <circle
            cx="12"
            cy="12"
            r="10"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            className="opacity-20"
          />
          <circle
            cx="12"
            cy="12"
            r="10"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            className="transition-all duration-1000"
          />
        </svg>
      )}
      {isQueued
        ? `Queued (${job?.format?.toUpperCase() ?? "ZIP"})...`
        : `Packaging ${job?.format?.toUpperCase() ?? "ZIP"} ${percent}%`}
    </span>
  );
}
