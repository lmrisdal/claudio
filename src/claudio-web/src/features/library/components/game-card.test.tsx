// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vite-plus/test";
import { cleanupRenderedDom, renderInDom } from "../../../test-utils/render";
import GameCard from "./game-card";

vi.mock("react-router", () => ({
  Link: ({ children, ...properties }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...properties}>{children}</a>
  ),
}));

describe("GameCard", () => {
  it("renders the game cover when one exists", () => {
    const view = renderInDom(
      <GameCard
        game={{
          id: 7,
          title: "Alpha",
          platform: "win",
          installType: "portable",
          sizeBytes: 0,
          isArchive: false,
          isMissing: false,
          isProcessing: false,
          folderName: "alpha",
          coverUrl: "https://example.com/cover.png",
        }}
      />,
    );

    const image = view.container.querySelector<HTMLImageElement>('img[alt="Alpha"]');
    expect(image).not.toBeNull();
    expect(image?.getAttribute("src")).toBe("https://example.com/cover.png");

    view.unmount();
    cleanupRenderedDom();
  });
});
