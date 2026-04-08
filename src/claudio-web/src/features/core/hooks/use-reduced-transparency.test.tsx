// @vitest-environment happy-dom

import { act } from "react";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { cleanupRenderedDom, renderInDom } from "../../../test-utils/render";
import { setReducedTransparencyEnabled } from "../utils/preferences";
import { useReducedTransparency } from "./use-reduced-transparency";

function ReducedTransparencyHarness() {
  const reducedTransparency = useReducedTransparency();

  return <div data-reduced-transparency={String(reducedTransparency)} />;
}

afterEach(() => {
  cleanupRenderedDom();
  localStorage.clear();
  document.documentElement.classList.remove("reduce-transparency");
});

describe("useReducedTransparency", () => {
  it("defaults to false", () => {
    const view = renderInDom(<ReducedTransparencyHarness />);
    const state = view.container.firstElementChild;

    expect(state).toBeInstanceOf(HTMLDivElement);
    expect((state as HTMLDivElement).dataset.reducedTransparency).toBe("false");
    expect(document.documentElement.classList.contains("reduce-transparency")).toBe(false);
  });

  it("updates the document and subscribers when the preference changes", () => {
    const view = renderInDom(<ReducedTransparencyHarness />);
    const state = view.container.firstElementChild as HTMLDivElement;

    act(() => {
      setReducedTransparencyEnabled(true);
    });
    expect(state.dataset.reducedTransparency).toBe("true");
    expect(document.documentElement.classList.contains("reduce-transparency")).toBe(true);

    act(() => {
      setReducedTransparencyEnabled(false);
    });
    expect(state.dataset.reducedTransparency).toBe("false");
    expect(document.documentElement.classList.contains("reduce-transparency")).toBe(false);
  });
});
