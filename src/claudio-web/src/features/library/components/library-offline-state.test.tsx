// @vitest-environment happy-dom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanupRenderedDom, renderInDom } from "../../../test-utils/render";
import LibraryOfflineState from "./library-offline-state";

describe("LibraryOfflineState", () => {
  afterEach(() => {
    cleanupRenderedDom();
  });

  it("explains that only installed games are shown", () => {
    const view = renderInDom(<LibraryOfflineState hasGames />);
    expect(view.container.textContent).toContain("Showing games installed on this device");
    expect(view.container.querySelector("button")).toBeNull();
  });

  it("offers settings when nothing is installed", () => {
    const openSettings = vi.fn();
    globalThis.addEventListener("claudio:open-desktop-settings", openSettings);
    const view = renderInDom(<LibraryOfflineState hasGames={false} />);
    expect(view.container.textContent).toContain("No games are installed on this device");
    act(() => view.container.querySelector("button")!.click());
    expect(openSettings).toHaveBeenCalledOnce();
    globalThis.removeEventListener("claudio:open-desktop-settings", openSettings);
  });
});
