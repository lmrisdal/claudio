import { listen } from "@tauri-apps/api/event";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  desktopCompleteExternalLogin,
  desktopGetSession,
  desktopLogin,
  desktopLogout,
  isDesktop,
  type DesktopSession,
} from "../../desktop/hooks/use-desktop";
import { api } from "../../core/api/client";
import { useServerStatus } from "../../core/hooks/use-server-status";
import type { User } from "../../core/types/models";
import type { AuthProvider, AuthProviders } from "../hooks/use-auth";
import { AuthContext } from "../hooks/use-auth";

interface AuthProvidersResponse {
  providers: AuthProvider[];
  authDisabled: boolean;
  localLoginEnabled: boolean;
  userCreationEnabled: boolean;
}

const DEFAULT_AUTH_PROVIDERS: AuthProviders = {
  providers: [],
  authDisabled: false,
  localLoginEnabled: true,
  userCreationEnabled: true,
};

function normalizeAuthProvidersResponse(
  response: AuthProvidersResponse | null | undefined,
): AuthProviders {
  return {
    providers: Array.isArray(response?.providers) ? response.providers : [],
    authDisabled: response?.authDisabled ?? false,
    localLoginEnabled: response?.localLoginEnabled ?? true,
    userCreationEnabled: response?.userCreationEnabled ?? true,
  };
}

const AUTH_DISABLED_USER: User = {
  id: 0,
  username: "admin",
  role: "admin",
  createdAt: "",
};

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

export default function AuthProvider({ children }: { children: ReactNode }) {
  const { isConnected } = useServerStatus();
  const [authDisabled, setAuthDisabled] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [providers, setProviders] = useState<AuthProviders>(DEFAULT_AUTH_PROVIDERS);
  const [user, setUser] = useState<User | null>(null);
  const previousConnectedReference = useRef(isConnected);

  const loadWebSession = useCallback(async () => {
    try {
      setUser(await api.get<User>("/auth/me"));
    } catch {
      setUser(null);
    }
  }, []);

  const applyDesktopSession = useCallback((session: DesktopSession) => {
    setUser(toUser(session));
  }, []);

  useEffect(() => {
    if (isDesktop && !isConnected) {
      setAuthDisabled(true);
      setIsReady(true);
      return;
    }

    let cancelled = false;

    void api
      .get<AuthProvidersResponse>("/auth/providers")
      .then(async (response) => {
        if (cancelled) return;
        const normalizedProviders = normalizeAuthProvidersResponse(response);
        setProviders(normalizedProviders);

        if (normalizedProviders.authDisabled) {
          setUser(AUTH_DISABLED_USER);
          setAuthDisabled(true);
          setIsReady(true);
          return;
        }

        setAuthDisabled(false);
        if (!isDesktop) {
          await loadWebSession();
        }

        setIsReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        setAuthDisabled(true);
        setIsReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, [isConnected, loadWebSession]);

  useEffect(() => {
    if (!isDesktop) return;

    let cancelled = false;

    void desktopGetSession()
      .then((session) => {
        if (cancelled) return;
        applyDesktopSession(session);
        setIsReady(true);
      })
      .catch(() => {
        if (!cancelled) {
          setIsReady(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [applyDesktopSession]);

  useEffect(() => {
    if (!isDesktop) {
      previousConnectedReference.current = isConnected;
      return;
    }

    const wasConnected = previousConnectedReference.current;
    previousConnectedReference.current = isConnected;
    if (wasConnected || !isConnected) {
      return;
    }

    let cancelled = false;

    void desktopGetSession()
      .then((session) => {
        if (cancelled) return;
        applyDesktopSession(session);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [applyDesktopSession, isConnected]);

  useEffect(() => {
    if (!isDesktop) return;

    const unlisten = listen("deep-link-auth-complete", () => {
      void desktopGetSession().then((session) => {
        applyDesktopSession(session);
      });
    });

    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [applyDesktopSession]);

  const login = useCallback(
    async (username: string, password: string) => {
      if (isDesktop) {
        applyDesktopSession(await desktopLogin(username, password));
        return;
      }

      await api.post<void>("/auth/login", { username, password });
      await loadWebSession();
    },
    [applyDesktopSession, loadWebSession],
  );

  const register = useCallback(
    async (username: string, password: string) => {
      await api.post("/auth/register", { username, password });

      if (isDesktop) {
        applyDesktopSession(await desktopLogin(username, password));
        return;
      }

      await loadWebSession();
    },
    [applyDesktopSession, loadWebSession],
  );

  const completeExternalLogin = useCallback(
    async (nonce: string) => {
      if (isDesktop) {
        applyDesktopSession(await desktopCompleteExternalLogin(nonce));
        return;
      }

      await loadWebSession();
    },
    [applyDesktopSession, loadWebSession],
  );

  const logout = useCallback(async () => {
    if (isDesktop) {
      applyDesktopSession(await desktopLogout());
      return;
    }

    await api.post<void>("/auth/logout", {});
    setUser(null);
  }, [applyDesktopSession]);

  const updateUser = useCallback((newUser: User) => {
    setUser(newUser);
  }, []);

  return (
    <AuthContext
      value={{
        user,
        token: null,
        login,
        register,
        completeExternalLogin,
        logout,
        setToken: () => {},
        setUser: updateUser,
        providers,
        authDisabled,
        isReady,
        isAdmin: user?.role === "admin",
        isLoggedIn: !!user,
      }}
    >
      {children}
    </AuthContext>
  );
}
