// @vitest-environment happy-dom

import { act, useRef } from "react";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { InputScopeProvider, useInputScope } from "./use-input-scope";
import { useArrowNav } from "./use-arrow-nav";
import { cleanupRenderedDom, renderInDom } from "../../../test-utils/render";

function ArrowNavHarness({ dialogOpen }: { dialogOpen: boolean }) {
  const containerReference = useRef<HTMLDivElement>(null);

  useInputScope({ id: "page", kind: "page" });
  useInputScope({
    id: "dialog",
    kind: "dialog",
    blocks: ["page-nav"],
    enabled: dialogOpen,
  });

  const handleKeyDown = useArrowNav(containerReference);

  return (
    <div ref={containerReference} onKeyDown={handleKeyDown}>
      <button data-nav data-testid="first" type="button">
        First
      </button>
      <button data-nav data-testid="second" type="button">
        Second
      </button>
      {dialogOpen && <input data-testid="dialog-input" />}
    </div>
  );
}

function renderHarness(dialogOpen: boolean) {
  return renderInDom(
    <InputScopeProvider>
      <ArrowNavHarness dialogOpen={dialogOpen} />
    </InputScopeProvider>,
  );
}

afterEach(() => {
  cleanupRenderedDom();
});

describe("useArrowNav", () => {
  it("does not steal arrow keys from focused dialog inputs", () => {
    const view = renderHarness(true);
    const input = view.container.querySelector<HTMLInputElement>('[data-testid="dialog-input"]');
    const secondButton = view.container.querySelector<HTMLButtonElement>('[data-testid="second"]');

    expect(input).not.toBeNull();
    expect(secondButton).not.toBeNull();

    act(() => {
      input?.focus();
      input?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });

    expect(document.activeElement).toBe(input);
    expect(document.activeElement).not.toBe(secondButton);
    view.unmount();
  });

  it("blocks page-level focus movement while a dialog scope is active", () => {
    const view = renderHarness(true);
    const firstButton = view.container.querySelector<HTMLButtonElement>('[data-testid="first"]');
    const secondButton = view.container.querySelector<HTMLButtonElement>('[data-testid="second"]');

    expect(firstButton).not.toBeNull();
    expect(secondButton).not.toBeNull();

    act(() => {
      firstButton?.focus();
      firstButton?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });

    expect(document.activeElement).toBe(firstButton);
    expect(document.activeElement).not.toBe(secondButton);
    view.unmount();
  });

  it("restores page navigation after the dialog closes", () => {
    const view = renderHarness(true);

    let firstButton = view.container.querySelector<HTMLButtonElement>('[data-testid="first"]');
    let secondButton = view.container.querySelector<HTMLButtonElement>('[data-testid="second"]');

    expect(firstButton).not.toBeNull();
    expect(secondButton).not.toBeNull();

    act(() => {
      firstButton?.focus();
      firstButton?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });

    expect(document.activeElement).toBe(firstButton);

    view.rerender(
      <InputScopeProvider>
        <ArrowNavHarness dialogOpen={false} />
      </InputScopeProvider>,
    );

    firstButton = view.container.querySelector<HTMLButtonElement>('[data-testid="first"]');
    secondButton = view.container.querySelector<HTMLButtonElement>('[data-testid="second"]');

    act(() => {
      firstButton?.focus();
      firstButton?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });

    expect(document.activeElement).toBe(secondButton);
    view.unmount();
  });
});
