#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const VERSION = "26.05";
export const BASE_URL = `https://github.com/ip7z/7zip/releases/download/${VERSION}`;
export const FILES = {
  linux: { name: "7z2605-linux-x64.tar.xz", sha256: "22cf82fcc6eb7474f1d5bb4f02c0f8ebd573a718089d6833dc30f8350a3b232e" },
  windowsExtra: { name: "7z2605-extra.7z", sha256: "f27a8f103c84785026edcba1f67faf1357225df9d19ddb0b7760d55947141bc7" },
  windowsBootstrap: { name: "7zr.exe", sha256: "9bf582b894dfa665f852d7e9112b02290a1c303c2d95a21fcdc41ffcb03143b7" },
  source: { name: "7z2605-src.tar.xz", sha256: "0b6080b8c3e7a579161d2d495224c0e51c467576cb4c7048b0ab485ef44cc22e" },
};

export function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export async function download(file, directory, fetchImpl = fetch) {
  const response = await fetchImpl(`${BASE_URL}/${file.name}`);
  if (!response.ok) {
    throw new Error(`Failed to download ${file.name}: HTTP ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = sha256(bytes);
  if (actual !== file.sha256) {
    throw new Error(`SHA-256 mismatch for ${file.name}: expected ${file.sha256}, got ${actual}`);
  }
  const target = path.join(directory, file.name);
  writeFileSync(target, bytes);
  return target;
}

export async function fetchSevenZip({ platform, output, withSource = false, fetchImpl = fetch }) {
  const work = mkdtempSync(path.join(tmpdir(), "claudio-7zip-"));
  try {
    mkdirSync(output, { recursive: true });
    if (platform === "linux") {
      const archive = await download(FILES.linux, work, fetchImpl);
      const extracted = path.join(work, "linux");
      mkdirSync(extracted);
      execFileSync("tar", ["-xf", archive, "-C", extracted]);
      copyFileSync(path.join(extracted, "7zzs"), path.join(output, "7zzs"));
      execFileSync("chmod", ["755", path.join(output, "7zzs")]);
      copyFileSync(path.join(extracted, "License.txt"), path.join(output, "License.txt"));
    } else if (platform === "win32") {
      const extra = await download(FILES.windowsExtra, work, fetchImpl);
      const bootstrap = await download(FILES.windowsBootstrap, work, fetchImpl);
      const extracted = path.join(work, "windows");
      execFileSync(bootstrap, ["x", `-o${extracted}`, "-y", extra]);
      copyFileSync(path.join(extracted, "x64", "7za.exe"), path.join(output, "7za.exe"));
      copyFileSync(path.join(extracted, "License.txt"), path.join(output, "License.txt"));
    } else {
      throw new Error(`Unsupported platform ${platform}`);
    }
    if (withSource) {
      await download(FILES.source, output, fetchImpl);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const platform = process.argv[2] ?? process.platform;
  const output = path.resolve(process.argv[3] ?? "7-zip");
  const withSource = process.argv.includes("--with-source");
  fetchSevenZip({ platform, output, withSource }).then(
    () => console.log(`7-Zip ${VERSION} for ${platform} written to ${output}`),
    (error) => {
      console.error(error.message);
      process.exit(1);
    },
  );
}

