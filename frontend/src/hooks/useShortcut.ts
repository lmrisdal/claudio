import { useEffect, useRef } from "react";

/**
 * Register a keyboard shortcut on the window.
 *
 * Key patterns:
 * - Simple key: "Escape", "Enter", "ArrowDown"
 * - With modifier: "mod+k" (Cmd on Mac, Ctrl elsewhere)
 */
export function useShortcut(
  key: string,
  handler: (e: KeyboardEvent) => void,
  options: { enabled?: boolean; capture?: boolean } = {},
) {
  const { enabled = true, capture = false } = options;
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    if (!enabled) return;

    function onKeyDown(e: KeyboardEvent) {
      if (matchKey(key, e)) {
        handlerRef.current(e);
      }
    }

    window.addEventListener("keydown", onKeyDown, capture);
    return () => window.removeEventListener("keydown", onKeyDown, capture);
  }, [key, enabled, capture]);
}

/**
 * Register a custom gamepad event listener on the window.
 */
export function useGamepadEvent(
  event: string,
  handler: () => void,
  enabled = true,
) {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    if (!enabled) return;

    function onEvent() {
      handlerRef.current();
    }
    window.addEventListener(event, onEvent);
    return () => window.removeEventListener(event, onEvent);
  }, [event, enabled]);
}

export function matchKey(pattern: string, e: KeyboardEvent): boolean {
  const parts = pattern.toLowerCase().split("+");
  const targetKey = parts.pop()!;

  if (e.key.toLowerCase() !== targetKey) return false;

  const wantMod = parts.includes("mod");
  const wantCtrl = parts.includes("ctrl");
  const wantShift = parts.includes("shift");
  const wantAlt = parts.includes("alt");

  if (wantMod && !(e.metaKey || e.ctrlKey)) return false;
  if (wantCtrl && !e.ctrlKey) return false;
  if (wantShift && !e.shiftKey) return false;
  if (wantAlt && !e.altKey) return false;

  return true;
}
