export interface ExitDeps {
  platform: NodeJS.Platform;
  hasActiveOperations: () => Promise<boolean>;
  confirmQuit: () => Promise<boolean>;
  quit: () => void;
}

export interface ExitController {
  requestExit: () => Promise<boolean>;
  allowQuitNow: () => boolean;
  isQuitting: () => boolean;
}

export function createExitController(deps: ExitDeps): ExitController {
  let quitting = false;
  const confirmsActiveInstalls = deps.platform === "win32";

  async function requestExit(): Promise<boolean> {
    if (confirmsActiveInstalls) {
      const active = await deps.hasActiveOperations().catch(() => false);
      if (active && !(await deps.confirmQuit())) return false;
    }
    quitting = true;
    deps.quit();
    return true;
  }

  function allowQuitNow(): boolean {
    if (quitting) return true;
    if (!confirmsActiveInstalls) {
      quitting = true;
      return true;
    }
    void requestExit();
    return false;
  }

  return { requestExit, allowQuitNow, isQuitting: () => quitting };
}

export function shouldHideOnClose(settings: { closeToTray: boolean }): boolean {
  return settings.closeToTray;
}
