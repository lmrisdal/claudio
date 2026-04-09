import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import App from "./app";
import AuthProvider from "./features/auth/components/auth-provider";
import GuideProvider from "./features/core/components/guide-provider";
import NavigationProvider from "./features/core/components/navigation-provider";
import ServerStatusProvider from "./features/core/components/server-status-provider";
import { InputScopeProvider } from "./features/core/hooks/use-input-scope";
import { resolveThemePreference, type ThemePreference } from "./features/core/hooks/use-theme";
import { applyAppTintVariables } from "./features/core/utils/app-tint";
import { isReducedTransparencyEnabled } from "./features/core/utils/preferences";
import { getAppTint } from "./features/core/utils/preferences";
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
  document.documentElement.classList.toggle("reduce-transparency", isReducedTransparencyEnabled());
  const storedTheme = localStorage.getItem("theme") as ThemePreference | null;
  const themePreference =
    storedTheme === "dark" || storedTheme === "light" || storedTheme === "system"
      ? storedTheme
      : "system";
  applyAppTintVariables(
    document.documentElement,
    resolveThemePreference(
      themePreference,
      globalThis.matchMedia("(prefers-color-scheme: light)").matches,
    ),
    getAppTint(),
    isReducedTransparencyEnabled(),
  );
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
      refetchOnReconnect: true,
      refetchOnWindowFocus: true,
    },
  },
});

createRoot(document.querySelector("#root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ServerStatusProvider>
          <AuthProvider>
            <InputScopeProvider>
              <GuideProvider>
                <SettingsDialogProvider>
                  <NavigationProvider>
                    <main data-ui-scroll-container>
                      <App />
                    </main>
                  </NavigationProvider>
                </SettingsDialogProvider>
              </GuideProvider>
            </InputScopeProvider>
          </AuthProvider>
        </ServerStatusProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
