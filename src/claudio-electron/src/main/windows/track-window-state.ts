import type { BrowserWindow } from "electron";
import { writeWindowState, type WindowState } from "./window-state";

const SAVE_DELAY_MS = 400;
const TRACKED_EVENTS = [
  "resize",
  "move",
  "maximize",
  "unmaximize",
  "enter-full-screen",
  "leave-full-screen",
] as const;

export function captureWindowState(window: BrowserWindow): WindowState {
  const { x, y, width, height } = window.getNormalBounds();
  return {
    x,
    y,
    width,
    height,
    maximized: window.isMaximized(),
    fullscreen: window.isFullScreen(),
  };
}

export function trackWindowState(window: BrowserWindow, file: string): void {
  let timer: NodeJS.Timeout | null = null;
  const save = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!window.isDestroyed()) writeWindowState(file, captureWindowState(window));
  };
  const scheduleSave = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, SAVE_DELAY_MS);
  };

  for (const event of TRACKED_EVENTS) window.on(event as "resize", scheduleSave);
  window.on("close", save);
}
