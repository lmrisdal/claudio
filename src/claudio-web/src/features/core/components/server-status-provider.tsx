import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { isDesktop } from "../../desktop/hooks/use-desktop";
import { ServerStatusContext } from "../hooks/use-server-status";

const HEALTH_TIMEOUT_MS = 3000;
const CONNECTED_POLL_INTERVAL_MS = 30_000;
const DISCONNECTED_POLL_INTERVAL_MS = 5000;

function parseCustomHeaders(): Record<string, string> {
  try {
    const raw = localStorage.getItem("claudio_custom_headers");
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

async function checkDesktopServerHealth(signal: AbortSignal): Promise<boolean> {
  const serverUrl = localStorage.getItem("claudio_server_url")?.trim();
  if (!serverUrl) {
    return true;
  }

  try {
    const healthUrl = `${serverUrl.replace(/\/+$/, "")}/health`;
    const response = await fetch(healthUrl, {
      method: "GET",
      headers: parseCustomHeaders(),
      signal,
    });

    return response.ok;
  } catch {
    return false;
  }
}

export default function ServerStatusProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [isConnected, setIsConnected] = useState(true);
  const previousConnectedReference = useRef(true);

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

      const controller = new AbortController();
      const timeout = globalThis.setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
      const nextConnected = await checkDesktopServerHealth(controller.signal);
      globalThis.clearTimeout(timeout);

      if (cancelled) {
        return;
      }

      setIsConnected(nextConnected);

      if (!previousConnectedReference.current && nextConnected) {
        void queryClient.refetchQueries({ type: "active" });
      }

      previousConnectedReference.current = nextConnected;
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
  }, [queryClient]);

  const value = useMemo(
    () => ({
      isConnected,
    }),
    [isConnected],
  );

  return <ServerStatusContext value={value}>{children}</ServerStatusContext>;
}
