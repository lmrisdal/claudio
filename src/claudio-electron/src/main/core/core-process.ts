import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { createInterface } from "node:readline";

export type SpawnFn = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

export interface ConfirmParams {
  title: string;
  message: string;
  okLabel: string;
  cancelLabel: string;
}

export interface CoreOptions {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  onEvent: (event: string, payload: unknown) => void;
  onConfirm: (params: ConfirmParams) => Promise<boolean>;
  onStderr: (line: string) => void;
  onFatal: (message: string) => void;
  spawnFn?: SpawnFn;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

const MAX_RESTARTS = 1;

export class CoreError extends Error {}

export class CoreProcess {
  private child: ChildProcess | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private restarts = 0;
  private disposed = false;

  private readonly options: CoreOptions;

  constructor(options: CoreOptions) {
    this.options = options;
  }

  start(): void {
    const spawnFn = this.options.spawnFn ?? spawn;
    const child = spawnFn(this.options.command, this.options.args, {
      env: this.options.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;

    if (child.stdout) {
      createInterface({ input: child.stdout }).on("line", (line) => this.handleLine(line));
    }
    if (child.stderr) {
      createInterface({ input: child.stderr }).on("line", (line) => this.options.onStderr(line));
    }
    child.stdin?.on("error", () => undefined);
    child.on("error", (error) => this.handleExit(child, `claudio-core failed: ${error.message}`));
    child.on("exit", (code, signal) =>
      this.handleExit(child, `claudio-core exited unexpectedly (${signal ?? code}).`),
    );
  }

  invoke(method: string, params?: unknown): Promise<unknown> {
    const stdin = this.child?.stdin;
    if (this.disposed || !stdin || stdin.destroyed || !stdin.writable) {
      return Promise.reject(new CoreError("claudio-core is not running."));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      stdin.write(`${JSON.stringify({ id, method, params: params ?? null })}\n`);
    });
  }

  dispose(): void {
    this.disposed = true;
    this.rejectAll("claudio-core is shutting down.");
    this.child?.stdin?.end();
  }

  private handleLine(line: string): void {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    } catch {
      this.options.onStderr(`unparseable core output: ${line}`);
      return;
    }

    if (typeof message.event === "string") {
      this.options.onEvent(message.event, message.payload);
    } else if (message.request === "confirm") {
      void this.answerConfirm(message.id, message.params as ConfirmParams);
    } else if (typeof message.id === "number") {
      this.settle(message.id, message);
    }
  }

  private settle(id: number, message: Record<string, unknown>): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    if (typeof message.error === "string") {
      pending.reject(new CoreError(message.error));
    } else {
      pending.resolve(message.result ?? null);
    }
  }

  private async answerConfirm(id: unknown, params: ConfirmParams): Promise<void> {
    const answer = await this.options.onConfirm(params).catch(() => false);
    this.child?.stdin?.write(`${JSON.stringify({ id, result: answer })}\n`);
  }

  private handleExit(child: ChildProcess, message: string): void {
    if (this.child !== child || this.disposed) return;
    this.child = null;
    this.rejectAll(message);
    if (this.restarts < MAX_RESTARTS) {
      this.restarts += 1;
      this.start();
      return;
    }
    this.options.onFatal(message);
  }

  private rejectAll(message: string): void {
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const entry of pending) entry.reject(new CoreError(message));
  }
}
