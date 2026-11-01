import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  buildResponseHeaders,
  buildTargetUrl,
  buildUpstreamHeaders,
  createApiHandler,
  isForbiddenCustomHeader,
  type FetchFn,
  type ProxySettings,
} from "../src/main/protocol/api-proxy";

const nodeFetch: FetchFn = (input, init) => fetch(input, init);
const settings = (overrides: Partial<ProxySettings> = {}): ProxySettings => ({
  serverUrl: "http://upstream.test",
  customHeaders: {},
  ...overrides,
});
const apiRequest = (path: string, init: RequestInit = {}) =>
  new Request(`claudio://api${path}`, init);

describe("buildTargetUrl", () => {
  it("maps claudio://api/<path> onto the server's /api prefix, keeping the query", () => {
    expect(buildTargetUrl("http://s:8080", "claudio://api/games?page=2")).toBe(
      "http://s:8080/api/games?page=2",
    );
  });

  it("rejects any other host", () => {
    expect(buildTargetUrl("http://s", "claudio://other/games")).toBeNull();
  });
});

describe("header handling", () => {
  it("drops the browser-only request headers and keeps the rest", () => {
    const headers = buildUpstreamHeaders(
      new Headers({
        authorization: "Bearer x",
        origin: "claudio-app://app",
        referer: "claudio-app://app/",
        host: "api",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
        "content-type": "application/json",
        "x-trace": "1",
      }),
      {},
    );

    expect([...headers.keys()].sort()).toEqual(["content-type", "x-trace"]);
  });

  it("adds custom headers except the forbidden ones", () => {
    const headers = buildUpstreamHeaders(new Headers(), {
      "CF-Access-Client-Id": "id",
      Host: "evil",
      "Transfer-Encoding": "chunked",
    });

    expect(headers.get("cf-access-client-id")).toBe("id");
    expect(headers.has("host")).toBe(false);
    expect(headers.has("transfer-encoding")).toBe(false);
  });

  it("matches the forbidden custom header list case-insensitively", () => {
    expect(isForbiddenCustomHeader(" Keep-Alive ")).toBe(true);
    expect(isForbiddenCustomHeader("x-custom")).toBe(false);
  });

  it("replaces upstream CORS headers with the request's own origin", () => {
    const request = apiRequest("/x", {
      headers: { origin: "claudio-app://app", "access-control-request-headers": "x-a" },
    });

    const headers = buildResponseHeaders(
      new Headers({ "access-control-allow-origin": "https://other", "x-keep": "1" }),
      request,
    );

    expect(headers.get("access-control-allow-origin")).toBe("claudio-app://app");
    expect(headers.get("access-control-allow-headers")).toBe("x-a");
    expect(headers.get("access-control-allow-methods")).toBe("GET, POST, PUT, DELETE, OPTIONS");
    expect(headers.get("x-keep")).toBe("1");
  });
});

describe("createApiHandler", () => {
  let server: Server | null = null;
  afterEach(() => {
    server?.closeAllConnections();
    server?.close();
    server = null;
  });

  async function listen(
    handler: (
      req: IncomingMessage,
      body: Buffer,
    ) => { status?: number; headers?: Record<string, string>; body?: string },
  ) {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const reply = handler(req, Buffer.concat(chunks));
        res.writeHead(reply.status ?? 200, reply.headers);
        res.end(reply.body ?? "");
      });
    });
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  function handlerFor(
    serverUrl: string | null,
    extra: Partial<Parameters<typeof createApiHandler>[0]> = {},
  ) {
    const log = vi.fn();
    const handler = createApiHandler({
      getSettings: () => settings({ serverUrl }),
      fetchImpl: nodeFetch,
      log,
      ...extra,
    });
    return { handler, log };
  }

  it("answers preflight requests locally with 204 and CORS headers", async () => {
    const fetchImpl = vi.fn();
    const { handler } = handlerFor("http://x", { fetchImpl });

    const response = await handler(
      apiRequest("/x", { method: "OPTIONS", headers: { origin: "claudio-app://app" } }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("claudio-app://app");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns 502 text/plain when no server is configured", async () => {
    const { handler } = handlerFor(null);

    const response = await handler(apiRequest("/x"));

    expect(response.status).toBe(502);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await response.text()).toBe("Desktop server URL is not configured.");
  });

  it("returns 502 for unsupported hosts", async () => {
    const { handler } = handlerFor("http://x");

    const response = await handler(new Request("claudio://elsewhere/x"));

    expect(await response.text()).toBe("Unsupported desktop URI target.");
  });

  it("forwards method, path, custom headers and bodies, and relays status and body", async () => {
    const seen: { url?: string; headers?: IncomingMessage["headers"]; body?: string } = {};
    const url = await listen((req, body) => {
      Object.assign(seen, { url: req.url, headers: req.headers, body: body.toString() });
      return {
        status: 201,
        headers: { "x-up": "1", "access-control-allow-origin": "https://evil" },
        body: "made",
      };
    });
    const handler = createApiHandler({
      getSettings: () => settings({ serverUrl: `${url}/`, customHeaders: { "X-Tenant": "t1" } }),
      fetchImpl: nodeFetch,
      log: vi.fn(),
    });

    const response = await handler(
      apiRequest("/games?x=1", {
        method: "POST",
        body: JSON.stringify({ a: 1 }),
        headers: {
          "content-type": "application/json",
          authorization: "Bearer drop-me",
          origin: "claudio-app://app",
        },
      }),
    );

    expect(response.status).toBe(201);
    expect(await response.text()).toBe("made");
    expect(response.headers.get("x-up")).toBe("1");
    expect(response.headers.get("access-control-allow-origin")).toBe("claudio-app://app");
    expect(seen.url).toBe("/api/games?x=1");
    expect(seen.body).toBe('{"a":1}');
    expect(seen.headers?.["x-tenant"]).toBe("t1");
    expect(seen.headers?.authorization).toBeUndefined();
  });

  it("uploads multipart FormData bodies intact", async () => {
    let contentType = "";
    let received = 0;
    const url = await listen((req, body) => {
      contentType = req.headers["content-type"] ?? "";
      received = body.length;
      return {};
    });
    const { handler } = handlerFor(url);
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(2_000_000)]), "big.bin");

    const response = await handler(apiRequest("/upload", { method: "POST", body: form }));

    expect(response.status).toBe(200);
    expect(contentType).toMatch(/^multipart\/form-data; boundary=/);
    expect(received).toBeGreaterThan(2_000_000);
  });

  it("streams the response body instead of buffering it", async () => {
    const encoder = new TextEncoder();
    let finish: () => void = () => undefined;
    const upstreamBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("first"));
        finish = () => {
          controller.enqueue(encoder.encode("second"));
          controller.close();
        };
      },
    });
    const { handler } = handlerFor("http://x", {
      fetchImpl: async () => new Response(upstreamBody),
    });

    const response = await handler(apiRequest("/stream"));
    const reader = response.body?.getReader();
    const first = await reader?.read();

    expect(new TextDecoder().decode(first?.value)).toBe("first");
    finish();
    const second = await reader?.read();
    expect(new TextDecoder().decode(second?.value)).toBe("second");
  });

  it("times out only while connecting, not while the body is still arriving", async () => {
    const url = await listen(() => ({ body: "ok" }));
    const slowBodyFetch: FetchFn = async (input, init) => {
      const upstream = await fetch(input, init);
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          await new Promise((resolve) => setTimeout(resolve, 120));
          controller.enqueue(new TextEncoder().encode("late body"));
          controller.close();
        },
      });
      return new Response(body, { status: upstream.status });
    };
    const { handler } = handlerFor(url, { fetchImpl: slowBodyFetch, connectTimeoutMs: 40 });

    const response = await handler(apiRequest("/slow"));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("late body");
  });

  it("returns 502 when the server does not answer within the connect timeout", async () => {
    const hangingFetch: FetchFn = (_input, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    const { handler, log } = handlerFor("http://silent.test", {
      fetchImpl: hangingFetch,
      connectTimeoutMs: 30,
    });

    const response = await handler(apiRequest("/x"));

    expect(response.status).toBe(502);
    expect(await response.text()).toBe("Timed out connecting to http://silent.test.");
    expect(log).toHaveBeenCalledWith("warn", expect.stringContaining("failed"));
  });

  it("returns 502 with the error text when the connection fails", async () => {
    const { handler } = handlerFor("http://127.0.0.1:1");

    const response = await handler(apiRequest("/x"));

    expect(response.status).toBe(502);
    expect(await response.text()).toContain("fetch failed");
  });

  it.each([
    [526, "warn", "origin TLS/certificate issue"],
    [503, "warn", "503"],
    [404, "info", "404"],
    [200, "debug", "200"],
  ] as const)("logs a %i response at %s level", async (status, level, text) => {
    const { handler, log } = handlerFor("http://x", {
      fetchImpl: async () => new Response("", { status }),
    });

    await handler(apiRequest("/x"));

    expect(log).toHaveBeenCalledWith(level, expect.stringContaining(text));
  });

  it("follows settings changes without being recreated", async () => {
    let current: ProxySettings | null = settings({ serverUrl: null });
    const handler = createApiHandler({
      getSettings: () => current,
      fetchImpl: async (input) => new Response(input),
      log: vi.fn(),
    });

    const before = await handler(apiRequest("/x"));
    current = settings({ serverUrl: "http://later.test" });
    const after = await handler(apiRequest("/x"));

    expect(before.status).toBe(502);
    expect(await after.text()).toBe("http://later.test/api/x");
  });
});
