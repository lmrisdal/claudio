// @vitest-environment happy-dom

import { act } from "react";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { clearAppTintVariables } from "../utils/app-tint";
import { DEFAULT_APP_TINT, resetAppTint, setAppTint } from "../utils/preferences";
import { cleanupRenderedDom, renderInDom } from "../../../test-utils/render";
import { useApplyAppTint } from "./use-app-tint";

function AppTintHarness({
  enabled = true,
  theme = "dark",
  reducedTransparency = false,
}: {
  enabled?: boolean;
  theme?: "dark" | "light";
  reducedTransparency?: boolean;
}) {
  const tint = useApplyAppTint({ enabled, theme, reducedTransparency });

  return <div data-hue={String(tint.hue)} data-intensity={String(tint.intensity)} />;
}

afterEach(() => {
  act(() => {
    resetAppTint();
  });
  localStorage.clear();
  cleanupRenderedDom();
  clearAppTintVariables(document.documentElement);
});

describe("useApplyAppTint", () => {
  it("defaults to the stored tint settings", () => {
    const view = renderInDom(<AppTintHarness />);
    const state = view.container.firstElementChild as HTMLDivElement;

    expect(state.dataset.hue).toBe(String(DEFAULT_APP_TINT.hue));
    expect(state.dataset.intensity).toBe(String(DEFAULT_APP_TINT.intensity));
    expect(document.documentElement.style.getPropertyValue("--accent")).toMatch(/^#/);
  });

  it("updates css variables when the tint changes", () => {
    const view = renderInDom(<AppTintHarness />);
    const state = view.container.firstElementChild as HTMLDivElement;
    const initialAccent = document.documentElement.style.getPropertyValue("--accent");
    const initialSurface = document.documentElement.style.getPropertyValue("--surface");

    act(() => {
      setAppTint({ hue: 210, intensity: 36 });
    });

    expect(state.dataset.hue).toBe("210");
    expect(state.dataset.intensity).toBe("36");
    expect(document.documentElement.style.getPropertyValue("--accent")).toMatch(/^#/);
    expect(document.documentElement.style.getPropertyValue("--accent")).not.toBe(initialAccent);
    expect(document.documentElement.style.getPropertyValue("--surface")).toMatch(/^#/);
    expect(document.documentElement.style.getPropertyValue("--surface")).not.toBe(initialSurface);
  });

  it("switches to opaque tinted surfaces when reduced transparency is enabled", () => {
    const view = renderInDom(<AppTintHarness />);

    act(() => {
      setAppTint({ hue: 28, intensity: 42 });
    });

    const translucentPanel =
      document.documentElement.style.getPropertyValue("--desktop-main-panel-bg");
    expect(translucentPanel).toContain("rgba(");

    view.rerender(<AppTintHarness reducedTransparency />);

    expect(document.documentElement.style.getPropertyValue("--desktop-main-panel-bg")).toMatch(
      /^#/,
    );
    expect(document.documentElement.style.getPropertyValue("--desktop-main-panel-bg")).toBe(
      document.documentElement.style.getPropertyValue("--surface"),
    );
    expect(document.documentElement.style.getPropertyValue("--surface-raised")).toMatch(/^#/);
  });

  it("keeps surfaces neutral at zero intensity regardless of hue", () => {
    renderInDom(<AppTintHarness />);

    act(() => {
      setAppTint({ hue: 28, intensity: 0 });
    });

    const lowHueSurface = document.documentElement.style.getPropertyValue("--surface");
    const lowHueAccent = document.documentElement.style.getPropertyValue("--accent");

    act(() => {
      setAppTint({ hue: 240, intensity: 0 });
    });

    expect(document.documentElement.style.getPropertyValue("--surface")).toBe(lowHueSurface);
    expect(document.documentElement.style.getPropertyValue("--accent")).not.toBe(lowHueAccent);
  });

  it("keeps sidebar active state neutral when intensity is zero", () => {
    renderInDom(<AppTintHarness theme="light" />);

    act(() => {
      setAppTint({ hue: 28, intensity: 0 });
    });

    const lowHueSidebarActive =
      document.documentElement.style.getPropertyValue("--sidebar-active-bg");

    act(() => {
      setAppTint({ hue: 240, intensity: 0 });
    });

    expect(document.documentElement.style.getPropertyValue("--sidebar-active-bg")).toBe(
      lowHueSidebarActive,
    );
  });

  it("keeps a stronger neutral active sidebar state in light mode at zero intensity", () => {
    renderInDom(<AppTintHarness theme="light" />);

    act(() => {
      setAppTint({ hue: 28, intensity: 0 });
    });

    expect(document.documentElement.style.getPropertyValue("--sidebar-active-bg")).toBe(
      "rgba(128, 128, 132, 0.140)",
    );
  });

  it("clamps stored intensity to fifty", () => {
    const view = renderInDom(<AppTintHarness />);
    const state = view.container.firstElementChild as HTMLDivElement;

    act(() => {
      setAppTint({ hue: 210, intensity: 80 });
    });

    expect(state.dataset.intensity).toBe("50");
  });

  it("clears tint variables when the feature is disabled", () => {
    const view = renderInDom(<AppTintHarness />);

    expect(document.documentElement.style.getPropertyValue("--accent")).toMatch(/^#/);

    view.rerender(<AppTintHarness enabled={false} />);

    expect(document.documentElement.style.getPropertyValue("--accent")).toBe("");
    expect(document.documentElement.style.getPropertyValue("--surface")).toBe("");
  });
});
