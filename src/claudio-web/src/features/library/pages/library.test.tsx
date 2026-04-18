// @vitest-environment happy-dom

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { InputScopeProvider } from "../../core/hooks/use-input-scope";
import { GAMEPAD_NAV_RIGHT_EVENT } from "../../core/hooks/use-gamepad";
import { DesktopShellNavigationContext } from "../../desktop/hooks/use-desktop-shell-navigation";
import Library from "./library";
import { cleanupRenderedDom, renderInDom } from "../../../test-utils/render";

const navigateMock = vi.fn();
const useQueryMock = vi.fn();

vi.mock("@tanstack/react-query", () => ({
  useQuery: (...arguments_: unknown[]) => useQueryMock(...arguments_),
}));

vi.mock("react-router", () => ({
  Link: ({ children, ...properties }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...properties}>{children}</a>
  ),
  useNavigate: () => navigateMock,
}));

vi.mock("../components/game-card", () => ({
  default: ({
    game,
    onPreviewStart,
  }: {
    game: { id: number; title: string; heroUrl?: string };
    onPreviewStart?: (game: { heroUrl?: string }) => void;
  }) => (
    <a
      href={`/games/${game.id}`}
      data-game-id={String(game.id)}
      onFocus={() => onPreviewStart?.({ heroUrl: game.heroUrl })}
    >
      {game.title}
    </a>
  ),
}));

const games = [
  { id: 1, title: "Alpha", platform: "pc", sizeBytes: 100, isMissing: false },
  { id: 2, title: "Beta", platform: "pc", sizeBytes: 120, isMissing: false },
  { id: 3, title: "Gamma", platform: "snes", sizeBytes: 130, isMissing: false },
];

beforeEach(() => {
  navigateMock.mockReset();
  localStorage.clear();
  useQueryMock.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
    if (queryKey[0] === "games") {
      return { data: games, isLoading: false };
    }

    return { data: undefined, isLoading: false };
  });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  globalThis.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
  globalThis.cancelAnimationFrame = vi.fn();
});

afterEach(() => {
  cleanupRenderedDom();
  localStorage.clear();
});

describe("Library", () => {
  it("keeps grid keyboard navigation working", () => {
    localStorage.setItem("library-view", "grid");
    const view = renderInDom(
      <InputScopeProvider>
        <Library />
      </InputScopeProvider>,
    );

    const links = view.container.querySelectorAll<HTMLAnchorElement>("a[data-game-id]");
    expect(links).toHaveLength(3);

    act(() => {
      links[0]?.focus();
      links[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });

    expect(document.activeElement).toBe(links[1]);
    view.unmount();
  });

  it("keeps grouped gamepad navigation and bumper jumps working", () => {
    localStorage.setItem("library-view", "grouped");
    const view = renderInDom(
      <InputScopeProvider>
        <Library />
      </InputScopeProvider>,
    );

    const links = view.container.querySelectorAll<HTMLAnchorElement>("a[data-game-id]");
    expect(links).toHaveLength(3);

    act(() => {
      links[0]?.focus();
      globalThis.dispatchEvent(new CustomEvent("gamepad-rt"));
    });

    expect(document.activeElement?.textContent).toBe("Gamma");
    view.unmount();
  });

  it("suppresses underlying library page navigation while the platform dropdown is open", () => {
    localStorage.setItem("library-view", "grouped");
    const view = renderInDom(
      <InputScopeProvider>
        <Library />
      </InputScopeProvider>,
    );

    const dropdownButton = [...view.container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("All platforms"),
    );
    const links = view.container.querySelectorAll<HTMLAnchorElement>("a[data-game-id]");

    expect(dropdownButton).not.toBeUndefined();
    expect(links).toHaveLength(3);

    act(() => {
      dropdownButton?.click();
    });

    act(() => {
      links[0]?.focus();
      globalThis.dispatchEvent(new CustomEvent(GAMEPAD_NAV_RIGHT_EVENT));
    });

    expect(document.activeElement).toBe(links[0]);
    view.unmount();
  });

  it("hands focus back to the desktop sidebar when moving left from the first card of any category", () => {
    localStorage.setItem("library-view", "grouped");
    const focusSidebar = vi.fn(() => true);

    const view = renderInDom(
      <DesktopShellNavigationContext.Provider value={{ focusSidebar, focusPage: () => false }}>
        <InputScopeProvider>
          <Library />
        </InputScopeProvider>
      </DesktopShellNavigationContext.Provider>,
    );

    const links = view.container.querySelectorAll<HTMLAnchorElement>("a[data-game-id]");
    expect(links).toHaveLength(3);

    act(() => {
      links[2]?.focus();
      links[2]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    });

    expect(focusSidebar).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it("does not expand or collapse categories with left and right arrows", () => {
    localStorage.setItem("library-view", "grouped");
    const view = renderInDom(
      <InputScopeProvider>
        <Library />
      </InputScopeProvider>,
    );

    const groupedToggle = [...view.container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.dataset.groupToggle === "pc",
    );
    expect(groupedToggle).not.toBeUndefined();

    act(() => {
      groupedToggle?.focus();
      groupedToggle?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
      );
      groupedToggle?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });

    expect(view.container.textContent).toContain("Alpha");
    expect(view.container.textContent).toContain("Beta");
    view.unmount();
  });

  it("restores the clicked game after mouse navigation back to the library", () => {
    localStorage.setItem("library-view", "grid");
    const firstView = renderInDom(
      <InputScopeProvider>
        <Library />
      </InputScopeProvider>,
    );

    const firstLinks = firstView.container.querySelectorAll<HTMLAnchorElement>("a[data-game-id]");
    expect(firstLinks).toHaveLength(3);

    act(() => {
      firstLinks[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    firstView.unmount();

    const secondView = renderInDom(
      <InputScopeProvider>
        <Library />
      </InputScopeProvider>,
    );

    const secondLinks = secondView.container.querySelectorAll<HTMLAnchorElement>("a[data-game-id]");
    expect(document.activeElement).toBe(secondLinks[1]);

    secondView.unmount();
  });

  it("does not show the card size slider", () => {
    localStorage.setItem("library-view", "grid");
    localStorage.setItem("library-card-width", "220");
    const view = renderInDom(
      <InputScopeProvider>
        <Library />
      </InputScopeProvider>,
    );

    expect(view.container.querySelector('input[type="range"]')).toBeNull();
    view.unmount();
  });
});
