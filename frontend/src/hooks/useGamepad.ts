import { useEffect, useRef } from "react";

const STICK_THRESHOLD = 0.5;
const REPEAT_DELAY = 300;
const REPEAT_INTERVAL_START = 190;
const REPEAT_INTERVAL_MIN = 70;
const REPEAT_ACCEL = 0.83; // multiply interval by this each repeat

interface InputState {
  pressed: boolean;
  time: number;
  repeatCount: number;
}

// Set on gamepad-dispatched events so other handlers can skip their own throttle
export let isGamepadEvent = false;

export function useGamepad() {
  const stateRef = useRef<Record<string, InputState>>({});

  useEffect(() => {
    let rafId: number;

    function dispatchKey(key: string) {
      // Custom gamepad actions
      if (key.startsWith("gamepad-")) {
        window.dispatchEvent(new CustomEvent(key));
        return;
      }

      const eventInit: KeyboardEventInit = {
        key,
        bubbles: true,
        cancelable: true,
      };

      // Flag so Library handler skips its own throttle
      isGamepadEvent = true;

      // Dispatch on active element (for React onKeyDown handlers)
      const target = document.activeElement ?? document.body;
      target.dispatchEvent(new KeyboardEvent("keydown", eventInit));

      // Also dispatch on window (for window.addEventListener listeners)
      window.dispatchEvent(new KeyboardEvent("keydown", eventInit));

      // For Enter, also click the focused element
      if (key === "Enter" && document.activeElement instanceof HTMLElement) {
        document.activeElement.click();
      }

      isGamepadEvent = false;
    }

    function handleInput(id: string, key: string, pressed: boolean, repeatable = true) {
      const now = performance.now();
      const prev = stateRef.current[id];

      if (!pressed) {
        stateRef.current[id] = { pressed: false, time: 0, repeatCount: 0 };
        return;
      }

      if (!prev?.pressed) {
        stateRef.current[id] = { pressed: true, time: now, repeatCount: 0 };
        dispatchKey(key);
      } else if (repeatable) {
        const interval =
          prev.repeatCount === 0
            ? REPEAT_DELAY
            : Math.max(
                REPEAT_INTERVAL_MIN,
                REPEAT_INTERVAL_START * REPEAT_ACCEL ** prev.repeatCount,
              );
        if (now - prev.time > interval) {
          stateRef.current[id] = {
            pressed: true,
            time: now,
            repeatCount: prev.repeatCount + 1,
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
        handleInput(
          "dpad-right",
          "ArrowRight",
          gp.buttons[15]?.pressed ?? false,
        );

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

        // LT/RT → previous/next group
        handleInput("btn-lt", "gamepad-lt", (gp.buttons[6]?.value ?? 0) > 0.5);
        handleInput("btn-rt", "gamepad-rt", (gp.buttons[7]?.value ?? 0) > 0.5);

        // Only handle first connected gamepad
        break;
      }

      rafId = requestAnimationFrame(poll);
    }

    rafId = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(rafId);
  }, []);
}
