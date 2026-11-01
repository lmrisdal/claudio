import type { CoreProcess } from "./core/core-process";

export type Level = "error" | "warn" | "info" | "debug";

export interface Logger {
  log: (level: Level, message: string, source?: string) => void;
}

export function createLogger(getCore: () => CoreProcess | null): Logger {
  return {
    log(level, message, source = "shell") {
      const consoleMethod = level === "debug" ? "log" : level;
      console[consoleMethod](`[${source}] ${message}`);
      getCore()
        ?.invoke("log", { level, message, source })
        .catch(() => undefined);
    },
  };
}
