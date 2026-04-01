const STORAGE_KEY = "claudio:shortcuts";

export interface ShortcutMap {
  guide: string;
}

const defaults: ShortcutMap = {
  guide: "mod+g",
};

export function getShortcuts(): ShortcutMap {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return { ...defaults, ...JSON.parse(saved) };
  } catch {
    // ignore
  }
  return { ...defaults };
}

export function setShortcut<K extends keyof ShortcutMap>(
  key: K,
  value: string,
) {
  const current = getShortcuts();
  current[key] = value;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  window.dispatchEvent(new CustomEvent("claudio:shortcuts-changed"));
}

export function getShortcutDefaults(): ShortcutMap {
  return { ...defaults };
}

/** Format a shortcut pattern for display (e.g. "mod+g" → "Ctrl+G" or "⌘G") */
export function formatShortcut(pattern: string): string {
  const isMac =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);
  const parts = pattern.toLowerCase().split("+");
  const key = parts.pop()!.toUpperCase();

  const modifiers = parts.map((p) => {
    if (p === "mod") return isMac ? "\u2318" : "Ctrl";
    if (p === "ctrl") return isMac ? "\u2303" : "Ctrl";
    if (p === "shift") return isMac ? "\u21E7" : "Shift";
    if (p === "alt") return isMac ? "\u2325" : "Alt";
    return p;
  });

  if (isMac) return modifiers.join("") + key;
  return [...modifiers, key].join("+");
}
