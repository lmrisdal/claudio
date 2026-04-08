// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { api } from "../../core/api/client";
import { InputScopeProvider } from "../../core/hooks/use-input-scope";
import { cleanupRenderedDom, renderInDom } from "../../../test-utils/render";
import InstallDialog from "./install-dialog";

vi.mock("../../core/api/client", () => ({
  api: {
    get: vi.fn(),
  },
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

const apiGet = vi.mocked(api.get);

function renderWithQuery(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderInDom(
    <QueryClientProvider client={queryClient}>
      <InputScopeProvider>{ui}</InputScopeProvider>
    </QueryClientProvider>,
  );
}

async function flushQueries() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function dialogSurface(): HTMLElement {
  return document.body;
}

beforeEach(() => {
  apiGet.mockReset();
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
    const view = renderWithQuery(
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

    await flushQueries();

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
    expect(call[5]).toBe(false);
  });

  it("shows extract option when manifest files is null (archive download)", async () => {
    apiGet.mockImplementation((path: string) => {
      if (path.includes("download-files-manifest")) {
        return Promise.resolve({ files: null });
      }
      return Promise.reject(new Error(`unexpected: ${path}`));
    });

    const view = renderWithQuery(
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

    await flushQueries();

    expect(dialogSurface().textContent).toContain("Extract downloaded archive");
  });

  it("shows extract option when manifest has at least 50 files", async () => {
    const manyFiles = Array.from({ length: 50 }, (_, index) => ({
      path: `f${index}.bin`,
      size: 1,
    }));
    apiGet.mockImplementation((path: string) => {
      if (path.includes("download-files-manifest")) {
        return Promise.resolve({ files: manyFiles });
      }
      return Promise.reject(new Error(`unexpected: ${path}`));
    });

    const view = renderWithQuery(
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

    await flushQueries();

    expect(dialogSurface().textContent).toContain("Extract downloaded archive");
  });
});
