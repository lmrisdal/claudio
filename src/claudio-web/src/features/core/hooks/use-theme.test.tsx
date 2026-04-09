// @vitest-environment happy-dom

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { cleanupRenderedDom, renderInDom } from "../../../test-utils/render";
import { setThemePreference, useTheme } from "./use-theme";

function ThemeHarness() {
  const { theme, resolvedTheme } = useTheme();

  return <div data-theme={theme} data-resolved-theme={resolvedTheme} />;
}

type MediaQueryStub = {
  matches: boolean;
  addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => void;
  removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => void;
  dispatch: (matches: boolean) => void;
};

const originalMatchMedia = globalThis.matchMedia;

function createMatchMediaStub(initialMatches: boolean): MediaQueryStub {
  let matches = initialMatches;
  const listeners = new Set<EventListenerOrEventListenerObject>();

  return {
    get matches() {
      return matches;
    },
    addEventListener(type, listener) {
      if (type === "change") {
        listeners.add(listener);
      }
    },
    removeEventListener(type, listener) {
      if (type === "change") {
        listeners.delete(listener);
      }
    },
    dispatch(nextMatches) {
      matches = nextMatches;
      const event = { matches } as MediaQueryListEvent;

      for (const listener of listeners) {
        if (typeof listener === "function") {
          listener(event);
        } else {
          listener.handleEvent(event);
        }
      }
    },
  };
}

describe("useTheme", () => {
  let mediaQueryStub: MediaQueryStub;

  beforeEach(() => {
    mediaQueryStub = createMatchMediaStub(false);
    Object.defineProperty(globalThis, "matchMedia", {
      configurable: true,
      value: () => mediaQueryStub,
    });
  });

  afterEach(() => {
    cleanupRenderedDom();
    localStorage.clear();
    document.documentElement.classList.remove("light", "dark");
    Object.defineProperty(globalThis, "matchMedia", {
      configurable: true,
      value: originalMatchMedia,
    });
  });

  it("updates all subscribers when the theme preference changes", () => {
    const appView = renderInDom(<ThemeHarness />);
    const settingsView = renderInDom(<ThemeHarness />);
    const appState = appView.container.firstElementChild as HTMLDivElement;
    const settingsState = settingsView.container.firstElementChild as HTMLDivElement;

    act(() => {
      setThemePreference("light");
    });

    expect(appState.dataset.theme).toBe("light");
    expect(settingsState.dataset.theme).toBe("light");
    expect(document.documentElement.classList.contains("light")).toBe(true);
  });

  it("resolves the system theme and reacts to color scheme changes", () => {
    const view = renderInDom(<ThemeHarness />);
    const state = view.container.firstElementChild as HTMLDivElement;

    expect(state.dataset.theme).toBe("system");
    expect(state.dataset.resolvedTheme).toBe("dark");

    act(() => {
      mediaQueryStub.dispatch(true);
    });

    expect(state.dataset.resolvedTheme).toBe("light");
    expect(document.documentElement.classList.contains("light")).toBe(true);
  });
});
