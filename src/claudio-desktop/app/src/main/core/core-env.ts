import path from "node:path";

const STRIPPED_PREFIXES = ["ELECTRON_", "CHROME_"];
const APPIMAGE_VARIABLES = ["APPIMAGE", "APPDIR", "ARGV0", "OWD"];
const APPIMAGE_LOADER_VARIABLES = ["LD_LIBRARY_PATH", "LD_PRELOAD"];

export function buildCoreEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const insideAppImage = Boolean(source.APPIMAGE);
  const appDir = source.APPDIR;
  const env: NodeJS.ProcessEnv = {};

  for (const [name, value] of Object.entries(source)) {
    if (STRIPPED_PREFIXES.some((prefix) => name.startsWith(prefix))) continue;
    if (APPIMAGE_VARIABLES.includes(name)) continue;
    if (insideAppImage && APPIMAGE_LOADER_VARIABLES.includes(name)) continue;
    env[name] = value;
  }

  if (insideAppImage && appDir && env.PATH) {
    env.PATH = env.PATH.split(path.delimiter)
      .filter((entry) => !entry.startsWith(appDir))
      .join(path.delimiter);
  }

  return env;
}
