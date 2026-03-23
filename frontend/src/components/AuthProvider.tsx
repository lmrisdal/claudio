import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { AuthContext } from "../hooks/useAuth";
import type { AuthResponse, User } from "../types/models";

function parseToken(token: string): User | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    const exp = payload.exp * 1000;
    if (Date.now() > exp) return null;
    return {
      id: Number(
        payload[
          "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier"
        ],
      ),
      username:
        payload["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name"],
      role: (
        payload[
          "http://schemas.microsoft.com/ws/2008/06/identity/claims/role"
        ] as string
      ).toLowerCase() as "user" | "admin",
      createdAt: "",
    };
  } catch {
    return null;
  }
}

export default function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() =>
    localStorage.getItem("token"),
  );
  const [user, setUser] = useState<User | null>(() => {
    const t = localStorage.getItem("token");
    return t ? parseToken(t) : null;
  });

  // Validate token: if expired, clear it (adjust state during render)
  if (token) {
    const parsed = parseToken(token);
    if (!parsed && user !== null) {
      localStorage.removeItem("token");
      setToken(null);
      setUser(null);
    }
  }

  // Try proxy authentication on mount if not logged in
  useEffect(() => {
    if (token) return;
    api
      .get<AuthResponse>("/auth/proxy")
      .then((res) => {
        localStorage.setItem("token", res.token);
        setToken(res.token);
        setUser(res.user);
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAuth = useCallback(
    async (endpoint: string, username: string, password: string) => {
      const res = await api.post<AuthResponse>(endpoint, {
        username,
        password,
      });
      localStorage.setItem("token", res.token);
      setToken(res.token);
      setUser(res.user);
    },
    [],
  );

  const login = useCallback(
    (username: string, password: string) =>
      handleAuth("/auth/login", username, password),
    [handleAuth],
  );

  const register = useCallback(
    (username: string, password: string) =>
      handleAuth("/auth/register", username, password),
    [handleAuth],
  );

  const logout = useCallback(() => {
    localStorage.removeItem("token");
    setToken(null);
    setUser(null);
  }, []);

  const updateToken = useCallback((newToken: string) => {
    localStorage.setItem("token", newToken);
    setToken(newToken);
  }, []);

  const updateUser = useCallback((newUser: User) => {
    setUser(newUser);
  }, []);

  return (
    <AuthContext
      value={{
        user,
        token,
        login,
        register,
        logout,
        setToken: updateToken,
        setUser: updateUser,
        isAdmin: user?.role === "admin",
        isLoggedIn: !!user,
      }}
    >
      {children}
    </AuthContext>
  );
}
