import { lazy } from "react";
import { Navigate, Route, createBrowserRouter, createRoutesFromElements } from "react-router";
import AppShell from "./app";
import { AdminRoute } from "./features/auth/components/admin-route";
import { GuestRoute } from "./features/auth/components/guest-route";
import { ProtectedRoute } from "./features/auth/components/protected-route";
import DesktopLayout from "./features/desktop/components/desktop-layout";
import { isDesktop } from "./features/desktop/hooks/use-desktop";
import { loadGameDetailPage } from "./features/gamedetail/load-game-detail-page";

const Admin = lazy(() => import("./features/admin/pages/admin"));
const Downloads = lazy(() => import("./features/downloads/pages/downloads"));
const GameDetail = lazy(loadGameDetailPage);
const GameEdit = lazy(() => import("./features/gamedetail/pages/game-edit"));
const GameEmulator = lazy(() => import("./features/gamedetail/pages/game-emulator"));
const Library = lazy(() => import("./features/library/pages/library"));
const Login = lazy(() => import("./features/auth/pages/login"));
const ExternalAuthCallback = lazy(() => import("./features/auth/pages/external-auth-callback"));
const Register = lazy(() => import("./features/auth/pages/register"));
const DesktopSetup = lazy(() => import("./features/desktop/pages/desktop-setup"));

export const appRouter = createBrowserRouter(
  createRoutesFromElements(
    <Route element={<AppShell />}>
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
      {isDesktop && (
        <Route
          path="/desktop-setup"
          element={
            <GuestRoute>
              <DesktopSetup
                onConnected={(serverUrl) => {
                  localStorage.setItem("claudio_server_url", serverUrl);
                  globalThis.location.href = "/login";
                }}
              />
            </GuestRoute>
          }
        />
      )}
      <Route path="/auth/callback" element={<ExternalAuthCallback />} />
      <Route
        element={
          <ProtectedRoute>
            <DesktopLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Library />} />
        <Route path="games/:id" element={<GameDetail />} />
        <Route
          path="games/:id/edit"
          element={
            <AdminRoute>
              <GameEdit />
            </AdminRoute>
          }
        />
        <Route path="games/:id/play" element={<GameEmulator />} />
        {isDesktop && <Route path="downloads" element={<Downloads />} />}
        <Route
          path="admin"
          element={
            <AdminRoute>
              <Admin />
            </AdminRoute>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Route>,
  ),
);
