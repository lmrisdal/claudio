import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { CoreHarness, coreAvailable } from "./support/core-harness";
import { FakeServer } from "./support/fake-server";

let core: CoreHarness;
let server: FakeServer;
let work: string;
let target: string;

beforeEach(async () => {
  server = await FakeServer.start();
  work = mkdtempSync(path.join(tmpdir(), "claudio-inst-"));
  target = path.join(work, "games", "Test Game");
});

afterEach(async () => {
  core?.dispose();
  await server.close();
  rmSync(work, { recursive: true, force: true });
});

function startCore(): void {
  core = new CoreHarness();
  const toolsDir = path.join(core.dataDir, "tools", "umu-launcher", "1.4.0");
  mkdirSync(toolsDir, { recursive: true });
  const log = path.join(work, "umu.log");
  writeFileSync(
    path.join(toolsDir, "umu-run"),
    `#!/bin/sh\nmkdir -p "$WINEPREFIX"\n{ echo "args:$*"; echo "WINEPREFIX=$WINEPREFIX"; echo "PROTONPATH=$PROTONPATH"; echo "GAMEID=$GAMEID"; } >> "${log}"\n`,
  );
  chmodSync(path.join(toolsDir, "umu-run"), 0o755);
  writeFileSync(path.join(toolsDir, "VERSION"), "1.4.0\n");
  core.writeData(
    "settings.json",
    JSON.stringify({
      serverUrl: server.url,
      windowWidth: 1,
      windowHeight: 1,
      defaultDownloadPath: path.join(work, "downloads"),
      defaultInstallPath: path.join(work, "games"),
    }),
  );
}

function packageServer(id: number, archive: Buffer, name = "pack.tar.gz"): void {
  server.on("GET", `/api/games/${id}/download-files-manifest`, (_req, res) => {
    res.statusCode = 404;
    res.end();
  });
  server.json("POST", `/api/games/${id}/download-ticket`, 200, { ticket: "t" });
  server.on("GET", `/api/games/${id}/download`, (_req, res) => {
    res.writeHead(200, { "content-disposition": `attachment; filename="${name}"` });
    res.end(archive);
  });
}

function buildTarGz(): Buffer {
  const source = path.join(work, "src");
  mkdirSync(path.join(source, "Game", "bin"), { recursive: true });
  writeFileSync(path.join(source, "Game", "bin", "zeta.exe"), "z");
  writeFileSync(path.join(source, "Game", "alpha.exe"), "a");
  writeFileSync(path.join(source, "Game", "readme.txt"), "r");
  const out = path.join(work, "pack.tar.gz");
  execFileSync("tar", ["-czf", out, "Game"], { cwd: source });
  return readFileSync(out);
}

function game(id: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    title: "Test Game",
    platform: "windows",
    installType: "portable",
    installPath: target,
    ...extra,
  };
}

const payload = (): string => path.join(target, "pfx", "drive_c", "Games", "Test Game");

describe.skipIf(!coreAvailable || process.platform !== "linux")(
  "claudio-core portable installs",
  () => {
    it("installs into a Proton prefix and registers the game", async () => {
      packageServer(1, buildTarGz());
      startCore();

      const installed = (await core.call("install_game", { game: game(1) })) as Record<
        string,
        unknown
      >;

      expect(installed).toMatchObject({
        remoteGameId: 1,
        title: "Test Game",
        installType: "portable",
        installPath: target,
        winePrefix: target,
        protonPath: "UMU-Latest",
        gameExe: path.join(payload(), "alpha.exe"),
      });
      expect(readFileSync(path.join(payload(), "bin", "zeta.exe"), "utf8")).toBe("z");
      await expect(core.call("get_installed_game", { remoteGameId: 1 })).resolves.toMatchObject({
        remoteGameId: 1,
      });
      expect(existsSync(`${target}.extracting`)).toBe(false);
    });

    it("writes the registry with a stable field order", async () => {
      packageServer(2, buildTarGz());
      startCore();
      await core.call("install_game", { game: game(2) });

      const [entry] = JSON.parse(
        readFileSync(path.join(core.dataDir, "installed-games.json"), "utf8"),
      );

      expect(Object.keys(entry)).toEqual([
        "launchOptions",
        "remoteGameId",
        "title",
        "platform",
        "installType",
        "installPath",
        "gameExe",
        "winePrefix",
        "protonPath",
        "installedAt",
        "summary",
        "genre",
        "releaseYear",
        "coverUrl",
        "heroUrl",
        "developer",
        "publisher",
        "gameMode",
        "series",
        "franchise",
        "gameEngine",
      ]);
      expect(entry.launchOptions).toEqual({
        parameters: "",
        runAsAdministrator: false,
        umuGameId: null,
      });
    });

    it("prefers the executable hint when it exists", async () => {
      packageServer(3, buildTarGz());
      startCore();

      const installed = (await core.call("install_game", {
        game: game(3, { gameExe: "bin/zeta.exe" }),
      })) as Record<string, unknown>;

      expect(installed.gameExe).toBe(path.join(payload(), "bin/zeta.exe"));
    });

    it("emits progress inside the documented ranges and ends completed", async () => {
      packageServer(4, buildTarGz());
      startCore();
      await core.call("install_game", { game: game(4) });

      const progress = core.events
        .filter((e) => e.event === "install-progress")
        .map((e) => e.payload);
      const statuses = progress.map((p) => p.status);

      expect(statuses[0]).toBe("starting");
      expect(statuses).toContain("preparing-prefix");
      expect(progress.find((p) => p.status === "preparing-prefix")).toMatchObject({
        percent: 60,
        indeterminate: true,
      });
      expect(progress.some((p) => p.detail === "Moving files…" && p.percent === 96)).toBe(true);
      expect(progress.at(-1)).toMatchObject({ status: "completed", percent: 100 });
    });

    it("refuses an install target that already exists", async () => {
      packageServer(5, buildTarGz());
      startCore();
      mkdirSync(target, { recursive: true });

      await expect(core.call("install_game", { game: game(5) })).rejects.toThrow(
        `Install target already exists: ${target}`,
      );
      const failed = core.events.find((e) => e.payload.status === "failed");
      expect(failed?.payload.detail).toBe(
        `Install failed for Test Game: Install target already exists: ${target}`,
      );
    });

    it("requires a configured server", async () => {
      core = new CoreHarness();

      await expect(core.call("install_game", { game: game(6) })).rejects.toThrow(
        "Desktop server URL is not configured.",
      );
    });

    it("keeps the download for a retry when extraction fails", async () => {
      const bad = buildTarGz().subarray(0, 60);
      packageServer(7, bad);
      startCore();

      await expect(core.call("install_game", { game: game(7) })).rejects.toThrow();

      const workspace = path.join(work, "downloads", "Test Game-7");
      const marker = JSON.parse(
        readFileSync(path.join(workspace, ".claudio-download-complete.json"), "utf8"),
      );
      expect(Object.keys(marker)).toEqual(["filePath", "isIndividual"]);
      expect(marker.isIndividual).toBe(false);

      writeFileSync(marker.filePath, buildTarGz());
      const retried = await core.call("retry_cached_install", { game: game(7) });
      expect(retried).toMatchObject({ remoteGameId: 7 });
      expect(existsSync(workspace)).toBe(false);
    });

    it("explains a retry with nothing cached", async () => {
      startCore();

      await expect(core.call("retry_cached_install", { game: game(8) })).rejects.toThrow(
        "The downloaded package is no longer available. Start the install again to download it.",
      );
    });

    it("writes an app menu shortcut that runs through umu", async () => {
      packageServer(9, buildTarGz());
      startCore();

      await core.call("install_game", { game: game(9, { appMenuShortcut: true }) });

      const applications = path.join(core.dataHome, "applications");
      const [file] = readdirSync(applications);
      expect(file).toBe("claudio-9-Test Game.desktop");
      const contents = readFileSync(path.join(applications, file), "utf8");
      expect(contents).toContain("[Desktop Entry]\nName=Test Game\n");
      expect(contents).toContain(`WINEPREFIX="${target}"`);
      expect(contents).toContain("GAMEID=umu-default STORE=none");
    });

    it("launches an installed prefix game through umu with the saved options", async () => {
      packageServer(10, buildTarGz());
      startCore();
      await core.call("install_game", { game: game(10) });
      const registryPath = path.join(core.dataDir, "installed-games.json");
      const registry = JSON.parse(readFileSync(registryPath, "utf8"));
      registry[0].launchOptions = { parameters: '-name "A B"', umuGameId: "umu-123" };
      writeFileSync(registryPath, JSON.stringify(registry));

      await core.call("launch_game", { remoteGameId: 10 });
      const log = path.join(work, "umu.log");
      const deadline = Date.now() + 5000;
      while (!existsSync(log) || !readFileSync(log, "utf8").includes("alpha.exe")) {
        if (Date.now() > deadline) throw new Error("umu was never started");
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      const text = readFileSync(log, "utf8");
      expect(text).toContain(`args:${path.join(payload(), "alpha.exe")} -name A B`);
      expect(text).toContain("GAMEID=umu-123");
    });
  },
);
