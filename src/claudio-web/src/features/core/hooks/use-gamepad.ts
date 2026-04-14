import { useEffect, useRef } from "react";

const STICK_THRESHOLD = 0.5;
const REPEAT_DELAY = 300;
const REPEAT_INTERVAL_START = 190;
const REPEAT_INTERVAL_MIN = 70;
const REPEAT_ACCEL = 0.83; // multiply interval by this each repeat

export const GAMEPAD_NAV_UP_EVENT = "gamepad-nav-up";
export const GAMEPAD_NAV_DOWN_EVENT = "gamepad-nav-down";
export const GAMEPAD_NAV_LEFT_EVENT = "gamepad-nav-left";
export const GAMEPAD_NAV_RIGHT_EVENT = "gamepad-nav-right";

interface InputState {
  pressed: boolean;
  time: number;
  repeatCount: number;
}

export function useGamepad() {
  const stateReference = useRef<Record<string, InputState>>({});

  useEffect(() => {
    let rafId: number;

    function dispatchDirectionalKey(key: string) {
      if (document.body.dataset.emulatorActive) {
        return;
      }

      if (document.activeElement instanceof HTMLIFrameElement) {
        return;
      }

      const eventName =
        key === "ArrowUp"
          ? GAMEPAD_NAV_UP_EVENT
          : key === "ArrowDown"
            ? GAMEPAD_NAV_DOWN_EVENT
            : key === "ArrowLeft"
              ? GAMEPAD_NAV_LEFT_EVENT
              : GAMEPAD_NAV_RIGHT_EVENT;

      globalThis.dispatchEvent(new CustomEvent(eventName));
    }

    function dispatchKey(key: string) {
      // Custom gamepad actions fire as window events
      if (key.startsWith("gamepad-")) {
        if (document.body.dataset.emulatorActive && key !== "gamepad-search") {
          return;
        }
        globalThis.dispatchEvent(new CustomEvent(key));
        return;
      }

      if (key === "ArrowUp" || key === "ArrowDown" || key === "ArrowLeft" || key === "ArrowRight") {
        dispatchDirectionalKey(key);
        return;
      }

      // When the emulator is active, let the iframe handle all input natively.
      if (document.body.dataset.emulatorActive) {
        return;
      }

      // When focus is inside an iframe, let that embedded app handle gamepad input.
      if (document.activeElement instanceof HTMLIFrameElement) {
        return;
      }

      const eventInit: KeyboardEventInit = {
        key,
        bubbles: true,
        cancelable: true,
      };

      // Dispatch on active element (for React onKeyDown handlers)
      const target = document.activeElement ?? document.body;
      target.dispatchEvent(new KeyboardEvent("keydown", eventInit));

      // Also dispatch on window (for window.addEventListener listeners)
      globalThis.dispatchEvent(new KeyboardEvent("keydown", eventInit));

      // For Enter, also click the focused element
      if (key === "Enter" && document.activeElement instanceof HTMLElement) {
        document.activeElement.click();
      }
    }

    function handleInput(id: string, key: string, pressed: boolean, repeatable = true) {
      const now = performance.now();
      const previous = stateReference.current[id];

      if (!pressed) {
        stateReference.current[id] = { pressed: false, time: 0, repeatCount: 0 };
        return;
      }

      if (!previous?.pressed) {
        stateReference.current[id] = { pressed: true, time: now, repeatCount: 0 };
        dispatchKey(key);
      } else if (repeatable) {
        const interval =
          previous.repeatCount === 0
            ? REPEAT_DELAY
            : Math.max(
                REPEAT_INTERVAL_MIN,
                REPEAT_INTERVAL_START * REPEAT_ACCEL ** previous.repeatCount,
              );
        if (now - previous.time > interval) {
          stateReference.current[id] = {
            pressed: true,
            time: now,
            repeatCount: previous.repeatCount + 1,
          };
          dispatchKey(key);
        }
      }
    }

    function poll() {
      const gamepads = navigator.getGamepads();

      for (const gp of gamepads) {
        if (!gp) continue;

        // D-pad
        handleInput("dpad-up", "ArrowUp", gp.buttons[12]?.pressed ?? false);
        handleInput("dpad-down", "ArrowDown", gp.buttons[13]?.pressed ?? false);
        handleInput("dpad-left", "ArrowLeft", gp.buttons[14]?.pressed ?? false);
        handleInput("dpad-right", "ArrowRight", gp.buttons[15]?.pressed ?? false);

        // Left stick
        const lx = gp.axes[0] ?? 0;
        const ly = gp.axes[1] ?? 0;

        handleInput("stick-left", "ArrowLeft", lx < -STICK_THRESHOLD);
        handleInput("stick-right", "ArrowRight", lx > STICK_THRESHOLD);
        handleInput("stick-up", "ArrowUp", ly < -STICK_THRESHOLD);
        handleInput("stick-down", "ArrowDown", ly > STICK_THRESHOLD);

        // A → Enter/click, B → Escape, Y → toggle search (no repeat)
        handleInput("btn-a", "Enter", gp.buttons[0]?.pressed ?? false, false);
        handleInput("btn-b", "Escape", gp.buttons[1]?.pressed ?? false, false);
        handleInput("btn-y", "gamepad-search", gp.buttons[3]?.pressed ?? false, false);

        // LB/RB → bumpers
        handleInput("btn-lb", "gamepad-lb", gp.buttons[4]?.pressed ?? false, false);
        handleInput("btn-rb", "gamepad-rb", gp.buttons[5]?.pressed ?? false, false);

        // LT/RT → previous/next group
        handleInput("btn-lt", "gamepad-lt", (gp.buttons[6]?.value ?? 0) > 0.5);
        handleInput("btn-rt", "gamepad-rt", (gp.buttons[7]?.value ?? 0) > 0.5);

        // Start / Options / Menu button (button 9)
        handleInput("btn-start", "gamepad-start", gp.buttons[9]?.pressed ?? false, false);

        handleInput("btn-guide", "gamepad-search", gp.buttons[16]?.pressed ?? false, false);

        // Only handle first connected gamepad
        break;
      }

      rafId = requestAnimationFrame(poll);
    }

    rafId = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(rafId);
  }, []);
}
