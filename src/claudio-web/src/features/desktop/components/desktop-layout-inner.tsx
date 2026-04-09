import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import SearchDialog from "../../core/components/search-dialog";
import { useNavigation } from "../../core/hooks/use-navigation";
import { isMac } from "../../core/utils/os";
import { sounds } from "../../core/utils/sounds";
import {
  DesktopShellNavigationContext,
  type DesktopShellNavigationContextValue,
} from "../hooks/use-desktop-shell-navigation";
import DesktopSidebar, {
  COLLAPSED_KEY,
  COLLAPSED_WIDTH,
  DEFAULT_WIDTH,
  WIDTH_KEY,
} from "./desktop-sidebar";
import DesktopWindowControls from "./desktop-window-controls";

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
  const { searchOpen, closeSearch } = useNavigation();
  const navigate = useNavigate();

  useEffect(() => {
    const unlisten = listen<string>("navigate", (event) => {
      void navigate(event.payload);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [navigate]);
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
      <DesktopWindowControls />
      <div
        data-tauri-drag-region
        className="fixed top-0 z-45"
        style={{
          left: isMac ? 220 : 140,
          right: 0,
          height: 30,
        }}
      />
      <div
        ref={contentReference}
        style={{
          marginLeft,
          height: "100dvh",
        }}
        className={`app-desktop-panel flex flex-col min-h-0 overflow-hidden ${animateMargin ? "transition-[margin-left] duration-200 ease-in-out" : ""}`}
      >
        {children}
      </div>
      <SearchDialog open={searchOpen} onClose={closeSearch} />
    </DesktopShellNavigationContext.Provider>
  );
}
