import { getBridge } from "./desktop-bridge";

type Level = "error" | "warn" | "info" | "debug";

const FORWARDED_CONSOLE_METHODS: Level[] = ["error", "warn"];

function formatArgument(value: unknown): string {
  if (value instanceof Error) return value.stack ?? value.message;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function forward(level: Level, values: unknown[]): void {
  try {
    getBridge().log(level, values.map((value) => formatArgument(value)).join(" "));
  } catch {
    return;
  }
}

export function forwardRendererLogs(): void {
  for (const level of FORWARDED_CONSOLE_METHODS) {
    const original = console[level].bind(console);
    console[level] = (...values: unknown[]) => {
      original(...values);
      forward(level, values);
    };
  }
  globalThis.addEventListener("error", (event) => {
    forward("error", [`Uncaught ${event.message}`, event.error]);
  });
  globalThis.addEventListener("unhandledrejection", (event) => {
    forward("error", ["Unhandled rejection", event.reason]);
  });
}
