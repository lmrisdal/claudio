import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import App from "./App";
import AccountDialogProvider from "./features/auth/components/AccountDialogProvider";
import AuthProvider from "./features/auth/components/AuthProvider";
import GuideProvider from "./features/core/components/GuideProvider";
import NavigationProvider from "./features/core/components/NavigationProvider";
import DesktopSettingsProvider from "./features/desktop/components/DesktopSettingsProvider";
import { isDesktop } from "./features/desktop/hooks/useDesktop";
import "./index.css";

if (isDesktop) {
  document.documentElement.setAttribute("data-desktop", "");
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <GuideProvider>
            <AccountDialogProvider>
              <DesktopSettingsProvider>
                <NavigationProvider>
                  <main data-ui-scroll-container>
                    <App />
                  </main>
                </NavigationProvider>
              </DesktopSettingsProvider>
            </AccountDialogProvider>
          </GuideProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
