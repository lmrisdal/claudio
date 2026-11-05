import { contextBridge, ipcRenderer } from "electron";
import {
  CHANNELS,
  UPDATE_DOWNLOAD_EVENT,
  type UpdateDownloadEvent,
  type UpdateInfo,
  type InvokeResult,
  type OpenDialogOptions,
  type WindowControl,
} from "../shared/channels";

type EventHandler = (event: string, payload: unknown) => void;

async function invoke(method: string, params?: unknown): Promise<unknown> {
  const result = (await ipcRenderer.invoke(CHANNELS.invoke, method, params)) as InvokeResult;
  if (result.ok) return result.value;
  throw result.error;
}

contextBridge.exposeInMainWorld("claudioDesktop", {
  invoke,
  onEvent(handler: EventHandler): () => void {
    const listener = (_event: unknown, message: { event: string; payload: unknown }) =>
      handler(message.event, message.payload);
    ipcRenderer.on(CHANNELS.event, listener);
    return () => ipcRenderer.removeListener(CHANNELS.event, listener);
  },
  window: {
    minimize: () => ipcRenderer.invoke(CHANNELS.windowControl, "minimize" satisfies WindowControl),
    toggleMaximize: () =>
      ipcRenderer.invoke(CHANNELS.windowControl, "toggleMaximize" satisfies WindowControl),
    close: () => ipcRenderer.invoke(CHANNELS.windowControl, "close" satisfies WindowControl),
  },
  updates: {
    check: () => ipcRenderer.invoke(CHANNELS.updatesCheck) as Promise<UpdateInfo | null>,
    download: () => ipcRenderer.invoke(CHANNELS.updatesDownload) as Promise<void>,
    install: () => ipcRenderer.invoke(CHANNELS.updatesInstall) as Promise<void>,
    onDownloadEvent(handler: (event: UpdateDownloadEvent) => void): () => void {
      const listener = (
        _event: unknown,
        message: { event: string; payload: UpdateDownloadEvent },
      ) => {
        if (message.event === UPDATE_DOWNLOAD_EVENT) handler(message.payload);
      };
      ipcRenderer.on(CHANNELS.event, listener);
      return () => ipcRenderer.removeListener(CHANNELS.event, listener);
    },
  },
  openDialog: (options?: OpenDialogOptions) => ipcRenderer.invoke(CHANNELS.openDialog, options),
  log: (level: string, message: string) => ipcRenderer.send(CHANNELS.log, level, message),
});
