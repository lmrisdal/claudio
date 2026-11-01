import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { desktopCheckServerConnection, isDesktop } from "../../desktop/hooks/use-desktop";
import { ServerStatusContext } from "../hooks/use-server-status";

const HEALTH_TIMEOUT_MS = 3000;
const CONNECTED_POLL_INTERVAL_MS = 30_000;
const DISCONNECTED_POLL_INTERVAL_MS = 5000;

async function checkDesktopServerHealth(signal: AbortSignal): Promise<boolean> {
  try {
    const response = await Promise.race([
      desktopCheckServerConnection({ path: "/health" }),
      new Promise<never>((_, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          },
          { once: true },
        );
      }),
    ]);

    return response.ok;
  } catch {
    return false;
  }
}

export default function ServerStatusProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [isConnected, setIsConnected] = useState(true);
  const previousConnectedReference = useRef(true);

  const checkServer = useCallback(async () => {
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    const nextConnected = await checkDesktopServerHealth(controller.signal);
    globalThis.clearTimeout(timeout);

    const reconnected = !previousConnectedReference.current && nextConnected;
    previousConnectedReference.current = nextConnected;
    setIsConnected(nextConnected);

    return { nextConnected, reconnected };
  }, []);

  useEffect(() => {
    if (!isDesktop) {
      setIsConnected(true);
      return;
    }

    let cancelled = false;
    let timer: number | null = null;

    async function pollServer() {
      if (cancelled) {
        return;
      }

      const { nextConnected, reconnected } = await checkServer();

      if (cancelled) {
        return;
      }

      if (reconnected) {
        void queryClient.refetchQueries({ type: "active" });
      }

      timer = globalThis.setTimeout(
        pollServer,
        nextConnected ? CONNECTED_POLL_INTERVAL_MS : DISCONNECTED_POLL_INTERVAL_MS,
      );
    }

    void pollServer();

    return () => {
      cancelled = true;
      if (timer !== null) {
        globalThis.clearTimeout(timer);
      }
    };
  }, [checkServer, queryClient]);

  const refresh = useCallback(async () => {
    if (isDesktop) {
      await checkServer();
    }

    await queryClient.refetchQueries({ type: "active" });
  }, [checkServer, queryClient]);

  const value = useMemo(
    () => ({
      isConnected,
      refresh,
    }),
    [isConnected, refresh],
  );

  return <ServerStatusContext value={value}>{children}</ServerStatusContext>;
}
