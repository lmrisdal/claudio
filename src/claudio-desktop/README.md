# claudio-desktop

Tauri 2 desktop client for Claudio. Wraps the `claudio-web` SPA in a native
window and adds the local capabilities the browser can't: installing games to
disk, launching them, storing auth tokens in the OS keyring, and proxying API
traffic to the user's configured Claudio server.

## Features

- Native shell around `../claudio-web/dist` (single `main` window + on-demand
  `settings` window).
- `claudio://` URI scheme that forwards SPA requests to the configured
  server, attaches bearer tokens, refreshes on 401, and injects user-defined
  custom headers.
- OAuth login (password, proxy-nonce, external-login-nonce, refresh grants)
  with tokens stored in the OS keyring. Plaintext fallback only if the user
  opts in.
- Game install pipeline: streamed download with optional speed limiting,
  `.zip` / `.tar.gz` extraction, native installer execution
  (`.exe` / `.msi`), progress events, cancellation, interactive-restart of
  silent installers.
- Windows install integration: Start Menu / Desktop shortcuts and an Uninstall
  registry entry pointing at the bundled `claudio-game-uninstaller.exe`.
- Installed-games registry persisted as JSON, self-pruning when install paths
  disappear.
- Game runtime: launch as child process, track PID, detect exit, list/stop
  running games.
- Tray icon + native macOS app menu, close-to-tray and hide-dock-icon toggles.
- Auto-updates via `tauri-plugin-updater` against the GitHub releases
  `latest.json`, signed with an embedded minisign key.
- Windows release builds compile and bundle the `../claudio-uninstaller` crate
  via `build.rs` + `tauri.windows.conf.json`.

## Layout

```
src/
  main.rs                    entry → claudio_desktop::run()
  lib.rs                     Tauri builder, tray, menus, plugins, handlers
  auth.rs                    OAuth + keyring token storage
  protocol.rs                claudio:// → server request forwarding
  settings.rs                DesktopSettings (JSON on disk)
  registry.rs                installed-games JSON registry
  models.rs                  RemoteGame / InstalledGame / progress DTOs
  version.rs                 display version (commit SHA or Cargo version)
  windows_integration.rs     Windows-only shortcuts / uninstall / process bits
  commands/                  #[tauri::command] handlers
  services/                  game_install + game_runtime
  integration_test_api.rs    gated behind `integration-tests`
  test_support.rs            gated behind `test` / `integration-tests`
capabilities/default.json    Tauri v2 permission manifest
tauri.conf.json              main Tauri config
tauri.windows.conf.json      Windows-only overrides
build.rs                     builds claudio-uninstaller on Windows release
```

## Building

```bash
# cross-build from macOS/Linux to Windows
./scripts/check-windows-xwin.sh
./scripts/build-windows-xwin.sh

# or directly
cargo tauri dev
cargo tauri build
```

Cargo features: `devtools`, `integration-tests`.

## Runtime data

- **Settings** — JSON in the platform app-data dir (`serverUrl`, `logLevel`,
  window geometry, `defaultInstallPath`, `closeToTray`, `hideDockIcon`,
  `customHeaders`, `allowInsecureAuthStorage`, `downloadSpeedLimitKbs`).
- **Tokens** — OS keyring, service `claudio-desktop`, account `auth-tokens`.
- **Installed games** — JSON registry alongside settings.
- **Logs** — `tauri-plugin-log`, 10 MB rotation, one file kept.
