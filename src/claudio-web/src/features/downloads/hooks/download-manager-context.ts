import { createContext } from "react";
import type {
  DesktopInstallGameInput,
  InstalledGame,
  InstallProgress,
} from "../../desktop/hooks/use-desktop";

export interface ActiveDownload {
  game: DesktopInstallGameInput;
  progress: InstallProgress;
  /** Download speed in bytes per second, computed from bytesDownloaded deltas. */
  speedBps: number | null;
}

export interface DownloadManagerContextValue {
  activeDownloads: Map<number, ActiveDownload>;
  activeCount: number;
  startDownload: (game: DesktopInstallGameInput) => Promise<InstalledGame>;
  getProgress: (gameId: number) => InstallProgress | null;
  cancelDownload: (gameId: number) => Promise<void>;
  restartDownloadInteractive: (gameId: number) => Promise<void>;
}

export const DownloadManagerContext = createContext<DownloadManagerContextValue | null>(null);
