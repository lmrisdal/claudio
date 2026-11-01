import type { UpdateDownloadEvent, UpdateInfo } from "../../shared/channels";

export interface UpdateService {
  check: () => Promise<UpdateInfo | null>;
  download: (onEvent: (event: UpdateDownloadEvent) => void) => Promise<void>;
  install: () => Promise<void>;
}

export function createDisabledUpdateService(): UpdateService {
  return {
    check: async () => null,
    download: async () => undefined,
    install: async () => {
      throw new Error("Updates are not available in this build.");
    },
  };
}
