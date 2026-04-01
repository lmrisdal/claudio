import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../core/api/client";
import type { User } from "../../core/types/models";
import type { AuthProvider, AuthProviders } from "../hooks/use-auth";
import { AuthContext } from "../hooks/use-auth";

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

interface AuthProvidersResponse {
  providers: AuthProvider[];
  localLoginEnabled: boolean;
  userCreationEnabled: boolean;
}

const noAuthUser: User = {
  id: 0,
  username: "admin",
  role: "admin",
  createdAt: "",
};

function parseToken(token: string): User | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    const exp = payload.exp * 1000;
    if (Date.now() > exp) return null;
    return {
      id: Number(payload.sub),
      username: payload.name,
      role: (payload.role as string).toLowerCase() as "user" | "admin",
      createdAt: "",
    };
  } catch {
    return null;
  }
}

async function exchangeTokens(
  parameters: Record<string, string>,
): Promise<TokenResponse> {
  const body = new URLSearchParams({ ...parameters, client_id: "claudio-spa" });
  const serverUrl = localStorage.getItem("claudio_server_url") ?? "";
  const res = await fetch(`${serverUrl}/connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      const description: string =
        json.error_description || json.error || "Authentication failed";
      throw new Error(description);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(text || "Authentication failed");
      }
      throw error;
    }
  }
  return res.json();
}

export default function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(() =>
    localStorage.getItem("token"),
  );
  const [authDisabled, setAuthDisabled] = useState(false);
  const [providers, setProviders] = useState<AuthProviders>({
    providers: [],
    localLoginEnabled: true,
    userCreationEnabled: true,
  });
  const [user, setUser] = useState<User | null>(() => {
    const t = localStorage.getItem("token");
    return t ? parseToken(t) : null;
  });

  // Validate token: if expired, clear it
  if (token) {
    const parsed = parseToken(token);
    if (!parsed && user !== null) {
      localStorage.removeItem("token");
      localStorage.removeItem("refresh_token");
      setTokenState(null);
      setUser(null);
    }
  }

  const applyTokenResponse = useCallback((res: TokenResponse) => {
    localStorage.setItem("token", res.access_token);
    if (res.refresh_token) {
      localStorage.setItem("refresh_token", res.refresh_token);
    }
    setTokenState(res.access_token);
    setUser(parseToken(res.access_token));
  }, []);

  // Fetch auth providers; 404 means auth is disabled
  useEffect(() => {
    api
      .get<AuthProvidersResponse>("/auth/providers")
      .then((response) => {
        setProviders(response);
      })
      .catch(() => {
        // Auth endpoints not available — auth is disabled, act as admin
        setAuthDisabled(true);
        setUser(noAuthUser);
      });
  }, []);

  useEffect(() => {
    if (token) return;
    api
      .post<{ nonce: string }>("/auth/remote", {})
      .then(async ({ nonce }) => {
        const res = await exchangeTokens({
          grant_type: "urn:claudio:proxy_nonce",
          nonce,
          scope: "openid offline_access roles",
        });
        applyTokenResponse(res);
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const login = useCallback(
    async (username: string, password: string) => {
      const res = await exchangeTokens({
        grant_type: "password",
        username,
        password,
        scope: "openid offline_access roles",
      });
      applyTokenResponse(res);
    },
    [applyTokenResponse],
  );

  const register = useCallback(
    async (username: string, password: string) => {
      await api.post("/auth/register", { username, password });
      const res = await exchangeTokens({
        grant_type: "password",
        username,
        password,
        scope: "openid offline_access roles",
      });
      applyTokenResponse(res);
    },
    [applyTokenResponse],
  );

  const completeExternalLogin = useCallback(
    async (nonce: string) => {
      const res = await exchangeTokens({
        grant_type: "urn:claudio:external_login_nonce",
        nonce,
        scope: "openid offline_access roles",
      });
      applyTokenResponse(res);
    },
    [applyTokenResponse],
  );

  const logout = useCallback(() => {
    localStorage.removeItem("token");
    localStorage.removeItem("refresh_token");
    setTokenState(null);
    setUser(null);
  }, []);

  const updateToken = useCallback((newToken: string) => {
    localStorage.setItem("token", newToken);
    setTokenState(newToken);
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
        completeExternalLogin,
        logout,
        setToken: updateToken,
        setUser: updateUser,
        providers,
        authDisabled,
        isAdmin: user?.role === "admin",
        isLoggedIn: !!user,
      }}
    >
      {children}
    </AuthContext>
  );
}
