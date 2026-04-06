// @vitest-environment happy-dom

import { act, useState } from "react";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { GAMEPAD_NAV_DOWN_EVENT, GAMEPAD_NAV_LEFT_EVENT } from "./use-gamepad";
import { useGamepadDirectionalKeyBridge } from "./use-gamepad-directional-key-bridge";
import { cleanupRenderedDom, renderInDom } from "../../../test-utils/render";

function BridgeHarness({ bridgeEnabled }: { bridgeEnabled: boolean }) {
  const [lastKey, setLastKey] = useState("");
  useGamepadDirectionalKeyBridge("menu", bridgeEnabled);

  return (
    <>
      <button data-testid="plain-target" type="button" onKeyDown={(event) => setLastKey(event.key)}>
        Plain
      </button>
      <button
        data-gamepad-nav-bridge="menu"
        data-testid="bridged-target"
        type="button"
        onKeyDown={(event) => setLastKey(event.key)}
      >
        Bridged
      </button>
      <output data-testid="last-key">{lastKey}</output>
    </>
  );
}

afterEach(() => {
  cleanupRenderedDom();
});

describe("useGamepadDirectionalKeyBridge", () => {
  it("forwards gamepad directional events only to marked widgets", () => {
    const view = renderInDom(<BridgeHarness bridgeEnabled />);
    const bridgedTarget = view.container.querySelector<HTMLButtonElement>(
      '[data-testid="bridged-target"]',
    );
    const output = view.container.querySelector<HTMLOutputElement>('[data-testid="last-key"]');

    expect(bridgedTarget).not.toBeNull();
    expect(output).not.toBeNull();

    act(() => {
      bridgedTarget?.focus();
      globalThis.dispatchEvent(new CustomEvent(GAMEPAD_NAV_DOWN_EVENT));
    });

    expect(output?.textContent).toBe("ArrowDown");
    view.unmount();
  });

  it("does not synthesize directional key events for unmarked elements", () => {
    const view = renderInDom(<BridgeHarness bridgeEnabled />);
    const plainTarget = view.container.querySelector<HTMLButtonElement>(
      '[data-testid="plain-target"]',
    );
    const output = view.container.querySelector<HTMLOutputElement>('[data-testid="last-key"]');

    expect(plainTarget).not.toBeNull();
    expect(output).not.toBeNull();

    act(() => {
      plainTarget?.focus();
      globalThis.dispatchEvent(new CustomEvent(GAMEPAD_NAV_LEFT_EVENT));
    });

    expect(output?.textContent).toBe("");
    view.unmount();
  });

  it("stops forwarding events when the bridge is disabled", () => {
    const view = renderInDom(<BridgeHarness bridgeEnabled={false} />);
    const bridgedTarget = view.container.querySelector<HTMLButtonElement>(
      '[data-testid="bridged-target"]',
    );
    const output = view.container.querySelector<HTMLOutputElement>('[data-testid="last-key"]');

    expect(bridgedTarget).not.toBeNull();
    expect(output).not.toBeNull();

    act(() => {
      bridgedTarget?.focus();
      globalThis.dispatchEvent(new CustomEvent(GAMEPAD_NAV_DOWN_EVENT));
    });

    expect(output?.textContent).toBe("");
    view.unmount();
  });
});
