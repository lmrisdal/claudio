const BASE = "/api";

async function tryRefreshToken(): Promise<string | null> {
  const refreshToken = localStorage.getItem("refresh_token");
  if (!refreshToken) return null;
  try {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: "claudio-spa",
    });
    const res = await fetch("/connect/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const newToken: string = data.access_token;
    localStorage.setItem("token", newToken);
    if (data.refresh_token)
      localStorage.setItem("refresh_token", data.refresh_token);
    return newToken;
  } catch {
    return null;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = localStorage.getItem("token");
  const isFormData = init?.body instanceof FormData;
  const headers: HeadersInit = {
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...init?.headers,
  };

  const res = await fetch(`${BASE}${path}`, { ...init, headers });

  if (res.status === 401) {
    const isAuthEndpoint = path.startsWith("/auth/");
    if (!isAuthEndpoint) {
      // Attempt silent token refresh before giving up
      const newToken = await tryRefreshToken();
      if (newToken) {
        const retryHeaders: HeadersInit = {
          ...(isFormData ? {} : { "Content-Type": "application/json" }),
          Authorization: `Bearer ${newToken}`,
          ...init?.headers,
        };
        const retryRes = await fetch(`${BASE}${path}`, {
          ...init,
          headers: retryHeaders,
        });
        if (retryRes.ok) {
          if (retryRes.status === 204 || retryRes.status === 202)
            return undefined as T;
          return retryRes.json();
        }
      }
      localStorage.removeItem("token");
      localStorage.removeItem("refresh_token");
      window.location.href = "/login";
    }
    const body = await res.text();
    throw new Error(body || "Unauthorized");
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || res.statusText);
  }

  if (res.status === 204 || res.status === 202) return undefined as T;
  return res.json();
}

async function requestBinary(path: string, init?: RequestInit): Promise<ArrayBuffer> {
  const token = localStorage.getItem("token");
  const headers: HeadersInit = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...init?.headers,
  };

  const res = await fetch(`${BASE}${path}`, { ...init, headers });

  if (res.status === 401) {
    const newToken = await tryRefreshToken();
    if (newToken) {
      const retryHeaders: HeadersInit = {
        Authorization: `Bearer ${newToken}`,
        ...init?.headers,
      };
      const retryRes = await fetch(`${BASE}${path}`, { ...init, headers: retryHeaders });
      if (retryRes.ok) return retryRes.arrayBuffer();
    }
    localStorage.removeItem("token");
    localStorage.removeItem("refresh_token");
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || res.statusText);
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
