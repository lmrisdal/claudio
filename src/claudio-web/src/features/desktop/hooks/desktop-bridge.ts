export interface DesktopDownloadEvent {
  event: "Started" | "Progress" | "Finished";
  data?: { contentLength?: number | null; chunkLength?: number };
}

export interface DesktopUpdateInfo {
  version: string;
  body?: string | null;
}

export interface ClaudioDesktopBridge {
  invoke: (method: string, params?: unknown) => Promise<unknown>;
  onEvent: (handler: (event: string, payload: unknown) => void) => () => void;
  window: {
    minimize: () => Promise<void>;
    toggleMaximize: () => Promise<void>;
    close: () => Promise<void>;
  };
  openDialog: (options?: {
    directory?: boolean;
    title?: string;
    defaultPath?: string;
  }) => Promise<string | null>;
  log: (level: "error" | "warn" | "info" | "debug", message: string) => void;
  updates: {
    check: () => Promise<DesktopUpdateInfo | null>;
    download: () => Promise<void>;
    install: () => Promise<void>;
    onDownloadEvent: (handler: (event: DesktopDownloadEvent) => void) => () => void;
  };
}

declare global {
  interface Window {
    claudioDesktop?: ClaudioDesktopBridge;
  }
}

export type UnlistenFn = () => void;

export function getBridge(): ClaudioDesktopBridge {
  const bridge = globalThis.window?.claudioDesktop;
  if (!bridge) {
    throw new Error("Desktop bridge is not available.");
  }
  return bridge;
}

export function invoke<T>(method: string, params?: unknown): Promise<T> {
  return getBridge().invoke(method, params) as Promise<T>;
}

export async function listen<T>(
  eventName: string,
  handler: (payload: T) => void,
): Promise<UnlistenFn> {
  return getBridge().onEvent((event, payload) => {
    if (event === eventName) handler(payload as T);
  });
}
