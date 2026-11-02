import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { CoreHarness, contractAvailable } from "./support/core-harness";
import { FakeServer } from "./support/fake-server";

const GAME_ID = 9171;
const REGISTRY_KEY = `HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Claudio-${GAME_ID}`;

let core: CoreHarness;
let server: FakeServer;
let work: string;
let target: string;
let startMenu: string;
let desktop: string;

function registryEntry(): string | null {
  try {
    return execFileSync("reg", ["query", REGISTRY_KEY], { encoding: "utf8", stdio: "pipe" });
  } catch {
    return null;
  }
}

function deleteRegistryEntry(): void {
  try {
    execFileSync("reg", ["delete", REGISTRY_KEY, "/f"], { stdio: "ignore" });
  } catch {
    // the key only exists when the test got far enough to create it
  }
}

beforeEach(async () => {
  server = await FakeServer.start();
  work = mkdtempSync(path.join(tmpdir(), "claudio-win-"));
  target = path.join(work, "games", "Test Game");
  startMenu = path.join(work, "start-menu");
  desktop = path.join(work, "desktop");
  deleteRegistryEntry();
});

afterEach(async () => {
  core?.dispose();
  await server.close();
  deleteRegistryEntry();
  rmSync(work, { recursive: true, force: true });
});

function startCore(): void {
  core = new CoreHarness({ CLAUDIO_START_MENU_DIR: startMenu, CLAUDIO_DESKTOP_DIR: desktop });
  writeFileSync(path.join(core.resourceDir, "claudio-game-uninstaller.exe"), "uninstaller");
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

function serveZip(): void {
  const source = path.join(work, "src");
  mkdirSync(path.join(source, "Game"), { recursive: true });
  writeFileSync(path.join(source, "Game", "game.exe"), "exe");
  writeFileSync(path.join(source, "Game", "readme.txt"), "hello");
  const archive = path.join(work, "pack.zip");
  const sevenZip = process.env.CLAUDIO_TEST_7Z;
  if (sevenZip) {
    execFileSync(sevenZip, ["a", "-tzip", archive, "Game"], { cwd: source, stdio: "ignore" });
  } else {
    execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Compress-Archive -Path '${path.join(source, "Game")}' -DestinationPath '${archive}'`,
      ],
      { stdio: "ignore" },
    );
  }
  const body = readFileSync(archive);
  server.on("GET", `/api/games/${GAME_ID}/download-files-manifest`, (_req, res) => {
    res.statusCode = 404;
    res.end();
  });
  server.json("POST", `/api/games/${GAME_ID}/download-ticket`, 200, { ticket: "t" });
  server.on("GET", `/api/games/${GAME_ID}/download`, (_req, res) => {
    res.writeHead(200, { "content-disposition": 'attachment; filename="pack.zip"' });
    res.end(body);
  });
}

const game = (extra: Record<string, unknown> = {}) => ({
  id: GAME_ID,
  title: "Test Game",
  platform: "windows",
  installType: "portable",
  installPath: target,
  desktopShortcut: true,
  ...extra,
});

describe.skipIf(!contractAvailable || process.platform !== "win32")("claudio-core windows", () => {
  it("installs a portable game and registers it with Windows", async () => {
    serveZip();
    startCore();

    const installed = (await core.call("install_game", { game: game() })) as Record<
      string,
      unknown
    >;

    expect(installed).toMatchObject({
      remoteGameId: GAME_ID,
      installPath: target,
      gameExe: path.join(target, "game.exe"),
      winePrefix: null,
    });
    expect(readFileSync(path.join(target, "game.exe"), "utf8")).toBe("exe");
    expect(readFileSync(path.join(target, "uninstall.exe"), "utf8")).toBe("uninstaller");
    const config = JSON.parse(readFileSync(path.join(target, "uninstall-config.json"), "utf8"));
    expect(Object.keys(config)).toEqual([
      "desktopShortcutPath",
      "gameTitle",
      "installPath",
      "registryKeyName",
      "shortcutPath",
    ]);
    expect(config).toMatchObject({
      gameTitle: "Test Game",
      registryKeyName: `Claudio-${GAME_ID}`,
      installPath: target,
    });
    expect(existsSync(path.join(startMenu, "Test Game.lnk"))).toBe(true);
    expect(existsSync(path.join(desktop, "Test Game.lnk"))).toBe(true);
    const entry = registryEntry();
    expect(entry).toContain("DisplayName");
    expect(entry).toContain("Test Game");
    expect(entry).toContain(path.join(target, "uninstall.exe"));
    await expect(core.call("has_active_operations")).resolves.toBe(false);
  });

  it("still succeeds when the uninstaller is missing from the resources", async () => {
    serveZip();
    startCore();
    rmSync(path.join(core.resourceDir, "claudio-game-uninstaller.exe"));

    await expect(core.call("install_game", { game: game() })).resolves.toMatchObject({
      remoteGameId: GAME_ID,
    });

    expect(existsSync(path.join(target, "uninstall.exe"))).toBe(false);
    expect(registryEntry()).toContain("DisplayName");
    await expect(core.call("has_active_operations")).resolves.toBe(false);
  });

  it("uninstalling removes files, shortcuts and the registry entry", async () => {
    serveZip();
    startCore();
    await core.call("install_game", { game: game() });

    await core.call("uninstall_game", { remoteGameId: GAME_ID, deleteFiles: true });

    expect(existsSync(target)).toBe(false);
    expect(existsSync(path.join(startMenu, "Test Game.lnk"))).toBe(false);
    expect(existsSync(path.join(desktop, "Test Game.lnk"))).toBe(false);
    expect(registryEntry()).toBeNull();
    await expect(core.call("get_installed_game", { remoteGameId: GAME_ID })).resolves.toBeNull();
    await expect(core.call("has_active_operations")).resolves.toBe(false);
  });

  it("launches an installed game and lists it as running", async () => {
    serveZip();
    startCore();
    await core.call("install_game", { game: game() });
    // a copy of cmd.exe stands in for the game so it can start and stay alive
    const cmd = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe");
    const exe = path.join(target, "game.exe");
    writeFileSync(exe, readFileSync(cmd));
    await core.call("update_game_launch_settings", {
      remoteGameId: GAME_ID,
      gameExe: "game.exe",
      protonPath: null,
      options: { parameters: "/c ping -n 30 127.0.0.1", runAsAdministrator: false },
    });

    await expect(core.call("launch_game", { remoteGameId: GAME_ID })).resolves.toBeNull();
    const running = (await core.call("list_running_games")) as { gameId: number; pid: number }[];
    expect(running.map((entry) => entry.gameId)).toEqual([GAME_ID]);

    await expect(core.call("stop_game", { remoteGameId: GAME_ID })).resolves.toBeNull();
    await expect(core.call("list_running_games")).resolves.toEqual([]);
  });
});
