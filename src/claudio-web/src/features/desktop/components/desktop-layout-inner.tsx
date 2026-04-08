import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Header from "../../core/components/header";
import { sounds } from "../../core/utils/sounds";
import {
  DesktopShellNavigationContext,
  type DesktopShellNavigationContextValue,
} from "../hooks/use-desktop-shell-navigation";
import DesktopSidebar, {
  COLLAPSED_KEY,
  COLLAPSED_WIDTH,
  DEFAULT_WIDTH,
  HEADER_HEIGHT,
  WIDTH_KEY,
} from "./desktop-sidebar";

function isVisibleFocusableElement(element: HTMLElement) {
  if (element.hasAttribute("disabled")) {
    return false;
  }

  if (element.getAttribute("aria-hidden") === "true") {
    return false;
  }

  return element.getClientRects().length > 0;
}

export default function DesktopLayoutInner({ children }: { children: React.ReactNode }) {
  const [marginLeft, setMarginLeft] = useState(() => {
    const collapsed = localStorage.getItem(COLLAPSED_KEY) === "true";
    if (collapsed) return COLLAPSED_WIDTH;
    const saved = localStorage.getItem(WIDTH_KEY);
    return saved ? Number(saved) : DEFAULT_WIDTH;
  });
  const [animateMargin, setAnimateMargin] = useState(true);
  const sidebarReference = useRef<HTMLElement>(null);
  const contentReference = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onSidebarChanged(e: Event) {
      const dragging = (e as CustomEvent).detail?.dragging ?? false;
      setAnimateMargin(!dragging);
      const collapsed = localStorage.getItem(COLLAPSED_KEY) === "true";
      if (collapsed) {
        setMarginLeft(COLLAPSED_WIDTH);
      } else {
        const saved = localStorage.getItem(WIDTH_KEY);
        setMarginLeft(saved ? Number(saved) : DEFAULT_WIDTH);
      }
    }
    globalThis.addEventListener("sidebar-collapse-changed", onSidebarChanged);
    return () => globalThis.removeEventListener("sidebar-collapse-changed", onSidebarChanged);
  }, []);

  const focusSidebar = useCallback(() => {
    const sidebar = sidebarReference.current;
    if (!sidebar) {
      return false;
    }

    const items = [...sidebar.querySelectorAll<HTMLElement>("[data-desktop-sidebar-nav]")].filter(
      (element) => isVisibleFocusableElement(element),
    );
    if (items.length === 0) {
      return false;
    }

    const target =
      items.find((item) => item.dataset.desktopSidebarActive === "true") ??
      items.find((item) => item === document.activeElement) ??
      items[0];

    target.focus({ focusVisible: true } as FocusOptions);
    void sounds.navigate();
    return true;
  }, []);

  const focusPage = useCallback(() => {
    const content = contentReference.current;
    if (!content) {
      return false;
    }

    const items = [
      ...content.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ].filter(
      (element) =>
        !Object.hasOwn(element.dataset, "desktopSidebarNav") && isVisibleFocusableElement(element),
    );
    if (items.length === 0) {
      return false;
    }

    items[0].focus({ focusVisible: true } as FocusOptions);
    void sounds.navigate();
    return true;
  }, []);

  const navigationValue = useMemo<DesktopShellNavigationContextValue>(
    () => ({ focusPage, focusSidebar }),
    [focusPage, focusSidebar],
  );

  return (
    <DesktopShellNavigationContext.Provider value={navigationValue}>
      <DesktopSidebar navigationReference={sidebarReference} />
      <Header />
      <div
        ref={contentReference}
        style={{
          marginLeft,
          marginTop: HEADER_HEIGHT,
          height: `calc(100dvh - ${HEADER_HEIGHT}px)`,
        }}
        className={`app-desktop-panel flex flex-col min-h-0 overflow-y-auto overflow-x-hidden ${animateMargin ? "transition-[margin-left] duration-200 ease-in-out" : ""}`}
      >
        {children}
      </div>
    </DesktopShellNavigationContext.Provider>
  );
}
