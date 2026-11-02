import { afterEach, describe, expect, it } from "vite-plus/test";
import { CoreHarness, contractAvailable } from "./support/core-harness";

const platform = process.platform === "win32" ? "windows" : process.platform;
let core: CoreHarness;

function start(): CoreHarness {
  core = new CoreHarness();
  return core;
}

afterEach(() => core?.dispose());

describe.skipIf(!contractAvailable)("claudio-core protocol contract", () => {
  describe("framing", () => {
    it("echoes numeric and string ids unchanged", async () => {
      start();

      const numeric = await core.request("ping", null, 41);
      const text = await core.request("ping", undefined, "c-7");

      expect(numeric.id).toBe(41);
      expect(text.id).toBe("c-7");
    });

    it("treats null and missing params as an empty object", async () => {
      start();

      const withNull = await core.request("ping", null);
      const missing = await core.request("ping");

      expect(withNull.result).toMatchObject({ platform });
      expect(missing.result).toMatchObject({ platform });
    });

    it("reports an unknown method with the literal message", async () => {
      start();

      await expect(core.call("nope")).rejects.toThrow("Command nope not found");
    });

    it("prefixes invalid arguments with the method name", async () => {
      start();

      await expect(core.call("cancel_install", {})).rejects.toThrow(
        /^invalid args for command `cancel_install`: /,
      );
    });

    it("keeps working after a malformed line", async () => {
      start();
      core.sendRaw("not json\n\n");

      await expect(core.call("ping")).resolves.toMatchObject({ platform });
    });

    it("writes only protocol JSON to stdout", async () => {
      start();
      await core.call("ping");
      await core.call("log", { level: "info", message: "hello" });

      for (const line of core.stdoutLines) {
        expect(() => JSON.parse(line)).not.toThrow();
        expect(line.charCodeAt(0)).not.toBe(0xfeff);
      }
    });
  });

  describe("ping and log", () => {
    it("reports platform and a version", async () => {
      start();

      await expect(core.call("ping")).resolves.toEqual({
        platform,
        version: expect.stringMatching(/^\d+\.\d+\.\d+/),
      });
    });

    it("accepts log entries and returns null", async () => {
      start();

      await expect(core.call("log", { level: "warn", message: "x" })).resolves.toBeNull();
      await expect(
        core.call("log", { level: "info", message: "x", source: "s" }),
      ).resolves.toBeNull();
    });

    it("rejects a log entry without a message", async () => {
      start();

      await expect(core.call("log", { level: "info" })).rejects.toThrow(
        /^invalid args for command `log`/,
      );
    });
  });

  describe("settings", () => {
    it("returns defaults with explicit nulls", async () => {
      start();

      const settings = (await core.call("get_settings")) as Record<string, unknown>;

      expect(settings).toMatchObject({
        serverUrl: null,
        logLevel: "info",
        windowWidth: 1280,
        windowHeight: 800,
        windowX: null,
        windowY: null,
        defaultInstallPath: null,
        defaultDownloadPath: null,
        closeToTray: false,
        customHeaders: {},
        downloadSpeedLimitKbs: null,
      });
      expect(Object.keys(settings)).toContain("defaultProtonPath");
    });

    it("normalises the log level and drops forbidden headers when saving", async () => {
      start();

      await expect(
        core.call("update_settings", {
          settings: {
            serverUrl: "http://example",
            logLevel: "WARNING",
            windowWidth: 10,
            windowHeight: 20,
            customHeaders: { Host: "x", "Content-Length": "1", "X-Token": "t" },
          },
        }),
      ).resolves.toBeNull();

      await expect(core.call("get_settings")).resolves.toMatchObject({
        serverUrl: "http://example",
        logLevel: "warn",
        customHeaders: { "X-Token": "t" },
      });
    });

    it("requires window dimensions when saving", async () => {
      start();

      await expect(
        core.call("update_settings", { settings: { logLevel: "info" } }),
      ).rejects.toThrow(/^invalid args for command `update_settings`/);
    });

    it("falls back to all defaults when a stored file lacks window dimensions", async () => {
      start();
      core.writeData(
        "settings.json",
        JSON.stringify({ serverUrl: "http://stored", logLevel: "debug" }),
      );

      await expect(core.call("get_settings")).resolves.toMatchObject({
        serverUrl: null,
        logLevel: "info",
        windowWidth: 1280,
      });
    });

    it("keeps a stored file that has window dimensions and fills optional fields", async () => {
      start();
      core.writeData(
        "settings.json",
        JSON.stringify({ serverUrl: "http://stored", windowWidth: 640, windowHeight: 480 }),
      );

      await expect(core.call("get_settings")).resolves.toMatchObject({
        serverUrl: "http://stored",
        logLevel: "info",
        windowWidth: 640,
        closeToTray: false,
        customHeaders: {},
      });
    });
  });

  describe("installed games", () => {
    const entry = {
      remoteGameId: 7,
      title: "Legacy",
      platform: "linux",
      installType: "portable",
      installPath: "/definitely/missing",
      gameExe: null,
      installedAt: "1",
      bottleName: "legacy",
      linuxRuntimeBackend: "wine",
    };

    it("lists nothing for a fresh data directory", async () => {
      start();

      await expect(core.call("list_installed_games")).resolves.toEqual([]);
      await expect(core.call("get_installed_game", { remoteGameId: 1 })).resolves.toBeNull();
    });

    it("treats an empty registry file as no games", async () => {
      start();
      core.writeData("installed-games.json", "");

      await expect(core.call("list_installed_games")).resolves.toEqual([]);
    });

    it("reports a corrupt registry as an error and leaves the file", async () => {
      start();
      core.writeData("installed-games.json", "{broken");

      await expect(core.call("list_installed_games")).rejects.toThrow();
      await expect(core.call("list_installed_games")).rejects.toThrow();
    });

    it("prunes entries whose install path is missing", async () => {
      start();
      core.writeData("installed-games.json", JSON.stringify([entry]));

      await expect(core.call("list_installed_games")).resolves.toEqual([]);
    });

    it("ignores unknown legacy fields on entries", async () => {
      start();
      core.writeData(
        "installed-games.json",
        JSON.stringify([{ ...entry, installPath: core.dataHome }]),
      );

      await expect(core.call("get_installed_game", { remoteGameId: 7 })).resolves.toMatchObject({
        remoteGameId: 7,
        title: "Legacy",
        installType: "portable",
      });
    });
  });

  describe("missing games", () => {
    it.each(["launch_game", "list_game_executables", "open_install_folder", "add_steam_shortcut"])(
      "%s reports a game that is not installed",
      async (method) => {
        start();

        await expect(core.call(method, { remoteGameId: 99 })).rejects.toThrow(
          "Game is not installed.",
        );
      },
    );

    it("set_game_exe reports a game that is not installed", async () => {
      start();

      await expect(core.call("set_game_exe", { remoteGameId: 99, gameExe: "x" })).rejects.toThrow(
        "Game is not installed.",
      );
    });

    it("stop_game reports a game that is not running", async () => {
      start();

      await expect(core.call("stop_game", { remoteGameId: 99 })).rejects.toThrow(
        "This game is not running.",
      );
    });

    it("uninstall_game of an unknown game succeeds", async () => {
      start();

      await expect(
        core.call("uninstall_game", { remoteGameId: 99, deleteFiles: false }),
      ).resolves.toBeNull();
    });

    it("lists no running games", async () => {
      start();

      await expect(core.call("list_running_games")).resolves.toEqual([]);
    });
  });

  describe("install control", () => {
    it("cancel_install and restart_install_interactive need an active install", async () => {
      start();

      await expect(core.call("cancel_install", { gameId: 1 })).rejects.toThrow(
        "No active install for this game.",
      );
      await expect(core.call("restart_install_interactive", { gameId: 1 })).rejects.toThrow(
        "No active install for this game.",
      );
    });

    it("has no active operations when idle", async () => {
      start();

      await expect(core.call("has_active_operations")).resolves.toBe(false);
    });

    it("cleanup_failed_install requires a game", async () => {
      start();

      await expect(core.call("cleanup_failed_install", {})).rejects.toThrow(
        /^invalid args for command `cleanup_failed_install`/,
      );
    });
  });

  describe("paths", () => {
    it("resolves download paths under the data directory with a sanitised title", async () => {
      start();

      const root = (await core.call("resolve_default_download_root")) as string;
      const download = (await core.call("resolve_download_path", {
        gameTitle: "A: B/C",
      })) as string;

      expect(root.startsWith(core.dataHome)).toBe(true);
      expect(download.startsWith(root)).toBe(true);
      expect(download.endsWith("A B_C")).toBe(true);
    });

    it("includes the title in the install path", async () => {
      start();

      await expect(core.call("resolve_install_path", { gameTitle: "Some Game" })).resolves.toEqual(
        expect.stringContaining("Some Game"),
      );
    });

    it("accepts a relative install target", async () => {
      start();

      await expect(
        core.call("validate_install_target", { targetPath: "relative/x" }),
      ).resolves.toBeNull();
    });

    it("walks up to an existing folder for the browse root", async () => {
      start();

      const root = (await core.call("resolve_install_browse_root", {
        targetPath: `${core.dataHome}${process.platform === "win32" ? "\\" : "/"}missing`,
      })) as string;

      expect(root.toLowerCase()).toBe(core.dataHome.toLowerCase());
    });
  });

  describe("proton", () => {
    it("lists proton versions as label and value pairs", async () => {
      start();

      const versions = (await core.call("list_proton_versions")) as unknown[];

      expect(Array.isArray(versions)).toBe(true);
      if (process.platform === "linux") {
        expect(versions).toEqual(
          expect.arrayContaining([{ label: "UMU Latest", value: "UMU-Latest" }]),
        );
      }
    });
  });

  describe("server connection", () => {
    it("requires a configured URL", async () => {
      start();

      await expect(core.call("desktop_check_server_connection", {})).rejects.toThrow(
        "Desktop server URL is not configured.",
      );
    });

    it("reports an unreachable server as an error", async () => {
      start();

      await expect(
        core.call("desktop_check_server_connection", { serverUrl: "http://127.0.0.1:1" }),
      ).rejects.toThrow(/^error sending request for url/);
    });
  });
});
