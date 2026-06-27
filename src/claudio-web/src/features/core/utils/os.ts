export const isMac = typeof navigator !== "undefined" && navigator.platform.startsWith("Mac");
export const isWindows = typeof navigator !== "undefined" && navigator.platform.startsWith("Win");
export const isLinux = typeof navigator !== "undefined" && navigator.platform.includes("Linux");
