import { Navigate } from "react-router";
import { useAuth } from "../hooks/use-auth";

export function GuestRoute({ children }: { children: React.ReactNode }) {
  const { isLoggedIn, isReady } = useAuth();
  if (!isReady) return null;
  if (isLoggedIn) return <Navigate to="/" replace />;
  return <>{children}</>;
}
