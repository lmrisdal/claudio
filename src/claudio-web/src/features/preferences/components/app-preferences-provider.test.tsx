// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { renderInDom } from "../../../test-utils/render";
import { useAppPreferences } from "../hooks/use-app-preferences";
import AppPreferencesProvider from "./app-preferences-provider";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../../core/api/client", () => ({ api: { get } }));

function PreferencesConsumer() {
  const { preferences } = useAppPreferences();
  return <div>Platform order: {JSON.stringify(preferences.library.platformOrder)}</div>;
}

let view: ReturnType<typeof renderInDom>;
let queryClient: QueryClient;
afterEach(() => {
  view?.unmount();
  queryClient?.clear();
});

describe("AppPreferencesProvider response handling", () => {
  it.each([
    ["missing library", {}, []],
    ["HTML from an incorrect server", "<html>Wrong server</html>", []],
    ["null library", { library: null }, []],
    ["missing order", { library: {} }, []],
    ["invalid order", { library: { platformOrder: "invalid" } }, []],
    ["mixed order", { library: { platformOrder: [null, "linux", 42] } }, ["linux"]],
    ["valid order", { library: { platformOrder: ["win", "linux"] } }, ["win", "linux"]],
  ])("renders safely with %s", async (_name, response, expected) => {
    get.mockResolvedValue(response);
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      view = renderInDom(
        <QueryClientProvider client={queryClient}>
          <AppPreferencesProvider>
            <PreferencesConsumer />
          </AppPreferencesProvider>
        </QueryClientProvider>,
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(get).toHaveBeenCalledWith("/preferences");
    expect(view.container.textContent).toBe(`Platform order: ${JSON.stringify(expected)}`);
  });
});
