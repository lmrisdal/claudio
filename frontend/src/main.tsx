import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import App from "./app";
import AccountDialogProvider from "./features/auth/components/account-dialog-provider";
import AuthProvider from "./features/auth/components/auth-provider";
import GuideProvider from "./features/core/components/guide-provider";
import NavigationProvider from "./features/core/components/navigation-provider";
import { isDesktop } from "./features/desktop/hooks/use-desktop";
import "./index.css";

if (isDesktop) {
  document.documentElement.dataset.desktop = "";
  const { attachConsole } = await import("@tauri-apps/plugin-log");
  await attachConsole();
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
            <AccountDialogProvider>
              <NavigationProvider>
                <main data-ui-scroll-container>
                  <App />
                </main>
              </NavigationProvider>
            </AccountDialogProvider>
          </GuideProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
