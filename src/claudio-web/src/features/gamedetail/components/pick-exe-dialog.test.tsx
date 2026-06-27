// @vitest-environment happy-dom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanupRenderedDom, renderInDom } from "../../../test-utils/render";
import { InputScopeProvider } from "../../core/hooks/use-input-scope";
import PickExeDialog from "./pick-exe-dialog";

afterEach(() => {
  cleanupRenderedDom();
});

function renderDialog(exeOptions: string[], onConfirm = vi.fn()) {
  return renderInDom(
    <InputScopeProvider>
      <PickExeDialog
        open
        title="Test Game"
        exeOptions={exeOptions}
        onClose={() => {}}
        onConfirm={onConfirm}
      />
    </InputScopeProvider>,
  );
}

describe("PickExeDialog", () => {
  it("uses the first executable when options arrive after the dialog mounts", async () => {
    const onConfirm = vi.fn();
    const view = renderDialog([], onConfirm);

    expect(document.body.textContent).toContain("No executables found");

    view.rerender(
      <InputScopeProvider>
        <PickExeDialog
          open
          title="Test Game"
          exeOptions={["game.exe"]}
          onClose={() => {}}
          onConfirm={onConfirm}
        />
      </InputScopeProvider>,
    );

    const launchButton = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent === "Launch",
    ) as HTMLButtonElement | undefined;

    expect(launchButton).not.toBeUndefined();
    expect(launchButton?.disabled).toBe(false);

    await act(async () => {
      launchButton?.click();
      await Promise.resolve();
    });

    expect(onConfirm).toHaveBeenCalledWith("game.exe");
    view.unmount();
  });
});
