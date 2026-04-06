// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vite-plus/test";
import { InputScopeProvider, useInputScope, useInputScopeState } from "./use-input-scope";
import { cleanupRenderedDom, renderInDom } from "../../../test-utils/render";

function ScopeStateHarness({
  settingsOpen,
  guideOpen,
  recordingOpen,
}: {
  settingsOpen: boolean;
  guideOpen: boolean;
  recordingOpen: boolean;
}) {
  useInputScope({ id: "page", kind: "page" });
  useInputScope({
    id: "settings-dialog",
    kind: "dialog",
    blocks: ["guide", "page-nav", "search"],
    enabled: settingsOpen,
  });
  useInputScope({
    id: "guide-overlay",
    kind: "overlay",
    blocks: ["page-nav", "search"],
    enabled: guideOpen,
  });
  useInputScope({
    id: "settings-shortcut-recording",
    kind: "recording",
    blocks: ["guide", "page-nav", "search"],
    enabled: recordingOpen,
  });

  const { isActionBlocked, topScope } = useInputScopeState();

  return (
    <div
      data-guide-blocked={String(isActionBlocked("guide"))}
      data-page-blocked={String(isActionBlocked("page-nav"))}
      data-top-scope={topScope?.id ?? ""}
    />
  );
}

function renderHarness(settingsOpen: boolean, guideOpen: boolean) {
  return renderInDom(
    <InputScopeProvider>
      <ScopeStateHarness settingsOpen={settingsOpen} guideOpen={guideOpen} recordingOpen={false} />
    </InputScopeProvider>,
  );
}

function getState(view: ReturnType<typeof renderHarness>) {
  const state = view.container.firstElementChild;
  expect(state).toBeInstanceOf(HTMLDivElement);
  return state as HTMLDivElement;
}

afterEach(() => {
  cleanupRenderedDom();
});

describe("InputScopeProvider", () => {
  it("blocks the guide action while settings is open", () => {
    const view = renderHarness(true, false);
    const state = getState(view);

    expect(state.dataset.guideBlocked).toBe("true");
    expect(state.dataset.topScope).toBe("settings-dialog");
    view.unmount();
  });

  it("lets the guide overlay outrank page scopes while still blocking page navigation", () => {
    const view = renderHarness(false, true);
    const state = getState(view);

    expect(state.dataset.guideBlocked).toBe("false");
    expect(state.dataset.pageBlocked).toBe("true");
    expect(state.dataset.topScope).toBe("guide-overlay");
    view.unmount();
  });

  it("returns control to the page once higher-priority scopes close", () => {
    const view = renderHarness(true, false);

    view.rerender(
      <InputScopeProvider>
        <ScopeStateHarness settingsOpen={false} guideOpen={false} recordingOpen={false} />
      </InputScopeProvider>,
    );

    const state = getState(view);
    expect(state.dataset.guideBlocked).toBe("false");
    expect(state.dataset.pageBlocked).toBe("false");
    expect(state.dataset.topScope).toBe("page");
    view.unmount();
  });

  it("lets recording scopes override lower-priority settings and page scopes", () => {
    const view = renderInDom(
      <InputScopeProvider>
        <ScopeStateHarness settingsOpen guideOpen={false} recordingOpen />
      </InputScopeProvider>,
    );

    const state = getState(view);
    expect(state.dataset.guideBlocked).toBe("true");
    expect(state.dataset.pageBlocked).toBe("true");
    expect(state.dataset.topScope).toBe("settings-shortcut-recording");
    view.unmount();
  });
});
