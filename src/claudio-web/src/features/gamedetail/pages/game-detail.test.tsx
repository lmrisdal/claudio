// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanupRenderedDom, renderInDom } from "../../../test-utils/render";
import type { Game } from "../../core/types/models";
import { getGameCoverViewTransitionName } from "../shared";
import GameDetail from "./game-detail";

const { navigateMock, useShortcutMock, backSoundMock } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  useShortcutMock: vi.fn(),
  backSoundMock: vi.fn(async () => {}),
}));

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
  useNavigate: () => navigateMock,
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
  useShortcut: useShortcutMock,
}));

vi.mock("../../core/utils/sounds", () => ({
  sounds: {
    back: backSoundMock,
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

function mockQueries() {
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
}

describe("GameDetail", () => {
  beforeEach(() => {
    useQueryMock.mockReset();
    getQueryDataMock.mockReset();
    getQueryStateMock.mockReset();
    navigateMock.mockReset();
    useShortcutMock.mockReset();
    backSoundMock.mockClear();
  });

  it("renders the cached library cover immediately", () => {
    mockQueries();

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

  it("uses a view transition when leaving with the escape shortcut", () => {
    mockQueries();

    const view = renderInDom(<GameDetail />);

    const shortcutHandler = useShortcutMock.mock.calls.find((call) => call[0] === "escape")?.[1] as
      | (() => void)
      | undefined;

    expect(shortcutHandler).toBeDefined();

    shortcutHandler?.();

    expect(backSoundMock).toHaveBeenCalledOnce();
    expect(navigateMock).toHaveBeenCalledWith("/", { viewTransition: true });

    view.unmount();
    cleanupRenderedDom();
  });
});
