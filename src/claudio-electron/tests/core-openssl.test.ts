import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { CoreHarness, coreAvailable, coreKind } from "./support/core-harness";
import { FakeServer } from "./support/fake-server";

const libssl = [
  "/usr/lib/libssl.so.3",
  "/usr/lib/x86_64-linux-gnu/libssl.so.3",
  "/lib64/libssl.so.3",
].find(existsSync);
const libcrypto = libssl?.replace("libssl", "libcrypto");

function canHideOpenSsl(): boolean {
  if (process.platform !== "linux" || !libssl || !libcrypto) return false;
  try {
    execFileSync("bwrap", ["--dev-bind", "/", "/", "--ro-bind", "/dev/null", libssl, "true"], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

let core: CoreHarness;
let server: FakeServer;

afterEach(async () => {
  core?.dispose();
  await server?.close();
});

describe.skipIf(!coreAvailable || coreKind !== "csharp" || !canHideOpenSsl())(
  "claudio-core without OpenSSL",
  () => {
    function start(): void {
      core = new CoreHarness({}, [
        "bwrap",
        "--dev-bind",
        "/",
        "/",
        "--ro-bind",
        "/dev/null",
        libssl!,
        "--ro-bind",
        "/dev/null",
        libcrypto!,
      ]);
    }

    it("reports HTTPS as unavailable instead of crashing, or does not need OpenSSL at all", async () => {
      start();

      await expect(
        core.call("desktop_check_server_connection", { serverUrl: "https://example.test" }),
      ).rejects.toThrow(
        process.env.CLAUDIO_STATIC_OPENSSL
          ? /^error sending request for url/
          : /^HTTPS is not available because OpenSSL \(libssl\) was not found/,
      );
      await expect(core.call("ping")).resolves.toMatchObject({ platform: "linux" });
    });

    it("keeps plain HTTP working", async () => {
      server = await FakeServer.start();
      server.json("GET", "/health", 200, {});
      start();

      await expect(
        core.call("desktop_check_server_connection", { serverUrl: server.url }),
      ).resolves.toEqual({ ok: true, status: 200 });
    });
  },
);
