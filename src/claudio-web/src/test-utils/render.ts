import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

interface RenderResult {
  container: HTMLDivElement;
  rerender: (ui: ReactNode) => void;
  unmount: () => void;
}

export function renderInDom(ui: ReactNode): RenderResult {
  const container = document.createElement("div");
  document.body.append(container);

  const root = createRoot(container);

  act(() => {
    root.render(ui);
  });

  return {
    container,
    rerender(nextUi) {
      act(() => {
        root.render(nextUi);
      });
    },
    unmount() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

export function cleanupRenderedDom() {
  for (const child of document.body.children) {
    if (child instanceof HTMLDivElement) {
      child.remove();
    }
  }
}
