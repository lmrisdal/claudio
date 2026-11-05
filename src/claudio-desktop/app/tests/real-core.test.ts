import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { CoreProcess } from "../src/main/core/core-process";

const here = path.dirname(fileURLToPath(import.meta.url));
const binary = path.resolve(
  here,
  "..",
  "..",
  "..",
  "..",
  "target",
  "debug",
  process.platform === "win32" ? "claudio-core.exe" : "claudio-core",
);

describe.skipIf(!existsSync(binary))("against the real claudio-core binary", () => {
  it("answers ping and reports domain errors as strings", async () => {
    const core = new CoreProcess({
      command: binary,
      args: ["--resource-dir", here],
      env: {
        ...process.env,
        XDG_DATA_HOME: path.join(here, "..", "node_modules", ".tmp-core-data"),
      },
      onEvent: () => undefined,
      onConfirm: async () => false,
      onStderr: () => undefined,
      onFatal: () => undefined,
    });
    core.start();

    try {
      await expect(core.invoke("ping")).resolves.toMatchObject({
        platform: process.platform === "win32" ? "windows" : process.platform,
      });
      await expect(core.invoke("cancel_install", { gameId: 1 })).rejects.toThrow(
        "No active install for this game.",
      );
      await expect(
        core.invoke("resolve_install_path", { gameTitle: "Some Game" }),
      ).resolves.toEqual(expect.stringContaining("Some Game"));
    } finally {
      core.dispose();
    }
  });
});
