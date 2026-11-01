// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { api } from "./client";

function stubResponse(body: string, contentType: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(body, { headers: { "content-type": contentType } })),
  );
}

describe("api client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects an HTML page answered with a success status", async () => {
    stubResponse("<!DOCTYPE html><title>404: Not Found</title>", "text/html");

    await expect(api.get("/admin/tasks/status")).rejects.toThrow("unexpected response");
  });

  it("parses JSON responses", async () => {
    stubResponse('{"ok":true}', "application/json");

    await expect(api.get("/health")).resolves.toEqual({ ok: true });
  });
});
