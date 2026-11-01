import { describe, expect, it, vi } from "vite-plus/test";
import { createExitController, shouldHideOnClose } from "../src/main/lifecycle";

function setup(platform: NodeJS.Platform, active: boolean, confirmed: boolean) {
  const quit = vi.fn();
  const confirmQuit = vi.fn(async () => confirmed);
  const controller = createExitController({
    platform,
    hasActiveOperations: async () => active,
    confirmQuit,
    quit,
  });
  return { controller, quit, confirmQuit };
}

describe("createExitController", () => {
  it("quits without asking when nothing is running on Windows", async () => {
    const { controller, quit, confirmQuit } = setup("win32", false, true);

    await controller.requestExit();

    expect(confirmQuit).not.toHaveBeenCalled();
    expect(quit).toHaveBeenCalledOnce();
    expect(controller.isQuitting()).toBe(true);
  });

  it("keeps running when the user declines on Windows", async () => {
    const { controller, quit } = setup("win32", true, false);

    expect(await controller.requestExit()).toBe(false);

    expect(quit).not.toHaveBeenCalled();
    expect(controller.isQuitting()).toBe(false);
  });

  it("quits when the user confirms on Windows", async () => {
    const { controller, quit } = setup("win32", true, true);

    expect(await controller.requestExit()).toBe(true);

    expect(quit).toHaveBeenCalledOnce();
  });

  it("never asks on Linux, matching the old behaviour", async () => {
    const { controller, quit, confirmQuit } = setup("linux", true, false);

    await controller.requestExit();

    expect(confirmQuit).not.toHaveBeenCalled();
    expect(quit).toHaveBeenCalledOnce();
  });

  it("allows an OS-initiated quit immediately on Linux", () => {
    const { controller, quit } = setup("linux", true, false);

    expect(controller.allowQuitNow()).toBe(true);

    expect(controller.isQuitting()).toBe(true);
    expect(quit).not.toHaveBeenCalled();
  });

  it("intercepts an OS-initiated quit on Windows and asks first", async () => {
    const { controller, confirmQuit } = setup("win32", true, false);

    expect(controller.allowQuitNow()).toBe(false);
    await vi.waitFor(() => expect(confirmQuit).toHaveBeenCalledOnce());
  });

  it("lets the quit through once it has been approved", async () => {
    const { controller } = setup("win32", true, true);
    await controller.requestExit();

    expect(controller.allowQuitNow()).toBe(true);
  });

  it("treats an unreachable core as having no active operations", async () => {
    const quit = vi.fn();
    const controller = createExitController({
      platform: "win32",
      hasActiveOperations: async () => Promise.reject(new Error("down")),
      confirmQuit: async () => false,
      quit,
    });

    await controller.requestExit();

    expect(quit).toHaveBeenCalledOnce();
  });
});

describe("shouldHideOnClose", () => {
  it("hides only when close-to-tray is on", () => {
    expect(shouldHideOnClose({ closeToTray: true })).toBe(true);
    expect(shouldHideOnClose({ closeToTray: false })).toBe(false);
  });
});
