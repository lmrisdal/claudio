export interface ProxySettings {
  serverUrl: string | null;
  customHeaders: Record<string, string>;
}

export type FetchFn = (input: string, init: RequestInit & { duplex?: "half" }) => Promise<Response>;
export type LogFn = (level: "debug" | "info" | "warn", message: string) => void;

export const CONNECT_TIMEOUT_MS = 3000;

const SKIPPED_REQUEST_HEADERS = new Set([
  "authorization",
  "host",
  "origin",
  "referer",
  "content-length",
  "access-control-request-method",
  "access-control-request-headers",
]);

const FORBIDDEN_CUSTOM_HEADERS = new Set([
  "host",
  "content-length",
  "connection",
  "transfer-encoding",
  "upgrade",
  "te",
  "trailer",
  "keep-alive",
  "proxy-connection",
]);

const BODYLESS_METHODS = new Set(["GET", "HEAD"]);

export function isForbiddenCustomHeader(name: string): boolean {
  return FORBIDDEN_CUSTOM_HEADERS.has(name.trim().toLowerCase());
}

export function buildTargetUrl(origin: string, requestUrl: string): string | null {
  const url = new URL(requestUrl);
  if (url.hostname !== "api") return null;
  return `${origin}/api${url.pathname}${url.search}`;
}

export function buildUpstreamHeaders(
  requestHeaders: Headers,
  customHeaders: Record<string, string>,
): Headers {
  const headers = new Headers();
  for (const [name, value] of requestHeaders) {
    if (!SKIPPED_REQUEST_HEADERS.has(name.toLowerCase())) headers.set(name, value);
  }
  for (const [name, value] of Object.entries(customHeaders)) {
    if (!isForbiddenCustomHeader(name)) headers.set(name, value);
  }
  return headers;
}

export function buildResponseHeaders(upstream: Headers, request: Request): Headers {
  const headers = new Headers();
  for (const [name, value] of upstream) {
    if (!name.toLowerCase().startsWith("access-control-")) headers.set(name, value);
  }
  return withCors(headers, request);
}

export function withCors(headers: Headers, request: Request): Headers {
  headers.set("access-control-allow-origin", request.headers.get("origin") ?? "*");
  headers.set("access-control-allow-methods", "GET, POST, PUT, DELETE, OPTIONS");
  headers.set(
    "access-control-allow-headers",
    request.headers.get("access-control-request-headers") ?? "content-type",
  );
  headers.set("access-control-expose-headers", "*");
  return headers;
}

function logProxyResponse(log: LogFn, target: string, status: number): void {
  if (status === 526) {
    log(
      "warn",
      `desktop proxy response ${target} ${status} (origin TLS/certificate issue while using upstream proxy)`,
    );
  } else if (status >= 500) {
    log("warn", `desktop proxy response ${target} ${status}`);
  } else if (status >= 400) {
    log("info", `desktop proxy response ${target} ${status}`);
  } else {
    log("debug", `desktop proxy response ${target} ${status}`);
  }
}

function plainTextError(message: string, request: Request, status = 502): Response {
  const headers = withCors(new Headers({ "content-type": "text/plain; charset=utf-8" }), request);
  return new Response(message, { status, headers });
}

export interface ApiProxyOptions {
  getSettings: () => ProxySettings | null;
  fetchImpl: FetchFn;
  log: LogFn;
  connectTimeoutMs?: number;
}

export function createApiHandler(options: ApiProxyOptions) {
  return async function handleApiRequest(request: Request): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: withCors(new Headers(), request) });
    }

    const settings = options.getSettings();
    const origin = settings?.serverUrl?.trim().replace(/\/+$/, "");
    if (!settings || !origin) {
      return plainTextError("Desktop server URL is not configured.", request);
    }

    const target = buildTargetUrl(origin, request.url);
    if (!target) return plainTextError("Unsupported desktop URI target.", request);

    options.log("debug", `desktop proxy ${request.method} ${target}`);
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS,
    );
    try {
      const upstream = await options.fetchImpl(target, {
        method: request.method,
        headers: buildUpstreamHeaders(request.headers, settings.customHeaders),
        body: BODYLESS_METHODS.has(request.method) ? undefined : request.body,
        duplex: "half",
        cache: "no-store",
        signal: controller.signal,
      });
      clearTimeout(timer);
      logProxyResponse(options.log, target, upstream.status);
      return new Response(upstream.body, {
        status: upstream.status,
        headers: buildResponseHeaders(upstream.headers, request),
      });
    } catch (error) {
      clearTimeout(timer);
      const message = controller.signal.aborted
        ? `Timed out connecting to ${origin}.`
        : describeFetchError(error);
      options.log("warn", `desktop proxy request to ${target} failed: ${message}`);
      return plainTextError(message, request);
    }
  };
}

function describeFetchError(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause instanceof Error ? `: ${error.cause.message}` : "";
    return `${error.message}${cause}`;
  }
  return String(error);
}
