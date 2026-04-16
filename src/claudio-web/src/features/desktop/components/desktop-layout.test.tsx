// @vitest-environment happy-dom

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { Route, RouterProvider, createMemoryRouter, createRoutesFromElements } from "react-router";
import { cleanupRenderedDom, renderInDom } from "../../../test-utils/render";
import DesktopLayout from "./desktop-layout";

const headerLifecycle = vi.hoisted(() => ({ mounts: 0, unmounts: 0 }));

vi.mock("../hooks/use-desktop", () => ({
  isDesktop: false,
}));

vi.mock("../../core/components/header", async () => {
  const { createElement, useEffect } = await import("react");

  function MockHeader() {
    useEffect(() => {
      headerLifecycle.mounts += 1;
      return () => {
        headerLifecycle.unmounts += 1;
      };
    }, []);

    return createElement("div", { "data-testid": "header" }, "Header");
  }

  return { default: MockHeader };
});

describe("DesktopLayout", () => {
  beforeEach(() => {
    headerLifecycle.mounts = 0;
    headerLifecycle.unmounts = 0;
  });

  afterEach(() => {
    cleanupRenderedDom();
  });

  it("keeps the header mounted while nested routes change", async () => {
    const router = createMemoryRouter(
      createRoutesFromElements(
        <Route element={<DesktopLayout />}>
          <Route index element={<div>Library</div>} />
          <Route path="games/:id" element={<div>Game detail</div>} />
        </Route>,
      ),
      { initialEntries: ["/"] },
    );

    const view = renderInDom(<RouterProvider router={router} />);
    const header = view.container.querySelector<HTMLElement>('[data-testid="header"]');

    expect(header).not.toBeNull();
    expect(headerLifecycle.mounts).toBe(1);

    await act(async () => {
      await router.navigate("/games/1");
    });

    expect(view.container.textContent).toContain("Game detail");
    expect(view.container.querySelector('[data-testid="header"]')).toBe(header);
    expect(headerLifecycle.mounts).toBe(1);
    expect(headerLifecycle.unmounts).toBe(0);

    view.unmount();

    expect(headerLifecycle.unmounts).toBe(1);
  });
});
