import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..", "..");
const executable = process.platform === "win32" ? "claudio-core.exe" : "claudio-core";

export const coreBinary = process.env.CLAUDIO_CORE_PATH
  ? path.resolve(process.env.CLAUDIO_CORE_PATH)
  : path.join(repoRoot, "target", "debug", executable);

export const coreAvailable = existsSync(coreBinary);
// Rust resolves the Windows data folder through the shell API and has no override, so contract
// suites that need an isolated data directory only run against the C# core there.
export const coreKind: "rust" | "csharp" = coreBinary.includes("claudio-core-cs")
  ? "csharp"
  : "rust";

export const contractAvailable =
  coreAvailable && (process.platform !== "win32" || coreKind === "csharp");

export interface Response {
  id?: unknown;
  result?: unknown;
  error?: string;
  [key: string]: unknown;
}

export class CoreHarness {
  readonly dataHome: string;
  readonly dataDir: string;
  readonly stdoutLines: string[] = [];
  readonly events: { event: string; payload: Record<string, unknown> }[] = [];
  readonly resourceDir: string;
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly waiting = new Map<string, (message: Response) => void>();
  private readonly exited: Promise<number | null>;
  private nextId = 1;

  constructor(extraEnv: NodeJS.ProcessEnv = {}, wrapper: string[] = []) {
    this.dataHome = mkdtempSync(path.join(tmpdir(), "claudio-contract-"));
    this.dataDir = path.join(this.dataHome, process.platform === "win32" ? "Claudio" : "claudio");
    mkdirSync(this.dataDir, { recursive: true });
    this.resourceDir = mkdtempSync(path.join(tmpdir(), "claudio-resources-"));
    this.child = spawn(
      wrapper[0] ?? coreBinary,
      [
        ...wrapper.slice(1),
        ...(wrapper.length > 0 ? [coreBinary] : []),
        "--resource-dir",
        this.resourceDir,
      ],
      {
        env: {
          ...process.env,
          XDG_DATA_HOME: this.dataHome,
          LOCALAPPDATA: this.dataHome,
          ...(process.platform === "win32" ? { CLAUDIO_DATA_DIR: this.dataDir } : {}),
          ...extraEnv,
        },
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    createInterface({ input: this.child.stdout }).on("line", (line) => this.onLine(line));
    this.child.stderr.resume();
    this.child.stdin.on("error", () => undefined);
    this.exited = new Promise((resolve) => this.child.on("exit", (code) => resolve(code)));
  }

  private onLine(line: string): void {
    this.stdoutLines.push(line);
    const message = JSON.parse(line) as Response;
    if (typeof message.event === "string") {
      this.events.push({
        event: message.event,
        payload: message.payload as Record<string, unknown>,
      });
      return;
    }
    const key = JSON.stringify(message.id);
    const resolve = this.waiting.get(key);
    if (resolve) {
      this.waiting.delete(key);
      resolve(message);
    }
  }

  sendRaw(text: string): void {
    this.child.stdin.write(text);
  }

  get pid(): number | undefined {
    return this.child.pid;
  }

  request(method: string, params?: unknown, id: unknown = this.nextId++): Promise<Response> {
    return new Promise((resolve) => {
      this.waiting.set(JSON.stringify(id), resolve);
      const message: Record<string, unknown> = { id, method };
      if (params !== undefined) {
        message.params = params;
      }
      this.child.stdin.write(`${JSON.stringify(message)}\n`);
    });
  }

  async call(method: string, params?: unknown): Promise<unknown> {
    const response = await this.request(method, params);
    if (response.error !== undefined) {
      throw new Error(response.error);
    }
    return response.result;
  }

  sevenZipDir(binary: string): void {
    const dir = path.join(this.resourceDir, "7-zip");
    mkdirSync(dir, { recursive: true });
    symlinkSync(binary, path.join(dir, "7zzs"));
  }

  writeData(name: string, contents: string): void {
    writeFileSync(path.join(this.dataDir, name), contents);
  }

  async closeStdinAndWait(timeoutMs = 5000): Promise<boolean> {
    this.child.stdin.end();
    const timeout = new Promise<"timeout">((resolve) => setTimeout(resolve, timeoutMs, "timeout"));
    return (await Promise.race([this.exited, timeout])) !== "timeout";
  }

  dispose(): void {
    this.child.kill();
    rmSync(this.dataHome, { recursive: true, force: true });
    rmSync(this.resourceDir, { recursive: true, force: true });
  }
}
