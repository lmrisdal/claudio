import { describe, expect, it } from "vite-plus/test";
import { buildCoreEnv } from "../src/main/core/core-env";

describe("buildCoreEnv", () => {
  it("removes Electron and Chrome variables", () => {
    const env = buildCoreEnv({ ELECTRON_RUN_AS_NODE: "1", CHROME_DESKTOP: "x", HOME: "/home/a" });

    expect(env).toEqual({ HOME: "/home/a" });
  });

  it("keeps loader variables outside an AppImage", () => {
    const env = buildCoreEnv({ LD_LIBRARY_PATH: "/opt/lib", LD_PRELOAD: "/opt/p.so" });

    expect(env).toEqual({ LD_LIBRARY_PATH: "/opt/lib", LD_PRELOAD: "/opt/p.so" });
  });

  it("removes AppImage variables and loader overrides inside an AppImage", () => {
    const env = buildCoreEnv({
      APPIMAGE: "/a/Claudio.AppImage",
      APPDIR: "/tmp/.mount_x",
      ARGV0: "claudio",
      OWD: "/home/a",
      LD_LIBRARY_PATH: "/tmp/.mount_x/usr/lib",
      LD_PRELOAD: "/tmp/.mount_x/preload.so",
      HOME: "/home/a",
    });

    expect(env).toEqual({ HOME: "/home/a" });
  });

  it("drops mounted AppImage entries from PATH only", () => {
    const env = buildCoreEnv({
      APPIMAGE: "/a/Claudio.AppImage",
      APPDIR: "/tmp/.mount_x",
      PATH: "/tmp/.mount_x/usr/bin:/usr/bin:/bin",
    });

    expect(env.PATH).toBe("/usr/bin:/bin");
  });

  it("does not mutate the source environment", () => {
    const source = { ELECTRON_X: "1" };

    buildCoreEnv(source);

    expect(source).toEqual({ ELECTRON_X: "1" });
  });
});
