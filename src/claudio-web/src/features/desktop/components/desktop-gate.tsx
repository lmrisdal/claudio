import { Suspense, useEffect, useState } from "react";
import { useTheme } from "../../core/hooks/use-theme";
import { desktopCheckServerConnection, getSettings, isDesktop } from "../hooks/use-desktop";
import { HEADER_HEIGHT } from "./desktop-sidebar";
import DesktopSetup from "../pages/desktop-setup";
import { getConnectionErrorMessage } from "../utils/connection-check";

export function DesktopGate({ children }: { children: React.ReactNode }) {
  useTheme();
  const [state, setState] = useState<"loading" | "setup" | "ready">(
    isDesktop ? "loading" : "ready",
  );
  const [connectionError, setConnectionError] = useState("");
  const dragRegion = isDesktop ? (
    <div
      aria-hidden="true"
      className="desktop-drag fixed inset-x-0 top-0 z-40"
      style={{ height: HEADER_HEIGHT }}
    />
  ) : null;

  useEffect(() => {
    if (!isDesktop) return;
    let cancelled = false;

    getSettings()
      .then(async (settings) => {
        if (cancelled) return;
        if (settings.serverUrl) {
          localStorage.setItem("claudio_server_url", settings.serverUrl);
          localStorage.setItem(
            "claudio_custom_headers",
            JSON.stringify(settings.customHeaders ?? {}),
          );
          const result = await desktopCheckServerConnection({
            serverUrl: settings.serverUrl,
            customHeaders: settings.customHeaders ?? {},
            path: "/health",
          });
          if (cancelled) return;
          if (result.ok) {
            setState("ready");
          } else {
            setConnectionError(getConnectionErrorMessage(result.status));
            setState("setup");
          }
        } else {
          setState("setup");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setConnectionError(getConnectionErrorMessage());
          setState("setup");
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (state === "loading") return null;

  if (state === "setup") {
    return (
      <>
        {dragRegion}
        <Suspense>
          <DesktopSetup
            initialError={connectionError}
            onConnected={(serverUrl) => {
              localStorage.setItem("claudio_server_url", serverUrl);
              setState("ready");
            }}
          />
        </Suspense>
      </>
    );
  }

  return (
    <>
      {dragRegion}
      {children}
    </>
  );
}
