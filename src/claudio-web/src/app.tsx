import { Suspense } from "react";
import { Outlet } from "react-router";
import NavigationProvider from "./features/core/components/navigation-provider";
import { useTheme } from "./features/core/hooks/use-theme";

import { DownloadManagerProvider } from "./features/downloads/hooks/use-download-manager";

import { DesktopGate } from "./features/desktop/components/desktop-gate";
import UpdateToast from "./features/desktop/components/update-toast";

export default function AppShell() {
  useTheme(); // keeps OS colour-scheme subscription alive for the lifetime of the app

  return (
    <div className="min-h-dvh bg-grid flex flex-col">
      <NavigationProvider>
        <DesktopGate>
          <DownloadManagerProvider>
            <div className="flex-1 flex flex-col min-h-0">
              <Suspense>
                <Outlet />
              </Suspense>
            </div>
            <UpdateToast />
          </DownloadManagerProvider>
        </DesktopGate>
      </NavigationProvider>
    </div>
  );
}
