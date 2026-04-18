// @vitest-environment happy-dom

import { useRef } from "react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { InputScopeProvider, useInputScope } from "../hooks/use-input-scope";
import { useArrowNav } from "../hooks/use-arrow-nav";
import SearchDialog from "./search-dialog";
import { cleanupRenderedDom, renderInDom } from "../../../test-utils/render";

const navigateMock = vi.fn();
const useQueryMock = vi.fn();

vi.mock("@tanstack/react-query", () => ({
  useQuery: (...arguments_: unknown[]) => useQueryMock(...arguments_),
}));

vi.mock("react-router", () => ({
  useNavigate: () => navigateMock,
}));

function PageHarness({ onClose }: { onClose: () => void }) {
  const containerReference = useRef<HTMLDivElement>(null);
  useInputScope({ id: "page", kind: "page" });
  const handleKeyDown = useArrowNav(containerReference);

  return (
    <div ref={containerReference} onKeyDown={handleKeyDown}>
      <button data-nav data-testid="page-first" type="button">
        First
      </button>
      <button data-nav data-testid="page-second" type="button">
        Second
      </button>
      <SearchDialog open onClose={onClose} />
    </div>
  );
}

beforeEach(() => {
  navigateMock.mockReset();
  useQueryMock.mockReturnValue({
    data: [
      { id: 1, title: "Alpha", platform: "pc" },
      { id: 2, title: "Beta", platform: "pc" },
      { id: 3, title: "Gamma", platform: "pc" },
    ],
  });
});

afterEach(() => {
  cleanupRenderedDom();
});

describe("SearchDialog", () => {
  it("keeps typing native while owning search selection and blocking page navigation", async () => {
    const onClose = vi.fn();
    const view = renderInDom(
      <InputScopeProvider>
        <PageHarness onClose={onClose} />
      </InputScopeProvider>,
    );

    const input = view.container.querySelector<HTMLInputElement>('input[type="text"]');
    const pageFirst = view.container.querySelector<HTMLButtonElement>('[data-testid="page-first"]');
    expect(input).not.toBeNull();
    expect(pageFirst).not.toBeNull();

    await act(async () => {
      input?.focus();
      input?.setSelectionRange(1, 1);
      const valueDescriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
      // Headless DOM needs the native setter so React sees the controlled input update.
      // eslint-disable-next-line @typescript-eslint/unbound-method
      valueDescriptor?.set?.call(input, "a");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });

    expect(view.container.textContent).toContain("Alpha");

    act(() => {
      globalThis.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });

    act(() => {
      globalThis.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });

    expect(input?.value).toBe("a");
    expect(document.activeElement).toBe(input);
    expect(document.activeElement).not.toBe(pageFirst);
    expect(navigateMock).toHaveBeenCalledWith("/games/2");
    expect(onClose).toHaveBeenCalled();
    view.unmount();
  });
});
