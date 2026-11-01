import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { resolvePaths } from "../src/main/paths";

const base = {
  isPackaged: false,
  resourcesPath: "/opt/Claudio/resources",
  appPath: "/repo/src/claudio-electron",
  env: {},
  platform: "linux" as NodeJS.Platform,
};

describe("resolvePaths", () => {
  it("finds the cargo build and web dist relative to the repo in development", () => {
    const paths = resolvePaths(base);

    expect(paths.coreBinary).toBe("/repo/target/debug/claudio-core");
    expect(paths.resourceDir).toBe("/repo/target/debug");
    expect(paths.webRoot).toBe("/repo/src/claudio-web/dist");
    expect(paths.preload).toBe(path.join(base.appPath, "dist", "preload", "index.cjs"));
    expect(paths.trayIcon).toBe("/repo/src/claudio-electron/resources/tray-icon.png");
  });

  it("uses the release profile and .exe suffix when asked", () => {
    const paths = resolvePaths({
      ...base,
      platform: "win32",
      env: { CLAUDIO_CORE_PROFILE: "release" },
    });

    expect(paths.coreBinary).toBe(path.join("/repo", "target", "release", "claudio-core.exe"));
  });

  it("reads everything from the resources directory when packaged", () => {
    const paths = resolvePaths({
      ...base,
      isPackaged: true,
      appPath: "/opt/Claudio/resources/app.asar",
    });

    expect(paths.coreBinary).toBe("/opt/Claudio/resources/claudio-core");
    expect(paths.resourceDir).toBe("/opt/Claudio/resources");
    expect(paths.webRoot).toBe("/opt/Claudio/resources/web");
    expect(paths.windowIcon).toBe("/opt/Claudio/resources/icon.png");
    expect(paths.preload).toBe("/opt/Claudio/resources/app.asar/dist/preload/index.cjs");
  });

  it("lets environment variables override each location", () => {
    const paths = resolvePaths({
      ...base,
      env: {
        CLAUDIO_CORE_PATH: "/x/core",
        CLAUDIO_RESOURCE_DIR: "/x/res",
        CLAUDIO_WEB_DIST: "/x/web",
      },
    });

    expect(paths).toMatchObject({
      coreBinary: "/x/core",
      resourceDir: "/x/res",
      webRoot: "/x/web",
    });
  });
});
