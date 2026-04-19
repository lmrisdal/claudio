import { isDesktop } from "../../desktop/hooks/use-desktop";

function getDesktopTransportBase(): string {
  const convertFileSrc = (
    globalThis.window as typeof globalThis.window & {
      __TAURI_INTERNALS__?: { convertFileSrc?: (filePath: string, protocol?: string) => string };
    }
  ).__TAURI_INTERNALS__?.convertFileSrc;

  if (typeof convertFileSrc === "function") {
    try {
      const sample = new URL(convertFileSrc("", "claudio"));
      if (sample.protocol === "http:" || sample.protocol === "https:") {
        return `${sample.protocol}//claudio.api`;
      }
    } catch {
      return "claudio://api";
    }
  }

  return "claudio://api";
}

function getServerBase(): string {
  const serverUrl = localStorage.getItem("claudio_server_url");
  return serverUrl ? `${serverUrl}/api` : "/api";
}

function getServerOrigin(): string {
  const serverUrl = localStorage.getItem("claudio_server_url");
  return serverUrl ?? "";
}

function getApiBase(): string {
  return isDesktop ? getDesktopTransportBase() : getServerBase();
}

export function resolveServerUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  const origin = getServerOrigin();
  if (!origin) {
    return path;
  }

  return path.startsWith("/") ? `${origin}${path}` : `${origin}/${path}`;
}

function getCustomHeaders(): Record<string, string> {
  try {
    const raw = localStorage.getItem("claudio_custom_headers");
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function toHeaderRecord(headers?: HeadersInit): Record<string, string> {
  const normalized: Record<string, string> = {};
  if (!headers) return normalized;
  for (const [key, value] of new Headers(headers).entries()) {
    normalized[key] = value;
  }
  return normalized;
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") {
    return null;
  }

  const cookies = document.cookie.split(";");
  for (const cookie of cookies) {
    const [rawName, ...rest] = cookie.trim().split("=");
    if (rawName === name) {
      return decodeURIComponent(rest.join("="));
    }
  }

  return null;
}

function buildRequestHeaders(
  init: RequestInit | undefined,
  isFormData: boolean,
  isMutation: boolean,
): HeadersInit {
  return {
    ...(isDesktop ? {} : getCustomHeaders()),
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    ...(!isDesktop && isMutation ? { "X-CSRF-TOKEN": readCookie("claudio.csrf") ?? "" } : {}),
    ...toHeaderRecord(init?.headers),
  };
}

function redirectToLogin() {
  globalThis.location.href = "/login";
}

function reportDesktopUnauthorized(path: string, message: string) {
  console.error(`Desktop API unauthorized for ${path}: ${message}`);
}

async function readError(response: Response, fallback: string): Promise<string> {
  const body = await response.text();
  return body || fallback;
}

async function readSuccess<T>(response: Response): Promise<T> {
  if (response.status === 204 || response.status === 202) {
    return undefined as T;
  }

  const contentType = response.headers.get("content-type") ?? "";
  const body = await response.text();

  if (!body.trim()) {
    return undefined as T;
  }

  if (contentType.includes("application/json")) {
    return JSON.parse(body) as T;
  }

  return body as T;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const isFormData = init?.body instanceof FormData;
  const method = init?.method?.toUpperCase() ?? "GET";
  const isMutation = method !== "GET" && method !== "HEAD";
  const headers = buildRequestHeaders(init, isFormData, isMutation);
  const res = await fetch(`${getApiBase()}${path}`, {
    ...init,
    credentials: isDesktop ? undefined : "include",
    headers,
  });

  if (res.status === 401) {
    const isAuthEndpoint = path.startsWith("/auth/");

    if (isDesktop && !isAuthEndpoint) {
      reportDesktopUnauthorized(path, await readError(res.clone(), "Unauthorized"));
      redirectToLogin();
    }

    throw new Error(await readError(res, "Unauthorized"));
  }

  if (!res.ok) {
    throw new Error(await readError(res, res.statusText));
  }

  return readSuccess<T>(res);
}

async function requestBinary(path: string, init?: RequestInit): Promise<ArrayBuffer> {
  const headers = buildRequestHeaders(init, true, false);
  const res = await fetch(`${getApiBase()}${path}`, {
    ...init,
    credentials: isDesktop ? undefined : "include",
    headers,
  });

  if (res.status === 401) {
    if (isDesktop) {
      reportDesktopUnauthorized(path, await readError(res.clone(), "Unauthorized"));
      redirectToLogin();
    }

    throw new Error("Unauthorized");
  }

  if (!res.ok) {
    throw new Error(await readError(res, res.statusText));
  }

  return res.arrayBuffer();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  upload: <T>(path: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<T>(path, { method: "POST", body: form });
  },
  uploadBinary: <T>(path: string, files: Record<string, Blob>, method: "POST" | "PUT" = "POST") => {
    const form = new FormData();
    for (const [name, blob] of Object.entries(files)) {
      form.append(name, blob);
    }
    return request<T>(path, { method, body: form });
  },
  getBinary: (path: string) => requestBinary(path),
};
