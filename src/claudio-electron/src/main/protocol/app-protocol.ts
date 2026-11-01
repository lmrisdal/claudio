import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

export function mimeTypeFor(file: string): string {
  return MIME_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

export type Resolution = { kind: "file"; file: string } | { kind: "missing" } | { kind: "denied" };

export async function resolveAppFile(root: string, pathname: string): Promise<Resolution> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return { kind: "denied" };
  }
  if (decoded.includes("\0")) return { kind: "denied" };

  const resolvedRoot = path.resolve(root);
  const candidate = path.resolve(resolvedRoot, `.${path.posix.normalize(`/${decoded}`)}`);
  if (candidate !== resolvedRoot && !candidate.startsWith(resolvedRoot + path.sep)) {
    return { kind: "denied" };
  }

  const info = await stat(candidate).catch(() => null);
  if (info?.isFile()) return { kind: "file", file: candidate };
  if (info?.isDirectory()) {
    const index = path.join(candidate, "index.html");
    if ((await stat(index).catch(() => null))?.isFile()) return { kind: "file", file: index };
  }
  if (path.extname(decoded)) return { kind: "missing" };
  return { kind: "file", file: path.join(resolvedRoot, "index.html") };
}

function parseRange(header: string | null, size: number): { start: number; end: number } | null {
  const match = header ? /^bytes=(\d*)-(\d*)$/.exec(header) : null;
  if (!match || (!match[1] && !match[2])) return null;
  if (!match[1]) {
    const suffix = Number(match[2]);
    return { start: Math.max(size - suffix, 0), end: size - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  return start <= end && start < size ? { start, end } : null;
}

export function createAppHandler(root: string) {
  return async function handleAppRequest(request: Request): Promise<Response> {
    const resolution = await resolveAppFile(root, new URL(request.url).pathname);
    if (resolution.kind === "denied") return new Response("Forbidden", { status: 403 });
    if (resolution.kind === "missing") return new Response("Not found", { status: 404 });

    const { size } = await stat(resolution.file);
    const headers = new Headers({
      "content-type": mimeTypeFor(resolution.file),
      "accept-ranges": "bytes",
    });
    const rangeHeader = request.headers.get("range");
    const range = parseRange(rangeHeader, size);

    if (rangeHeader && !range) {
      headers.set("content-range", `bytes */${size}`);
      return new Response(null, { status: 416, headers });
    }
    if (range) {
      headers.set("content-range", `bytes ${range.start}-${range.end}/${size}`);
      headers.set("content-length", String(range.end - range.start + 1));
      return new Response(streamOf(resolution.file, range.start, range.end), {
        status: 206,
        headers,
      });
    }
    headers.set("content-length", String(size));
    return new Response(streamOf(resolution.file), { headers });
  };
}

function streamOf(file: string, start?: number, end?: number): ReadableStream {
  return Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream;
}
