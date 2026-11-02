import { execFileSync } from "node:child_process";
import {
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
import { CoreHarness, contractAvailable, coreKind } from "./support/core-harness";
import { FakeServer } from "./support/fake-server";

const sevenZip = [process.env.CLAUDIO_TEST_7Z, "/usr/bin/7zzs", "/usr/bin/7zz", "/usr/bin/7z"].find(
  (candidate) => candidate !== undefined && existsSync(candidate),
);
const canBuildArchives = process.platform === "linux";

const manyFiles = Array.from({ length: 100 }, (_, index) => ({ path: `f${index}`, size: 1 }));

let core: CoreHarness;
let server: FakeServer;
let work: string;
let target: string;

beforeEach(async () => {
  server = await FakeServer.start();
  work = mkdtempSync(path.join(tmpdir(), "claudio-dl-"));
  target = path.join(work, "target");
});

afterEach(async () => {
  core?.dispose();
  await server.close();
  rmSync(work, { recursive: true, force: true });
});

function startCore(extraSettings: Record<string, unknown> = {}): void {
  core = new CoreHarness();
  core.writeData(
    "settings.json",
    JSON.stringify({
      serverUrl: server.url,
      windowWidth: 1,
      windowHeight: 1,
      defaultDownloadPath: path.join(work, "downloads"),
      ...extraSettings,
    }),
  );
}

function download(id: number, extract: boolean): Promise<unknown> {
  return core.call("download_game_package", {
    input: { id, title: "Test Game", targetDir: target, extract },
  });
}

function sendFile(server: FakeServer, id: number, name: string, body: Buffer): void {
  server.on("GET", `/api/games/${id}/download-files-manifest`, (_req, res) => {
    res.statusCode = 404;
    res.end();
  });
  server.json("POST", `/api/games/${id}/download-ticket`, 200, { ticket: "t1" });
  server.on("GET", `/api/games/${id}/download`, (_req, res) => {
    res.writeHead(200, {
      "content-type": "application/octet-stream",
      "content-disposition": `attachment; filename="${name}"`,
      "content-length": body.length,
    });
    res.end(body);
  });
}

function buildSource(): string {
  const source = path.join(work, "src");
  mkdirSync(path.join(source, "Game", "data"), { recursive: true });
  writeFileSync(path.join(source, "Game", "game.exe"), "exe");
  writeFileSync(path.join(source, "Game", "data", "a.bin"), Buffer.alloc(200_000, 7));
  return source;
}

function buildArchive(kind: "zip" | "tar" | "tar.gz" | "7z"): Buffer {
  const source = buildSource();
  const out = path.join(work, `pack.${kind}`);
  if (kind === "zip") {
    execFileSync(sevenZip!, ["a", "-tzip", out, "Game"], { cwd: source, stdio: "ignore" });
  } else if (kind === "7z") {
    execFileSync(sevenZip!, ["a", out, "Game"], { cwd: source, stdio: "ignore" });
  } else {
    execFileSync("tar", [kind === "tar" ? "-cf" : "-czf", out, "Game"], { cwd: source });
  }
  return readFileSync(out);
}

function expectInstalled(): void {
  expect(readFileSync(path.join(target, "data", "a.bin")).length).toBe(200_000);
  expect(readFileSync(path.join(target, "game.exe"), "utf8")).toBe("exe");
}

describe.skipIf(!contractAvailable || !canBuildArchives || !sevenZip)(
  "claudio-core downloads",
  () => {
    describe("package download", () => {
      it("falls back to a ticket when the manifest is missing and keeps the archive", async () => {
        sendFile(server, 1, "pack.bin", Buffer.from("payload"));
        startCore();

        const result = await download(1, false);

        expect(result).toBe(path.join(target, "pack.bin"));
        expect(readFileSync(path.join(target, "pack.bin"), "utf8")).toBe("payload");
        expect(server.requests.some((r) => r.url === "/api/games/1/download?ticket=t1")).toBe(true);
      });

      it("tries the ticket once after a 404 from /download", async () => {
        server.json("GET", "/api/games/2/download-files-manifest", 200, { files: manyFiles });
        server.json("POST", "/api/games/2/download-ticket", 200, { ticket: "t9" });
        server.on("GET", "/api/games/2/download", (req, res) => {
          if ((req.url ?? "").includes("ticket=t9")) {
            res.writeHead(200, { "content-disposition": 'attachment; filename="x.bin"' });
            res.end("ok");
          } else {
            res.statusCode = 404;
            res.end();
          }
        });
        startCore();

        await expect(download(2, false)).resolves.toBe(path.join(target, "x.bin"));
      });

      it("names the file game-<id>.tar without a content disposition", async () => {
        server.json("GET", "/api/games/3/download-files-manifest", 200, { files: manyFiles });
        server.on("GET", "/api/games/3/download", (_req, res) => {
          res.end("data");
        });
        startCore();

        await expect(download(3, false)).resolves.toBe(path.join(target, "game-3.tar"));
      });

      it("reports the status when the package request fails", async () => {
        server.json("GET", "/api/games/4/download-files-manifest", 200, { files: manyFiles });
        server.on("GET", "/api/games/4/download", (_req, res) => {
          res.statusCode = 500;
          res.end();
        });
        startCore();

        await expect(download(4, false)).rejects.toThrow(/^Failed to download game package: 500/);
      });

      it("reports a manifest failure", async () => {
        server.on("GET", "/api/games/5/download-files-manifest", (_req, res) => {
          res.statusCode = 503;
          res.end();
        });
        startCore();

        await expect(download(5, false)).rejects.toThrow(
          /^Failed to load download file manifest: 503/,
        );
      });

      it("requires a configured server", async () => {
        core = new CoreHarness();

        await expect(download(6, false)).rejects.toThrow("Desktop server URL is not configured.");
      });

      it("sends configured custom headers and drops forbidden ones", async () => {
        sendFile(server, 7, "p.bin", Buffer.from("x"));
        startCore({ customHeaders: { "X-Token": "abc", Host: "evil" } });

        await download(7, false);

        const manifest = server.requests.find((r) => r.url.endsWith("download-files-manifest"));
        expect(manifest?.headers["x-token"]).toBe("abc");
        expect(manifest?.headers.host).not.toBe("evil");
      });

      it("emits progress events ending in completed", async () => {
        sendFile(server, 8, "p.bin", Buffer.alloc(100_000, 1));
        startCore();

        await download(8, false);

        const statuses = core.events
          .filter((e) => e.event === "install-progress")
          .map((e) => e.payload.status);
        expect(statuses[0]).toBe("starting");
        expect(statuses).toContain("requestingManifest");
        expect(statuses.at(-1)).toBe("completed");
      });

      it("cancels a download in progress and removes the empty target", async () => {
        server.json("GET", "/api/games/9/download-files-manifest", 200, { files: manyFiles });
        server.on("GET", "/api/games/9/download", (_req, res) => {
          res.writeHead(200, { "content-length": 50_000_000 });
          const timer = setInterval(() => res.write(Buffer.alloc(64_000)), 10);
          res.on("close", () => clearInterval(timer));
        });
        startCore();

        const pending = download(9, false);
        await waitFor(() => core.events.some((e) => e.payload.status === "downloading"));
        await core.call("cancel_install", { gameId: 9 });

        await expect(pending).rejects.toThrow("Download cancelled.");
        expect(existsSync(target)).toBe(false);
        await expect(core.call("has_active_operations")).resolves.toBe(false);
      });
    });

    describe("extraction", () => {
      it.each(["zip", "tar", "tar.gz", "7z"] as const)(
        "extracts a %s and unwraps the root folder",
        async (kind) => {
          if (kind === "zip" && coreKind === "rust") {
            return;
          }
          sendFile(server, 10, `pack.${kind}`, buildArchive(kind));
          startCore();
          if (kind === "7z" && coreKind === "csharp") {
            core.sevenZipDir(sevenZip!);
          }

          await expect(download(10, true)).resolves.toBe(target);

          expectInstalled();
        },
      );

      it("rejects a corrupted zip", async () => {
        if (coreKind === "rust") {
          return;
        }
        const archive = buildArchive("zip");
        archive[Math.floor(archive.length / 3)] ^= 0xff;
        sendFile(server, 11, "pack.zip", archive);
        startCore();

        await expect(download(11, true)).rejects.toThrow();
      });

      it("rejects a truncated tar.gz", async () => {
        const archive = buildArchive("tar.gz");
        sendFile(server, 12, "pack.tar.gz", archive.subarray(0, archive.length - 40));
        startCore();

        await expect(download(12, true)).rejects.toThrow();
      });

      it("rejects a corrupted 7z", async () => {
        const archive = buildArchive("7z");
        archive[40] ^= 0xff;
        sendFile(server, 13, "pack.7z", archive);
        startCore();
        if (coreKind === "csharp") {
          core.sevenZipDir(sevenZip!);
        }

        await expect(download(13, true)).rejects.toThrow();
      });

      it("copies a file that is not an archive", async () => {
        sendFile(server, 14, "readme.txt", Buffer.from("hello"));
        startCore();

        await download(14, true);

        expect(readFileSync(path.join(target, "readme.txt"), "utf8")).toBe("hello");
      });
    });

    describe("individual files", () => {
      const files = [
        { path: "Game/game.exe", size: 3 },
        { path: "Game/data/a b.bin", size: 5 },
      ];

      function manifestServer(id: number): void {
        server.json("GET", `/api/games/${id}/download-files-manifest`, 200, { files });
      }

      it("downloads every file into the target preserving folders", async () => {
        manifestServer(20);
        server.on("GET", "/api/games/20/download-files", (req, res) => {
          const requested = new URL(req.url ?? "", "http://x").searchParams.get("path");
          res.end(requested === "Game/game.exe" ? "exe" : "12345");
        });
        startCore();

        await download(20, true);

        expect(readFileSync(path.join(target, "game.exe"), "utf8")).toBe("exe");
        expect(readFileSync(path.join(target, "data", "a b.bin"), "utf8")).toBe("12345");
        expect(server.requests.some((r) => r.url.includes("path=Game/data/a%20b.bin"))).toBe(true);
      });

      it("retries a 429 and a 5xx", async () => {
        manifestServer(21);
        server.on("GET", "/api/games/21/download-files", (req, res, count) => {
          if (count === 1) {
            res.statusCode = 429;
            res.end();
          } else if (count === 2) {
            res.statusCode = 503;
            res.end();
          } else {
            const requested = new URL(req.url ?? "", "http://x").searchParams.get("path");
            res.end(requested === "Game/game.exe" ? "exe" : "12345");
          }
        });
        startCore();

        await download(21, true);

        expect(readFileSync(path.join(target, "game.exe"), "utf8")).toBe("exe");
      });

      it("resumes a dropped connection with a Range request", async () => {
        server.json("GET", "/api/games/22/download-files-manifest", 200, {
          files: [{ path: "big.bin", size: 100_000 }],
        });
        const full = Buffer.alloc(100_000, 9);
        server.on("GET", "/api/games/22/download-files", (req, res, count) => {
          if (count === 1) {
            res.writeHead(200, { "content-length": full.length });
            res.write(full.subarray(0, 40_000), () => setTimeout(() => res.destroy(), 100));
          } else {
            const range = /bytes=(\d+)-/.exec(String(req.headers.range ?? ""));
            const from = range ? Number(range[1]) : 0;
            res.writeHead(range ? 206 : 200, { "content-length": full.length - from });
            res.end(full.subarray(from));
          }
        });
        startCore();

        await download(22, true);

        expect(readFileSync(path.join(target, "big.bin")).equals(full)).toBe(true);
        const second = server.requests.filter((r) => r.url.includes("download-files?"))[1];
        expect(second.headers.range).toMatch(/^bytes=\d+-$/);
      });

      it("rewrites the file when the server ignores the Range header", async () => {
        server.json("GET", "/api/games/23/download-files-manifest", 200, {
          files: [{ path: "big.bin", size: 100_000 }],
        });
        const full = Buffer.alloc(100_000, 4);
        server.on("GET", "/api/games/23/download-files", (_req, res, count) => {
          if (count === 1) {
            res.writeHead(200, { "content-length": full.length });
            res.write(full.subarray(0, 30_000), () => setTimeout(() => res.destroy(), 100));
          } else {
            res.writeHead(200, { "content-length": full.length });
            res.end(full);
          }
        });
        startCore();

        await download(23, true);

        expect(readFileSync(path.join(target, "big.bin")).equals(full)).toBe(true);
      });

      it("fails immediately on a 404 with the file path", async () => {
        manifestServer(24);
        server.on("GET", "/api/games/24/download-files", (_req, res) => {
          res.statusCode = 404;
          res.end();
        });
        startCore();

        await expect(download(24, true)).rejects.toThrow(/^Failed to download Game\/.*: HTTP 404/);
        expect(
          server.requests.filter((r) => r.url.includes("download-files?")).length,
        ).toBeLessThanOrEqual(2);
      });
    });

    it("leaves nothing behind in the downloads folder after success", async () => {
      sendFile(server, 30, "p.bin", Buffer.from("x"));
      startCore();

      await download(30, false);

      const downloads = path.join(work, "downloads");
      expect(existsSync(downloads) ? readdirSync(downloads) : []).toEqual([]);
    });
  },
);

async function waitFor(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error("condition never became true");
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
