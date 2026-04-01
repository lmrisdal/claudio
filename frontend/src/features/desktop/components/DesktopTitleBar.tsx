import { isMac } from "../../core/utils/os";
import { isDesktop } from "../hooks/useDesktop";

export default function DesktopTitleBar() {
  if (!isDesktop || !isMac) return null;
  return null;
}
