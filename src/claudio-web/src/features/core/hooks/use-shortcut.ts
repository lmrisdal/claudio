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
  const handlerReference = useRef(handler);
  useEffect(() => {
    handlerReference.current = handler;
  });

  useEffect(() => {
    if (!enabled) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented) {
        return;
      }

      if (matchKey(key, e)) {
        handlerReference.current(e);
      }
    }

    globalThis.addEventListener("keydown", onKeyDown, capture);
    return () => globalThis.removeEventListener("keydown", onKeyDown, capture);
  }, [key, enabled, capture]);
}

export function useKeydown(
  handler: (e: KeyboardEvent) => void,
  options: { enabled?: boolean; capture?: boolean } = {},
) {
  const { enabled = true, capture = false } = options;
  const handlerReference = useRef(handler);
  useEffect(() => {
    handlerReference.current = handler;
  });

  useEffect(() => {
    if (!enabled) return;

    function onKeyDown(e: KeyboardEvent) {
      handlerReference.current(e);
    }

    globalThis.addEventListener("keydown", onKeyDown, capture);
    return () => globalThis.removeEventListener("keydown", onKeyDown, capture);
  }, [enabled, capture]);
}

/**
 * Register a custom gamepad event listener on the window.
 */
export function useGamepadEvent(event: string, handler: () => void, enabled = true) {
  const handlerReference = useRef(handler);
  useEffect(() => {
    handlerReference.current = handler;
  });

  useEffect(() => {
    if (!enabled) return;

    function onEvent() {
      handlerReference.current();
    }
    globalThis.addEventListener(event, onEvent);
    return () => globalThis.removeEventListener(event, onEvent);
  }, [event, enabled]);
}

export function matchKey(pattern: string, e: KeyboardEvent): boolean {
  const parts = pattern.toLowerCase().split("+");
  const targetKey = parts.pop()!;

  if (e.key.toLowerCase() !== targetKey) return false;

  const wantModule = parts.includes("mod");
  const wantCtrl = parts.includes("ctrl");
  const wantShift = parts.includes("shift");
  const wantAlt = parts.includes("alt");

  if (wantModule && !(e.metaKey || e.ctrlKey)) return false;
  if (wantCtrl && !e.ctrlKey) return false;
  if (wantShift && !e.shiftKey) return false;
  if (wantAlt && !e.altKey) return false;

  return true;
}
