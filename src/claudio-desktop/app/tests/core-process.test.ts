import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { CoreProcess, type ConfirmParams } from "../src/main/core/core-process";

const fakeCore = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "fake-core.mjs",
);

function createCore(overrides: Partial<ConstructorParameters<typeof CoreProcess>[0]> = {}) {
  const events: Array<[string, unknown]> = [];
  const stderr: string[] = [];
  const fatal = vi.fn();
  const core = new CoreProcess({
    command: process.execPath,
    args: [fakeCore],
    env: process.env,
    onEvent: (event, payload) => events.push([event, payload]),
    onConfirm: async () => true,
    onStderr: (line) => stderr.push(line),
    onFatal: fatal,
    ...overrides,
  });
  core.start();
  return { core, events, stderr, fatal };
}

const running: CoreProcess[] = [];
function track<T extends { core: CoreProcess }>(handle: T): T {
  running.push(handle.core);
  return handle;
}

afterEach(() => {
  for (const core of running.splice(0)) core.dispose();
});

describe("CoreProcess", () => {
  it("resolves requests with the result payload", async () => {
    const { core } = track(createCore());

    await expect(core.invoke("echo", { a: 1 })).resolves.toEqual({ a: 1 });
  });

  it("rejects with the core's error string", async () => {
    const { core } = track(createCore());

    await expect(core.invoke("fail")).rejects.toThrow("domain failure");
  });

  it("matches concurrent responses to the right request", async () => {
    const { core } = track(createCore());

    const results = await Promise.all([
      core.invoke("echo", 1),
      core.invoke("echo", 2),
      core.invoke("echo", 3),
    ]);

    expect(results).toEqual([1, 2, 3]);
  });

  it("forwards events before the response that follows them", async () => {
    const { core, events } = track(createCore());

    await core.invoke("emit");

    expect(events).toEqual([["install-progress", { gameId: 1 }]]);
  });

  it("answers confirm requests with the shell's decision", async () => {
    const seen: ConfirmParams[] = [];
    const { core } = track(
      createCore({
        onConfirm: async (params) => {
          seen.push(params);
          return false;
        },
      }),
    );

    await expect(core.invoke("confirm")).resolves.toBe(false);
    expect(seen[0]).toMatchObject({ title: "T", okLabel: "Ok" });
  });

  it("treats a failing confirm handler as a decline", async () => {
    const { core } = track(createCore({ onConfirm: async () => Promise.reject(new Error("x")) }));

    await expect(core.invoke("confirm")).resolves.toBe(false);
  });

  it("survives non-JSON output lines", async () => {
    const { core, stderr } = track(createCore());

    await expect(core.invoke("garbage")).resolves.toBe("after-garbage");
    expect(stderr.some((line) => line.includes("not json"))).toBe(true);
  });

  it("restarts once after an unexpected exit and rejects in-flight requests", async () => {
    const { core, fatal } = track(createCore());

    await expect(core.invoke("die")).rejects.toThrow(/exited unexpectedly/);
    await expect(core.invoke("echo", "again")).resolves.toBe("again");
    expect(fatal).not.toHaveBeenCalled();
  });

  it("reports a fatal error when it dies again after the restart", async () => {
    const { core, fatal } = track(createCore());

    await expect(core.invoke("die")).rejects.toThrow();
    await expect(core.invoke("die")).rejects.toThrow();
    await vi.waitFor(() => expect(fatal).toHaveBeenCalledTimes(1));
    await expect(core.invoke("echo", 1)).rejects.toThrow("claudio-core is not running.");
  });

  it("reports a fatal error when the binary cannot be started twice", async () => {
    const { fatal } = track(
      createCore({ command: path.join(path.dirname(fakeCore), "missing-binary") }),
    );

    await vi.waitFor(() => expect(fatal).toHaveBeenCalledTimes(1));
  });

  it("rejects pending requests and refuses new ones after dispose", async () => {
    const { core } = track(createCore());
    const pending = core.invoke("hang");

    core.dispose();

    await expect(pending).rejects.toThrow("shutting down");
    await expect(core.invoke("echo", 1)).rejects.toThrow("not running");
  });
});
