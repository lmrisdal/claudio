const forbiddenHeaderNames = new Set([
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

export function isForbiddenDesktopHeader(name: string): boolean {
  return forbiddenHeaderNames.has(name.trim().toLowerCase());
}

export function buildDesktopCustomHeaders(headers: Array<{ name: string; value: string }>): {
  customHeaders: Record<string, string>;
  forbiddenHeaders: string[];
} {
  const customHeaders: Record<string, string> = {};
  const forbiddenHeaders: string[] = [];

  for (const header of headers) {
    const name = header.name.trim();
    const value = header.value.trim();
    if (!name || !value) {
      continue;
    }

    if (isForbiddenDesktopHeader(name)) {
      forbiddenHeaders.push(name);
      continue;
    }

    customHeaders[name] = value;
  }

  return {
    customHeaders,
    forbiddenHeaders: [...new Set(forbiddenHeaders)],
  };
}
