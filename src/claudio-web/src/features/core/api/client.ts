import { isDesktop } from "../../desktop/hooks/use-desktop";

function getDesktopTransportBase(target: "api" | "connect"): string {
  const convertFileSrc = (
    globalThis.window as typeof globalThis.window & {
      __TAURI_INTERNALS__?: { convertFileSrc?: (filePath: string, protocol?: string) => string };
    }
  ).__TAURI_INTERNALS__?.convertFileSrc;

  if (typeof convertFileSrc === "function") {
    try {
      const sample = new URL(convertFileSrc("", "claudio"));
      if (sample.protocol === "http:" || sample.protocol === "https:") {
        return `${sample.protocol}//claudio.${target}`;
      }
    } catch {
      // Fall back to the direct custom protocol form used on macOS and Linux.
    }
  }

  return `claudio://${target}`;
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
  return isDesktop ? getDesktopTransportBase("api") : getServerBase();
}

function getConnectBase(): string {
  return isDesktop ? getDesktopTransportBase("connect") : `${getServerOrigin()}/connect`;
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

function buildRequestHeaders(init: RequestInit | undefined, isFormData: boolean): HeadersInit {
  const token = isDesktop ? null : localStorage.getItem("token");

  return {
    ...(isDesktop ? {} : getCustomHeaders()),
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...toHeaderRecord(init?.headers),
  };
}

async function tryRefreshToken(): Promise<string | null> {
  if (isDesktop) return null;

  const refreshToken = localStorage.getItem("refresh_token");
  if (!refreshToken) return null;

  try {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: "claudio-spa",
    });
    const res = await fetch(`${getConnectBase()}/token`, {
      method: "POST",
      headers: {
        ...getCustomHeaders(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
    if (!res.ok) return null;

    const data = await res.json();
    const newToken: string = data.access_token;
    localStorage.setItem("token", newToken);
    if (data.refresh_token) {
      localStorage.setItem("refresh_token", data.refresh_token);
    }
    return newToken;
  } catch {
    return null;
  }
}

function redirectToLogin() {
  globalThis.location.href = "/login";
}

function reportDesktopUnauthorized(path: string, message: string) {
  console.error(`Desktop API unauthorized for ${path}: ${message}`);
}

function clearWebAuthState() {
  localStorage.removeItem("token");
  localStorage.removeItem("refresh_token");
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
  const headers = buildRequestHeaders(init, isFormData);
  const res = await fetch(`${getApiBase()}${path}`, { ...init, headers });

  if (res.status === 401) {
    const isAuthEndpoint = path.startsWith("/auth/");
    if (!isDesktop && !isAuthEndpoint) {
      const newToken = await tryRefreshToken();
      if (newToken) {
        const retryHeaders: HeadersInit = {
          ...(isFormData ? {} : { "Content-Type": "application/json" }),
          Authorization: `Bearer ${newToken}`,
          ...toHeaderRecord(init?.headers),
        };
        const retryRes = await fetch(`${getApiBase()}${path}`, { ...init, headers: retryHeaders });
        if (retryRes.ok) {
          return readSuccess<T>(retryRes);
        }
      }

      clearWebAuthState();
      redirectToLogin();
    }

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
  const headers = buildRequestHeaders(init, true);
  const res = await fetch(`${getApiBase()}${path}`, { ...init, headers });

  if (res.status === 401) {
    if (!isDesktop) {
      const newToken = await tryRefreshToken();
      if (newToken) {
        const retryHeaders: HeadersInit = {
          Authorization: `Bearer ${newToken}`,
          ...toHeaderRecord(init?.headers),
        };
        const retryRes = await fetch(`${getApiBase()}${path}`, { ...init, headers: retryHeaders });
        if (retryRes.ok) return retryRes.arrayBuffer();
      }

      clearWebAuthState();
    }

    if (isDesktop) {
      reportDesktopUnauthorized(path, await readError(res.clone(), "Unauthorized"));
    }

    redirectToLogin();
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
