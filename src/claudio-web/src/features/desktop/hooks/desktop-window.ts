import { getBridge } from "./desktop-bridge";

export function minimizeWindow(): Promise<void> {
  return getBridge().window.minimize();
}

export function toggleMaximizeWindow(): Promise<void> {
  return getBridge().window.toggleMaximize();
}

export function closeWindow(): Promise<void> {
  return getBridge().window.close();
}
