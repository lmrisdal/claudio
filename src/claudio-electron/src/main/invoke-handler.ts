import { APP_ORIGIN, CORE_METHODS, SHELL_METHODS, type InvokeResult } from "../shared/channels";
import type { CoreProcess } from "./core/core-process";

export interface InvokeDeps {
  core: Pick<CoreProcess, "invoke">;
  onSettingsUpdated: () => void;
  shell: Record<(typeof SHELL_METHODS)[number], () => void | Promise<void>>;
}

const coreMethods = new Set<string>(CORE_METHODS);
const shellMethods = new Set<string>(SHELL_METHODS);

export function isTrustedFrame(frame: { url: string } | null, mainFrame: unknown): boolean {
  return frame !== null && frame === mainFrame && frame.url.startsWith(`${APP_ORIGIN}/`);
}

export async function runInvoke(
  deps: InvokeDeps,
  method: unknown,
  params: unknown,
): Promise<InvokeResult> {
  if (typeof method !== "string") return { ok: false, error: "Invalid command." };
  try {
    if (shellMethods.has(method)) {
      await deps.shell[method as (typeof SHELL_METHODS)[number]]();
      return { ok: true, value: null };
    }
    if (!coreMethods.has(method)) return { ok: false, error: `Command ${method} not found` };
    const value = await deps.core.invoke(method, params);
    if (method === "update_settings") deps.onSettingsUpdated();
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
