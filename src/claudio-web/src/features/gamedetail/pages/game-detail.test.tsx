// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vite-plus/test";
import type { Game } from "../../core/types/models";
import { getGameCoverViewTransitionName } from "../shared";
import { cleanupRenderedDom, renderInDom } from "../../../test-utils/render";
import GameDetail from "./game-detail";

const useQueryMock = vi.fn();
const getQueryDataMock = vi.fn();
const getQueryStateMock = vi.fn();

vi.mock("@tanstack/react-query", () => ({
  useQuery: (...arguments_: unknown[]) => useQueryMock(...arguments_),
  useQueryClient: () => ({
    getQueryData: getQueryDataMock,
    getQueryState: getQueryStateMock,
  }),
}));

vi.mock("react-router", () => ({
  Link: ({ children, ...properties }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...properties}>{children}</a>
  ),
  useNavigate: () => vi.fn(),
  useParams: () => ({ id: "1" }),
}));

vi.mock("../../auth/hooks/use-auth", () => ({
  useAuth: () => ({ user: { role: "user" } }),
}));

vi.mock("../../core/hooks/use-arrow-nav", () => ({
  useArrowNav: () => {},
}));

vi.mock("../../core/hooks/use-input-scope", () => ({
  useInputScope: vi.fn(),
  useInputScopeState: () => ({ isActionBlocked: () => false }),
}));

vi.mock("../../core/hooks/use-shortcut", () => ({
  useShortcut: vi.fn(),
}));

vi.mock("../../core/utils/sounds", () => ({
  sounds: {
    back: vi.fn(async () => {}),
    navigate: vi.fn(async () => {}),
  },
}));

vi.mock("../../desktop/hooks/use-desktop-shell-navigation", () => ({
  useDesktopShellNavigation: () => ({ focusSidebar: () => false }),
}));

vi.mock("../../desktop/hooks/use-desktop", () => ({
  useDesktop: () => ({
    isDesktop: false,
    getInstalledGame: vi.fn(),
  }),
}));

vi.mock("../components/browse-files-dialog", () => ({
  default: () => null,
}));

vi.mock("../components/game-detail-actions", () => ({
  default: () => <div>actions</div>,
}));

vi.mock("../components/game-detail-overview", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const cachedGame: Game = {
  id: 1,
  title: "Alpha",
  platform: "win",
  installType: "portable",
  sizeBytes: 0,
  folderName: "alpha",
  isArchive: false,
  isMissing: false,
  isProcessing: false,
  coverUrl: "https://example.com/cover.png",
};

describe("GameDetail", () => {
  it("renders the cached library cover immediately", () => {
    getQueryDataMock.mockReturnValue([cachedGame]);
    getQueryStateMock.mockReturnValue({ dataUpdatedAt: 123 });
    useQueryMock.mockImplementation((options: { queryKey: string[]; initialData?: unknown }) => {
      switch (options.queryKey[0]) {
        case "game": {
          return { data: options.initialData, isLoading: false };
        }
        case "installedGame": {
          return {
            data: null,
            refetch: vi.fn(),
            isFetching: false,
          };
        }
        case "browse": {
          return { data: undefined, isLoading: false };
        }
        case "emulation": {
          return { data: { supported: false }, isLoading: false };
        }
        default: {
          return { data: undefined, isLoading: false };
        }
      }
    });

    const view = renderInDom(<GameDetail />);

    const image = view.container.querySelector<HTMLImageElement>('img[alt="Alpha"]');
    expect(image).not.toBeNull();
    expect(image?.getAttribute("src")).toBe(cachedGame.coverUrl);
    expect(image?.parentElement?.style.viewTransitionName).toBe(
      getGameCoverViewTransitionName(cachedGame.id),
    );

    view.unmount();
    cleanupRenderedDom();
  });
});
