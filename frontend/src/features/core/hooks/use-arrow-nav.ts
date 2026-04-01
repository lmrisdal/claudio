import { useCallback, type RefObject } from "react";
import { sounds } from "../utils/sounds";

/**
 * Returns an onKeyDown handler for arrow-key navigation among [data-nav] elements
 * within a container. Used by GameDetail and GameEmulator for linear nav.
 */
export function useArrowNav(
  containerReference: RefObject<HTMLElement | null>,
  options: { enabled?: boolean } = {},
) {
  const { enabled = true } = options;

  return useCallback(
    (e: React.KeyboardEvent) => {
      if (!enabled) return;
      if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key))
        return;

      const container = containerReference.current;
      if (!container) return;

      const items = [...container.querySelectorAll<HTMLElement>("[data-nav]")].filter(
        (element) =>
          !element.hasAttribute("disabled") &&
          element.getAttribute("aria-hidden") !== "true" &&
          element.offsetParent !== null,
      );
      if (items.length === 0) return;

      const currentIndex = items.indexOf(document.activeElement as HTMLElement);
      const isForward = e.key === "ArrowDown" || e.key === "ArrowRight";
      const nextIndex =
        currentIndex === -1
          ? (isForward
            ? 0
            : items.length - 1)
          : Math.max(
              0,
              Math.min(items.length - 1, currentIndex + (isForward ? 1 : -1)),
            );

      if (nextIndex !== currentIndex) {
        e.preventDefault();
        items[nextIndex].focus({ focusVisible: true } as FocusOptions);
        sounds.navigate();
      }
    },
    [containerReference, enabled],
  );
}
