# claudio-core

Headless Rust sidecar for the Claudio desktop app. The Electron
shell in `../claudio-desktop/app` owns the windows, tray and API proxy; this crate
does the local work the browser can't: installing games to disk, launching them
and tracking running processes.

## Features

- Game install pipeline: streamed download with optional speed limiting,
  `.zip` / `.7z` / `.tar.gz` extraction, native installer execution
  (`.exe` / `.msi`), progress events, cancellation, interactive-restart of
  silent installers.
- Linux: Proton/umu prefixes, Steam shortcuts, host path mapping.
- Windows install integration: Start Menu / Desktop shortcuts and an Uninstall
  registry entry pointing at the bundled `claudio-game-uninstaller.exe`.
- Installed-games registry persisted as JSON, self-pruning when install paths
  disappear.
- Game runtime: launch as child process, track PID, detect exit, list/stop
  running games. Games keep running when the core exits.

## Protocol

`claudio-core` reads one JSON object per line on stdin and writes one per line
on stdout. Nothing else may write to stdout, so every spawned subprocess sets
its stdio explicitly.

```
→ {"id":1,"method":"install_game","params":{"game":{...}}}
← {"id":1,"result":{...}}          or {"id":1,"error":"message"}
← {"event":"install-progress","payload":{...}}
← {"id":"c1","request":"confirm","params":{...}}     the core asks the shell
→ {"id":"c1","result":true}
```

Params use the camelCase names the web app sends. The core exits when stdin
closes. Pass `--resource-dir <path>` so Windows registration can find
`claudio-game-uninstaller.exe`.

## Layout

```
src/
  main.rs                    claudio-core entry: logging, runtime, rpc::serve
  lib.rs                     module wiring
  rpc/                       stdio protocol, dispatcher, confirm round trip
  host.rs                    Host abstraction (emit, confirm, resource_dir)
  logging.rs                 claudio.log with 10 MB rotation, mirrored to stderr
  settings.rs                DesktopSettings (JSON on disk)
  registry.rs                installed-games JSON registry
  models.rs                  RemoteGame / InstalledGame / progress DTOs
  version.rs                 display version (commit SHA or Cargo version)
  windows_integration.rs     Windows-only shortcuts / uninstall / process bits
  commands/                  command implementations called by the dispatcher
  services/                  game_install + game_runtime
  integration_test_api.rs    gated behind `integration-tests`
  test_support.rs            gated behind `test` / `integration-tests`
tests/core_process.rs        runs the real binary over piped stdio
```

## Building

```bash
cargo build --release -p claudio-core --bin claudio-core
cargo test --workspace

# cross-check or cross-build for Windows from Linux
./scripts/check-windows-xwin.sh
./scripts/build-windows-xwin.sh
```

Cargo features: `integration-tests`.

## Runtime data

- **Settings** — JSON in the platform app-data dir (`serverUrl`, `logLevel`,
  `defaultInstallPath`, `closeToTray`, `customHeaders`,
  `downloadSpeedLimitKbs`).
- **Installed games** — JSON registry alongside settings.
- **Logs** — `claudio.log` next to the settings, 10 MB rotation, one old file
  kept. The Electron shell and renderer log through the core's `log` method.
