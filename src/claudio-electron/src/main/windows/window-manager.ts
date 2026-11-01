import { BrowserWindow, screen } from "electron";
import { APP_ORIGIN } from "../../shared/channels";
import { guardNavigation } from "../navigation";
import type { AppPaths } from "../paths";
import { trackWindowState } from "./track-window-state";
import { readWindowState } from "./window-state";

const MAIN_SIZE = { width: 1280, height: 800, minWidth: 800, minHeight: 600 };

export interface WindowManagerDeps {
  paths: AppPaths;
  windowStateFile: string;
  isQuitting: () => boolean;
  onMainCloseRequested: () => void;
}

export interface WindowManager {
  createMain: () => BrowserWindow;
  restoreMain: () => void;
  send: (channel: string, payload?: unknown) => void;
  getMain: () => BrowserWindow | null;
}

export function createWindowManager(deps: WindowManagerDeps): WindowManager {
  let main: BrowserWindow | null = null;

  function createMain(): BrowserWindow {
    const displays = screen.getAllDisplays().map((display) => display.workArea);
    const saved = readWindowState(deps.windowStateFile, displays, MAIN_SIZE);
    const window = new BrowserWindow({
      title: "Claudio",
      show: false,
      backgroundColor: "#0a0a0a",
      icon: deps.paths.windowIcon,
      width: saved?.width ?? MAIN_SIZE.width,
      height: saved?.height ?? MAIN_SIZE.height,
      x: saved?.x,
      y: saved?.y,
      center: saved?.x === undefined,
      minWidth: MAIN_SIZE.minWidth,
      minHeight: MAIN_SIZE.minHeight,
      frame: false,
      webPreferences: {
        preload: deps.paths.preload,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    guardNavigation(window.webContents);
    window.once("ready-to-show", () => {
      window.show();
      window.focus();
    });
    if (saved?.maximized) window.maximize();
    if (saved?.fullscreen) window.setFullScreen(true);
    trackWindowState(window, deps.windowStateFile);
    window.on("close", (event) => {
      if (main === window && !deps.isQuitting()) {
        event.preventDefault();
        deps.onMainCloseRequested();
      }
    });
    window.on("closed", () => {
      if (main === window) main = null;
    });
    void window.loadURL(`${APP_ORIGIN}/index.html`);
    main = window;
    return window;
  }

  function restoreMain(): void {
    if (!main || main.isDestroyed()) return;
    if (main.isMinimized()) main.restore();
    main.show();
    main.focus();
  }

  return {
    createMain,
    restoreMain,
    send: (channel, payload) => {
      if (main && !main.isDestroyed()) main.webContents.send(channel, payload);
    },
    getMain: () => main,
  };
}
