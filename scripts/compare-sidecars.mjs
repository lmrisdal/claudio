#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const exe = process.platform === "win32" ? ".exe" : "";

export const ALLOWED = [
  { method: "(binary size)", reason: "Different runtimes produce different binary sizes; reported, not compared." },
];

const requests = [
  ["ping", null],
  ["get_settings", null],
  ["update_settings", { settings: { serverUrl: "http://example.test", logLevel: "WARNING", windowWidth: 800, windowHeight: 600, customHeaders: { Host: "x", "X-A": "b" }, downloadSpeedLimitKbs: 128.5 } }],
  ["get_settings", null],
  ["list_installed_games", null],
  ["get_installed_game", { remoteGameId: 1 }],
  ["list_running_games", null],
  ["has_active_operations", null],
  ["cancel_install", { gameId: 1 }],
  ["restart_install_interactive", { gameId: 1 }],
  ["stop_game", { remoteGameId: 1 }],
  ["launch_game", { remoteGameId: 1 }],
  ["uninstall_game", { remoteGameId: 1, deleteFiles: true }],
  ["open_install_folder", { remoteGameId: 1 }],
  ["list_game_executables", { remoteGameId: 1 }],
  ["set_game_exe", { remoteGameId: 1, gameExe: "a.exe" }],
  ["add_steam_shortcut", { remoteGameId: 1 }],
  ["update_game_launch_settings", { remoteGameId: 1, gameExe: null, protonPath: null, options: { parameters: "" } }],
  ["resolve_install_path", { gameTitle: "A: B/C" }],
  ["resolve_download_path", { gameTitle: "A: B/C" }],
  ["resolve_default_download_root", null],
  ["resolve_install_browse_root", { targetPath: "/nonexistent/x/y" }],
  ["validate_install_target", { targetPath: "  " }],
  ["list_proton_versions", null],
  ["desktop_check_server_connection", { serverUrl: "http://127.0.0.1:1" }],
  ["desktop_check_server_connection", { serverUrl: "http://127.0.0.1:1", path: "health" }],
  ["log", { level: "info", message: "compare" }],
  ["cleanup_failed_install", {}],
  ["download_game_package", { input: { id: 1, title: "T", targetDir: "@TARGET@", extract: false } }],
  ["install_game", { game: { id: 1, title: "T", platform: "windows", installType: "portable" } }],
  ["retry_cached_install", { game: { id: 1, title: "T", platform: "windows", installType: "portable" } }],
  ["no_such_method", null],
];

async function run(binary, label) {
  const home = mkdtempSync(path.join(tmpdir(), `claudio-compare-${label}-`));
  const target = path.join(home, "target");
  mkdirSync(target);
  const started = performance.now();
  const child = spawn(binary, ["--resource-dir", home], {
    env: { ...process.env, XDG_DATA_HOME: home, HOME: home, LOCALAPPDATA: home },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stderr.resume();
  const lines = createInterface({ input: child.stdout });
  const waiting = new Map();
  lines.on("line", (line) => {
    const message = JSON.parse(line);
    waiting.get(message.id)?.(message);
  });
  const results = [];
  let startup = null;
  try {
    for (const [index, [method, params]] of requests.entries()) {
      const id = index + 1;
      const response = new Promise((resolve) => waiting.set(id, resolve));
      const body = JSON.parse(JSON.stringify(params ?? null).replaceAll("@TARGET@", target.replaceAll("\\", "\\\\")));
      child.stdin.write(`${JSON.stringify({ id, method, params: body })}\n`);
      const message = await Promise.race([response, new Promise((resolve) => setTimeout(resolve, 20000, { error: "<timeout>" }))]);
      startup ??= performance.now() - started;
      results.push({ method, params, result: message.result, error: message.error });
    }
  } finally {
    child.kill();
  }
  const files = {};
  for (const name of ["settings.json", "installed-games.json"]) {
    const file = path.join(home, process.platform === "win32" ? "Claudio" : "claudio", name);
    try {
      files[name] = readFileSync(file, "utf8");
    } catch {
      files[name] = null;
    }
  }
  rmSync(home, { recursive: true, force: true });
  return { results, files, home, startup };
}

function sortKeys(value) {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]));
  }
  return value;
}

function normalize(value, home) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? null);
  const replaced = text.replaceAll(home.replaceAll("\\", "\\\\"), "<HOME>").replaceAll(home, "<HOME>");
  try {
    return sortKeys(JSON.parse(replaced));
  } catch {
    return replaced;
  }
}

function describeError(error) {
  return typeof error === "string" ? error.replace(/`(\w+)`:.*/s, "`$1`: …").replace(/^(error sending request for url).*/s, "$1 …") : error;
}

export async function compare(rustBinary, csharpBinary) {
  const rust = await run(rustBinary, "rust");
  const csharp = await run(csharpBinary, "csharp");
  const differences = [];
  for (const [index, left] of rust.results.entries()) {
    const right = csharp.results[index];
    const a = { result: normalize(left.result, rust.home), error: describeError(normalize(left.error, rust.home)) };
    const b = { result: normalize(right.result, csharp.home), error: describeError(normalize(right.error, csharp.home)) };
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      differences.push({ method: left.method, params: left.params, rust: a, csharp: b });
    }
  }
  for (const name of Object.keys(rust.files)) {
    const a = normalize(rust.files[name], rust.home);
    const b = normalize(csharp.files[name], csharp.home);
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      differences.push({ method: `file:${name}`, rust: a, csharp: b });
    }
  }
  return { differences, startup: { rust: rust.startup, csharp: csharp.startup } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rustBinary = process.argv[2] ?? path.join(root, "target", "debug", `claudio-core${exe}`);
  const csharpBinary = process.argv[3] ?? path.join(root, "artifacts", "claudio-core-cs", "publish", `claudio-core${exe}`);
  const { differences, startup } = await compare(rustBinary, csharpBinary);
  const allowed = new Set(ALLOWED.map((entry) => entry.method));
  const unexpected = differences.filter((difference) => !allowed.has(difference.method));
  console.log(`first response: rust ${startup.rust.toFixed(0)} ms, csharp ${startup.csharp.toFixed(0)} ms`);
  for (const difference of unexpected) {
    console.log(`\n${difference.method} ${JSON.stringify(difference.params ?? "")}`);
    console.log(`  rust:   ${JSON.stringify(difference.rust)}`);
    console.log(`  csharp: ${JSON.stringify(difference.csharp)}`);
  }
  console.log(`\n${unexpected.length} difference(s) outside the allow-list`);
  process.exit(unexpected.length === 0 ? 0 : 1);
}
