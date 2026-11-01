import { APP_SCHEME } from "../shared/channels";

export type NavigationDecision = "allow" | "open-external" | "deny";

export function classifyUrl(url: string): NavigationDecision {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "deny";
  }
  if (parsed.protocol === `${APP_SCHEME}:` && parsed.host === "app") return "allow";
  if (parsed.protocol === "http:" || parsed.protocol === "https:") return "open-external";
  return "deny";
}
