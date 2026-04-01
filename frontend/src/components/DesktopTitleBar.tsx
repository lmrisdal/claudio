import { isDesktop } from "../hooks/useDesktop";
import { isMac } from "../utils/os";

export default function DesktopTitleBar() {
  if (!isDesktop || !isMac) return null;
  return null;
}
