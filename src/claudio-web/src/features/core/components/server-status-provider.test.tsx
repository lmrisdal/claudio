// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { renderInDom } from "../../../test-utils/render";
import { useServerStatus, type ServerStatusState } from "../hooks/use-server-status";
import ServerStatusProvider from "./server-status-provider";

const { desktopCheckServerConnection } = vi.hoisted(() => ({
  desktopCheckServerConnection: vi.fn(),
}));
vi.mock("../../desktop/hooks/use-desktop", () => ({
  isDesktop: true,
  desktopCheckServerConnection,
}));

let status: ServerStatusState;
function Probe() {
  status = useServerStatus();
  return null;
}

describe("ServerStatusProvider", () => {
  let view: ReturnType<typeof renderInDom>;
  afterEach(() => {
    view.unmount();
    desktopCheckServerConnection.mockReset();
  });

  it("refresh rechecks the server immediately and refetches active queries", async () => {
    desktopCheckServerConnection.mockResolvedValue({ ok: false, status: 200 });
    const client = new QueryClient();
    const refetchQueries = vi.spyOn(client, "refetchQueries");
    await act(async () => {
      view = renderInDom(
        <QueryClientProvider client={client}>
          <ServerStatusProvider>
            <Probe />
          </ServerStatusProvider>
        </QueryClientProvider>,
      );
    });
    expect(status.isConnected).toBe(false);

    desktopCheckServerConnection.mockResolvedValue({ ok: true, status: 200 });
    await act(() => status.refresh());

    expect(status.isConnected).toBe(true);
    expect(refetchQueries).toHaveBeenCalledWith({ type: "active" });
  });
});
