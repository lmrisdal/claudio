import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { CoreHarness, coreAvailable } from "./support/core-harness";

const golden = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "golden");
let core: CoreHarness;

afterEach(() => core?.dispose());

describe.skipIf(!coreAvailable)("claudio-core data files", () => {
  it("writes settings.json exactly as the golden file", async () => {
    core = new CoreHarness();

    await core.call("update_settings", {
      settings: {
        serverUrl: "http://ü.example",
        logLevel: "debug",
        windowWidth: 1,
        windowHeight: 2,
        windowX: 3,
        customHeaders: { "X-A": "b" },
        downloadSpeedLimitKbs: 512.5,
      },
    });

    const written = readFileSync(path.join(core.dataDir, "settings.json"), "utf8");
    expect(written.replace(/\r\n/g, "\n").trimEnd()).toBe(
      readFileSync(path.join(golden, "settings.json"), "utf8").trimEnd(),
    );
  });

  it("loads the golden settings file back unchanged", async () => {
    core = new CoreHarness();
    core.writeData("settings.json", readFileSync(path.join(golden, "settings.json"), "utf8"));

    await expect(core.call("get_settings")).resolves.toMatchObject({
      serverUrl: "http://ü.example",
      logLevel: "debug",
      windowX: 3,
      downloadSpeedLimitKbs: 512.5,
    });
  });
});
