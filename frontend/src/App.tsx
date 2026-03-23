import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router";
import { useAuth } from "./hooks/useAuth";

import Header from "./components/Header";

const Account = lazy(() => import("./pages/Account"));
const Admin = lazy(() => import("./pages/Admin"));
const GameDetail = lazy(() => import("./pages/GameDetail"));
const GameEmulator = lazy(() => import("./pages/GameEmulator"));
const Library = lazy(() => import("./pages/Library"));
const Login = lazy(() => import("./pages/Login"));
const Register = lazy(() => import("./pages/Register"));

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

export default function App() {
  return (
    <div className="min-h-screen bg-grid">
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
            path="/account"
            element={
              <ProtectedRoute>
                <>
                  <Header />
                  <Account />
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
  );
}
