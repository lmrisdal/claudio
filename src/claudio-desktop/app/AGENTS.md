# Electron Shell Agent Rules

These rules apply when working in `src/claudio-desktop/app`.

- Renderer security is not negotiable: `sandbox` and `contextIsolation` on, `nodeIntegration` off, no remote content with a preload. The renderer only gets what `src/preload/index.ts` exposes as `window.claudioDesktop`.
- Every IPC handler checks the sender with `isTrustedFrame` (top frame served from `claudio-app://app/`). Renderer-callable commands go through the allowlists in `src/shared/channels.ts` (`CORE_METHODS`, `SHELL_METHODS`). `log` and `has_active_operations` stay core-internal.
- Rejections reach the SPA as plain strings. `game-detail-actions.tsx` and `use-download-manager.tsx` check `typeof error === "string"`, so keep the `{ ok, value } | { ok: false, error }` wrapping in main and the plain-string rejection in the preload.
- `claudio-core` owns stdout for its protocol. Never add a code path that lets a child process inherit it. The shell spawns the core with piped stdio, `windowsHide: true` and a scrubbed environment (`buildCoreEnv`).
- The custom schemes are registered in `src/main/index.ts` before `ready`. `claudio-app` serves the SPA with an `index.html` fallback for extension-less routes and must keep Range support for the emulator. `claudio` is the API proxy and must stay streaming.
- Keep data folders apart: Chromium's profile lives in `<appData>/claudio-shell`, the core keeps its data in the local app data folder under `claudio`. On Windows never install the app into the core's data directory.
- The SPA is Linux and Windows only. Do not add macOS code paths.
- Keep pure logic out of files that import `electron` so it can be unit-tested in Node (see `navigation-policy.ts`, `invoke-handler.ts`, `lifecycle.ts`).
- Frameless window: the drag region is the `.desktop-drag` CSS class. Chromium drag regions swallow pointer events, so every interactive element inside one needs `.desktop-no-drag`.
- Comments are code smell, as in the rest of the repo. Explain "why" only when it is not obvious from the code.
- Limit source files to 400 lines.
- Run `vp check` and `vp test` before finishing. Use `vp` for tooling, and import test utilities from `vite-plus/test`.
- Pin electron, electron-builder and electron-updater to exact versions. electron-builder 26 is intentional; the electron.build docs describe unreleased v27, so check behaviour against the installed version.
