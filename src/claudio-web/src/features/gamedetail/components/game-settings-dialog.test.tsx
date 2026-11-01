// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanupRenderedDom, renderInDom } from "../../../test-utils/render";
import { InputScopeProvider } from "../../core/hooks/use-input-scope";
import { updateGameLaunchSettings, type InstalledGame } from "../../desktop/hooks/use-desktop";
import GameSettingsDialog from "./game-settings-dialog";

vi.mock("../../desktop/hooks/use-desktop", () => ({
  listGameExecutables: vi.fn().mockResolvedValue(["game.exe"]),
  listProtonVersions: vi.fn().mockResolvedValue([{ label: "GE Proton", value: "/proton/ge" }]),
  updateGameLaunchSettings: vi.fn(),
}));
vi.mock("../../core/utils/os", () => ({ isLinux: true, isWindows: false }));

const game: InstalledGame = {
  remoteGameId: 1,
  title: "Test Game",
  platform: "windows",
  installType: "portable",
  installPath: "/games/test",
  gameExe: "/games/test/game.exe",
  winePrefix: "/prefix",
  protonPath: "/proton/ge",
  installedAt: "1",
  launchOptions: { parameters: "-fullscreen", runAsAdministrator: false, umuGameId: "umu-123" },
};

beforeEach(() => vi.clearAllMocks());
afterEach(cleanupRenderedDom);

function renderDialog(onClose = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = renderInDom(
    <QueryClientProvider client={client}>
      <InputScopeProvider>
        <GameSettingsDialog game={game} onClose={onClose} />
      </InputScopeProvider>
    </QueryClientProvider>,
  );
  return { ...view, client, onClose };
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

function button(text: string) {
  return [...document.querySelectorAll("button")].find((button) => button.textContent === text)!;
}

describe("GameSettingsDialog", () => {
  it("shows saved launch options and Linux runtime controls without Store", async () => {
    const view = renderDialog();
    await settle();
    expect(
      document.querySelector<HTMLInputElement>('[aria-label="Launch parameters"]')?.value,
    ).toBe("-fullscreen");
    expect(document.querySelector<HTMLInputElement>('[aria-label="Game ID"]')?.value).toBe(
      "umu-123",
    );
    expect(document.body.textContent).toContain("Linux · Wine/Proton");
    expect(document.body.textContent).not.toContain("Store");
    expect(document.querySelector('[aria-label="Run as administrator"]')).toBeNull();
    expect(document.body.textContent).not.toContain("Run as administrator");
    view.unmount();
  });

  it("saves settings and updates the installed game cache", async () => {
    vi.mocked(updateGameLaunchSettings).mockResolvedValue(game);
    const view = renderDialog();
    await settle();
    await act(async () => {
      const input = document.querySelector<HTMLInputElement>('[aria-label="Launch parameters"]')!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        input,
        '-windowed "Player Two"',
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => button("Save changes").click());
    await settle();
    expect(updateGameLaunchSettings).toHaveBeenCalledWith(1, game.gameExe, game.protonPath, {
      ...game.launchOptions,
      parameters: '-windowed "Player Two"',
    });
    expect(view.client.getQueryData(["installedGame", "1"])).toEqual(game);
    expect(view.onClose).toHaveBeenCalledOnce();
    view.unmount();
  });

  it("cancel closes without saving", async () => {
    const view = renderDialog();
    await settle();
    await act(async () => button("Cancel").click());
    expect(updateGameLaunchSettings).not.toHaveBeenCalled();
    expect(view.onClose).toHaveBeenCalledOnce();
    view.unmount();
  });

  it("keeps the dialog open and displays sidecar validation errors", async () => {
    vi.mocked(updateGameLaunchSettings).mockRejectedValue("Selected executable no longer exists.");
    const view = renderDialog();
    await settle();
    await act(async () => button("Save changes").click());
    await settle();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Selected executable no longer exists.",
    );
    expect(view.onClose).not.toHaveBeenCalled();
    view.unmount();
  });
});
