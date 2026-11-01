import { Suspense } from "react";
import { Outlet } from "react-router";
import NavigationProvider from "./features/core/components/navigation-provider";

import { DownloadManagerProvider } from "./features/downloads/hooks/use-download-manager";

import UpdateToast from "./features/desktop/components/update-toast";

export default function AppShell() {
  return (
    <div className="min-h-dvh bg-grid flex flex-col">
      <NavigationProvider>
        <DownloadManagerProvider>
          <div className="flex-1 flex flex-col min-h-0">
            <Suspense>
              <Outlet />
            </Suspense>
          </div>
          <UpdateToast />
        </DownloadManagerProvider>
      </NavigationProvider>
    </div>
  );
}
