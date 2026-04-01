import { useContext } from "react";
import {
  DownloadManagerContext,
  type DownloadManagerContextValue,
} from "./downloadManagerContext";

export function useDownloadManager(): DownloadManagerContextValue {
  const context = useContext(DownloadManagerContext);
  if (!context) {
    throw new Error(
      "useDownloadManager must be used within DownloadManagerProvider",
    );
  }
  return context;
}
