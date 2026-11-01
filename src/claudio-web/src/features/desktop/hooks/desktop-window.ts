import { getBridge, type WindowRole } from "./desktop-bridge";

export function getWindowRole(): WindowRole {
  try {
    return getBridge().window.role;
  } catch {
    return "main";
  }
}

export function minimizeWindow(): Promise<void> {
  return getBridge().window.minimize();
}

export function toggleMaximizeWindow(): Promise<void> {
  return getBridge().window.toggleMaximize();
}

export function closeWindow(): Promise<void> {
  return getBridge().window.close();
}
