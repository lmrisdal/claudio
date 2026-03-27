import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import App from "./App";
import AccountDialogProvider from "./components/AccountDialogProvider";
import AuthProvider from "./components/AuthProvider";
import GuideProvider from "./components/GuideProvider";
import NavigationProvider from "./hooks/NavigationProvider";
import "./index.css";

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
              <NavigationProvider>
                <App />
              </NavigationProvider>
            </AccountDialogProvider>
          </GuideProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
