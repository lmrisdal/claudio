import { describe, expect, it, vi } from "vite-plus/test";
import {
  createDisabledUpdateService,
  createUpdateService,
  updatesSupported,
  type ProgressInfo,
  type UpdaterLike,
} from "../src/main/updates/update-service";

function fakeUpdater(overrides: Partial<UpdaterLike> = {}) {
  const listeners = new Set<(info: ProgressInfo) => void>();
  const updater: UpdaterLike = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    checkForUpdates: async () => null,
    downloadUpdate: async () => undefined,
    quitAndInstall: vi.fn(),
    on: (_event, listener) => void listeners.add(listener),
    off: (_event, listener) => void listeners.delete(listener),
    ...overrides,
  };
  return { updater, listeners };
}

function build(updater: UpdaterLike, confirmExit = async () => true) {
  return createUpdateService({ updater, confirmExit, log: () => undefined });
}

describe("createDisabledUpdateService", () => {
  it("reports no update so the toast stays quiet", async () => {
    const service = createDisabledUpdateService();

    await expect(service.check()).resolves.toBeNull();
    await expect(service.download(() => undefined)).resolves.toBeUndefined();
  });

  it("refuses to install", async () => {
    await expect(createDisabledUpdateService().install()).rejects.toThrow("not available");
  });
});

describe("updatesSupported", () => {
  it("rejects dev runs and the portable build", () => {
    expect(updatesSupported({}, false)).toBe(false);
    expect(updatesSupported({ PORTABLE_EXECUTABLE_DIR: "C:\\x" }, true)).toBe(false);
    expect(updatesSupported({}, true)).toBe(true);
  });
});

describe("createUpdateService", () => {
  it("turns off automatic downloads and installs", () => {
    const { updater } = fakeUpdater();
    build(updater);

    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(false);
  });

  it("returns null when there is no update", async () => {
    const none = fakeUpdater();
    const same = fakeUpdater({
      checkForUpdates: async () => ({ isUpdateAvailable: false, updateInfo: { version: "1.0.0" } }),
    });

    await expect(build(none.updater).check()).resolves.toBeNull();
    await expect(build(same.updater).check()).resolves.toBeNull();
  });

  it("maps update info and flattens release notes", async () => {
    const { updater } = fakeUpdater({
      checkForUpdates: async () => ({
        isUpdateAvailable: true,
        updateInfo: {
          version: "1.2.0",
          releaseNotes: [{ note: "Fixes" }, { note: null }, { note: "Features" }],
        },
      }),
    });

    await expect(build(updater).check()).resolves.toEqual({
      version: "1.2.0",
      body: "Fixes\n\nFeatures",
    });
  });

  it("passes string release notes through", async () => {
    const { updater } = fakeUpdater({
      checkForUpdates: async () => ({ updateInfo: { version: "1.2.0", releaseNotes: "Notes" } }),
    });

    await expect(build(updater).check()).resolves.toEqual({ version: "1.2.0", body: "Notes" });
  });

  it("translates download progress into Started, Progress and Finished", async () => {
    const { updater, listeners } = fakeUpdater();
    updater.downloadUpdate = async () => {
      for (const listener of listeners) listener({ total: 100, delta: 40 });
      for (const listener of listeners) listener({ total: 100, delta: 60 });
    };
    const events: unknown[] = [];

    await build(updater).download((event) => events.push(event));

    expect(events).toEqual([
      { event: "Started", data: { contentLength: 100 } },
      { event: "Progress", data: { chunkLength: 40 } },
      { event: "Progress", data: { chunkLength: 60 } },
      { event: "Finished" },
    ]);
    expect(listeners.size).toBe(0);
  });

  it("still reports Started and Finished when the update was already downloaded", async () => {
    const { updater } = fakeUpdater();
    const events: unknown[] = [];

    await build(updater).download((event) => events.push(event));

    expect(events).toEqual([
      { event: "Started", data: { contentLength: null } },
      { event: "Finished" },
    ]);
  });

  it("detaches the progress listener when the download fails", async () => {
    const { updater, listeners } = fakeUpdater({
      downloadUpdate: async () => {
        throw new Error("network down");
      },
    });

    await expect(build(updater).download(() => undefined)).rejects.toThrow("network down");
    expect(listeners.size).toBe(0);
  });

  it("quits and installs after the exit is confirmed", async () => {
    const { updater } = fakeUpdater();

    await build(updater).install();

    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true);
  });

  it("does not install when the user keeps Claudio running", async () => {
    const { updater } = fakeUpdater();

    await expect(build(updater, async () => false).install()).rejects.toThrow("cancelled");
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
  });
});
