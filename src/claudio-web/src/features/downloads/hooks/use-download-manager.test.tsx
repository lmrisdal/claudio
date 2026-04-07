// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import Downloads from "../pages/downloads";
import { cleanupRenderedDom, renderInDom } from "../../../test-utils/render";
import { DownloadManagerProvider } from "./use-download-manager";
import { useDownloadManager } from "./use-download-manager-hook";

type ProgressHandler = (progress: {
  gameId: number;
  status: string;
  percent?: number | null;
  detail?: string | null;
  indeterminate?: boolean | null;
  bytesDownloaded?: number | null;
  totalBytes?: number | null;
}) => void;

const installGameMock = vi.fn();
const downloadGamePackageMock = vi.fn();
const cancelInstallMock = vi.fn();
const restartInstallInteractiveMock = vi.fn();
let progressHandler: ProgressHandler | null = null;

vi.mock("../../desktop/hooks/use-desktop", () => ({
  isDesktop: true,
  installGame: (...arguments_: unknown[]) => installGameMock(...arguments_),
  downloadGamePackage: (...arguments_: unknown[]) => downloadGamePackageMock(...arguments_),
  cancelInstall: (...arguments_: unknown[]) => cancelInstallMock(...arguments_),
  restartInstallInteractive: (...arguments_: unknown[]) => restartInstallInteractiveMock(...arguments_),
  listenToInstallProgress: async (handler: ProgressHandler) => {
    progressHandler = handler;
    return () => {
      progressHandler = null;
    };
  },
}));

function TestHarness() {
  const manager = useDownloadManager();
  const game = {
    id: 1,
    title: "Hades II",
    platform: "windows",
    installType: "installer" as const,
  };

  return (
    <div>
      <button
        type="button"
        data-testid="start-install"
        onClick={() => {
          void manager.startDownload(game).catch(() => {});
        }}
      >
        Start install
      </button>
      <button
        type="button"
        data-testid="retry-install"
        onClick={() => {
          void manager.retryDownload(game.id).catch(() => {});
        }}
      >
        Retry
      </button>
      <button
        type="button"
        data-testid="dismiss-install"
        onClick={() => manager.dismissDownload(game.id)}
      >
        Dismiss
      </button>
      <div data-testid="download-count">{manager.activeDownloads.size}</div>
      <div data-testid="failed-count">
        {[...manager.activeDownloads.values()].filter((entry) => entry.progress.status === "failed")
          .length}
      </div>
      <div data-testid="failed-message">
        {[...manager.activeDownloads.values()].find((entry) => entry.progress.status === "failed")
          ?.errorMessage ?? ""}
      </div>
    </div>
  );
}

function renderDownloadManager(ui: ReactNode) {
  const queryClient = new QueryClient();
  return renderInDom(
    <QueryClientProvider client={queryClient}>
      <DownloadManagerProvider>{ui}</DownloadManagerProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  installGameMock.mockReset();
  downloadGamePackageMock.mockReset();
  cancelInstallMock.mockReset();
  restartInstallInteractiveMock.mockReset();
  progressHandler = null;
});

afterEach(() => {
  cleanupRenderedDom();
});

describe("DownloadManagerProvider", () => {
  it("keeps failed installs in downloads with error detail", async () => {
    installGameMock.mockRejectedValue(new Error("Install failed: access denied"));

    const view = renderDownloadManager(<TestHarness />);
    const startButton = view.container.querySelector<HTMLButtonElement>('[data-testid="start-install"]');
    expect(startButton).not.toBeNull();

    await act(async () => {
      startButton?.click();
      await Promise.resolve();
    });

    const count = view.container.querySelector('[data-testid="download-count"]')?.textContent;
    const failedCount = view.container.querySelector('[data-testid="failed-count"]')?.textContent;
    const failedMessage = view.container.querySelector('[data-testid="failed-message"]')?.textContent;

    expect(count).toBe("1");
    expect(failedCount).toBe("1");
    expect(failedMessage).toContain("Install failed: access denied");
    view.unmount();
  });

  it("removes cancelled installs from downloads", async () => {
    installGameMock.mockRejectedValue(new Error("Install cancelled."));

    const view = renderDownloadManager(<TestHarness />);
    const startButton = view.container.querySelector<HTMLButtonElement>('[data-testid="start-install"]');
    expect(startButton).not.toBeNull();

    await act(async () => {
      startButton?.click();
      await Promise.resolve();
    });

    const count = view.container.querySelector('[data-testid="download-count"]')?.textContent;
    const failedCount = view.container.querySelector('[data-testid="failed-count"]')?.textContent;
    expect(count).toBe("0");
    expect(failedCount).toBe("0");
    view.unmount();
  });

  it("shows one toast per failed transition key", async () => {
    installGameMock.mockImplementation(
      () => new Promise<never>(() => {}),
    );

    const view = renderDownloadManager(<TestHarness />);
    const startButton = view.container.querySelector<HTMLButtonElement>('[data-testid="start-install"]');
    expect(startButton).not.toBeNull();

    await act(async () => {
      startButton?.click();
      await Promise.resolve();
    });

    await act(async () => {
      progressHandler?.({
        gameId: 1,
        status: "failed",
        detail: "Install failed for Hades II: Access denied",
      });
      await Promise.resolve();
    });

    await act(async () => {
      progressHandler?.({
        gameId: 1,
        status: "failed",
        detail: "Install failed for Hades II: Access denied",
      });
      await Promise.resolve();
    });

    const alerts = view.container.querySelectorAll('[role="alert"]');
    expect(alerts.length).toBe(1);
    expect(alerts[0]?.textContent).toContain("Hades II failed");
    view.unmount();
  });

  it("renders failed section in downloads page", async () => {
    installGameMock.mockRejectedValue(new Error("Install failed: os error 5"));

    const view = renderDownloadManager(
      <>
        <TestHarness />
        <Downloads />
      </>,
    );
    const startButton = view.container.querySelector<HTMLButtonElement>('[data-testid="start-install"]');
    expect(startButton).not.toBeNull();

    await act(async () => {
      startButton?.click();
      await Promise.resolve();
    });

    expect(view.container.textContent).toContain("Failed");
    expect(view.container.textContent).toContain("Install failed: os error 5");
    view.unmount();
  });
});
