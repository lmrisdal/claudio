// @vitest-environment happy-dom

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanupRenderedDom, renderInDom } from "../../../test-utils/render";
import { useAppSettingsForm } from "./use-app-settings-form";

const getSettingsMock = vi.fn();
const resolveDefaultDownloadRootMock = vi.fn();
const updateSettingsMock = vi.fn();

vi.mock("../../desktop/hooks/use-desktop", () => ({
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
    getSettingsMock.mockResolvedValue(baseSettings);
    resolveDefaultDownloadRootMock.mockResolvedValue(appDefaultDownloads);
  });

  afterEach(() => {
    cleanupRenderedDom();
  });

  it("loads defaultDownloadPath into form state", async () => {
    const view = renderInDom(<TestHarness />);

    await act(async () => {
      await Promise.resolve();
    });

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

    await act(async () => {
      await Promise.resolve();
    });

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

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const input = view.container.querySelector<HTMLInputElement>('[data-testid="download-path"]');
    expect(input?.value).toBe(appDefaultDownloads);
  });

  it("persists defaultDownloadPath when saving settings", async () => {
    const view = renderInDom(<TestHarness />);

    await act(async () => {
      await Promise.resolve();
    });

    const input = view.container.querySelector<HTMLInputElement>('[data-testid="download-path"]');
    expect(input).not.toBeNull();

    await act(async () => {
      if (input) {
        input.value = "D:/Custom/Downloads";
        input.dispatchEvent(new Event("input", { bubbles: true }));
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
});

