# Desktop Integration Test Todo

Remaining work after the current Rust workspace and external integration test setup.

## Windows Integration Tests

- [x] Add `tests/claudio-desktop/tests/windows_installer_flow.rs`
- [x] Add fake installer fixtures for Windows integration tests
- [x] Cover installer success path for EXE installers
- [x] Cover installer success path for MSI installers
- [x] Cover installer failure cleanup for partial target and staging directories
- [x] Cover cancel flow terminating tracked installer processes
- [x] Cover restart-interactive flow for installer-based installs
- [x] Cover elevation-required path returning the expected result
- [x] Cover RunAsInvoker fallback path where practical
- [x] Cover `innoextract`-based extraction path and cleanup where practical

## Windows Registration Lifecycle

- [x] Add `tests/claudio-desktop/tests/windows_registration_flow.rs`
- [x] Verify shortcut creation during portable game registration
- [x] Verify bundled uninstaller deployment into the install directory
- [x] Verify uninstall config JSON contents
- [x] Verify uninstall registry key creation under HKCU
- [x] Verify deregistration removes registry keys
- [x] Verify deregistration removes Start Menu and desktop shortcuts

## Command-Level Integration Tests

- [x] Add `tests/claudio-desktop/tests/commands_flow.rs`
- [ ] Cover install/list/get installed game command paths through the external harness
- [x] Cover uninstall command path
- [x] Cover launch/stop/list running command paths
- [x] Cover `resolve_install_path` through the command-level surface

## Tauri App-Shell Integration Tests

- [ ] Decide whether to add a real Tauri app harness for window-level integration tests
- [ ] If yes, cover `open_settings_window` for logged-out users
- [ ] If yes, cover `open_settings_window` reusing and focusing an existing settings window
- [ ] If yes, cover auth-driven settings-window access gating
- [ ] If yes, cover tray/menu smoke flows that are stable in CI

## CI Follow-Up

- [ ] Ensure Windows CI runs the new `tests/claudio-desktop` Windows-only suites
- [ ] Decide whether to split Rust unit tests and Rust integration tests into separate CI steps for clearer failure reporting

## Cleanup / Hardening

- [ ] Review whether the feature-gated `integration_test_api` can be narrowed further after the remaining suites are added
- [ ] Review regenerated Tauri schema files and confirm they should stay committed
- [ ] Confirm the new root `Cargo.lock` is the only Rust lockfile kept in the repo
