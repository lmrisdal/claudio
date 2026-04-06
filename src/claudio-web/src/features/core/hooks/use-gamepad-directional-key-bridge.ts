import {
  GAMEPAD_NAV_DOWN_EVENT,
  GAMEPAD_NAV_LEFT_EVENT,
  GAMEPAD_NAV_RIGHT_EVENT,
  GAMEPAD_NAV_UP_EVENT,
} from "./use-gamepad";
import { useGamepadEvent } from "./use-shortcut";

function dispatchToActiveElement(key: string, bridgeId: string) {
  const target = document.activeElement;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  if (target.closest(`[data-gamepad-nav-bridge="${bridgeId}"]`) === null) {
    return;
  }

  target.dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
    }),
  );
}

export function useGamepadDirectionalKeyBridge(bridgeId: string, enabled = true) {
  useGamepadEvent(
    GAMEPAD_NAV_UP_EVENT,
    () => dispatchToActiveElement("ArrowUp", bridgeId),
    enabled,
  );
  useGamepadEvent(
    GAMEPAD_NAV_DOWN_EVENT,
    () => dispatchToActiveElement("ArrowDown", bridgeId),
    enabled,
  );
  useGamepadEvent(
    GAMEPAD_NAV_LEFT_EVENT,
    () => dispatchToActiveElement("ArrowLeft", bridgeId),
    enabled,
  );
  useGamepadEvent(
    GAMEPAD_NAV_RIGHT_EVENT,
    () => dispatchToActiveElement("ArrowRight", bridgeId),
    enabled,
  );
}
