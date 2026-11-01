import { Menu, app, dialog, net, protocol, session } from "electron";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { API_SCHEME, APP_SCHEME, CHANNELS } from "../shared/channels";
import { buildCoreEnv } from "./core/core-env";
import { CoreProcess } from "./core/core-process";
import { registerIpc } from "./ipc";
import { createExitController, shouldHideOnClose } from "./lifecycle";
import { createLogger } from "./logger";
import { resolvePaths } from "./paths";
import { restrictPermissions } from "./permissions";
import { createDisabledUpdateService } from "./updates/update-service";
import { createApiHandler, type ProxySettings } from "./protocol/api-proxy";
import { createAppHandler } from "./protocol/app-protocol";
import { createTray } from "./windows/tray";
import { createWindowManager } from "./windows/window-manager";

app.setName("Claudio");

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      allowServiceWorkers: true,
      corsEnabled: true,
      stream: true,
    },
  },
  {
    scheme: API_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

// Keeps Chromium's profile out of the folder the Rust core uses for its data.
const shellDataDir = path.join(app.getPath("appData"), "claudio-shell");
mkdirSync(shellDataDir, { recursive: true });
app.setPath("userData", shellDataDir);

if (!app.requestSingleInstanceLock()) {
  app.exit(0);
} else {
  void start();
}

async function start(): Promise<void> {
  await app.whenReady();
  const paths = resolvePaths({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
    env: process.env,
    platform: process.platform,
  });

  let core: CoreProcess | null = null;
  const logger = createLogger(() => core);
  let proxySettings: ProxySettings | null = null;
  let windows: ReturnType<typeof createWindowManager>;

  const exit = createExitController({
    platform: process.platform,
    hasActiveOperations: async () => (await core?.invoke("has_active_operations")) === true,
    confirmQuit: async () => {
      const { response } = await dialog.showMessageBox({
        type: "warning",
        title: "Quit Claudio?",
        message:
          "A download or installation is still in progress. Closing Claudio will stop it. Quit anyway?",
        buttons: ["Quit", "Keep Running"],
        defaultId: 1,
        cancelId: 1,
      });
      return response === 0;
    },
    quit: () => app.quit(),
  });

  core = new CoreProcess({
    command: paths.coreBinary,
    args: ["--resource-dir", paths.resourceDir],
    env: buildCoreEnv(process.env),
    onEvent: (event, payload) => windows.broadcast(CHANNELS.event, { event, payload }),
    onConfirm: async ({ title, message, okLabel, cancelLabel }) => {
      const { response } = await dialog.showMessageBox({
        type: "warning",
        title,
        message,
        buttons: [okLabel, cancelLabel],
        defaultId: 1,
        cancelId: 1,
      });
      return response === 0;
    },
    onStderr: (line) => {
      if (!line.startsWith("[")) logger.log("warn", `core: ${line}`);
    },
    onFatal: (message) => {
      logger.log("error", message);
      dialog.showErrorBox("Claudio stopped working", `${message}\nClaudio will now close.`);
      app.exit(1);
    },
  });
  core.start();

  async function refreshProxySettings(): Promise<void> {
    const settings = (await core?.invoke("get_settings").catch(() => null)) as {
      serverUrl: string | null;
      customHeaders: Record<string, string>;
    } | null;
    proxySettings = settings
      ? { serverUrl: settings.serverUrl, customHeaders: settings.customHeaders ?? {} }
      : null;
  }
  await refreshProxySettings();

  protocol.handle(APP_SCHEME, createAppHandler(paths.webRoot));
  protocol.handle(
    API_SCHEME,
    createApiHandler({
      getSettings: () => proxySettings,
      fetchImpl: (input, init) => net.fetch(input, { ...init, bypassCustomProtocolHandlers: true }),
      log: (level, message) => logger.log(level, message, "proxy"),
    }),
  );
  restrictPermissions(session.defaultSession);

  windows = createWindowManager({
    paths,
    windowStateFile: path.join(shellDataDir, "window-state.json"),
    isQuitting: exit.isQuitting,
    onMainCloseRequested: () => void handleMainClose(),
  });

  async function handleMainClose(): Promise<void> {
    const settings = (await core?.invoke("get_settings").catch(() => null)) as {
      closeToTray?: boolean;
    } | null;
    if (shouldHideOnClose({ closeToTray: settings?.closeToTray === true })) {
      windows.getMain()?.hide();
      return;
    }
    await exit.requestExit();
  }

  const checkForUpdates = () => {
    windows.restoreMain();
    windows.sendToMain(CHANNELS.event, { event: "check-for-updates", payload: null });
  };

  registerIpc({
    core,
    logger,
    updates: createDisabledUpdateService(),
    broadcast: (channel, payload) => windows.broadcast(channel, payload),
    onSettingsUpdated: () => void refreshProxySettings(),
    shell: {
      restart_app: () => {
        core?.dispose();
        const appImage = process.env.APPIMAGE;
        app.relaunch(appImage ? { execPath: appImage } : undefined);
        app.exit(0);
      },
      open_settings_window: () => windows.openSettings(),
    },
  });

  Menu.setApplicationMenu(null);
  createTray(paths.trayIcon, {
    show: () => windows.restoreMain(),
    checkForUpdates,
    quit: () => void exit.requestExit(),
  });
  windows.createMain();

  app.on("second-instance", () => windows.restoreMain());
  app.on("before-quit", (event) => {
    if (!exit.allowQuitNow()) event.preventDefault();
  });
  app.on("will-quit", () => core?.dispose());
  app.on("window-all-closed", () => undefined);
}
