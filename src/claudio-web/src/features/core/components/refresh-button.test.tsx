// @vitest-environment happy-dom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanupRenderedDom, renderInDom } from "../../../test-utils/render";
import { ServerStatusContext } from "../hooks/use-server-status";
import RefreshButton from "./refresh-button";

describe("RefreshButton", () => {
  afterEach(() => {
    cleanupRenderedDom();
  });

  it("refreshes once and blocks repeat clicks until it finishes", async () => {
    let finish = () => {};
    const refresh = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const view = renderInDom(
      <ServerStatusContext value={{ isConnected: true, refresh }}>
        <RefreshButton />
      </ServerStatusContext>,
    );
    const button = view.container.querySelector<HTMLButtonElement>('[aria-label="Refresh"]')!;

    act(() => button.click());
    expect(refresh).toHaveBeenCalledOnce();
    expect(button.disabled).toBe(true);

    await act(async () => finish());
    expect(button.disabled).toBe(false);
  });
});
