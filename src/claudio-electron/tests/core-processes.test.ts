import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { CoreHarness, coreAvailable } from "./support/core-harness";

let core: CoreHarness;
const pids: number[] = [];

afterEach(() => {
  for (const pid of pids.splice(0)) {
    try {
      process.kill(pid);
    } catch {}
  }
  core?.dispose();
});

function installScriptGame(id: number, script: string, launchOptions?: unknown): string {
  const installDir = path.join(core.dataHome, `game-${id}`);
  mkdirSync(installDir, { recursive: true });
  const exe = path.join(installDir, "run.sh");
  writeFileSync(exe, script);
  chmodSync(exe, 0o755);
  core.writeData(
    "installed-games.json",
    JSON.stringify([
      {
        remoteGameId: id,
        title: "Script Game",
        platform: "linux",
        installType: "portable",
        installPath: installDir,
        gameExe: exe,
        installedAt: "1",
        ...(launchOptions ? { launchOptions } : {}),
      },
    ]),
  );
  return installDir;
}

async function waitForFile(file: string): Promise<string> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (existsSync(file) && readFileSync(file, "utf8").trim() !== "") {
      return readFileSync(file, "utf8");
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`${file} was never written`);
}

describe.skipIf(!coreAvailable || process.platform !== "linux")("claudio-core processes", () => {
  it("keeps stdout pure protocol when a launched child writes to stdout", async () => {
    core = new CoreHarness();
    const dir = installScriptGame(
      1,
      "#!/bin/sh\necho CORRUPTING-THE-PROTOCOL\necho CORRUPTING-STDERR >&2\necho $$ > pid\nexec sleep 30\n",
    );

    await expect(core.call("launch_game", { remoteGameId: 1 })).resolves.toBeNull();
    pids.push(Number((await waitForFile(path.join(dir, "pid"))).trim()));

    await expect(core.call("list_running_games")).resolves.toHaveLength(1);
    await expect(core.call("ping")).resolves.toMatchObject({ platform: "linux" });
    expect(core.stdoutLines.join("\n")).not.toContain("CORRUPTING");
  });

  it("exits on stdin close and leaves running games alive", async () => {
    core = new CoreHarness();
    const dir = installScriptGame(2, "#!/bin/sh\necho $$ > pid\nexec sleep 30\n");
    await core.call("launch_game", { remoteGameId: 2 });
    const pid = Number((await waitForFile(path.join(dir, "pid"))).trim());
    pids.push(pid);

    expect(await core.closeStdinAndWait()).toBe(true);

    expect(existsSync(`/proc/${pid}`)).toBe(true);
  });

  it("passes saved launch arguments without shell expansion", async () => {
    core = new CoreHarness();
    const dir = installScriptGame(3, "#!/bin/sh\nprintf '%s\\n' \"$@\" > arguments\n", {
      parameters: '-name "Player One" $HOME ;',
    });

    await expect(core.call("launch_game", { remoteGameId: 3 })).resolves.toBeNull();

    expect(await waitForFile(path.join(dir, "arguments"))).toBe("-name\nPlayer One\n$HOME\n;\n");
  });
});
