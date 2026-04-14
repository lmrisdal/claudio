// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { api } from "./client";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("api client", () => {
  it("treats an empty 200 response body as success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(null, { status: 200, headers: { "content-type": "application/json" } }),
      ),
    );

    await expect(
      api.post("/auth/register", { username: "alice", password: "password123" }),
    ).resolves.toBeUndefined();
  });

  it("still parses JSON success responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ ok: true })),
    );

    await expect(api.get<{ ok: boolean }>("/status")).resolves.toEqual({ ok: true });
  });
});
