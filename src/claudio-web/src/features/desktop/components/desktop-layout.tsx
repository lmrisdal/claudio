import Header from "../../core/components/header";
import { isDesktop } from "../hooks/use-desktop";
import DesktopLayoutInner from "./desktop-layout-inner";

export default function DesktopLayout({ children }: { children: React.ReactNode }) {
  if (!isDesktop) {
    return (
      <>
        <Header />
        <div className="flex-1 flex flex-col min-h-0 pt-14">{children}</div>
      </>
    );
  }

  return <DesktopLayoutInner>{children}</DesktopLayoutInner>;
}
