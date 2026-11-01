// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { renderInDom } from "../../../test-utils/render";
import { ServerStatusContext } from "../../core/hooks/use-server-status";
import { useAvailableGames } from "./use-available-games";

const { apiGet, listInstalledGames } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  listInstalledGames: vi.fn(),
}));

vi.mock("../../core/api/client", () => ({ api: { get: apiGet } }));
vi.mock("./use-desktop", () => ({ isDesktop: true, listInstalledGames }));

let result: ReturnType<typeof useAvailableGames>;
let view: ReturnType<typeof renderInDom>;

function Probe() {
  result = useAvailableGames();
  return null;
}

async function renderProbe(isConnected: boolean) {
  const client = new QueryClient({
    defaultOptions: { queries: { networkMode: "always", retry: false } },
  });
  const wrap = (children: ReactNode) => (
    <QueryClientProvider client={client}>
      <ServerStatusContext value={{ isConnected, refresh: async () => {} }}>
        {children}
      </ServerStatusContext>
    </QueryClientProvider>
  );
  await act(async () => {
    view = renderInDom(wrap(<Probe />));
  });
}

const installedGame = {
  remoteGameId: 7,
  title: "Installed",
  platform: "win",
  installType: "portable",
  installPath: "/games/installed",
  installedAt: "2026-01-01",
};

describe("useAvailableGames", () => {
  beforeEach(() => {
    apiGet.mockReset();
    listInstalledGames.mockReset();
    listInstalledGames.mockResolvedValue([installedGame]);
  });
  afterEach(() => {
    view.unmount();
  });

  it("returns the server library when it is reachable", async () => {
    apiGet.mockResolvedValue([{ id: 1, title: "Remote" }]);
    await renderProbe(true);
    await vi.waitFor(() => expect(result.games.map((game) => game.title)).toEqual(["Remote"]));
    expect(result.isOffline).toBe(false);
  });

  it("falls back to installed games when the library request fails", async () => {
    apiGet.mockRejectedValue(new Error("The server returned an unexpected response."));
    await renderProbe(true);
    await vi.waitFor(() => expect(result.games.map((game) => game.id)).toEqual([7]));
    expect(result.isOffline).toBe(true);
  });

  it("keeps retrying a failed library request while the server looks healthy", async () => {
    vi.useFakeTimers();
    apiGet.mockRejectedValueOnce(new Error("starting"));
    apiGet.mockResolvedValue([{ id: 1, title: "Remote" }]);
    await renderProbe(true);
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(result.isOffline).toBe(true);

    await act(() => vi.advanceTimersByTimeAsync(6000));
    vi.useRealTimers();

    expect(result.isOffline).toBe(false);
    expect(result.games.map((game) => game.title)).toEqual(["Remote"]);
  });

  it("falls back to installed games when the health check reports a disconnect", async () => {
    apiGet.mockResolvedValue([{ id: 1, title: "Remote" }]);
    await renderProbe(false);
    await vi.waitFor(() => expect(result.games.map((game) => game.title)).toEqual(["Installed"]));
    expect(result.isOffline).toBe(true);
  });

  it("reports an empty offline library when nothing is installed", async () => {
    apiGet.mockRejectedValue(new Error("offline"));
    listInstalledGames.mockResolvedValue([]);
    await renderProbe(false);
    await vi.waitFor(() =>
      expect(result).toMatchObject({ games: [], isLoading: false, isOffline: true }),
    );
  });
});
