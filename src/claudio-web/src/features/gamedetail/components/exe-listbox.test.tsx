// @vitest-environment happy-dom

import { useRef } from "react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { useArrowNav } from "../../core/hooks/use-arrow-nav";
import { InputScopeProvider, useInputScope } from "../../core/hooks/use-input-scope";
import ExeListbox from "./exe-listbox";
import { cleanupRenderedDom, renderInDom } from "../../../test-utils/render";

vi.mock("../../core/utils/sounds", () => ({
  sounds: {
    navigate: vi.fn(async () => {}),
    select: vi.fn(async () => {}),
    back: vi.fn(async () => {}),
  },
}));

function DialogHarness() {
  const containerReference = useRef<HTMLDivElement>(null);
  useInputScope({ id: "page", kind: "page" });
  useInputScope({ id: "dialog", kind: "dialog", blocks: ["page-nav"], enabled: true });
  const handleKeyDown = useArrowNav(containerReference);

  return (
    <div ref={containerReference} onKeyDown={handleKeyDown}>
      <button data-nav data-testid="page-first" type="button">
        First
      </button>
      <button data-nav data-testid="page-second" type="button">
        Second
      </button>
      <ExeListbox label="Executable" value="alpha.exe" onChange={() => {}} options={["beta.exe"]} />
    </div>
  );
}

afterEach(() => {
  cleanupRenderedDom();
});

describe("ExeListbox", () => {
  it("keeps listbox keyboard interaction inside the dialog without moving underlying page focus", async () => {
    const view = renderInDom(
      <InputScopeProvider>
        <DialogHarness />
      </InputScopeProvider>,
    );

    const listboxButton = [...view.container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("alpha.exe"),
    );
    const pageSecond = view.container.querySelector<HTMLButtonElement>(
      '[data-testid="page-second"]',
    );

    expect(listboxButton).not.toBeUndefined();
    expect(pageSecond).not.toBeNull();

    await act(async () => {
      listboxButton?.focus();
      listboxButton?.click();
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain("beta.exe");
    expect(document.activeElement).not.toBe(pageSecond);
    view.unmount();
  });
});
