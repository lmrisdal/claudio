import { getBridge, type DesktopDownloadEvent } from "./desktop-bridge";

export interface Update {
  version: string;
  body?: string | null;
  download: (onEvent: (event: DesktopDownloadEvent) => void) => Promise<void>;
  install: () => Promise<void>;
}

export async function checkForUpdate(): Promise<Update | null> {
  const { updates } = getBridge();
  const info = await updates.check();
  if (!info) return null;

  return {
    ...info,
    async download(onEvent) {
      const stopListening = updates.onDownloadEvent(onEvent);
      try {
        await updates.download();
      } finally {
        stopListening();
      }
    },
    install: () => updates.install(),
  };
}
