import { Suspense, useEffect, useState } from "react";
import { getSettings, isDesktop } from "../hooks/use-desktop";
import DesktopSetup from "../pages/desktop-setup";

export function DesktopGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<"loading" | "setup" | "ready">(
    isDesktop ? "loading" : "ready",
  );
  useEffect(() => {
    if (!isDesktop) return;
    let cancelled = false;

    getSettings()
      .then((settings) => {
        if (cancelled) return;
        if (settings.serverUrl) {
          localStorage.setItem("claudio_server_url", settings.serverUrl);
          if (settings.customHeaders && Object.keys(settings.customHeaders).length > 0) {
            localStorage.setItem("claudio_custom_headers", JSON.stringify(settings.customHeaders));
          }
          setState("ready");
        } else {
          setState("setup");
        }
      })
      .catch(() => {
        if (!cancelled) setState("setup");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (state === "loading") return null;

  if (state === "setup") {
    return (
      <>
        <Suspense>
          <DesktopSetup
            onConnected={(serverUrl) => {
              localStorage.setItem("claudio_server_url", serverUrl);
              setState("ready");
            }}
          />
        </Suspense>
      </>
    );
  }

  return <>{children}</>;
}
