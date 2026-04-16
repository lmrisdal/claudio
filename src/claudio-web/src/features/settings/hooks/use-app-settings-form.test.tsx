// @vitest-environment happy-dom

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanupRenderedDom, renderInDom } from "../../../test-utils/render";
import { useAppSettingsForm } from "./use-app-settings-form";

const getSettingsMock = vi.fn();
const resolveDefaultDownloadRootMock = vi.fn();
const updateSettingsMock = vi.fn();
const desktopCheckServerConnectionMock = vi.fn();

vi.mock("../../desktop/hooks/use-desktop", () => ({
  desktopCheckServerConnection: (...arguments_: unknown[]) =>
    desktopCheckServerConnectionMock(...arguments_),
  getSettings: (...arguments_: unknown[]) => getSettingsMock(...arguments_),
  resolveDefaultDownloadRoot: (...arguments_: unknown[]) =>
    resolveDefaultDownloadRootMock(...arguments_),
  updateSettings: (...arguments_: unknown[]) => updateSettingsMock(...arguments_),
}));

function TestHarness() {
  const form = useAppSettingsForm(true);

  return (
    <div>
      <input
        data-testid="download-path"
        value={form.downloadPath}
        onChange={(event) => form.setDownloadPath(event.target.value)}
      />
      <button
        type="button"
        data-testid="test"
        onClick={() => {
          void form.handleTest();
        }}
      >
        Test
      </button>
      <div data-testid="connection-message">{form.connectionMessage}</div>
      <button
        type="button"
        data-testid="save"
        onClick={() => {
          void form.handleSave();
        }}
      >
        Save
      </button>
    </div>
  );
}

async function flushFormLoad() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function setInputValue(input: HTMLInputElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function createDeferredPromise<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

const baseSettings = {
  serverUrl: "https://example.com",
  logLevel: "info" as const,
  windowWidth: 1280,
  windowHeight: 800,
  windowX: null,
  windowY: null,
  defaultInstallPath: "C:/Games",
  defaultDownloadPath: "C:/Games/downloads",
  closeToTray: false,
  hideDockIcon: false,
  customHeaders: {},
  allowInsecureAuthStorage: false,
  downloadSpeedLimitKbs: null,
};

describe("useAppSettingsForm", () => {
  const appDefaultDownloads = "C:/Users/Lars/AppData/Local/Claudio/downloads";

  beforeEach(() => {
    getSettingsMock.mockReset();
    resolveDefaultDownloadRootMock.mockReset();
    updateSettingsMock.mockReset();
    desktopCheckServerConnectionMock.mockReset();
    getSettingsMock.mockResolvedValue(baseSettings);
    resolveDefaultDownloadRootMock.mockResolvedValue(appDefaultDownloads);
    desktopCheckServerConnectionMock.mockResolvedValue({ ok: true, status: 200 });
  });

  afterEach(() => {
    cleanupRenderedDom();
  });

  it("loads defaultDownloadPath into form state", async () => {
    const view = renderInDom(<TestHarness />);

    await flushFormLoad();

    const input = view.container.querySelector<HTMLInputElement>('[data-testid="download-path"]');
    expect(input?.value).toBe("C:/Games/downloads");
  });

  it("prefills downloads path from resolved app downloads root when unset", async () => {
    getSettingsMock.mockResolvedValue({
      ...baseSettings,
      defaultInstallPath: "D:/Games",
      defaultDownloadPath: null,
    });

    const view = renderInDom(<TestHarness />);

    await flushFormLoad();

    const input = view.container.querySelector<HTMLInputElement>('[data-testid="download-path"]');
    expect(input?.value).toBe(appDefaultDownloads);
  });

  it("prefills downloads path from resolved app downloads root when install path is unset", async () => {
    getSettingsMock.mockResolvedValue({
      ...baseSettings,
      defaultInstallPath: null,
      defaultDownloadPath: null,
    });
    resolveDefaultDownloadRootMock.mockResolvedValue(appDefaultDownloads);

    const view = renderInDom(<TestHarness />);

    await flushFormLoad();

    const input = view.container.querySelector<HTMLInputElement>('[data-testid="download-path"]');
    expect(input?.value).toBe(appDefaultDownloads);
  });

  it("persists defaultDownloadPath when saving settings", async () => {
    const view = renderInDom(<TestHarness />);

    await flushFormLoad();

    const input = view.container.querySelector<HTMLInputElement>('[data-testid="download-path"]');
    expect(input).not.toBeNull();

    await act(async () => {
      if (input) {
        setInputValue(input, "D:/Custom/Downloads");
      }
    });

    const saveButton = view.container.querySelector<HTMLButtonElement>('[data-testid="save"]');
    expect(saveButton).not.toBeNull();

    await act(async () => {
      saveButton?.click();
      await Promise.resolve();
    });

    expect(updateSettingsMock).toHaveBeenCalledTimes(1);
    const saved = updateSettingsMock.mock.calls[0]?.[0];
    expect(saved.defaultDownloadPath).toBe("D:/Custom/Downloads");
  });

  it("does not overwrite a typed download path when async initialization finishes later", async () => {
    const deferredDownloadRoot = createDeferredPromise<string>();
    resolveDefaultDownloadRootMock.mockReturnValue(deferredDownloadRoot.promise);

    const view = renderInDom(<TestHarness />);

    const input = view.container.querySelector<HTMLInputElement>('[data-testid="download-path"]');
    expect(input).not.toBeNull();

    await act(async () => {
      if (input) {
        setInputValue(input, "D:/Custom/Downloads");
      }
      await Promise.resolve();
    });

    await act(async () => {
      deferredDownloadRoot.resolve(appDefaultDownloads);
      await deferredDownloadRoot.promise;
      await Promise.resolve();
    });

    expect(input?.value).toBe("D:/Custom/Downloads");

    const saveButton = view.container.querySelector<HTMLButtonElement>('[data-testid="save"]');

    await act(async () => {
      saveButton?.click();
      await Promise.resolve();
    });

    expect(updateSettingsMock).toHaveBeenCalledTimes(1);
    const saved = updateSettingsMock.mock.calls[0]?.[0];
    expect(saved.defaultDownloadPath).toBe("D:/Custom/Downloads");
  });

  it("tests connection with unsaved custom headers through the desktop command", async () => {
    getSettingsMock.mockResolvedValue({
      ...baseSettings,
      customHeaders: { "X-Saved": "saved" },
    });
    desktopCheckServerConnectionMock.mockResolvedValue({ ok: false, status: 401 });

    const view = renderInDom(<TestHarness />);

    await flushFormLoad();

    await act(async () => {
      const testButton = view.container.querySelector<HTMLButtonElement>('[data-testid="test"]');
      testButton?.click();
      await Promise.resolve();
    });

    expect(desktopCheckServerConnectionMock).toHaveBeenCalledWith({
      serverUrl: "https://example.com",
      customHeaders: { "X-Saved": "saved" },
      path: "/api/auth/providers",
    });

    const message = view.container.querySelector('[data-testid="connection-message"]');
    expect(message?.textContent).toBe("Server responded with 401.");
  });
});
