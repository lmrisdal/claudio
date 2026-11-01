import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  readWindowState,
  sanitizeWindowState,
  writeWindowState,
} from "../src/main/windows/window-state";

const limits = { minWidth: 800, minHeight: 600 };
const display = { x: 0, y: 0, width: 1920, height: 1080 };
const second = { x: 1920, y: 0, width: 1920, height: 1080 };

describe("sanitizeWindowState", () => {
  it("keeps valid bounds on a connected display", () => {
    const state = sanitizeWindowState(
      { x: 100, y: 50, width: 1000, height: 700, maximized: true },
      [display],
      limits,
    );

    expect(state).toEqual({
      x: 100,
      y: 50,
      width: 1000,
      height: 700,
      maximized: true,
      fullscreen: false,
    });
  });

  it("keeps positions on a second monitor while it is connected", () => {
    const raw = { x: 2000, y: 100, width: 1000, height: 700 };

    expect(sanitizeWindowState(raw, [display, second], limits)?.x).toBe(2000);
  });

  it("drops the position when its monitor is gone, so the window is centered", () => {
    const state = sanitizeWindowState(
      { x: 2000, y: 100, width: 1000, height: 700 },
      [display],
      limits,
    );

    expect(state?.x).toBeUndefined();
    expect(state?.width).toBe(1000);
  });

  it("drops positions that would leave only a sliver visible", () => {
    const state = sanitizeWindowState(
      { x: 1900, y: 10, width: 1000, height: 700 },
      [display],
      limits,
    );

    expect(state?.x).toBeUndefined();
  });

  it("raises tiny sizes to the minimum", () => {
    const state = sanitizeWindowState({ width: 100, height: 100 }, [display], limits);

    expect(state).toMatchObject({ width: 800, height: 600 });
  });

  it.each([null, "x", 5, {}, { width: "a", height: 1 }, { width: NaN, height: 600 }])(
    "rejects malformed state %j",
    (raw) => {
      expect(sanitizeWindowState(raw, [display], limits)).toBeNull();
    },
  );
});

describe("window state files", () => {
  let dir = "";
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("round-trips through disk, creating the folder", () => {
    dir = mkdtempSync(path.join(tmpdir(), "claudio-ws-"));
    const file = path.join(dir, "nested", "window-state.json");
    const state = { x: 10, y: 20, width: 900, height: 650, maximized: false, fullscreen: true };

    writeWindowState(file, state);

    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(state);
    expect(readWindowState(file, [display], limits)).toEqual(state);
  });

  it("returns null for missing or corrupt files", () => {
    dir = mkdtempSync(path.join(tmpdir(), "claudio-ws-"));
    const corrupt = path.join(dir, "bad.json");
    writeFileSync(corrupt, "{nope");

    expect(readWindowState(path.join(dir, "missing.json"), [display], limits)).toBeNull();
    expect(readWindowState(corrupt, [display], limits)).toBeNull();
  });
});
