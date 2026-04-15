// @vitest-environment happy-dom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { InputScopeProvider } from "../hooks/use-input-scope";
import { cleanupRenderedDom, renderInDom } from "../../../test-utils/render";
import UninstallDialog from "./uninstall-dialog";

afterEach(() => {
  cleanupRenderedDom();
});

describe("UninstallDialog", () => {
  it("keeps the dialog in a loading state until uninstall completes", async () => {
    let resolveConfirm = () => {};
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveConfirm = resolve;
        }),
    );

    renderInDom(
      <InputScopeProvider>
        <UninstallDialog open title="Test Game" onClose={() => {}} onConfirm={onConfirm} />
      </InputScopeProvider>,
    );

    const deleteButton = [...document.body.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Uninstall and delete files"),
    );

    expect(deleteButton).toBeDefined();

    await act(async () => {
      deleteButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(onConfirm).toHaveBeenCalledWith(true);
    expect(document.body.textContent).toContain("Uninstalling...");
    expect(deleteButton?.getAttribute("disabled")).not.toBeNull();

    await act(async () => {
      resolveConfirm();
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain("Uninstall and delete files");
  });
});
