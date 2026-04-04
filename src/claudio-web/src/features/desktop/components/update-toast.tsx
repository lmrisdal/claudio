import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { useCallback, useEffect, useRef, useState } from "react";
import { isDesktop } from "../hooks/use-desktop";

const PENDING_UPDATE_VERSION_KEY = "claudio_pending_update_version";
const CHECK_EVENT = "claudio:check-for-updates";
const CHECK_RESULT_EVENT = "claudio:update-check-result";
const INSTALL_PREPARED_UPDATE_EVENT = "claudio:install-prepared-update";

type ToastMode = "update-available" | "up-to-date" | "installing" | "error";
type CheckSource = "startup" | "settings" | "native";

type DownloadEvent =
  | { event: "Started"; data: { contentLength?: number | null } }
  | { event: "Progress"; data: { chunkLength: number } }
  | { event: "Finished" };

function toErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Could not complete update operation.";
}

export default function UpdateToast() {
  const [visible, setVisible] = useState(false);
  const [mode, setMode] = useState<ToastMode>("update-available");
  const [toastTitle, setToastTitle] = useState("");
  const [toastBody, setToastBody] = useState("");
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const updateRef = useRef<Update | null>(null);
  const downloadedRef = useRef(false);
  const downloadPromiseRef = useRef<Promise<void> | null>(null);
  const dismissedForSessionRef = useRef(false);

  const emitResult = useCallback(
    (message: string, options?: { canInstall?: boolean; isInstalling?: boolean }) => {
      globalThis.dispatchEvent(
        new CustomEvent(CHECK_RESULT_EVENT, {
          detail: {
            message,
            canInstall: options?.canInstall,
            isInstalling: options?.isInstalling,
          },
        }),
      );
    },
    [],
  );

  const startDownload = useCallback(async (update: Update) => {
    if (downloadedRef.current) {
      return;
    }

    if (downloadPromiseRef.current) {
      await downloadPromiseRef.current;
      return;
    }

    let downloadedBytes = 0;
    let contentLength = 0;
    setIsDownloading(true);

    const downloadTask = update
      .download((event: DownloadEvent) => {
        if (event.event === "Started") {
          contentLength = event.data.contentLength ?? 0;
          downloadedBytes = 0;
          setDownloadProgress(contentLength > 0 ? 0 : null);
          return;
        }

        if (event.event === "Progress") {
          downloadedBytes += event.data.chunkLength;
          if (contentLength > 0) {
            setDownloadProgress(Math.min(100, Math.round((downloadedBytes / contentLength) * 100)));
          }
          return;
        }

        setDownloadProgress(100);
      })
      .then(() => {
        downloadedRef.current = true;
        localStorage.setItem(PENDING_UPDATE_VERSION_KEY, update.version);
      })
      .finally(() => {
        setIsDownloading(false);
        downloadPromiseRef.current = null;
      });

    downloadPromiseRef.current = downloadTask;
    await downloadTask;
  }, []);

  const installPreparedUpdate = useCallback(
    async (update: Update) => {
      setIsInstalling(true);
      setMode("installing");
      setToastTitle("Installing update");
      setToastBody(`Installing v${update.version}. Claudio will restart when done.`);
      setVisible(true);
      emitResult(`Installing update v${update.version}...`, { canInstall: false, isInstalling: true });

      try {
        await startDownload(update);
        await update.install();
        localStorage.removeItem(PENDING_UPDATE_VERSION_KEY);
        await invoke("restart_app");
      } catch (error) {
        setMode("error");
        setToastTitle("Update failed");
        setToastBody(toErrorMessage(error));
        setVisible(true);
        emitResult("Update installation failed.", { canInstall: true, isInstalling: false });
      } finally {
        setIsInstalling(false);
      }
    },
    [emitResult, startDownload],
  );

  const checkForUpdates = useCallback(
    async (source: CheckSource) => {
      if (!isDesktop) {
        return;
      }

      const manual = source !== "startup";
      const showToastForCheck = source === "native";

      if (manual) {
        emitResult("Checking for updates...", { canInstall: false, isInstalling: false });
      }

      setIsChecking(true);

      if (showToastForCheck) {
        setMode("up-to-date");
        setToastTitle("Checking for updates");
        setToastBody("Looking for a newer version of Claudio.");
        setVisible(true);
      }

      try {
        const update = await check();

        if (!update) {
          localStorage.removeItem(PENDING_UPDATE_VERSION_KEY);
          updateRef.current = null;
          setMode("up-to-date");
          setToastTitle("No updates available");
          setToastBody("You are already running the latest version of Claudio.");
          setDownloadProgress(null);
          setUpdateVersion(null);

          if (manual || showToastForCheck) {
            emitResult("No updates available.", { canInstall: false, isInstalling: false });
          }

          if (showToastForCheck) {
            setVisible(true);
          }

          return;
        }

        updateRef.current = update;
        downloadedRef.current = false;
        setUpdateVersion(update.version);

        const pendingVersion = localStorage.getItem(PENDING_UPDATE_VERSION_KEY);
        if (source === "startup" && pendingVersion === update.version) {
          await installPreparedUpdate(update);
          return;
        }

        setMode("update-available");
        setToastTitle(`Update available: v${update.version}`);
        setToastBody(update.body?.trim() || "A new Claudio version is ready to install.");
        setDownloadProgress(null);

        if (source === "settings" || source === "native") {
          emitResult(`Update v${update.version} is available.`, {
            canInstall: true,
            isInstalling: false,
          });
        }

        if (source === "native" || (source === "startup" && !dismissedForSessionRef.current)) {
          setVisible(true);
        } else {
          setVisible(false);
        }

        void startDownload(update);
      } catch (error) {
        setMode("error");
        setToastTitle("Update check failed");
        setToastBody(toErrorMessage(error));
        updateRef.current = null;
        setUpdateVersion(null);

        if (manual || showToastForCheck) {
          emitResult("Could not check for updates.", { canInstall: false, isInstalling: false });
        }

        if (showToastForCheck) {
          setVisible(true);
        }
      } finally {
        setIsChecking(false);
      }
    },
    [emitResult, installPreparedUpdate, startDownload],
  );

  useEffect(() => {
    if (!isDesktop) {
      return;
    }

    void checkForUpdates("startup");

    const onSettingsCheck = () => {
      void checkForUpdates("settings");
    };

    const onNativeCheck = () => {
      void checkForUpdates("native");
    };

    const onInstallPreparedUpdate = () => {
      if (!updateRef.current || isInstalling || isChecking) {
        return;
      }

      void installPreparedUpdate(updateRef.current);
    };

    const unlisten = listen("check-for-updates", onNativeCheck);

    globalThis.addEventListener(CHECK_EVENT, onSettingsCheck);
    globalThis.addEventListener(INSTALL_PREPARED_UPDATE_EVENT, onInstallPreparedUpdate);
    return () => {
      globalThis.removeEventListener(CHECK_EVENT, onSettingsCheck);
      globalThis.removeEventListener(INSTALL_PREPARED_UPDATE_EVENT, onInstallPreparedUpdate);
      void unlisten.then((function_) => function_());
    };
  }, [checkForUpdates, installPreparedUpdate, isChecking, isInstalling]);

  useEffect(() => {
    if (!visible && isHovered) {
      setIsHovered(false);
    }
  }, [isHovered, visible]);

  useEffect(() => {
    if (isHovered || !visible || mode !== "up-to-date" || toastTitle !== "No updates available") {
      return;
    }

    const timeout = globalThis.setTimeout(() => {
      setVisible(false);
    }, 2000);

    return () => {
      globalThis.clearTimeout(timeout);
    };
  }, [isHovered, mode, toastTitle, visible]);

  if (!isDesktop || !visible) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[140] w-[min(24rem,calc(100vw-2rem))]">
      <div
        className="pointer-events-auto rounded-xl border border-border bg-surface-raised/95 p-4 shadow-2xl backdrop-blur-sm"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <h3 className="text-sm font-semibold text-text-primary">{toastTitle}</h3>
        <p className="mt-1 text-sm text-text-secondary">{toastBody}</p>

        {(isChecking || isDownloading || isInstalling) && (
          <div className="mt-3">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg">
              <div
                className="h-full rounded-full bg-accent transition-all"
                style={{ width: `${isChecking ? 45 : (downloadProgress ?? 30)}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-text-muted">
              {isChecking
                ? "Checking for updates..."
                : isInstalling
                  ? "Installing..."
                  : "Preparing update in the background..."}
            </p>
          </div>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              setVisible(false);
              dismissedForSessionRef.current = mode === "update-available";
            }}
            className="rounded-lg border border-border px-3 py-1.5 text-sm text-text-secondary transition hover:bg-bg hover:text-text-primary"
          >
            Dismiss
          </button>

          {mode === "update-available" && updateRef.current && (
            <button
              type="button"
              onClick={() => {
                if (!updateRef.current) {
                  return;
                }
                void installPreparedUpdate(updateRef.current);
              }}
              disabled={isInstalling || (isDownloading && !downloadedRef.current)}
              className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-neutral-950 transition hover:bg-accent-hover disabled:opacity-60"
            >
              {isInstalling
                ? "Installing..."
                : isDownloading && !downloadedRef.current
                  ? "Preparing..."
                  : "Update now"}
            </button>
          )}
        </div>

        {updateVersion && mode === "update-available" && (
          <p className="mt-2 text-xs text-text-muted">Prepared update: v{updateVersion}</p>
        )}
      </div>
    </div>
  );
}
