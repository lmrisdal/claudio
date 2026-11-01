import type { UpdateDownloadEvent, UpdateInfo } from "../../shared/channels";

export interface UpdateService {
  check: () => Promise<UpdateInfo | null>;
  download: (onEvent: (event: UpdateDownloadEvent) => void) => Promise<void>;
  install: () => Promise<void>;
}

export interface ProgressInfo {
  total: number;
  delta: number;
}

export interface UpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  checkForUpdates: () => Promise<{
    isUpdateAvailable?: boolean;
    updateInfo: { version: string; releaseNotes?: unknown };
  } | null>;
  downloadUpdate: () => Promise<unknown>;
  quitAndInstall: (isSilent?: boolean, isForceRunAfter?: boolean) => void;
  on: (event: "download-progress", listener: (info: ProgressInfo) => void) => unknown;
  off: (event: "download-progress", listener: (info: ProgressInfo) => void) => unknown;
}

export interface UpdateServiceDeps {
  updater: UpdaterLike;
  confirmExit: () => Promise<boolean>;
  log: (level: "info" | "warn" | "error", message: string) => void;
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

// The portable Windows build and unpackaged dev runs have no installer to update.
export function updatesSupported(env: NodeJS.ProcessEnv, isPackaged: boolean): boolean {
  return isPackaged && !env.PORTABLE_EXECUTABLE_DIR;
}

function releaseNotesText(notes: unknown): string | null {
  if (typeof notes === "string") return notes;
  if (!Array.isArray(notes)) return null;
  const parts = notes
    .map((entry) => (entry as { note?: unknown } | null)?.note)
    .filter((note): note is string => typeof note === "string" && note.length > 0);
  return parts.length > 0 ? parts.join("\n\n") : null;
}

export function createUpdateService(deps: UpdateServiceDeps): UpdateService {
  const { updater, confirmExit, log } = deps;
  // The toast decides when to download and install; the updater must never act on its own.
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;

  return {
    async check() {
      const result = await updater.checkForUpdates();
      if (!result || result.isUpdateAvailable === false) return null;
      log("info", `Update available: ${result.updateInfo.version}`);
      return {
        version: result.updateInfo.version,
        body: releaseNotesText(result.updateInfo.releaseNotes),
      };
    },

    async download(onEvent) {
      let started = false;
      const onProgress = (info: ProgressInfo) => {
        if (!started) {
          started = true;
          onEvent({ event: "Started", data: { contentLength: info.total } });
        }
        onEvent({ event: "Progress", data: { chunkLength: info.delta } });
      };
      updater.on("download-progress", onProgress);
      try {
        await updater.downloadUpdate();
      } finally {
        updater.off("download-progress", onProgress);
      }
      if (!started) onEvent({ event: "Started", data: { contentLength: null } });
      onEvent({ event: "Finished" });
    },

    async install() {
      if (!(await confirmExit())) throw new Error("Update installation was cancelled.");
      log("info", "Installing update and restarting");
      updater.quitAndInstall(false, true);
    },
  };
}
