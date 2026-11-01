import path from "node:path";

export interface PathInputs {
  isPackaged: boolean;
  resourcesPath: string;
  appPath: string;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
}

export interface AppPaths {
  coreBinary: string;
  resourceDir: string;
  webRoot: string;
  preload: string;
  windowIcon: string;
  trayIcons: { onDarkPanel: string; onLightPanel: string };
}

export function resolvePaths(inputs: PathInputs): AppPaths {
  const { isPackaged, resourcesPath, appPath, env, platform } = inputs;
  const executable = platform === "win32" ? "claudio-core.exe" : "claudio-core";
  const repoRoot = path.resolve(appPath, "..", "..");
  const profile = env.CLAUDIO_CORE_PROFILE === "release" ? "release" : "debug";

  const coreBinary =
    env.CLAUDIO_CORE_PATH ??
    (isPackaged
      ? path.join(resourcesPath, executable)
      : path.join(repoRoot, "target", profile, executable));
  const resourceDir =
    env.CLAUDIO_RESOURCE_DIR ?? (isPackaged ? resourcesPath : path.dirname(coreBinary));
  const webRoot =
    env.CLAUDIO_WEB_DIST ??
    (isPackaged
      ? path.join(resourcesPath, "web")
      : path.join(repoRoot, "src", "claudio-web", "dist"));
  const assets = isPackaged ? resourcesPath : path.join(appPath, "resources");

  return {
    coreBinary,
    resourceDir,
    webRoot,
    preload: path.join(appPath, "dist", "preload", "index.cjs"),
    windowIcon: path.join(assets, "icon.png"),
    trayIcons: {
      onDarkPanel: path.join(assets, "tray-icon-white.png"),
      onLightPanel: path.join(assets, "tray-icon-black.png"),
    },
  };
}
