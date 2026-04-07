import { createContext } from "react";
import type {
  DesktopInstallGameInput,
  DownloadPackageInput,
  InstalledGame,
  InstallProgress,
} from "../../desktop/hooks/use-desktop";

export interface ActiveDownload {
  game: DesktopInstallGameInput;
  progress: InstallProgress;
  /** Download speed in bytes per second, computed from bytesDownloaded deltas. */
  speedBps: number | null;
  /** "install" produces an installed game; "package" only downloads files. */
  kind: "install" | "package";
  /** Original package input for package retry flows. */
  packageInput?: DownloadPackageInput;
  /** Last non-cancel failure message. */
  errorMessage?: string;
  /** Last failure timestamp in ms since epoch. */
  failedAt?: number;
}

export interface DownloadManagerContextValue {
  activeDownloads: Map<number, ActiveDownload>;
  activeCount: number;
  startDownload: (game: DesktopInstallGameInput) => Promise<InstalledGame>;
  startPackageDownload: (
    input: DownloadPackageInput,
    game: Pick<DesktopInstallGameInput, "id" | "title" | "platform">,
  ) => Promise<string>;
  getProgress: (gameId: number) => InstallProgress | null;
  cancelDownload: (gameId: number) => Promise<void>;
  restartDownloadInteractive: (gameId: number) => Promise<void>;
  retryDownload: (gameId: number) => Promise<void>;
  dismissDownload: (gameId: number) => void;
}

export const DownloadManagerContext = createContext<DownloadManagerContextValue | null>(null);
