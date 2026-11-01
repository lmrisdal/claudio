// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanupRenderedDom, renderInDom } from "../../../test-utils/render";
import RouteError from "./route-error";

const { useRouteError } = vi.hoisted(() => ({ useRouteError: vi.fn() }));
vi.mock("react-router", () => ({ useRouteError }));

describe("RouteError", () => {
  afterEach(() => {
    cleanupRenderedDom();
  });

  it("shows the error and a focused reload action", () => {
    useRouteError.mockReturnValue(new Error("Boom"));
    const view = renderInDom(<RouteError />);
    expect(view.container.querySelector('[role="alert"]')?.textContent).toContain("Boom");
    expect(view.container.querySelector("button")?.textContent).toBe("Reload");
  });
});
