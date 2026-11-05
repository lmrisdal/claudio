// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanupRenderedDom, renderInDom } from "../../../test-utils/render";
import { api } from "../../core/api/client";
import { InputScopeProvider } from "../../core/hooks/use-input-scope";
import { selectPath } from "../../desktop/hooks/desktop-dialog";
import InstallDialog, { INDIVIDUAL_FILE_DOWNLOAD_THRESHOLD } from "./install-dialog";

vi.mock("../../core/api/client", () => ({
  api: {
    get: vi.fn(),
  },
}));

vi.mock("../../desktop/hooks/desktop-dialog", () => ({
  selectPath: vi.fn(),
}));

vi.mock("../../desktop/hooks/use-desktop", () => ({
  isDesktop: true,
  getDiskSpace: () => Promise.resolve({ freeBytes: 50 * 1024 ** 3, totalBytes: 200 * 1024 ** 3 }),
  listProtonVersions: () => Promise.resolve([{ label: "UMU Latest", value: "UMU-Latest" }]),
  resolveInstallBrowseRoot: (targetPath: string) =>
    Promise.resolve(targetPath.replace(/[\\/][^\\/]+$/, "")),
}));

const apiGet = vi.mocked(api.get);
const openDialogMock = vi.mocked(selectPath);

function renderWithQuery(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  renderInDom(
    <QueryClientProvider client={queryClient}>
      <InputScopeProvider>{ui}</InputScopeProvider>
    </QueryClientProvider>,
  );
  return queryClient;
}

async function flushQueryNotifications() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve));
  });
}

async function settleQueries(queryClient: QueryClient) {
  await vi.waitFor(async () => {
    await flushQueryNotifications();
    expect(queryClient.isFetching()).toBe(0);
  });
  await flushQueryNotifications();
}

function dialogSurface(): HTMLElement {
  return document.body;
}

beforeEach(() => {
  apiGet.mockReset();
  openDialogMock.mockReset();
});

afterEach(() => {
  cleanupRenderedDom();
});

describe("InstallDialog download mode", () => {
  it("hides extract option when manifest lists fewer than 50 loose files", async () => {
    apiGet.mockImplementation((path: string) => {
      if (path.includes("download-files-manifest")) {
        return Promise.resolve({
          files: [
            { path: "setup.exe", size: 100 },
            { path: "readme.txt", size: 10 },
          ],
        });
      }
      return Promise.reject(new Error(`unexpected: ${path}`));
    });

    const onConfirm = vi.fn();
    const queryClient = renderWithQuery(
      <InstallDialog
        open
        gameId={1}
        title="Test Game"
        defaultPath="C:\\Games\\Test"
        downloadMode
        onClose={() => {}}
        onConfirm={onConfirm}
      />,
    );

    await settleQueries(queryClient);

    expect(dialogSurface().textContent).not.toContain("Extract downloaded archive");

    const downloadButton = [...dialogSurface().querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Download"),
    );
    expect(downloadButton).toBeDefined();
    await act(async () => {
      downloadButton?.click();
      await Promise.resolve();
    });

    expect(onConfirm).toHaveBeenCalled();
    const call = onConfirm.mock.calls[0]!;
    expect(call[0]).toContain("Games");
    expect(call[0]).toContain("Test");
    expect(call[8]).toBe(false);
  });

  it("shows required and free space for the install location", async () => {
    apiGet.mockResolvedValue({ files: null });

    const queryClient = renderWithQuery(
      <InstallDialog
        open
        gameId={1}
        title="Test Game"
        defaultPath="/games/Test"
        requiredBytes={2 * 1024 ** 3}
        onClose={() => {}}
        onConfirm={() => {}}
      />,
    );

    await settleQueries(queryClient);

    const text = dialogSurface().textContent;
    expect(text).toContain("2.00 GB needed");
    expect(text).toContain("50.00 GB free of 200.00 GB");
    const bar = dialogSurface().querySelector('[role="progressbar"]');
    expect(bar?.getAttribute("aria-valuenow")).toBe("150");
    expect(bar?.getAttribute("aria-valuemax")).toBe("200");
  });

  it("shows extract option when manifest files is null (archive download)", async () => {
    apiGet.mockImplementation((path: string) => {
      if (path.includes("download-files-manifest")) {
        return Promise.resolve({ files: null });
      }
      return Promise.reject(new Error(`unexpected: ${path}`));
    });

    const queryClient = renderWithQuery(
      <InstallDialog
        open
        gameId={1}
        title="Test Game"
        defaultPath="C:\\Games\\Test"
        downloadMode
        onClose={() => {}}
        onConfirm={() => {}}
      />,
    );

    await settleQueries(queryClient);

    expect(dialogSurface().textContent).toContain("Extract downloaded archive");
  });

  it(`shows extract option when manifest has at least ${INDIVIDUAL_FILE_DOWNLOAD_THRESHOLD} files`, async () => {
    const manyFiles = Array.from({ length: INDIVIDUAL_FILE_DOWNLOAD_THRESHOLD }, (_, index) => ({
      path: `f${index}.bin`,
      size: 1,
    }));
    apiGet.mockImplementation((path: string) => {
      if (path.includes("download-files-manifest")) {
        return Promise.resolve({ files: manyFiles });
      }
      return Promise.reject(new Error(`unexpected: ${path}`));
    });

    const queryClient = renderWithQuery(
      <InstallDialog
        open
        gameId={1}
        title="Test Game"
        defaultPath="C:\\Games\\Test"
        downloadMode
        onClose={() => {}}
        onConfirm={() => {}}
      />,
    );

    await settleQueries(queryClient);

    expect(dialogSurface().textContent).toContain("Extract downloaded archive");
  });
});

describe("InstallDialog browse", () => {
  it("keeps the game folder leaf when selecting an existing parent directory", async () => {
    apiGet.mockRejectedValue(new Error("unexpected api call"));
    openDialogMock.mockResolvedValue("/run/host/mnt/games/Claudio");
    const onConfirm = vi.fn();

    renderWithQuery(
      <InstallDialog
        open
        gameId={1}
        title="Test Game"
        defaultPath="/run/host/mnt/games/Claudio/Test Game"
        isPortable
        onClose={() => {}}
        onConfirm={onConfirm}
      />,
    );

    const browseButton = [...dialogSurface().querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Browse"),
    );
    await act(async () => {
      browseButton?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    const input = dialogSurface().querySelector<HTMLInputElement>("input[type='text']");

    expect(input?.value).toBe("/run/host/mnt/games/Claudio/Test Game");
  });
});
