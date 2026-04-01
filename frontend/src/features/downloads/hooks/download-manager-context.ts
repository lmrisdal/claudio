import { createContext } from "react";
import type {
  DesktopInstallGameInput,
  InstalledGame,
  InstallProgress,
} from "../../desktop/hooks/use-desktop";

export interface ActiveDownload {
  game: DesktopInstallGameInput;
  progress: InstallProgress;
}

export interface DownloadManagerContextValue {
  activeDownloads: Map<number, ActiveDownload>;
  activeCount: number;
  startDownload: (game: DesktopInstallGameInput) => Promise<InstalledGame>;
  getProgress: (gameId: number) => InstallProgress | null;
}

export const DownloadManagerContext = createContext<DownloadManagerContextValue | null>(null);
