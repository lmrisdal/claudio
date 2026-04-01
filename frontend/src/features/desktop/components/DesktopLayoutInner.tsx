import { useEffect, useState } from "react";
import Header from "../../core/components/Header";
import DesktopSidebar, {
  COLLAPSED_KEY,
  COLLAPSED_WIDTH,
  DEFAULT_WIDTH,
  HEADER_HEIGHT,
  WIDTH_KEY,
} from "./DesktopSidebar";

export default function DesktopLayoutInner({
  children,
}: {
  children: React.ReactNode;
}) {
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
        style={{
          marginLeft,
          marginTop: HEADER_HEIGHT,
          height: `calc(100dvh - ${HEADER_HEIGHT}px)`,
        }}
        className={`flex flex-col min-h-0 overflow-y-auto overflow-x-hidden ${animateMargin ? "transition-[margin-left] duration-200 ease-in-out" : ""}`}
      >
        {children}
      </div>
    </>
  );
}
