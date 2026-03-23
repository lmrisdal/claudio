import { createContext, useContext } from "react";

export interface AuthState {
  user: {
    id: number;
    username: string;
    role: "user" | "admin";
    createdAt: string;
  } | null;
  token: string | null;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => void;
  setToken: (token: string) => void;
  setUser: (user: {
    id: number;
    username: string;
    role: "user" | "admin";
    createdAt: string;
  }) => void;
  isAdmin: boolean;
  isLoggedIn: boolean;
}

export const AuthContext = createContext<AuthState | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
