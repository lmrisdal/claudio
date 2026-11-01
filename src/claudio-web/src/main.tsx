import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router/dom";
import { appRouter } from "./app-router";
import ServerStatusProvider from "./features/core/components/server-status-provider";
import { InputScopeProvider } from "./features/core/hooks/use-input-scope";
import { forwardRendererLogs } from "./features/desktop/hooks/desktop-log";
import { isDesktop } from "./features/desktop/hooks/use-desktop";
import SettingsDialogProvider from "./features/settings/components/settings-dialog-provider";
import AppPreferencesProvider from "./features/preferences/components/app-preferences-provider";
import "./index.css";

if (isDesktop) {
  document.documentElement.dataset.desktop = "";
  document.addEventListener("contextmenu", (event) => {
    event.preventDefault();
  });

  forwardRendererLogs();
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnReconnect: true,
      refetchOnWindowFocus: true,
    },
  },
});

createRoot(document.querySelector("#root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ServerStatusProvider>
        <AppPreferencesProvider>
          <InputScopeProvider>
            <SettingsDialogProvider>
              <main data-ui-scroll-container>
                <RouterProvider router={appRouter} />
              </main>
            </SettingsDialogProvider>
          </InputScopeProvider>
        </AppPreferencesProvider>
      </ServerStatusProvider>
    </QueryClientProvider>
  </StrictMode>,
);
