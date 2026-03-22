const BASE = '/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = localStorage.getItem('token');
  const isFormData = init?.body instanceof FormData;
  const headers: HeadersInit = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...init?.headers,
  };

  const res = await fetch(`${BASE}${path}`, { ...init, headers });

  if (res.status === 401) {
    const isAuthEndpoint = path.startsWith('/auth/');
    if (!isAuthEndpoint) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    const body = await res.text();
    throw new Error(body || 'Unauthorized');
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || res.statusText);
  }

  if (res.status === 204 || res.status === 202) return undefined as T;
  return res.json();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<T>(path, { method: 'POST', body: form });
  },
};
