import { BrowserWindow, screen } from "electron";
import { APP_ORIGIN, WINDOW_ROLE_ARG_PREFIX, type WindowRole } from "../../shared/channels";
import { guardNavigation } from "../navigation";
import type { AppPaths } from "../paths";
import { trackWindowState } from "./track-window-state";
import { readWindowState } from "./window-state";

const MAIN_SIZE = { width: 1280, height: 800, minWidth: 800, minHeight: 600 };
const SETTINGS_SIZE = { width: 640, height: 620, minWidth: 640, minHeight: 620 };

export interface WindowManagerDeps {
  paths: AppPaths;
  windowStateFile: string;
  isQuitting: () => boolean;
  onMainCloseRequested: () => void;
}

export interface WindowManager {
  createMain: () => BrowserWindow;
  openSettings: () => void;
  restoreMain: () => void;
  broadcast: (channel: string, payload?: unknown) => void;
  sendToMain: (channel: string, payload?: unknown) => void;
  getMain: () => BrowserWindow | null;
}

export function createWindowManager(deps: WindowManagerDeps): WindowManager {
  let main: BrowserWindow | null = null;
  let settings: BrowserWindow | null = null;

  function baseWindow(role: WindowRole, options: Electron.BrowserWindowConstructorOptions) {
    const window = new BrowserWindow({
      title: role === "main" ? "Claudio" : "Claudio settings",
      show: false,
      backgroundColor: "#0a0a0a",
      icon: deps.paths.windowIcon,
      ...options,
      webPreferences: {
        preload: deps.paths.preload,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        additionalArguments: [`${WINDOW_ROLE_ARG_PREFIX}${role}`],
      },
    });
    guardNavigation(window.webContents);
    window.once("ready-to-show", () => {
      window.show();
      window.focus();
    });
    void window.loadURL(`${APP_ORIGIN}/index.html`);
    return window;
  }

  function createMain(): BrowserWindow {
    const displays = screen.getAllDisplays().map((display) => display.workArea);
    const saved = readWindowState(deps.windowStateFile, displays, MAIN_SIZE);
    const window = baseWindow("main", {
      width: saved?.width ?? MAIN_SIZE.width,
      height: saved?.height ?? MAIN_SIZE.height,
      x: saved?.x,
      y: saved?.y,
      center: saved?.x === undefined,
      minWidth: MAIN_SIZE.minWidth,
      minHeight: MAIN_SIZE.minHeight,
      frame: false,
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
    main = window;
    return window;
  }

  function reveal(window: BrowserWindow): void {
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }

  function openSettings(): void {
    if (settings && !settings.isDestroyed()) {
      reveal(settings);
      return;
    }
    settings = baseWindow("settings", { ...SETTINGS_SIZE, center: true, resizable: true });
    settings.on("closed", () => {
      settings = null;
    });
  }

  function restoreMain(): void {
    if (main && !main.isDestroyed()) reveal(main);
  }

  function liveWindows(): BrowserWindow[] {
    return [main, settings].filter(
      (window): window is BrowserWindow => window !== null && !window.isDestroyed(),
    );
  }

  return {
    createMain,
    openSettings,
    restoreMain,
    broadcast: (channel, payload) => {
      for (const window of liveWindows()) window.webContents.send(channel, payload);
    },
    sendToMain: (channel, payload) => {
      if (main && !main.isDestroyed()) main.webContents.send(channel, payload);
    },
    getMain: () => main,
  };
}
