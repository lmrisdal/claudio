import { describe, expect, it, vi } from "vite-plus/test";
import { runInvoke, isTrustedFrame } from "../src/main/invoke-handler";
import { classifyUrl } from "../src/main/navigation-policy";
import { CORE_METHODS } from "../src/shared/channels";

type InvokeMock = ReturnType<typeof vi.fn<(method: string, params?: unknown) => Promise<unknown>>>;

function deps(invoke: InvokeMock = vi.fn(async () => "value")) {
  return {
    invoke,
    value: {
      core: { invoke },
      onSettingsUpdated: vi.fn(),
      shell: { restart_app: vi.fn() },
    },
  };
}

describe("runInvoke", () => {
  it("passes allowlisted core commands through and wraps the result", async () => {
    const { value, invoke } = deps(vi.fn(async () => ({ version: "1" })));

    const result = await runInvoke(value, "ping", undefined);

    expect(result).toEqual({ ok: true, value: { version: "1" } });
    expect(invoke).toHaveBeenCalledWith("ping", undefined);
  });

  it("turns a rejection into the plain error string the web app checks for", async () => {
    const { value } = deps(
      vi.fn(async () => Promise.reject(new Error("No active install for this game."))),
    );

    expect(await runInvoke(value, "cancel_install", { gameId: 1 })).toEqual({
      ok: false,
      error: "No active install for this game.",
    });
  });

  it("refuses commands outside the allowlist, including the core's internal ones", async () => {
    const { value, invoke } = deps();

    for (const method of ["log", "has_active_operations", "rm_rf", "__proto__"]) {
      expect(await runInvoke(value, method, null)).toEqual({
        ok: false,
        error: `Command ${method} not found`,
      });
    }
    expect(await runInvoke(value, 42, null)).toEqual({ ok: false, error: "Invalid command." });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("exposes exactly the 26 documented core commands", () => {
    expect(CORE_METHODS).toHaveLength(26);
    expect(new Set(CORE_METHODS).size).toBe(26);
  });

  it("routes shell-owned commands to the shell instead of the core", async () => {
    const { value, invoke } = deps();

    expect(await runInvoke(value, "restart_app", null)).toEqual({ ok: true, value: null });

    expect(value.shell.restart_app).toHaveBeenCalledOnce();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("refreshes the proxy's settings cache only after a successful update_settings", async () => {
    const ok = deps();
    await runInvoke(ok.value, "update_settings", { settings: {} });
    expect(ok.value.onSettingsUpdated).toHaveBeenCalledOnce();

    const failing = deps(vi.fn(async () => Promise.reject(new Error("disk full"))));
    await runInvoke(failing.value, "update_settings", { settings: {} });
    expect(failing.value.onSettingsUpdated).not.toHaveBeenCalled();
  });
});

describe("isTrustedFrame", () => {
  it("accepts only the top frame served from the app origin", () => {
    const frame = { url: "claudio-app://app/library" };

    expect(isTrustedFrame(frame, frame)).toBe(true);
    expect(isTrustedFrame(frame, { url: "other" })).toBe(false);
    expect(isTrustedFrame(null, null)).toBe(false);
  });

  it("rejects look-alike origins", () => {
    for (const url of [
      "claudio-app://app.evil.test/",
      "https://app/",
      "claudio-app://appx/",
      "claudio-app://app",
    ]) {
      const frame = { url };
      expect(isTrustedFrame(frame, frame)).toBe(false);
    }
  });
});

describe("classifyUrl", () => {
  it("allows the app origin, sends web links to the browser, and denies the rest", () => {
    expect(classifyUrl("claudio-app://app/games/1")).toBe("allow");
    expect(classifyUrl("https://example.com/a")).toBe("open-external");
    expect(classifyUrl("http://10.0.0.1:9911/")).toBe("open-external");
    for (const url of [
      "file:///etc/passwd",
      "javascript:alert(1)",
      "claudio://api/x",
      "not a url",
      "claudio-app://other/",
    ]) {
      expect(classifyUrl(url)).toBe("deny");
    }
  });
});
