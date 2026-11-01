// @vitest-environment happy-dom

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { renderInDom } from "../../../test-utils/render";
import { DesktopGate } from "./desktop-gate";

const { getSettings, updateSettings, desktopCheckServerConnection } = vi.hoisted(() => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  desktopCheckServerConnection: vi.fn(),
}));
const desktop = { getSettings, updateSettings, desktopCheckServerConnection };
vi.mock("../hooks/use-desktop", () => ({
  isDesktop: true,
  getSettings,
  desktopCheckServerConnection,
  useDesktop: () => desktop,
}));
vi.mock("./desktop-sidebar", () => ({ HEADER_HEIGHT: 40 }));

let view: ReturnType<typeof renderInDom>;
async function renderGate() {
  await act(async () => {
    view = renderInDom(
      <DesktopGate>
        <div>Library</div>
      </DesktopGate>,
    );
  });
}
async function saveSetup() {
  await act(async () => {
    view.container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

describe("DesktopGate server recovery", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    localStorage.clear();
    getSettings.mockResolvedValue({
      serverUrl: "https://wrong.example",
      customHeaders: { "X-Access": "value" },
    });
    updateSettings.mockImplementation(async () => {});
  });
  afterEach(() => {
    view?.unmount();
    vi.unstubAllGlobals();
    document.documentElement.classList.remove("dark", "light");
  });

  it.each([
    { ok: false, status: null },
    { ok: false, status: 404 },
  ])("returns to editable setup for a failed saved connection: %j", async (result) => {
    desktopCheckServerConnection.mockResolvedValue(result);
    await renderGate();
    expect(view.container.querySelector<HTMLInputElement>("#server-url")?.value).toBe(
      "https://wrong.example",
    );
    expect(view.container.querySelector('[role="alert"]')).not.toBeNull();
    expect(view.container.textContent).not.toContain("Library");
    expect(desktopCheckServerConnection).toHaveBeenCalledWith({
      serverUrl: "https://wrong.example",
      customHeaders: { "X-Access": "value" },
      path: "/health",
    });
  });
  it("recovers from a rejected connection check", async () => {
    desktopCheckServerConnection.mockRejectedValue("connection refused");
    await renderGate();
    expect(view.container.querySelector("#server-url")).not.toBeNull();
    expect(view.container.textContent).toContain("Could not connect");
  });
  it("opens the app when the saved server responds successfully", async () => {
    desktopCheckServerConnection.mockResolvedValue({ ok: true, status: 200 });
    await renderGate();
    expect(view.container.textContent).toBe("Library");
  });
  it("keeps setup available after a failed save and allows retry", async () => {
    desktopCheckServerConnection.mockRejectedValue("connection refused");
    await renderGate();
    await saveSetup();
    expect(updateSettings).not.toHaveBeenCalled();
    expect(view.container.textContent).toContain("Could not connect");
    desktopCheckServerConnection.mockResolvedValue({ ok: true, status: 200 });
    await saveSetup();
    expect(updateSettings).toHaveBeenCalledWith({
      serverUrl: "https://wrong.example",
      customHeaders: { "X-Access": "value" },
    });
    expect(view.container.textContent).toBe("Library");
  });
  it("does not save a server returning an HTTP error", async () => {
    desktopCheckServerConnection.mockResolvedValue({ ok: false, status: 503 });
    await renderGate();
    await saveSetup();
    expect(updateSettings).not.toHaveBeenCalled();
    expect(view.container.textContent).toContain("Server responded with 503");
  });
  it("shows setup without checking when no URL is configured", async () => {
    getSettings.mockResolvedValue({ serverUrl: null, customHeaders: {} });
    await renderGate();
    expect(view.container.querySelector("#server-url")).not.toBeNull();
    expect(desktopCheckServerConnection).not.toHaveBeenCalled();
  });
  it("preserves saved dark mode on setup even when the OS prefers light", async () => {
    localStorage.setItem("theme", "dark");
    getSettings.mockResolvedValue({ serverUrl: null, customHeaders: {} });
    await renderGate();
    expect(view.container.querySelector("#server-url")).not.toBeNull();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("light")).toBe(false);
    expect(localStorage.getItem("theme")).toBe("dark");
  });
});
