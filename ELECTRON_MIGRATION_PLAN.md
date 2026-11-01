# Electron Migration Plan

Status: proposed, 2026-11-01. Nothing here has been implemented.

## Goal

Replace the Tauri desktop shell with Electron so Claudio renders with bundled Chromium on every platform, while keeping every current desktop feature and all existing user data.

The main reason is poor and inconsistent WebKitGTK performance on Linux. The reported machine has an RTX 4090, NVIDIA 615.78, Wayland and WebKitGTK 2.54.2.

Chromium has not yet been measured on that machine, and the cause of the jank is not established. Phase 0 tests this before any existing code changes.

## Key decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Rust code | Keep it as a headless sidecar, `claudio-core` | Installs, Proton, Bottles, Steam shortcuts and Win32 integration already work. Only 18 of the crate's source files reference Tauri, and they are mostly plumbing. |
| Sidecar or native addon | Sidecar, JSON lines over stdio | A crash can't take down the UI, no Node ABI concerns, and the existing Rust integration tests keep working. |
| API proxy (`claudio://`) | Port to the Electron main process | It needs streaming, and binary bodies over a JSON pipe would be slow. |
| Renderer security | `sandbox` and `contextIsolation` on, `nodeIntegration` off, preload allowlist | Electron defaults and recommended practice. |
| Versions | `electron` 45.2.1, `electron-builder` 26.18.0, `electron-updater` 6.8.11 | Current `latest` on npm as of 2026-11-01. Pin exact versions. |
| Release targets | Linux and Windows | Same as `release.yml` today. macOS stays buildable for development, with its code paths kept, but is not released. |
| Existing users | The current Tauri updater delivers the first Electron build through `latest.json` | The updater verifies only the minisign signature and file format, so no extra Tauri release is needed (see Phase 6). |

### Trap: electron-builder docs

The docs at electron.build describe unreleased v27, while npm `latest` is v26.18.0. Deb and rpm update behaviour, AppImage sandbox behaviour and update-manifest signing were read from v27 docs. Confirm each against 26.18.0 in Phase 5, and do not upgrade to v27 during this migration.

## Architecture

```
Renderer (claudio-web, sandboxed)
   │  window.claudioDesktop (preload allowlist)
   ▼
Electron main (src/claudio-electron)
   ├─ windows, tray, menus, dialogs, single instance, updater, window state
   ├─ claudio-app://   serves the built SPA with index.html fallback
   ├─ claudio://api    proxies API traffic to the configured server
   │  JSON lines over stdio
   ▼
claudio-core (src/claudio-desktop, Rust, no Tauri)
   └─ downloads, extraction, installers, registry, settings, game runtime,
      Proton/umu/Bottles, Steam shortcuts, Windows integration
```

Layout:

- `src/claudio-desktop/` stays in place as the Rust crate. It keeps the lib name `claudio_desktop`, so `tests/claudio-desktop` still works, and its binary becomes `claudio-core`.
- `src/claudio-electron/` is new: `src/main/`, `src/preload/`, `electron-builder.yml`, `build/installer.nsh`.
- `src/claudio-uninstaller/` is unchanged.

## Phase 0: Proof gate (no changes to existing code)

Work in a throwaway directory: a minimal Electron app that loads the existing `claudio-web` build against a real server. Stop and report if this phase fails.

1. **Performance:** compare the current Tauri build and Electron on the same machine, on these flows: scroll the library, open a game detail page, open and close settings. Record FPS with a temporary `requestAnimationFrame` counter, input feel, idle CPU and GPU, total memory across processes, and startup time. Test Electron under native Wayland (the default since v38) and under `--ozone-platform=x11`.
2. **Blur:** repeat with `backdrop-filter` and hero blur disabled, so the cause of any remaining jank is known.
3. **HTTP servers:** with the SPA on `claudio-app://`, load a server over plain `http://` on the LAN and test cover images, hero images and the emulator (`/emulator/index.html` with a direct `gameUrl`). Chromium may block or upgrade these as mixed content from a secure origin. The Electron docs don't cover this, so it has to be tested. If it breaks, try these in order:
   - Route those URLs through the `claudio://` proxy.
   - Use `allowRunningInsecureContent`, with the security trade-off written down.
   - Register the scheme without `secure`, after confirming the emulator and service worker still work.
4. **Proxy:** confirm `fetch("claudio://api/...")` works from `claudio-app://`, including `FormData` uploads.

Exit criteria: the user agrees Electron is clearly better on their machine, and one option in item 3 works. If Electron is not clearly better, the migration stops here, because it would not fix the actual problem.

## Phase 1: Make the Rust core independent of Tauri

Merge this to `main` in small PRs while Tauri still ships.

1. Add a `Host` abstraction in the crate with three jobs:
   - `emit(event, payload)`
   - `confirm(title, message, ok, cancel) -> bool`
   - `resource_dir() -> PathBuf`
2. Replace `tauri::AppHandle` and `State<'_, T>` throughout `commands/` and `services/` with `Host` and plain references. The call sites are `progress.rs`, `download.rs`, `api.rs`, `install.rs`, `state.rs`, `installer_install*.rs`, `installer_run.rs` (`confirm_installer_elevation`) and `windows_integration/registration.rs` (`resource_dir`).
3. Move `tauri::command` functions behind thin wrappers so the same logic can be called from either shell.
4. Replace `pub use tauri::http` in `integration_test_api.rs` with the `http` crate.
5. Make `tauri` an optional default feature, and have CI also run `cargo test --workspace --no-default-features` so the core stays free of Tauri.

No behaviour changes. Keep the path-aware logging that `src/claudio-desktop/AGENTS.md` requires.

## Phase 2: `claudio-core` sidecar

Add a `claudio-core` binary with an `rpc` module.

Protocol, one JSON object per line:

```
→ {"id":1,"method":"install_game","params":{"game":{...}}}
← {"id":1,"result":{...}}          or {"id":1,"error":"message"}
← {"event":"install-progress","payload":{...}}
← {"id":"c1","request":"confirm","params":{...}}     host asks the shell
→ {"id":"c1","result":true}
```

Requirements:

- **Commands:** expose all 30 current commands under their existing names, plus `has_active_operations`.
  - Install: `install_game`, `retry_cached_install`, `download_game_package`, `cancel_install`, `restart_install_interactive`, `cleanup_failed_install`, `uninstall_game`, `validate_install_target`.
  - Paths: `resolve_install_path`, `resolve_install_browse_root`, `resolve_default_download_root`, `resolve_download_path`, `open_install_folder`.
  - Library: `list_installed_games`, `get_installed_game`, `list_game_executables`, `set_game_exe`, `add_steam_shortcut`.
  - Runtime: `launch_game`, `stop_game`, `list_running_games`, `list_proton_versions`, `list_linux_runtime_backends`, `list_linux_bottles`.
  - App: `get_settings`, `update_settings`, `ping`, `desktop_check_server_connection`.
  - Shell-owned, so not in the core: `restart_app`, `open_settings_window`.
- **Parameter names:** Tauri converts camelCase to snake_case automatically. Param structs must accept the camelCase the web app already sends (`remoteGameId`, `gameTitle`, `deleteFiles`, `targetPath`).
- **Concurrency:** run every request on its own task, with synchronous filesystem work on `spawn_blocking`, so `cancel_install` can never be blocked by another command.
- **Stdout protection:** stdout carries the protocol, so nothing else may write to it. `std::process::Command` inherits stdio by default, so installers, games and helpers could corrupt it. Audit every `Command::new` (including `game_runtime.rs`, `linux_umu.rs`, `linux_bottles.rs`, `installer_run.rs` and `extract.rs`), set stdin, stdout and stderr explicitly, and add a regression test that launches a child which writes to stdout.
- **Logging:** replace `tauri-plugin-log`. Keep `claudio.log` in `settings::data_dir()`, the same log levels, 10 MB rotation with one file kept, and also write to stderr. Add a `log` method so the shell and renderer log to the same file.
- **Lifetime:** exit when stdin closes. Games keep running after exit, as they do now, because children aren't killed on exit. Add a test for this.
- **Resources:** take `--resource-dir` on the command line. Windows registration uses it to find `claudio-game-uninstaller.exe`.
- **Windows:** keep `windows_subsystem = "windows"`, and test that the UAC prompt appears in the foreground from a windowless process.

Tests: dispatcher unit tests for every method, camelCase parsing, error strings, the confirm round trip, and exit on EOF.

## Phase 3: Electron main process

Port each `lib.rs` and `commands/mod.rs` behaviour one-for-one.

| Today | Electron |
| --- | --- |
| `tauri_plugin_single_instance` restoring the window | `requestSingleInstanceLock` first, before starting the core. `second-instance` restores the window. |
| Main window 1280x800, min 800x600, hidden until loaded | `BrowserWindow` with `show: false`, shown on `ready-to-show`. Frameless except on macOS. |
| macOS overlay title bar, traffic lights at 14,21 | `titleBarStyle: "hiddenInset"`, `trafficLightPosition: {x: 14, y: 21}` |
| Settings window: 640x620, resizable, reused if open | Second `BrowserWindow`, window role passed through `additionalArguments`, read in preload |
| Close: `closeToTray` hides, otherwise requests exit | `close` event with `preventDefault`. Same logic, including `hideDockIcon` via `app.dock`. |
| Quit during active install (Windows only): "Quit" or "Keep Running" | Same text, asks `has_active_operations`, `dialog.showMessageBox`. Stays Windows-only for parity. |
| Tray: Show (`tray-show`), Check for Updates, Quit | `Tray` with `setContextMenu`, and `click` restores the window. On Linux, `click` means "activation", which may not be a left click. |
| macOS app menu | `Menu` with the same items and accelerators |
| `tauri_plugin_window_state`: all flags except visibility, not for settings | Small `window-state.json` module: bounds, maximized and fullscreen, validated against `screen.getAllDisplays()`. Electron's `windowStatePersistence` is experimental, so don't depend on it. |
| `restart_app` | `app.relaunch()` then `app.exit(0)`. Electron requires both. Test on AppImage. |
| `tauri_plugin_opener` | Not used by the web app, so drop it |
| `target="_blank"` links | `setWindowOpenHandler`: open http and https with `shell.openExternal`, deny the rest. Block other navigation with `will-navigate`. |

### Data paths: must not collide

- Rust data stays at `dirs::data_local_dir()` plus `Claudio`/`claudio`. It doesn't depend on the Tauri identifier, so `settings.json`, `installed-games.json`, `tools/` and logs carry over with no migration.
- Electron's default `userData` on macOS is `~/Library/Application Support/Claudio`, the **same folder** as the Rust data. Before `ready`, create `<appData>/claudio-shell` and call `app.setPath("userData", ...)` on all platforms. `setPath` throws if the directory doesn't exist.
- The per-user Windows Tauri install directory, `%LOCALAPPDATA%\Claudio`, is also the Rust data directory. Never install Electron there. electron-builder's default is `%LOCALAPPDATA%\Programs\<APP_FILENAME>`; keep it.

### Protocols

Call `protocol.registerSchemesAsPrivileged` before `ready`:

- `claudio-app`: `standard`, `secure`, `supportFetchAPI`, `allowServiceWorkers` (`public/sw.js` exists), `corsEnabled`, `stream`.
- `claudio`: `standard`, `secure`, `supportFetchAPI`, `corsEnabled`, `stream`.

Adjust the `secure` flag if Phase 0 requires it.

`claudio-app://` handler: serve from the resources directory, block path traversal, set MIME types, and fall back to `index.html` for routes without a file extension (`createBrowserRouter` needs this). `/emulator/*` must serve directly. If the emulator needs Range support, implement it in the handler and return 206 with `Content-Range`, because reports show `net.fetch` on `file://` URLs doesn't.

`claudio://api` handler, ported from `protocol.rs`:

- Answer `OPTIONS` with 204 and CORS headers.
- `claudio://api/<path>` maps to `<serverUrl>/api/<path>`. Any other host is an error.
- Drop request headers: `authorization`, `host`, `origin`, `referer`, `content-length`, `access-control-request-method`, `access-control-request-headers`.
- Add `customHeaders`, skipping `is_forbidden_custom_header` names.
- Drop `access-control-*` response headers from upstream, then apply the same CORS logic.
- Return 502 as `text/plain` on failure.
- Keep the 526 and status-based log levels.
- Cache settings in main and refresh them after `update_settings`.

Deliberate behaviour changes, each covered by a test:

- Stream responses instead of buffering them (`protocol.rs:84` buffers the whole body today).
- The current 3-second total timeout (`http_client.rs`) covers the body too, so any slow API response fails. Use a 3-second limit on connecting and receiving headers only. Keep the existing client for `desktop_check_server_connection`.

Use `net.fetch` in the main process, with `duplex: "half"` for request bodies. It uses Chromium's network stack, which trusts the OS certificate store, while today's client uses bundled `rustls` roots. Test HTTPS, a self-signed server and a proxy-fronted server (status 526 logs).

### Core process

- Spawn from `process.resourcesPath` with piped stdio and `windowsHide: true`. Send stderr to the log.
- Pending requests reject with the same error strings. If the core exits unexpectedly, reject them all, log it, restart once, and show a dialog if it dies again.
- Strip Electron and AppImage variables from the core's environment (`LD_LIBRARY_PATH` and `LD_PRELOAD` set by AppRun, `ELECTRON_*`, `CHROME_*`), because they're inherited by umu, Wine and games. Test a real game launch from the AppImage.
- Forward `install-progress` to all windows, matching Tauri's broadcast.

### Permissions

Use a default-deny `setPermissionRequestHandler`, allowing only `fullscreen` (the emulator uses `requestFullscreen`). Verify gamepad input still works.

Non-goal: adding a strict CSP. Today's CSP is `null`, and images come from arbitrary hosts and the emulator may need `wasm`. Handle it as a follow-up.

## Phase 4: Web app changes

Keep changes behind one bridge; feature code should barely change.

1. Preload exposes `window.claudioDesktop` with a fixed allowlist: `invoke`, `onEvent`, `window` (`minimize`, `toggleMaximize`, `close`, `role`), `openDialog`, `updates`. Sandboxed preloads can only `require("electron")` and must be a single bundled file. Main rejects IPC from any sender outside the app's own frames.
2. **Error strings:** Tauri rejects with a plain string, and `game-detail-actions.tsx` and `use-download-manager.tsx` check `typeof error === "string"`. Electron's `invoke` rejects with a different `Error` object. So main must return `{ok, value}` or `{ok: false, error}`, and preload must reject with the same plain string. Test this.
3. Replace `@tauri-apps/*` usage:

| File | Change |
| --- | --- |
| `use-desktop.ts` | `isDesktop` checks for `claudioDesktop`. `invoke` and `listen` go through the bridge. Same command names and signatures. |
| `core/api/client.ts` | Remove `convertFileSrc`. The base is always `claudio://api`. |
| `app.tsx` | `getCurrentWindow().label` becomes `window.role` |
| `header.tsx` | Window controls go through the bridge |
| `settings-window.tsx`, `settings-window-error-boundary.tsx` | `window.close` through the bridge |
| `install-dialog.tsx`, `game-detail-actions.tsx` | `openDialog` with `dialog.showOpenDialog`, keeping `directory`, `title` and `defaultPath`, and returning a path or `null` |
| `update-toast.tsx` | Replace `check`, `Update`, `download` and `install` with `updates.*`. Keep every UI state, the pending-version startup flow, and the 15-second timeout. Listen for `check-for-updates` through the bridge. |
| `main.tsx` | Replace `attachConsole`. Forward renderer logs to the file log. |
| `install-dialog.test.tsx` | Mock the bridge |
| `vite.config.ts` | Replace `TAURI_ENV_PLATFORM` with a `CLAUDIO_DESKTOP_BUILD` variable. Keep `dist`, `strictPort` and no proxy in that mode. |

4. **Drag regions:** `data-tauri-drag-region` in `header.tsx` (two places) and `desktop-gate.tsx` becomes a CSS class using `-webkit-app-region: drag`. This behaves differently: draggable areas ignore all pointer events, including on child elements, so every interactive element in the region needs `no-drag`. Also set `user-select: none` there. `desktop-gate.tsx` has a fixed overlay across the top of the app, so test that everything beneath it still responds to clicks, on every page. Check `desktop-title-bar.tsx` on macOS.
5. Remove the `@tauri-apps/*` dependencies and `tauri:*` scripts. Add `desktop:dev` and `desktop:build`.

Keyboard, gamepad and focus behaviour must remain as `AGENTS.md` describes.

## Phase 5: Packaging and CI

`electron-builder.yml`:

- `appId: com.claudio.desktop`, `productName: Claudio`, icons from `src/claudio-desktop/icons`.
- `extraResources`: `claudio-core`, the built SPA, the tray icon, and `claudio-game-uninstaller.exe` on Windows.
- Linux: AppImage, deb, rpm. Set `packageName` to match the **actual** `Package` field of the v0.1.9 deb and the rpm `Name`. These could not be read for this plan because the repo isn't publicly reachable. Read them first with `dpkg-deb -f` and `rpm -qp --qf '%{NAME}'`. A mismatch would install a second copy next to the old one instead of upgrading.
- Windows: NSIS, `oneClick: true`, `perMachine: false`.
- Publish to GitHub: this generates `latest.yml` and `latest-linux.yml`.

Confirm against 26.18.0:

- Deb and rpm update flow.
- Chromium sandbox handling on Ubuntu 24.04+, where AppArmor restricts Electron unless the deb has a profile (`appArmorProfile`), and whether the AppImage needs `--no-sandbox` when user namespaces are unavailable.
- AppImage runtime requirements (the legacy runtime needs `libfuse.so.2`).
- pnpm: allow Electron's postinstall under pnpm's build-script policy, and confirm electron-builder's dependency collection works with the lockfile layout.

Workflows (`build.yml`, `release.yml`, `test.yml`):

- Remove `tauri-apps/tauri-action`, the `patch-linux-appimage` job and the WebKit, appindicator and rsvg packages.
- Build order: uninstaller (Windows), `claudio-core`, SPA, shell, `electron-builder`.
- Keep `cargo test --workspace` on all three OSes. Add `vp test` and `vp check` for `src/claudio-electron`.
- Add a smoke test: launch the packaged Linux app under xvfb, wait for the window and a successful `ping`.

Repo files:

- Update `scripts/bump_version.cjs`, `Makefile` and `README.md` for the new version file. Fix the script's stale usage string while there.
- Update `scripts/check-windows-xwin.sh` and `build-windows-xwin.sh` to build the core and uninstaller only.

## Phase 6: Updates and moving existing users

### New updater

`electron-updater` with `autoDownload: false` and `autoInstallOnAppQuit: false`, so the existing toast stays in control.

Format behaviour differs: AppImage updates without elevation, but deb and rpm need `pkexec` or `sudo`. Today's Tauri flow also prompts for deb and rpm.

Windows builds are unsigned today (`release.yml` has no Authenticode step). electron-updater's Authenticode check behaviour for unsigned builds isn't stated in its docs, so test a real update.

### Trap: the updater and the private repo

The current updater endpoint is `https://github.com/lmrisdal/claudio/releases/latest/download/latest.json`. On 2026-11-01 it returned **404 without authentication**, and the repo API did too, which suggests the repo is private. If so, auto-update isn't working for anyone today, and neither would electron-updater's GitHub provider without a token. **Resolve this before Phase 6**: make releases publicly reachable or host the manifests elsewhere. Never embed a GitHub token in the app. If nobody is receiving updates, existing users must install 0.2.0 by hand, and the bridge below only applies after the endpoint works.

### Bridge from Tauri to Electron

From `tauri-plugin-updater` 2.14.1 source: the app fetches `latest.json`, verifies the minisign signature, then installs by format. So the first Electron release can publish a Tauri-format manifest pointing at Electron artifacts.

The release job, for at least 3 releases:

1. Builds with electron-builder, as usual.
2. Signs each artifact with `tauri signer sign` using the existing `TAURI_SIGNING_PRIVATE_KEY`. Pin `@tauri-apps/cli` for this step.
3. Generates `latest.json` using the same platform keys as v0.1.9. Read them from that release's manifest rather than assuming them. Version must be above 0.1.9: use 0.2.0.

What happens on each format, per the source:

| Format | Behaviour | To test |
| --- | --- | --- |
| AppImage | Checks the payload is ELF, replaces `$APPIMAGE` in place | App restarts into Electron |
| deb | `pkexec dpkg -i` (fallbacks: zenity or kdialog, then sudo) | Upgrades in place, old files removed, `/usr/bin` launcher and `.desktop` entry correct |
| rpm | `pkexec rpm -U`, same fallbacks | Same |
| Windows NSIS | Runs the installer with `/P /UPDATE /R /ARGS ...` | electron-builder's handling of these unknown flags is undocumented, so run it for real |

Windows cleanup in `build/installer.nsh`, because Tauri's install stays behind otherwise:

- If `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Claudio` exists and `%LOCALAPPDATA%\Claudio\uninstall.exe` exists, run it with `/P /UPDATE _?=%LOCALAPPDATA%\Claudio`, wait, then delete `uninstall.exe`.
- Tauri's uninstaller removes only its listed files and uses non-recursive `RMDir`, so `settings.json`, `installed-games.json`, `tools/` and logs in the same folder should survive. `/UPDATE` skips app-data deletion. **Prove this on a VM with populated data before release.**
- `/UPDATE` also skips shortcut removal. Confirm the old `Claudio.lnk` shortcuts on the Desktop and Start Menu end up pointing at the new app, with no duplicates.
- Confirm "Installed apps" shows only one Claudio.
- Confirm uninstalling an already-installed game still works, since those entries use their own deployed `claudio-game-uninstaller.exe`.

### User-visible data loss to accept

`localStorage` belongs to the old webview and can't be carried over.

- Restored automatically: server URL and custom headers, because `DesktopGate` reloads them from `settings.json`.
- Reset: theme, library view, card width, collapsed groups, sidebar width and collapsed state, emulator fullscreen preference, last played.

Mention this in the release notes.

## Phase 7: Test matrix

Run on real hardware or VMs, on packaged builds rather than dev. Rust and web suites must also pass.

| Area | Linux Wayland NVIDIA | Linux X11 or Mesa | Windows 11 | Steam Deck, if supported |
| --- | --- | --- | --- | --- |
| First run, server setup, reconnect | ✓ | ✓ | ✓ | ✓ |
| Library, detail, emulator, keyboard and gamepad navigation | ✓ | ✓ | ✓ | ✓ |
| Download: speed limit, cancel, retry, resume, custom headers | ✓ | ✓ | ✓ | |
| Install: portable, zip, 7z, tar.gz, cached retry | ✓ | ✓ | ✓ | |
| Installers: umu, Bottles, Proton selection | ✓ | ✓ | | ✓ |
| Installers: silent, interactive restart, elevated with UAC, innoextract | | | ✓ | |
| Launch, stop, running list, process tree kill, audio sessions | ✓ | ✓ | ✓ | ✓ |
| Steam shortcut, Start Menu and Desktop shortcuts, game uninstall | ✓ | ✓ | ✓ | ✓ |
| Frameless drag, resize, maximize, title bar buttons | ✓ | ✓ | ✓ | |
| Tray, close to tray, single instance, window state on two monitors | ✓ | ✓ | ✓ | |
| Quit during install prompt | | | ✓ | |
| Update Tauri → Electron (each format), then Electron → Electron | ✓ | ✓ | ✓ | |
| Settings and registry preserved after update | ✓ | ✓ | ✓ | |

Also compare against `docs/desktop-test-coverage-checklist.md`, and record package sizes and memory in the release notes. Package size will grow substantially.

## Phase 8: Cutover and removal

Once Phase 7 passes, in one PR:

- Delete: `tauri.conf.json`, `tauri.windows.conf.json`, `build.rs`, `capabilities/`, `gen/`, `protocol.rs`, the `tauri` feature and all `tauri*` dependencies, `scripts/strip-appimage-libs.sh`, `.agents/skills/tauri-v2/` and its `skills-lock.json` entry.
- Port the `protocol.rs` tests to Vitest **before** deleting it, along with any integration test using `forward_request_for_tests`.
- Update: root `AGENTS.md`, `src/claudio-desktop/AGENTS.md` and `README.md`, `README.md`, `docs/src/content/docs/development/architecture.mdx`, `REMOTE_INSTALL_PLAN.md`, `docs/desktop-test-coverage-checklist.md`, `.vscode/launch.json` and `tasks.json`.
- Add `src/claudio-electron/AGENTS.md`, carrying over the desktop rules.
- Remove the bridge steps from the release workflow after 3 releases. Anyone still on Tauri then needs a manual install, so announce this.

## Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Chromium is no better on NVIDIA Wayland | Migration doesn't fix the problem | Phase 0 gate, tested with native Wayland and X11 |
| Plain HTTP servers break as mixed content | Images or emulator fail for LAN users | Phase 0 item 3, with ordered fallbacks |
| Update endpoint is private | No user receives updates or the bridge | Resolve before Phase 6 |
| Bad Windows bridge installer | Users stranded or data lost | VM test with populated data before tagging, and a manual installer as fallback |
| Package name mismatch | Two copies installed on Linux | Read v0.1.9 package metadata in Phase 5 |
| Child process writes to stdout | Protocol corruption, hung installs | Explicit stdio audit plus regression test |
| Environment leaks into games | Proton or Wine launch failures | Strip variables, and test launching from the AppImage |
| Frameless drag behaviour | Dead buttons in the title bar | Phase 4 item 4, every button on every page |
| Higher memory and disk use | Worse for low-end machines and Steam Deck | Measure in Phase 0 and Phase 7. Accepted cost of bundling Chromium. |
| electron-builder 26 differs from v27 docs | Wrong packaging assumptions | Confirm in Phase 5 |

## Not verified

These could not be confirmed while writing this plan. Each has a phase above that resolves it.

- Whether Chromium fixes the jank.
- Actual package names and platform keys from v0.1.9, and whether the endpoint works for authenticated or public users.
- Whether Windows releases are unsigned in practice, inferred from `release.yml` having no signing step.
- electron-builder NSIS handling of `/P /UPDATE /R /ARGS`.
- electron-updater behaviour on unsigned Windows builds.
- Chromium mixed-content behaviour from `claudio-app://`.
- The effect of `app.relaunch` inside an AppImage.

## Sources

Electron: [app](https://www.electronjs.org/docs/latest/api/app), [protocol](https://www.electronjs.org/docs/latest/api/protocol), [CustomScheme](https://www.electronjs.org/docs/latest/api/structures/custom-scheme), [BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window), [BaseWindow](https://www.electronjs.org/docs/latest/api/base-window), [Tray](https://www.electronjs.org/docs/latest/api/tray), [ipcRenderer](https://www.electronjs.org/docs/latest/api/ipc-renderer), [autoUpdater](https://www.electronjs.org/docs/latest/api/auto-updater), [sandbox](https://www.electronjs.org/docs/latest/tutorial/sandbox), [security](https://www.electronjs.org/docs/latest/tutorial/security), [custom window interactions](https://www.electronjs.org/docs/latest/tutorial/custom-window-interactions), [breaking changes](https://www.electronjs.org/docs/latest/breaking-changes).

electron-builder (v27 docs): [auto update](https://www.electron.build/docs/features/auto-update/), [Linux](https://www.electron.build/docs/linux/), [AppImage](https://www.electron.build/docs/appimage), [NSIS](https://www.electron.build/docs/nsis/), [configuration](https://www.electron.build/docs/configuration/), [`multiUser.nsh`](https://raw.githubusercontent.com/electron-userland/electron-builder/master/packages/app-builder-lib/templates/nsis/multiUser.nsh).

Tauri: `tauri-plugin-updater` 2.14.1 `src/updater.rs` (read from the local Cargo registry), [NSIS template](https://raw.githubusercontent.com/tauri-apps/tauri/dev/crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi).

Range request reports: [electron#38749](https://github.com/electron/electron/issues/38749), [local-knowledge-vault#326](https://github.com/tosin2013/local-knowledge-vault/issues/326).
