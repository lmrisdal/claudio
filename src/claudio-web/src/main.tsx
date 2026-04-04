import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import App from "./app";
import AuthProvider from "./features/auth/components/auth-provider";
import GuideProvider from "./features/core/components/guide-provider";
import NavigationProvider from "./features/core/components/navigation-provider";
import { isDesktop } from "./features/desktop/hooks/use-desktop";
import SettingsDialogProvider from "./features/settings/components/settings-dialog-provider";
import "./index.css";

const LOG_ATTACH_TIMEOUT_MS = 1500;

async function attachDesktopLogBridgeWithTimeout() {
  const { attachConsole } = await import("@tauri-apps/plugin-log");
  await Promise.race([
    attachConsole(),
    new Promise<never>((_, reject) => {
      globalThis.setTimeout(() => {
        reject(new Error("Timed out attaching desktop log bridge"));
      }, LOG_ATTACH_TIMEOUT_MS);
    }),
  ]);
}

if (isDesktop) {
  document.documentElement.dataset.desktop = "";
  document.addEventListener("contextmenu", (event) => {
    event.preventDefault();
  });

  try {
    await attachDesktopLogBridgeWithTimeout();
    console.info("Desktop log bridge attached");
  } catch (error) {
    console.error("Failed to attach desktop log bridge", error);
  }
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

createRoot(document.querySelector("#root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <GuideProvider>
            <SettingsDialogProvider>
              <NavigationProvider>
                <main data-ui-scroll-container>
                  <App />
                </main>
              </NavigationProvider>
            </SettingsDialogProvider>
          </GuideProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
