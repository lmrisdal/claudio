import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router";
import { useTheme } from "./features/core/hooks/useTheme";

import { isDesktop } from "./features/desktop/hooks/useDesktop";
import { DownloadManagerProvider } from "./features/downloads/hooks/useDownloadManager";

import { AdminRoute } from "./features/auth/components/AdminRoute";
import { GuestRoute } from "./features/auth/components/GuestRoute";
import { ProtectedRoute } from "./features/auth/components/ProtectedRoute";
import { DesktopGate } from "./features/desktop/components/DesktopGate";
import DesktopLayout from "./features/desktop/components/DesktopLayout";

const Admin = lazy(() => import("./features/admin/pages/Admin"));
const Downloads = lazy(() => import("./features/downloads/pages/Downloads"));
const GameDetail = lazy(() => import("./features/gamedetail/pages/GameDetail"));
const GameEmulator = lazy(
  () => import("./features/gamedetail/pages/GameEmulator"),
);
const Library = lazy(() => import("./features/library/pages/Library"));
const Login = lazy(() => import("./features/auth/pages/Login"));
const ExternalAuthCallback = lazy(
  () => import("./features/auth/pages/ExternalAuthCallback"),
);
const Register = lazy(() => import("./features/auth/pages/Register"));

export default function App() {
  useTheme(); // keeps OS colour-scheme subscription alive for the lifetime of the app
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
                <Route
                  path="/auth/callback"
                  element={<ExternalAuthCallback />}
                />
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
        </DownloadManagerProvider>
      </DesktopGate>
    </div>
  );
}
