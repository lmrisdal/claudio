import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import {
  desktopCompleteExternalLogin,
  desktopGetSession,
  desktopLogin,
  desktopLogout,
  desktopProxyLogin,
  isDesktop,
  type DesktopSession,
} from "../../desktop/hooks/use-desktop";
import { api } from "../../core/api/client";
import type { User } from "../../core/types/models";
import type { AuthProvider, AuthProviders } from "../hooks/use-auth";
import { AuthContext } from "../hooks/use-auth";

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
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

function toUser(session: DesktopSession): User | null {
  if (!session.user) {
    return null;
  }

  return {
    id: session.user.id,
    username: session.user.username,
    role: session.user.role,
    createdAt: "",
  };
}

async function exchangeTokens(parameters: Record<string, string>): Promise<TokenResponse> {
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
      const description: string = json.error_description || json.error || "Authentication failed";
      throw new Error(description);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new TypeError(text || "Authentication failed");
      }
      throw error;
    }
  }

  return res.json();
}

export default function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(() => {
    if (isDesktop) return null;
    return localStorage.getItem("token");
  });
  const [authDisabled, setAuthDisabled] = useState(false);
  const [providers, setProviders] = useState<AuthProviders>({
    providers: [],
    localLoginEnabled: true,
    userCreationEnabled: true,
  });
  const [user, setUser] = useState<User | null>(() => {
    if (isDesktop) return null;
    const existingToken = localStorage.getItem("token");
    return existingToken ? parseToken(existingToken) : null;
  });

  const clearWebAuthState = useCallback(() => {
    localStorage.removeItem("token");
    localStorage.removeItem("refresh_token");
    setTokenState(null);
    setUser(null);
  }, []);

  const applyWebTokenResponse = useCallback((response: TokenResponse) => {
    localStorage.setItem("token", response.access_token);
    if (response.refresh_token) {
      localStorage.setItem("refresh_token", response.refresh_token);
    }
    setTokenState(response.access_token);
    setUser(parseToken(response.access_token));
  }, []);

  const applyDesktopSession = useCallback((session: DesktopSession) => {
    localStorage.removeItem("token");
    localStorage.removeItem("refresh_token");
    setTokenState(null);
    setUser(toUser(session));
  }, []);

  if (!isDesktop && token) {
    const parsed = parseToken(token);
    if (!parsed && user !== null) {
      clearWebAuthState();
    }
  }

  useEffect(() => {
    api
      .get<AuthProvidersResponse>("/auth/providers")
      .then((response) => {
        setProviders(response);
      })
      .catch(() => {
        setAuthDisabled(true);
        setUser(noAuthUser);
      });
  }, []);

  useEffect(() => {
    if (!isDesktop) return;

    let cancelled = false;
    clearWebAuthState();

    void desktopGetSession()
      .then((session) => {
        if (cancelled) return;

        applyDesktopSession(session);
        if (session.isLoggedIn) {
          return;
        }

        return desktopProxyLogin()
          .then((proxySession) => {
            if (!cancelled) {
              applyDesktopSession(proxySession);
            }
          })
          .catch(() => {});
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [applyDesktopSession, clearWebAuthState]);

  useEffect(() => {
    if (isDesktop || token) return;

    api
      .post<{ nonce: string }>("/auth/remote", {})
      .then(async ({ nonce }) => {
        const response = await exchangeTokens({
          grant_type: "urn:claudio:proxy_nonce",
          nonce,
          scope: "openid offline_access roles",
        });
        applyWebTokenResponse(response);
      })
      .catch(() => {});
  }, [applyWebTokenResponse, token]);

  useEffect(() => {
    if (isDesktop) return;

    function handleStorage(event: StorageEvent) {
      if (event.storageArea !== localStorage) return;
      if (event.key !== "token" && event.key !== null) return;

      const nextToken = localStorage.getItem("token");
      if (!nextToken) {
        setTokenState(null);
        setUser(null);
        return;
      }

      const parsed = parseToken(nextToken);
      if (!parsed) {
        clearWebAuthState();
        return;
      }

      setTokenState(nextToken);
      setUser(parsed);
    }

    globalThis.addEventListener("storage", handleStorage);

    return () => {
      globalThis.removeEventListener("storage", handleStorage);
    };
  }, [clearWebAuthState]);

  const login = useCallback(
    async (username: string, password: string) => {
      if (isDesktop) {
        applyDesktopSession(await desktopLogin(username, password));
        return;
      }

      const response = await exchangeTokens({
        grant_type: "password",
        username,
        password,
        scope: "openid offline_access roles",
      });
      applyWebTokenResponse(response);
    },
    [applyDesktopSession, applyWebTokenResponse],
  );

  const register = useCallback(
    async (username: string, password: string) => {
      await api.post("/auth/register", { username, password });

      if (isDesktop) {
        applyDesktopSession(await desktopLogin(username, password));
        return;
      }

      const response = await exchangeTokens({
        grant_type: "password",
        username,
        password,
        scope: "openid offline_access roles",
      });
      applyWebTokenResponse(response);
    },
    [applyDesktopSession, applyWebTokenResponse],
  );

  const completeExternalLogin = useCallback(
    async (nonce: string) => {
      if (isDesktop) {
        applyDesktopSession(await desktopCompleteExternalLogin(nonce));
        return;
      }

      const response = await exchangeTokens({
        grant_type: "urn:claudio:external_login_nonce",
        nonce,
        scope: "openid offline_access roles",
      });
      applyWebTokenResponse(response);
    },
    [applyDesktopSession, applyWebTokenResponse],
  );

  const logout = useCallback(async () => {
    if (isDesktop) {
      applyDesktopSession(await desktopLogout());
      return;
    }

    clearWebAuthState();
  }, [applyDesktopSession, clearWebAuthState]);

  const updateToken = useCallback((newToken: string) => {
    if (isDesktop) return;
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
