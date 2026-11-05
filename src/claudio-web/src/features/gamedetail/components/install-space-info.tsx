import { useQuery } from "@tanstack/react-query";
import { formatSize } from "../../core/utils/format";
import { getDiskSpace, isDesktop } from "../../desktop/hooks/use-desktop";

interface InstallSpaceInfoProperties {
  path: string;
  requiredBytes: number;
  enabled: boolean;
}

function toPercent(bytes: number, total: number): number {
  return total > 0 ? Math.min(100, (bytes / total) * 100) : 0;
}

export default function InstallSpaceInfo({
  path,
  requiredBytes,
  enabled,
}: InstallSpaceInfoProperties) {
  const trimmedPath = path.trim();
  const { data: disk } = useQuery({
    queryKey: ["diskSpace", trimmedPath],
    queryFn: () => getDiskSpace(trimmedPath),
    enabled: enabled && isDesktop && trimmedPath !== "",
    retry: false,
  });

  if (!disk || disk.totalBytes <= 0) {
    return null;
  }

  const usedBytes = Math.max(0, disk.totalBytes - disk.freeBytes);
  const insufficient = requiredBytes > disk.freeBytes;
  const usedPercent = toPercent(usedBytes, disk.totalBytes);
  const gamePercent = Math.min(100 - usedPercent, toPercent(requiredBytes, disk.totalBytes));

  return (
    <div className="mt-4">
      <div
        role="progressbar"
        aria-label="Disk space"
        aria-valuemin={0}
        aria-valuemax={Math.round(disk.totalBytes / 1024 ** 3)}
        aria-valuenow={Math.round((usedBytes + requiredBytes) / 1024 ** 3)}
        className="flex h-2 w-full overflow-hidden rounded-full bg-surface-raised border border-border"
      >
        <div className="h-full bg-text-muted/60" style={{ width: `${usedPercent}%` }} />
        <div
          className={`h-full ${insufficient ? "bg-red-400" : "bg-accent"}`}
          style={{ width: `${gamePercent}%` }}
        />
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-text-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-text-muted/60" aria-hidden="true" />
          {formatSize(usedBytes)} used
        </span>
        {requiredBytes > 0 && (
          <span
            className={`flex items-center gap-1.5 ${insufficient ? "text-red-400" : "text-accent"}`}
          >
            <span
              className={`h-2 w-2 rounded-full ${insufficient ? "bg-red-400" : "bg-accent"}`}
              aria-hidden="true"
            />
            {formatSize(requiredBytes)} needed
          </span>
        )}
        <span className="ml-auto">
          {formatSize(disk.freeBytes)} free of {formatSize(disk.totalBytes)}
        </span>
      </div>
      {insufficient && (
        <p className="mt-1 text-xs text-red-400" role="alert">
          Not enough free space on this drive.
        </p>
      )}
    </div>
  );
}
