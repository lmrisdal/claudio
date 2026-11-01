import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { createAppHandler, mimeTypeFor, resolveAppFile } from "../src/main/protocol/app-protocol";

let root = "";

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "claudio-app-"));
  mkdirSync(path.join(root, "assets"));
  mkdirSync(path.join(root, "emulator"));
  writeFileSync(path.join(root, "index.html"), "<html>spa</html>");
  writeFileSync(path.join(root, "assets", "app.js"), "0123456789");
  writeFileSync(path.join(root, "emulator", "index.html"), "<html>emulator</html>");
  writeFileSync(path.join(path.dirname(root), "outside-secret.txt"), "secret");
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(path.join(path.dirname(root), "outside-secret.txt"), { force: true });
});

const get = (pathname: string, headers: Record<string, string> = {}) =>
  createAppHandler(root)(new Request(`claudio-app://app${pathname}`, { headers }));

describe("resolveAppFile", () => {
  it("serves existing files", async () => {
    expect(await resolveAppFile(root, "/assets/app.js")).toEqual({
      kind: "file",
      file: path.join(root, "assets", "app.js"),
    });
  });

  it("falls back to index.html for extension-less client routes", async () => {
    expect(await resolveAppFile(root, "/games/42")).toEqual({
      kind: "file",
      file: path.join(root, "index.html"),
    });
  });

  it("serves a directory's own index.html, so /emulator/ is not the SPA", async () => {
    expect(await resolveAppFile(root, "/emulator/")).toEqual({
      kind: "file",
      file: path.join(root, "emulator", "index.html"),
    });
  });

  it("reports missing assets instead of masking them with index.html", async () => {
    expect(await resolveAppFile(root, "/assets/missing.js")).toEqual({ kind: "missing" });
  });

  it.each(["/%2e%2e/outside-secret.txt", "/..%2foutside-secret.txt", "/a%00b", "/%E0%A4%A"])(
    "never leaves the root for %s",
    async (pathname) => {
      const result = await resolveAppFile(root, pathname);

      if (result.kind === "file") expect(result.file.startsWith(root + path.sep)).toBe(true);
      else expect(result.kind === "denied" || result.kind === "missing").toBe(true);
    },
  );
});

describe("createAppHandler", () => {
  it("returns content with its MIME type and range support advertised", async () => {
    const response = await get("/assets/app.js");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(await response.text()).toBe("0123456789");
  });

  it("serves 404 for missing files and 403 for malformed paths", async () => {
    expect((await get("/nope.css")).status).toBe(404);
    expect((await get("/%E0%A4%A")).status).toBe(403);
  });

  it("answers range requests with 206 and Content-Range", async () => {
    const response = await get("/assets/app.js", { range: "bytes=2-5" });

    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(response.headers.get("content-length")).toBe("4");
    expect(await response.text()).toBe("2345");
  });

  it("supports open-ended and suffix ranges", async () => {
    expect(await (await get("/assets/app.js", { range: "bytes=7-" })).text()).toBe("789");
    expect(await (await get("/assets/app.js", { range: "bytes=-3" })).text()).toBe("789");
  });

  it("rejects unsatisfiable ranges with 416", async () => {
    const response = await get("/assets/app.js", { range: "bytes=50-60" });

    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe("bytes */10");
  });
});

describe("mimeTypeFor", () => {
  it("knows the types the SPA and emulator need", () => {
    expect(mimeTypeFor("a.wasm")).toBe("application/wasm");
    expect(mimeTypeFor("a.WOFF2")).toBe("font/woff2");
    expect(mimeTypeFor("a.unknown")).toBe("application/octet-stream");
  });
});
