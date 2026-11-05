import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from "electron";
import {
  CHANNELS,
  UPDATE_DOWNLOAD_EVENT,
  type InvokeResult,
  type OpenDialogOptions,
  type WindowControl,
} from "../shared/channels";
import { isTrustedFrame, runInvoke, type InvokeDeps } from "./invoke-handler";
import type { Level, Logger } from "./logger";
import type { UpdateService } from "./updates/update-service";

export interface IpcDeps extends InvokeDeps {
  logger: Logger;
  updates: UpdateService;
  send: (channel: string, payload?: unknown) => void;
}

const LOG_LEVELS = new Set<Level>(["error", "warn", "info", "debug"]);
const WINDOW_CONTROLS = new Set<WindowControl>(["minimize", "toggleMaximize", "close"]);
function trusted(event: IpcMainInvokeEvent | Electron.IpcMainEvent): boolean {
  return isTrustedFrame(event.senderFrame, event.sender.mainFrame);
}

export function registerIpc(deps: IpcDeps): void {
  ipcMain.handle(CHANNELS.invoke, async (event, method: unknown, params: unknown) => {
    if (!trusted(event)) return { ok: false, error: "Untrusted sender." } satisfies InvokeResult;
    return runInvoke(deps, method, params);
  });

  ipcMain.handle(CHANNELS.windowControl, (event, control: unknown) => {
    if (!trusted(event) || !WINDOW_CONTROLS.has(control as WindowControl)) return;
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return;
    if (control === "minimize") window.minimize();
    else if (control === "close") window.close();
    else if (window.isMaximized()) window.unmaximize();
    else window.maximize();
  });

  ipcMain.handle(CHANNELS.openDialog, async (event, options: OpenDialogOptions | undefined) => {
    if (!trusted(event)) return null;
    const window = BrowserWindow.fromWebContents(event.sender);
    const dialogOptions: Electron.OpenDialogOptions = {
      title: options?.title,
      defaultPath: options?.defaultPath,
      properties: [options?.directory ? "openDirectory" : "openFile"],
    };
    const result = window
      ? await dialog.showOpenDialog(window, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  ipcMain.on(CHANNELS.log, (event, level: unknown, message: unknown) => {
    if (!trusted(event) || typeof message !== "string") return;
    if (typeof level === "string" && LOG_LEVELS.has(level as Level)) {
      deps.logger.log(level as Level, message, "renderer");
    }
  });

  ipcMain.handle(CHANNELS.updatesCheck, async (event) => {
    if (!trusted(event)) throw new Error("Untrusted sender.");
    return deps.updates.check();
  });

  ipcMain.handle(CHANNELS.updatesDownload, async (event) => {
    if (!trusted(event)) throw new Error("Untrusted sender.");
    await deps.updates.download((progress) =>
      deps.send(CHANNELS.event, { event: UPDATE_DOWNLOAD_EVENT, payload: progress }),
    );
  });

  ipcMain.handle(CHANNELS.updatesInstall, async (event) => {
    if (!trusted(event)) throw new Error("Untrusted sender.");
    await deps.updates.install();
  });
}
