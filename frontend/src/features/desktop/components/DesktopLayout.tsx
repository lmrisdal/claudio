import Header from "../../core/components/Header";
import { isDesktop } from "../hooks/useDesktop";
import DesktopLayoutInner from "./DesktopLayoutInner";

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
