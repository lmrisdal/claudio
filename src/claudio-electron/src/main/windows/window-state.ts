import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
  fullscreen: boolean;
}

export interface SizeLimits {
  minWidth: number;
  minHeight: number;
}

const MIN_VISIBLE_WIDTH = 100;
const MIN_VISIBLE_HEIGHT = 50;

function overlapsEnough(bounds: Rect, area: Rect): boolean {
  const width = Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x);
  const height =
    Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y);
  return width >= MIN_VISIBLE_WIDTH && height >= MIN_VISIBLE_HEIGHT;
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export function sanitizeWindowState(
  raw: unknown,
  displays: Rect[],
  limits: SizeLimits,
): WindowState | null {
  if (typeof raw !== "object" || raw === null) return null;
  const candidate = raw as Record<string, unknown>;
  if (!isFiniteNumber(candidate.width) || !isFiniteNumber(candidate.height)) return null;

  const state: WindowState = {
    width: Math.max(Math.round(candidate.width), limits.minWidth),
    height: Math.max(Math.round(candidate.height), limits.minHeight),
    maximized: candidate.maximized === true,
    fullscreen: candidate.fullscreen === true,
  };

  if (isFiniteNumber(candidate.x) && isFiniteNumber(candidate.y)) {
    const bounds = { x: candidate.x, y: candidate.y, width: state.width, height: state.height };
    if (displays.some((display) => overlapsEnough(bounds, display))) {
      state.x = Math.round(candidate.x);
      state.y = Math.round(candidate.y);
    }
  }
  return state;
}

export function readWindowState(
  file: string,
  displays: Rect[],
  limits: SizeLimits,
): WindowState | null {
  try {
    return sanitizeWindowState(JSON.parse(readFileSync(file, "utf8")), displays, limits);
  } catch {
    return null;
  }
}

export function writeWindowState(file: string, state: WindowState): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(state));
}
