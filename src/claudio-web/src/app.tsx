import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router";
import { useTheme } from "./features/core/hooks/use-theme";

import { isDesktop } from "./features/desktop/hooks/use-desktop";
import { DownloadManagerProvider } from "./features/downloads/hooks/use-download-manager";

import { AdminRoute } from "./features/auth/components/admin-route";
import { GuestRoute } from "./features/auth/components/guest-route";
import { ProtectedRoute } from "./features/auth/components/protected-route";
import { DesktopGate } from "./features/desktop/components/desktop-gate";
import DesktopLayout from "./features/desktop/components/desktop-layout";
import UpdateToast from "./features/desktop/components/update-toast";
import SettingsWindow from "./features/settings/components/settings-window";

const Admin = lazy(() => import("./features/admin/pages/admin"));
const Downloads = lazy(() => import("./features/downloads/pages/downloads"));
const GameDetail = lazy(() => import("./features/gamedetail/pages/game-detail"));
const GameEmulator = lazy(() => import("./features/gamedetail/pages/game-emulator"));
const Library = lazy(() => import("./features/library/pages/library"));
const Login = lazy(() => import("./features/auth/pages/login"));
const ExternalAuthCallback = lazy(() => import("./features/auth/pages/external-auth-callback"));
const Register = lazy(() => import("./features/auth/pages/register"));

export default function App() {
  useTheme(); // keeps OS colour-scheme subscription alive for the lifetime of the app

  const isDesktopSettingsWindow =
    isDesktop && new URLSearchParams(globalThis.location.search).has("desktop-settings-window");

  if (isDesktopSettingsWindow) {
    return <SettingsWindow />;
  }

  return (
    <div className="h-full bg-grid flex flex-col">
      <DesktopGate>
        <DownloadManagerProvider>
          <div className="flex-1 flex flex-col min-h-0">
            <Suspense>
              <Routes>
                <Route
                  path="/login"
                  element={
                    <GuestRoute>
                      <Login />
                    </GuestRoute>
                  }
                />
                <Route
                  path="/register"
                  element={
                    <GuestRoute>
                      <Register />
                    </GuestRoute>
                  }
                />
                <Route path="/auth/callback" element={<ExternalAuthCallback />} />
                <Route
                  path="/"
                  element={
                    <ProtectedRoute>
                      <DesktopLayout>
                        <Library />
                      </DesktopLayout>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/games/:id"
                  element={
                    <ProtectedRoute>
                      <DesktopLayout>
                        <GameDetail />
                      </DesktopLayout>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/games/:id/play"
                  element={
                    <ProtectedRoute>
                      <DesktopLayout>
                        <GameEmulator />
                      </DesktopLayout>
                    </ProtectedRoute>
                  }
                />
                {isDesktop && (
                  <Route
                    path="/downloads"
                    element={
                      <ProtectedRoute>
                        <DesktopLayout>
                          <Downloads />
                        </DesktopLayout>
                      </ProtectedRoute>
                    }
                  />
                )}
                <Route
                  path="/admin"
                  element={
                    <AdminRoute>
                      <DesktopLayout>
                        <Admin />
                      </DesktopLayout>
                    </AdminRoute>
                  }
                />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </div>
          <UpdateToast />
        </DownloadManagerProvider>
      </DesktopGate>
    </div>
  );
}
