import { createContext, useContext } from "react";

export interface AuthProviders {
  providers: AuthProvider[];
  localLoginEnabled: boolean;
  userCreationEnabled: boolean;
}

export interface AuthProvider {
  slug: string;
  displayName: string;
  logoUrl: string | null;
  startUrl: string;
}

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
  completeExternalLogin: (nonce: string) => Promise<void>;
  logout: () => void;
  setToken: (token: string) => void;
  setUser: (user: {
    id: number;
    username: string;
    role: "user" | "admin";
    createdAt: string;
  }) => void;
  providers: AuthProviders;
  authDisabled: boolean;
  isAdmin: boolean;
  isLoggedIn: boolean;
}

export const AuthContext = createContext<AuthState | null>(null);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
