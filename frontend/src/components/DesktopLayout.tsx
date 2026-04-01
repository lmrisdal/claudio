import { useEffect, useState } from "react";
import { isDesktop } from "../hooks/useDesktop";
import DesktopSidebar, {
  COLLAPSED_KEY,
  COLLAPSED_WIDTH,
  DEFAULT_WIDTH,
  HEADER_HEIGHT,
  WIDTH_KEY,
} from "./DesktopSidebar";
import Header from "./Header";

export default function DesktopLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!isDesktop) {
    return (
      <>
        <Header />
        {children}
      </>
    );
  }

  return <DesktopLayoutInner>{children}</DesktopLayoutInner>;
}

function DesktopLayoutInner({ children }: { children: React.ReactNode }) {
  const [marginLeft, setMarginLeft] = useState(() => {
    const collapsed = localStorage.getItem(COLLAPSED_KEY) === "true";
    if (collapsed) return COLLAPSED_WIDTH;
    const saved = localStorage.getItem(WIDTH_KEY);
    return saved ? Number(saved) : DEFAULT_WIDTH;
  });
  const [animateMargin, setAnimateMargin] = useState(true);

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
    window.addEventListener("sidebar-collapse-changed", onSidebarChanged);
    return () =>
      window.removeEventListener("sidebar-collapse-changed", onSidebarChanged);
  }, []);

  return (
    <>
      <DesktopSidebar />
      <Header />
      <div
        style={{ marginLeft, paddingTop: HEADER_HEIGHT }}
        className={`flex-1 flex flex-col min-h-0 ${animateMargin ? "transition-[margin-left] duration-200 ease-in-out" : ""}`}
      >
        {children}
      </div>
    </>
  );
}
