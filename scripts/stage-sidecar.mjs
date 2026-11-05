#!/usr/bin/env node
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const stageDirectory = path.join(root, "src", "claudio-electron", "sidecar");

export function plan(kind, platform, options = {}) {
  const exe = platform === "win32" ? ".exe" : "";
  const publishDir = options.csharpDir ?? path.join(root, "artifacts", "claudio-core", "publish");
  const uninstallerDir = options.uninstallerDir ?? path.join(root, "artifacts", "claudio-uninstaller", "publish");
  const sevenZipDir = options.sevenZipDir ?? path.join(root, "artifacts", "7-zip");

  if (kind === "csharp") {
    const files = [
      { from: path.join(publishDir, `claudio-core${exe}`), to: `claudio-core${exe}`, executable: true },
      { from: path.join(root, "THIRD-PARTY-NOTICES.md"), to: "THIRD-PARTY-NOTICES.md" },
    ];
    if (platform === "win32") {
      files.push({ from: path.join(uninstallerDir, "claudio-game-uninstaller.exe"), to: "claudio-game-uninstaller.exe" });
    }
    return { files, directories: [{ from: sevenZipDir, to: "7-zip" }] };
  }

  throw new Error(`Unknown sidecar '${kind}'. Use csharp.`);
}

export function stage(kind, platform = process.platform, options = {}) {
  const output = options.output ?? stageDirectory;
  const { files, directories } = plan(kind, platform, options);
  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });
  for (const file of files) {
    if (!existsSync(file.from)) {
      throw new Error(`Missing ${file.from}. Build the ${kind} sidecar first.`);
    }
    const target = path.join(output, file.to);
    copyFileSync(file.from, target);
    if (file.executable && platform !== "win32") {
      chmodSync(target, 0o755);
    }
  }
  for (const directory of directories) {
    if (!existsSync(directory.from)) {
      throw new Error(`Missing ${directory.from}. Run scripts/fetch-7zip.mjs first.`);
    }
    cpSync(directory.from, path.join(output, directory.to), {
      recursive: true,
      filter: (source) => !source.endsWith(".tar.xz"),
    });
  }
  return files.map((file) => file.to);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const staged = stage(process.argv[2] ?? "csharp");
    console.log(`Staged ${process.argv[2] ?? "csharp"} sidecar: ${staged.join(", ")}`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
