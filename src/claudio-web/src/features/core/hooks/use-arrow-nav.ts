import { useCallback, type RefObject } from "react";
import {
  GAMEPAD_NAV_DOWN_EVENT,
  GAMEPAD_NAV_LEFT_EVENT,
  GAMEPAD_NAV_RIGHT_EVENT,
  GAMEPAD_NAV_UP_EVENT,
} from "./use-gamepad";
import { useInputScopeState } from "./use-input-scope";
import { useGamepadEvent } from "./use-shortcut";
import { isEditableTarget } from "../utils/dom";

/**
 * Returns an onKeyDown handler for arrow-key navigation among [data-nav] elements
 * within a container. Used by GameDetail and GameEmulator for linear nav.
 */
export function useArrowNav(
  containerReference: RefObject<HTMLElement | null>,
  options: { enabled?: boolean; onExitLeft?: () => boolean } = {},
) {
  const { enabled = true, onExitLeft } = options;
  const { isActionBlocked } = useInputScopeState();

  const moveFocus = useCallback(
    (key: string) => {
      if (!enabled) return false;
      if (isActionBlocked("page-nav")) return false;

      const container = containerReference.current;
      if (!container) return false;

      const target = document.activeElement;
      if (isEditableTarget(target)) return false;
      if (target instanceof Node && !container.contains(target)) return false;

      const items = [...container.querySelectorAll<HTMLElement>("[data-nav]")].filter(
        (element) =>
          !element.hasAttribute("disabled") &&
          element.getAttribute("aria-hidden") !== "true" &&
          element.offsetParent !== null,
      );
      if (items.length === 0) return false;

      const currentIndex = items.indexOf(document.activeElement as HTMLElement);
      const isForward = key === "ArrowDown" || key === "ArrowRight";
      const nextIndex =
        currentIndex === -1
          ? isForward
            ? 0
            : items.length - 1
          : Math.max(0, Math.min(items.length - 1, currentIndex + (isForward ? 1 : -1)));

      if (nextIndex !== currentIndex) {
        items[nextIndex].focus({ focusVisible: true } as FocusOptions);
        return true;
      }

      if (key === "ArrowLeft" && currentIndex === 0) {
        return onExitLeft?.() ?? false;
      }

      return false;
    },
    [containerReference, enabled, isActionBlocked, onExitLeft],
  );

  useGamepadEvent(GAMEPAD_NAV_UP_EVENT, () => moveFocus("ArrowUp"), enabled);
  useGamepadEvent(GAMEPAD_NAV_DOWN_EVENT, () => moveFocus("ArrowDown"), enabled);
  useGamepadEvent(GAMEPAD_NAV_LEFT_EVENT, () => moveFocus("ArrowLeft"), enabled);
  useGamepadEvent(GAMEPAD_NAV_RIGHT_EVENT, () => moveFocus("ArrowRight"), enabled);

  return useCallback(
    (e: React.KeyboardEvent) => {
      if (!enabled) return;
      if (e.defaultPrevented) return;
      if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
      if (moveFocus(e.key)) {
        e.preventDefault();
      }
    },
    [enabled, moveFocus],
  );
}
