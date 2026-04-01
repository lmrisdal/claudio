import { Navigate } from "react-router";
import { useAuth } from "../hooks/useAuth";

export function AdminRoute({ children }: { children: React.ReactNode }) {
  const { isLoggedIn, isAdmin } = useAuth();
  if (!isLoggedIn) return <Navigate to="/login" replace />;
  if (!isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}
