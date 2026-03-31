import { lazy, Suspense, useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router";
import { useAuth } from "./hooks/useAuth";
import { isDesktop, getSettings } from "./hooks/useDesktop";

import DesktopTitleBar from "./components/DesktopTitleBar";
import Header from "./components/Header";

const Admin = lazy(() => import("./pages/Admin"));
const GameDetail = lazy(() => import("./pages/GameDetail"));
const GameEmulator = lazy(() => import("./pages/GameEmulator"));
const Library = lazy(() => import("./pages/Library"));
const Login = lazy(() => import("./pages/Login"));
const ExternalAuthCallback = lazy(
  () => import("./pages/ExternalAuthCallback"),
);
const Register = lazy(() => import("./pages/Register"));
const DesktopSetup = lazy(() => import("./pages/DesktopSetup"));

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isLoggedIn } = useAuth();
  if (!isLoggedIn) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { isLoggedIn, isAdmin } = useAuth();
  if (!isLoggedIn) return <Navigate to="/login" replace />;
  if (!isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function GuestRoute({ children }: { children: React.ReactNode }) {
  const { isLoggedIn } = useAuth();
  if (isLoggedIn) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function DesktopGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<"loading" | "setup" | "ready">(
    isDesktop ? "loading" : "ready",
  );

  useEffect(() => {
    if (!isDesktop) return;
    let cancelled = false;

    getSettings()
      .then((settings) => {
        if (cancelled) return;
        if (settings.serverUrl) {
          localStorage.setItem("claudio_server_url", settings.serverUrl);
          if (settings.customHeaders && Object.keys(settings.customHeaders).length > 0) {
            localStorage.setItem("claudio_custom_headers", JSON.stringify(settings.customHeaders));
          }
          setState("ready");
        } else {
          setState("setup");
        }
      })
      .catch(() => {
        if (!cancelled) setState("setup");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (state === "loading") return null;

  if (state === "setup") {
    return (
      <Suspense>
        <DesktopSetup
          onConnected={(serverUrl) => {
            localStorage.setItem("claudio_server_url", serverUrl);
            setState("ready");
          }}
        />
      </Suspense>
    );
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <div className="min-h-screen bg-grid flex flex-col">
      <DesktopTitleBar />
      <DesktopGate>
        <div className="flex-1">
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
                    <>
                      <Header />
                      <Library />
                    </>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/games/:id"
                element={
                  <ProtectedRoute>
                    <>
                      <Header />
                      <GameDetail />
                    </>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/games/:id/play"
                element={
                  <ProtectedRoute>
                    <>
                      <Header />
                      <GameEmulator />
                    </>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin"
                element={
                  <AdminRoute>
                    <>
                      <Header />
                      <Admin />
                    </>
                  </AdminRoute>
                }
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </div>
      </DesktopGate>
    </div>
  );
}
