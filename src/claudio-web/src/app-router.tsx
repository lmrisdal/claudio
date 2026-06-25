import { lazy } from "react";
import { Navigate, Route, createBrowserRouter, createRoutesFromElements } from "react-router";
import AppShell from "./app";
import DesktopLayout from "./features/desktop/components/desktop-layout";
import { isDesktop } from "./features/desktop/hooks/use-desktop";
import { loadGameDetailPage } from "./features/gamedetail/load-game-detail-page";

const Admin = lazy(() => import("./features/admin/pages/admin"));
const Downloads = lazy(() => import("./features/downloads/pages/downloads"));
const GameDetail = lazy(loadGameDetailPage);
const GameEdit = lazy(() => import("./features/gamedetail/pages/game-edit"));
const GameEmulator = lazy(() => import("./features/gamedetail/pages/game-emulator"));
const Library = lazy(() => import("./features/library/pages/library"));
const DesktopSetup = lazy(() => import("./features/desktop/pages/desktop-setup"));

export const appRouter = createBrowserRouter(
  createRoutesFromElements(
    <Route element={<AppShell />}>
      {isDesktop && (
        <Route
          path="/desktop-setup"
          element={
            <DesktopSetup
              onConnected={(serverUrl) => {
                localStorage.setItem("claudio_server_url", serverUrl);
                globalThis.location.href = "/";
              }}
            />
          }
        />
      )}
      <Route element={<DesktopLayout />}>
        <Route index element={<Library />} />
        <Route path="games/:id" element={<GameDetail />} />
        <Route path="games/:id/edit" element={<GameEdit />} />
        <Route path="games/:id/play" element={<GameEmulator />} />
        {isDesktop && <Route path="downloads" element={<Downloads />} />}
        <Route path="admin" element={<Admin />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Route>,
  ),
);
