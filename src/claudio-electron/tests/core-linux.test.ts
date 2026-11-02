import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { CoreHarness, contractAvailable } from "./support/core-harness";
import { FakeServer } from "./support/fake-server";

const golden = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "golden");
let core: CoreHarness;
let server: FakeServer;
let work: string;
let home: string;
let prefix: string;

beforeEach(async () => {
  server = await FakeServer.start();
  work = mkdtempSync(path.join(tmpdir(), "claudio-lin-"));
  home = path.join(work, "home");
  mkdirSync(home);
  prefix = path.join(work, "games", "Test Game");
});

afterEach(async () => {
  core?.dispose();
  await server.close();
  rmSync(work, { recursive: true, force: true });
});

function startCore(umuScript: string): void {
  core = new CoreHarness({ HOME: home });
  const toolsDir = path.join(core.dataDir, "tools", "umu-launcher", "1.4.0");
  mkdirSync(toolsDir, { recursive: true });
  writeFileSync(path.join(toolsDir, "umu-run"), `#!/bin/sh\n${umuScript}\n`);
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

function registerGame(id: number, extra: Record<string, unknown> = {}): string {
  const installPath = path.join(work, "games", `g${id}`);
  const exe = path.join(installPath, "pfx", "drive_c", "Games", "G", "start.exe");
  mkdirSync(path.dirname(exe), { recursive: true });
  writeFileSync(exe, "x");
  writeFileSync(path.join(path.dirname(exe), "other.bat"), "x");
  writeFileSync(path.join(path.dirname(exe), "notes.txt"), "x");
  core.writeData(
    "installed-games.json",
    JSON.stringify([
      {
        remoteGameId: id,
        title: "Test Game",
        platform: "windows",
        installType: "installer",
        installPath,
        gameExe: exe,
        winePrefix: installPath,
        protonPath: "UMU-Latest",
        installedAt: "1",
        ...extra,
      },
    ]),
  );
  return exe;
}

describe.skipIf(!contractAvailable || process.platform !== "linux")("claudio-core linux", () => {
  describe("executables and launch settings", () => {
    it("lists executables relative to drive_c in sorted order", async () => {
      startCore("exit 0");
      registerGame(1);

      await expect(core.call("list_game_executables", { remoteGameId: 1 })).resolves.toEqual([
        "Games/G/other.bat",
        "Games/G/start.exe",
      ]);
    });

    it("sets the executable from a relative path and rejects other files", async () => {
      startCore("exit 0");
      const exe = registerGame(2);

      await expect(
        core.call("set_game_exe", { remoteGameId: 2, gameExe: "Games/G/other.bat" }),
      ).resolves.toMatchObject({ gameExe: path.join(path.dirname(exe), "other.bat") });
      await expect(
        core.call("set_game_exe", { remoteGameId: 2, gameExe: "Games/G/notes.txt" }),
      ).rejects.toThrow("Selected file is not a Windows executable.");
      await expect(
        core.call("set_game_exe", { remoteGameId: 2, gameExe: "missing.exe" }),
      ).rejects.toThrow("Selected executable no longer exists.");
    });

    it("saves launch settings and clears blank fields", async () => {
      startCore("exit 0");
      registerGame(3);

      const saved = await core.call("update_game_launch_settings", {
        remoteGameId: 3,
        gameExe: "  ",
        protonPath: "umu-sniper",
        options: { parameters: "-a -b", runAsAdministrator: false, umuGameId: " " },
      });

      expect(saved).toMatchObject({
        gameExe: null,
        protonPath: "umu-sniper",
        launchOptions: { parameters: "-a -b", runAsAdministrator: false, umuGameId: null },
      });
    });

    it("rejects launch parameters with an unclosed quote", async () => {
      startCore("exit 0");
      registerGame(4);

      await expect(
        core.call("update_game_launch_settings", {
          remoteGameId: 4,
          gameExe: null,
          protonPath: null,
          options: { parameters: '-name "x', runAsAdministrator: false },
        }),
      ).rejects.toThrow("Launch parameters contain an unclosed quote.");
    });

    it("uninstalls a Proton prefix without following its dosdevices symlinks", async () => {
      startCore("exit 0");
      const exe = registerGame(12);
      const prefixDir = path.join(work, "games", "g12");
      const outside = path.join(work, "outside");
      mkdirSync(outside);
      writeFileSync(path.join(outside, "keep.txt"), "keep");
      mkdirSync(path.join(prefixDir, "dosdevices"));
      symlinkSync(outside, path.join(prefixDir, "dosdevices", "z:"));
      symlinkSync("/nonexistent-target", path.join(prefixDir, "dosdevices", "dangling"));

      await core.call("uninstall_game", { remoteGameId: 12, deleteFiles: true });

      expect(existsSync(prefixDir)).toBe(false);
      expect(existsSync(exe)).toBe(false);
      expect(readFileSync(path.join(outside, "keep.txt"), "utf8")).toBe("keep");
      await expect(core.call("get_installed_game", { remoteGameId: 12 })).resolves.toBeNull();
    });

    it("refuses to launch a game twice", async () => {
      startCore("exec sleep 30");
      registerGame(5);

      await core.call("launch_game", { remoteGameId: 5 });
      await expect(core.call("launch_game", { remoteGameId: 5 })).rejects.toThrow(
        "This game is already running.",
      );
      await core.call("stop_game", { remoteGameId: 5 });
      await expect(core.call("list_running_games")).resolves.toEqual([]);
    });
  });

  describe("steam shortcuts", () => {
    function steamConfig(): string {
      return path.join(home, ".steam", "steam", "userdata", "1234", "config", "shortcuts.vdf");
    }

    it("explains when Steam is not set up", async () => {
      startCore("exit 0");
      registerGame(6);

      await expect(core.call("add_steam_shortcut", { remoteGameId: 6 })).rejects.toThrow(
        "No Steam userdata folder was found for shortcut creation.",
      );
    });

    it("writes shortcuts.vdf exactly as the golden file and keeps a backup", async () => {
      startCore("exit 0");
      registerGame(7);
      mkdirSync(path.dirname(steamConfig()), { recursive: true });

      await core.call("add_steam_shortcut", { remoteGameId: 7 });
      await core.call("add_steam_shortcut", { remoteGameId: 7 });

      const normalized = readFileSync(steamConfig())
        .toString("latin1")
        .split(work)
        .join("@ROOT@")
        .split(core.dataHome)
        .join("@DATA@");
      if (process.env.UPDATE_GOLDEN) {
        writeFileSync(path.join(golden, "shortcuts.vdf"), Buffer.from(normalized, "latin1"));
      }
      expect(
        Buffer.from(normalized, "latin1").equals(readFileSync(path.join(golden, "shortcuts.vdf"))),
      ).toBe(true);
      expect(existsSync(`${steamConfig()}.claudio.bak`)).toBe(true);
    });

    it("leaves an unreadable shortcuts file unchanged", async () => {
      startCore("exit 0");
      registerGame(8);
      mkdirSync(path.dirname(steamConfig()), { recursive: true });
      writeFileSync(steamConfig(), Buffer.from([0x63, 0x61]));

      await expect(core.call("add_steam_shortcut", { remoteGameId: 8 })).rejects.toThrow(
        /^Failed to parse Steam shortcuts .* Leaving it unchanged/,
      );
      expect([...readFileSync(steamConfig())]).toEqual([0x63, 0x61]);
    });

    it("updates an existing entry with the same name and keeps others", async () => {
      startCore("exit 0");
      registerGame(9);
      mkdirSync(path.dirname(steamConfig()), { recursive: true });
      await core.call("add_steam_shortcut", { remoteGameId: 9 });
      const first = readFileSync(steamConfig());

      await core.call("add_steam_shortcut", { remoteGameId: 9 });

      expect(readFileSync(steamConfig()).equals(first)).toBe(true);
    });
  });

  describe("installer packages", () => {
    function installerServer(id: number): void {
      const source = path.join(work, "src");
      mkdirSync(path.join(source, "disc"), { recursive: true });
      writeFileSync(path.join(source, "disc", "setup.exe"), "MZ");
      writeFileSync(path.join(source, "disc", "unins000.exe"), "MZ");
      const out = path.join(work, "installer.tar");
      execFileSync("tar", ["-cf", out, "disc"], { cwd: source });
      const archive = readFileSync(out);
      server.on("GET", `/api/games/${id}/download-files-manifest`, (_req, res) => {
        res.statusCode = 404;
        res.end();
      });
      server.json("POST", `/api/games/${id}/download-ticket`, 200, { ticket: "t" });
      server.on("GET", `/api/games/${id}/download`, (_req, res) => {
        res.writeHead(200, { "content-disposition": 'attachment; filename="installer.tar"' });
        res.end(archive);
      });
    }

    const installerGame = (id: number, extra: Record<string, unknown> = {}) => ({
      id,
      title: "Test Game",
      platform: "windows",
      installType: "installer",
      installPath: prefix,
      gameExe: "start.exe",
      ...extra,
    });

    it("runs the detected installer through umu and finds the game executable", async () => {
      installerServer(10);
      const log = path.join(work, "umu.log");
      startCore(
        `echo "args:$*" >> "${log}"\ncase "$1" in\n*setup.exe) mkdir -p "$WINEPREFIX/pfx/drive_c/Games/Test Game"; echo x > "$WINEPREFIX/pfx/drive_c/Games/Test Game/start.exe";;\nesac`,
      );

      const installed = (await core.call("install_game", { game: installerGame(10) })) as Record<
        string,
        unknown
      >;

      expect(installed).toMatchObject({
        installType: "installer",
        winePrefix: prefix,
        gameExe: path.join(prefix, "pfx", "drive_c", "Games", "Test Game", "start.exe"),
      });
      expect(readFileSync(log, "utf8")).toMatch(/args:.+setup\.exe\n$/);
      const statuses = core.events.map((e) => e.payload.status);
      expect(statuses).toContain("installing-interactive");
    });

    it("surfaces a failing installer with the umu output", async () => {
      installerServer(11);
      startCore(`case "$1" in\n*setup.exe) echo "boom from umu" >&2; exit 3;;\nesac`);

      await expect(core.call("install_game", { game: installerGame(11) })).rejects.toThrow(
        /UMU exited with status .*3.*\n.*boom from umu/s,
      );
    });
  });
});
