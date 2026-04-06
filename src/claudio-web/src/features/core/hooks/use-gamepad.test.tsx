// @vitest-environment happy-dom

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useGamepad } from "./use-gamepad";
import { cleanupRenderedDom, renderInDom } from "../../../test-utils/render";

function Harness() {
  useGamepad();
  return null;
}

function createGamepad(
  buttons: Record<number, { pressed?: boolean; value?: number }>,
  axes: number[] = [],
) {
  return {
    buttons: Array.from({ length: 17 }, (_, index) => ({
      pressed: buttons[index]?.pressed ?? false,
      value: buttons[index]?.value ?? (buttons[index]?.pressed ? 1 : 0),
    })),
    axes,
  };
}

let animationFrameCallback: FrameRequestCallback | null = null;

beforeEach(() => {
  animationFrameCallback = null;
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback: FrameRequestCallback) => {
      animationFrameCallback = callback;
      return 1;
    }),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  Object.defineProperty(navigator, "getGamepads", {
    configurable: true,
    value: () => [],
  });
  delete document.body.dataset.emulatorActive;
});

afterEach(() => {
  cleanupRenderedDom();
  vi.unstubAllGlobals();
  delete document.body.dataset.emulatorActive;
});

describe("useGamepad", () => {
  it("suppresses directional events while the emulator is active but still allows the guide button", () => {
    const navListener = vi.fn();
    const guideListener = vi.fn();
    globalThis.addEventListener("gamepad-nav-up", navListener);
    globalThis.addEventListener("gamepad-guide", guideListener);
    Object.defineProperty(navigator, "getGamepads", {
      configurable: true,
      value: () => [createGamepad({ 12: { pressed: true }, 16: { pressed: true } })],
    });

    document.body.dataset.emulatorActive = "true";
    const view = renderInDom(<Harness />);

    act(() => {
      animationFrameCallback?.(0);
    });

    expect(navListener).not.toHaveBeenCalled();
    expect(guideListener).toHaveBeenCalledTimes(1);

    globalThis.removeEventListener("gamepad-nav-up", navListener);
    globalThis.removeEventListener("gamepad-guide", guideListener);
    view.unmount();
  });

  it("does not dispatch directional events when an iframe owns focus", () => {
    const navListener = vi.fn();
    globalThis.addEventListener("gamepad-nav-up", navListener);
    Object.defineProperty(navigator, "getGamepads", {
      configurable: true,
      value: () => [createGamepad({ 12: { pressed: true } })],
    });

    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    iframe.focus();

    const view = renderInDom(<Harness />);

    act(() => {
      animationFrameCallback?.(0);
    });

    expect(document.activeElement).toBe(iframe);
    expect(navListener).not.toHaveBeenCalled();

    globalThis.removeEventListener("gamepad-nav-up", navListener);
    iframe.remove();
    view.unmount();
  });
});
