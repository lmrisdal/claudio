import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { resolvePaths } from "../src/main/paths";

const repoRoot = path.resolve("/repo");
const resourcesPath = path.resolve("/opt/Claudio/resources");

describe.each(["linux", "win32"] as const)("resolvePaths (%s)", (platform) => {
  const executable = platform === "win32" ? "claudio-core.exe" : "claudio-core";
  const base = {
    isPackaged: false,
    resourcesPath,
    appPath: path.join(repoRoot, "src", "claudio-desktop", "app"),
    env: {},
    platform,
  };

  it("finds the cargo build and web dist relative to the repo in development", () => {
    const paths = resolvePaths(base);

    expect(paths.coreBinary).toBe(path.join(repoRoot, "target", "debug", executable));
    expect(paths.resourceDir).toBe(path.join(repoRoot, "target", "debug"));
    expect(paths.webRoot).toBe(path.join(repoRoot, "src", "claudio-web", "dist"));
    expect(paths.preload).toBe(path.join(base.appPath, "dist", "preload", "index.cjs"));
    expect(paths.trayIcons).toEqual({
      onDarkPanel: path.join(base.appPath, "resources", "tray-icon-white.png"),
      onLightPanel: path.join(base.appPath, "resources", "tray-icon-black.png"),
    });
  });

  it("uses the release profile and platform-specific executable name", () => {
    const paths = resolvePaths({
      ...base,
      env: { CLAUDIO_CORE_PROFILE: "release" },
    });

    expect(paths.coreBinary).toBe(path.join(repoRoot, "target", "release", executable));
  });

  it("reads everything from the resources directory when packaged", () => {
    const appPath = path.join(resourcesPath, "app.asar");
    const paths = resolvePaths({ ...base, isPackaged: true, appPath });

    expect(paths.coreBinary).toBe(path.join(resourcesPath, executable));
    expect(paths.resourceDir).toBe(resourcesPath);
    expect(paths.webRoot).toBe(path.join(resourcesPath, "web"));
    expect(paths.windowIcon).toBe(path.join(resourcesPath, "icon.png"));
    expect(paths.preload).toBe(path.join(appPath, "dist", "preload", "index.cjs"));
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
