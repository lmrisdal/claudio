# Desktop Test Coverage Checklist

This checklist is the implementation reference for expanding test coverage in `src/claudio-desktop/`.

## Goals

- Add comprehensive coverage for install, download, cancel, failure, rollback, and cleanup flows.
- Expand coverage to runtime process management, auth/protocol behavior, persistence, and Windows integration.
- Move orchestration-level integration tests into `tests/claudio-desktop/`.
- Add a root Cargo workspace for the Rust subgraph so desktop, uninstaller, and desktop integration tests share one Rust toolchain entry point.
- Refactor only where needed to make the desktop app testable without mutating real user state.
- Run desktop tests in CI on Linux, macOS, and Windows, with Windows-only behavior treated as required coverage.

## Current State

- Existing desktop tests are minimal:
  - `src/auth.rs`: JWT/session parsing tests
  - `src/settings.rs`: log-level normalization tests
  - `src/services/game_install.rs`: one cleanup test
- Desktop CI currently builds/packages on Windows, macOS, and Linux.
- Desktop CI does not currently run `cargo test` for `src/claudio-desktop`.

## Risk Priorities

### Highest Priority

- `src/claudio-desktop/src/services/game_install.rs`
- `src/claudio-desktop/src/services/game_runtime.rs`
- `src/claudio-desktop/src/auth.rs`
- `src/claudio-desktop/src/protocol.rs`

### Medium Priority

- `src/claudio-desktop/src/windows_integration.rs`
- `src/claudio-desktop/src/settings.rs`
- `src/claudio-desktop/src/registry.rs`
- `src/claudio-desktop/src/lib.rs`
- `src/claudio-desktop/src/commands/mod.rs`

### Low Priority

- `src/claudio-desktop/src/commands/games.rs`
- `src/claudio-desktop/src/commands/ping.rs`
- `src/claudio-desktop/src/version.rs`
- `src/claudio-desktop/src/models.rs`
- `src/claudio-desktop/src/main.rs`
- `src/claudio-desktop/build.rs`

## Required Refactors For Testability

These are the first refactors to make before trying to add broad coverage.

### 1. Inject Desktop Paths

- Replace direct `settings::data_dir()` usage in these modules with an injectable path provider or `DesktopPaths` struct:
  - `src/settings.rs`
  - `src/registry.rs`
  - `src/auth.rs`
  - `src/services/game_install.rs`
- Minimum target:
  - settings file path
  - installed games registry path
  - auth fallback token path
  - temp download/install roots
- Outcome:
  - tests use temp directories
  - no test touches real local data

### 2. Extract Progress/Event Sink

- Move `emit_progress`, `emit_progress_indeterminate`, and `emit_progress_with_bytes` behind a small trait or callback adapter.
- Keep the Tauri `AppHandle` emission at the outer edge.
- Outcome:
  - install tests can assert progress states directly
  - no real app event bus required for most tests

### 3. Extract Process Runner / Process Inspection Seams

- Add narrow wrappers around:
  - launching child processes
  - checking whether a PID is still alive
  - killing a process tree
  - installer-specific process launch/wait/terminate behavior
- Apply to:
  - `src/services/game_runtime.rs`
  - Windows installer branches in `src/services/game_install.rs`
- Outcome:
  - state logic can be unit tested
  - only a smaller set of tests need real subprocesses

### 4. Separate Pure Install Logic From Side Effects

- Break `game_install.rs` into smaller internal modules or clearly separated sections:
  - path and naming helpers
  - download workflow
  - archive extraction
  - installer orchestration
  - cleanup helpers
  - file discovery/detection helpers
- Outcome:
  - helper logic becomes easy to test
  - integration tests can focus on orchestration instead of every branch at once

### 5. Add Resettable Auth Test Hooks

- Add test-only helpers for:
  - clearing `TOKEN_CACHE`
  - clearing secure-storage dialog state
  - overriding auth storage location when plaintext fallback is enabled
- Outcome:
  - auth tests are deterministic
  - tests do not leak cached state across runs

### 6. Reduce Hardwired HTTP Construction

- Keep request building and response handling testable without requiring live Tauri state.
- Extract pure helpers for:
  - header shaping
  - route classification
  - target URL selection
  - refresh retry decision logic where practical
- Outcome:
  - `auth.rs` and `protocol.rs` can use local test servers with minimal harness code

## Workspace And Integration Test Crate

Add a root Cargo workspace for the Rust subgraph only. This does not change the repo into a Rust monorepo; it only standardizes the Rust members.

### Workspace Members

- `src/claudio-desktop`
- `src/claudio-uninstaller`
- `tests/claudio-desktop`

### Workspace Root

- Add `Cargo.toml` at the repository root:

```toml
[workspace]
members = [
  "src/claudio-desktop",
  "src/claudio-uninstaller",
  "tests/claudio-desktop",
]
resolver = "3"
```

### Integration Test Crate

Create a dedicated Rust crate at `tests/claudio-desktop/` for orchestration-level integration tests.

### Integration Test Crate Files

- `tests/claudio-desktop/Cargo.toml`
- `tests/claudio-desktop/src/lib.rs`
- `tests/claudio-desktop/src/support/mod.rs`
- `tests/claudio-desktop/src/support/fs.rs`
- `tests/claudio-desktop/src/support/http.rs`
- `tests/claudio-desktop/src/support/fixtures.rs`
- `tests/claudio-desktop/src/support/process.rs`
- `tests/claudio-desktop/src/support/archive.rs`

### Desktop Crate Testing Surface

Add a narrow feature-gated testing surface in `src/claudio-desktop` rather than making whole modules public.

### Desktop Crate Refactors For External Integration Tests

- add `integration-tests` feature to `src/claudio-desktop/Cargo.toml`
- add `integration_test_api` module in `src/claudio-desktop/src/`
- expose only what the external integration test crate needs:
  - temp path override helpers
  - auth plaintext storage override helpers
  - install/download orchestration entry points
  - runtime state helpers
  - reusable test fixtures or wrappers where necessary

## Shared Test Support To Add

Keep pure helper and unit tests inline in `src/claudio-desktop`. Put orchestration-level integration tests in `tests/claudio-desktop/`.

### New Support Files

- `tests/claudio-desktop/src/support/mod.rs`
- `tests/claudio-desktop/src/support/fs.rs`
- `tests/claudio-desktop/src/support/http.rs`
- `tests/claudio-desktop/src/support/fixtures.rs`
- `tests/claudio-desktop/src/support/process.rs`
- `tests/claudio-desktop/src/support/archive.rs`

### Support Responsibilities

- temp workspace creation and cleanup
- temporary desktop path overrides
- local HTTP test server helpers
- archive fixture creation (`.zip`, `.tar`, `.tar.gz`)
- fake installed game / remote game builders
- small child process helpers for runtime tests
- auth cache reset helpers

## Concrete Test Files To Add

Inline unit/helper tests that already exist in `src/claudio-desktop` should stay there. The files below are for the external integration test crate.

### Install / Download / Cleanup

- `tests/claudio-desktop/tests/install_portable_flow.rs`
- `tests/claudio-desktop/tests/download_package_flow.rs`
- `tests/claudio-desktop/tests/install_cancel_cleanup.rs`
- `tests/claudio-desktop/tests/windows_installer_flow.rs`
- `tests/claudio-desktop/tests/windows_registration_flow.rs`

### Runtime

- `tests/claudio-desktop/tests/runtime_flow.rs`

### Auth / Protocol

- `tests/claudio-desktop/tests/auth_flow.rs`
- `tests/claudio-desktop/tests/protocol_flow.rs`

### Persistence / Platform

- `tests/claudio-desktop/tests/commands_flow.rs`

### Thin Smoke Coverage

- keep thin smoke coverage inline in `src/claudio-desktop`

## Integration Test Crate Execution Order

### Phase 1: Harness

- add root Cargo workspace
- create `tests/claudio-desktop` crate
- add `integration-tests` feature and `integration_test_api`
- move shared orchestration test helpers into `tests/claudio-desktop/src/support/`

### Phase 2: Highest-Value Flows

- `install_portable_flow.rs`
- `download_package_flow.rs`
- `install_cancel_cleanup.rs`

### Phase 3: Auth / Protocol Flows

- `auth_flow.rs`
- `protocol_flow.rs`

### Phase 4: Runtime Flow

- `runtime_flow.rs`

### Phase 5: Windows-Only Flows

- `windows_installer_flow.rs`
- `windows_registration_flow.rs`

### Phase 6: Command And App-Level Flows

- `commands_flow.rs`
- defer deeper tray/window lifecycle tests until the integration harness justifies them

## Test Matrix By Module

### `src/services/game_install.rs`

#### Unit Tests

- `sanitize_segment` replaces invalid path characters
- `sanitize_segment` falls back to `game` when empty after trim
- `infer_filename` handles `filename=`
- `infer_filename` handles `filename*=UTF-8''...`
- `build_install_dir` uses sanitized game title
- `visible_entries` filters `__MACOSX` and `.DS_Store`
- `normalize_into_final_dir` flattens a single extracted root directory
- `normalize_into_final_dir` moves multiple visible entries directly
- `resolve_installer_path` prefers explicit hint when present
- `detect_installer` finds `setup.exe` / `install.exe`
- `detect_windows_executable` finds first sorted `.exe`
- `build_headers` rejects forbidden headers and applies bearer token
- `cleanup_directory` removes an existing directory
- `cleanup_failed_installer_state` removes target and staging directories
- Windows only: `stream_requests_elevation` detects embedded elevation markers

#### Integration Tests

- portable install from `.zip`
- portable install from `.tar`
- portable install from `.tar.gz`
- non-archive package copy path
- inferred `game_exe` when hint is missing
- honored `game_exe` hint when file exists
- scene override files copied into target directory
- install writes registry entry through app registry store
- uninstall removes registry entry without deleting files when `delete_files=false`
- uninstall removes install directory when `delete_files=true`
- download temp directory removed after success
- install temp directory removed after success

#### Cancel / Failure / Cleanup Tests

- cancel during download removes temp root
- cancel during download removes target dir only when target did not already exist
- cancel during extraction removes partial moved files
- installer failure removes partial install dir and staging dir
- restart-interactive sets the right state and retries as interactive
- target path already exists fails early
- non-Windows installer flow fails closed

#### Windows-Only Tests

- installer launch kind detection
- silent MSI path
- silent InnoSetup path
- NSIS path
- unknown installer falls back to interactive
- elevation-required path returns `RequiresAdministrator`
- RunAsInvoker path is applied on non-admin EXE launch when needed
- tracked installer processes are cleared on cancel / restart / completion
- failed installer state cleanup runs after installer error
- `innoextract` path flattens `app/` output and removes leftover temp folder

### `src/services/game_runtime.rs`

#### Unit Tests

- `RunningGamesState::list_active` prunes dead entries
- `ensure_not_running` removes stale entry and allows relaunch
- `ensure_not_running` rejects currently running game
- `remove` returns removed process info

#### Integration Tests

- launch game with valid installed entry and executable
- reject launch when game is not installed
- reject launch when `game_exe` is missing
- stop running game successfully
- list running games omits exited child processes
- reject stop when game is not running

#### Platform-Gated Tests

- Windows: stop logic through `taskkill` path
- Unix/macOS/Linux: stop logic through `kill`/`pkill` path

### `src/auth.rs`

#### Unit Tests

- `parse_session` accepts string and numeric `sub`
- `parse_session` accepts role arrays and lowercases role
- malformed or expired tokens are rejected
- `access_token_is_expired` handles missing `exp`
- `is_secure_storage_error` matches only the secure-storage prefix
- `apply_custom_headers` strips forbidden custom headers
- `map_keyring_error` maps storage-access failures to secure-storage prefix
- `server_origin` trims whitespace and trailing slash
- `parse_response_error` prefers `error_description`, then `error`, then raw body

#### Integration Tests

- password login success stores tokens and returns session
- login with invalid token response clears tokens on finalize failure
- refresh token success stores new tokens
- refresh rejection clears stored tokens
- restore session returns logged-out state when no tokens exist
- derive session falls back to `/api/auth/me` when JWT cannot be parsed locally
- secure storage recovery invalidates plaintext fallback and forces reauth
- plaintext fallback file path is used only when insecure storage is enabled

### `src/protocol.rs`

#### Unit Tests

- `target_url` maps `claudio://api/...` to `/api/...`
- `target_url` maps `claudio://connect/...` to `/connect/...`
- unsupported host returns an error
- `is_authenticated_route` excludes `/connect/token`
- `should_skip_request_header` skips auth/origin/host/CORS preflight headers

#### Integration Tests

- authenticated route attaches bearer token
- unauthenticated route forwards without bearer token
- `401` triggers refresh and retry
- failed refresh updates auth UI state to logged out
- OPTIONS request returns CORS preflight response
- proxied response preserves status and headers

### `src/settings.rs`

#### Tests

- load/save roundtrip
- invalid JSON falls back to defaults
- invalid log level normalizes to `info`
- `warning` normalizes to `warn`
- forbidden custom headers are removed on save/load
- default install root respects configured install path
- install root creation works against test paths

### `src/registry.rs`

#### Tests

- upsert inserts and sorts by title
- upsert replaces existing game by remote id
- remove returns removed game
- list prunes entries whose install path no longer exists
- get prunes missing-path entries before lookup

### `src/windows_integration.rs`

#### Unit Tests

- `expand_process_tree` includes descendants across multiple passes
- `registry_key_name` is stable
- `days_to_ymd` converts known dates correctly

#### Windows-Only Integration Tests

- shortcut creation writes `.lnk`
- uninstaller deployment copies `uninstall.exe` and writes config JSON
- registry writing populates expected uninstall keys
- deregister removes keys and shortcuts
- tracked process collection includes descendants and matching exe names

### Thin Smoke Tests

- `src/version.rs`: commit SHA env var wins, empty env falls back to package version
- `src/commands/ping.rs`: command response shape
- `src/commands/mod.rs`: auth gate for settings window if seams make this practical

## Delivery Order

### Batch 1: Foundation Refactors

- add injectable path provider
- add progress sink seam
- add auth cache reset helpers
- split out install helper logic with minimal movement
- add test support helpers under `tests/support/`

### Batch 2: Install Helper And Cleanup Coverage

- add helper tests for `game_install.rs`
- add portable install integration tests
- add uninstall and cleanup tests

### Batch 3: Download / Cancel / Failure Coverage

- add local HTTP server tests for ticket + download
- add cancel during download/extract tests
- add temp-root cleanup and partial-target cleanup assertions

### Batch 4: Windows Installer Coverage

- add Windows-only installer branch tests
- add Windows registration/deregistration coverage
- add tracked installer process cleanup assertions

### Batch 5: Runtime Coverage

- add `RunningGamesState` tests
- add subprocess launch/stop/list tests

### Batch 6: Auth / Protocol Coverage

- add pure auth tests
- add local-server auth flow tests
- add protocol forwarding / retry / CORS tests

### Batch 7: Persistence And Small Smoke Tests

- add settings and registry tests
- add version/ping smoke tests
- add any low-cost command smoke tests that become practical after refactors

## CI Changes Required

Desktop tests should run before packaging in CI.

### `build.yml`

- add a desktop test matrix job for:
  - `ubuntu-22.04`
  - `windows-latest`
  - `macos-latest`
- run internal desktop tests and external desktop integration tests
- keep packaging as a separate downstream step

### `release.yml`

- add the same desktop test matrix before release packaging
- fail release packaging if desktop tests fail

### Commands

- workspace tests: `cargo test --workspace`
- internal desktop tests: `cargo test -p claudio-desktop`
- external desktop integration tests: `cargo test -p claudio-desktop-tests`
- desktop build verification after larger refactors: `cargo test --workspace` and `cargo build --workspace`

## First Implementation Slice

If work starts immediately, this is the best first slice:

1. Add the root Cargo workspace.
2. Create `tests/claudio-desktop`.
3. Add the `integration-tests` feature and a minimal `integration_test_api` surface.
4. Introduce test path injection for settings, registry, auth fallback, and install temp roots.
5. Introduce a progress sink seam in `game_install.rs`.
6. Add shared test support files.
7. Add helper tests for:
   - install path sanitization
   - filename inference
   - visible entry filtering
   - normalize-into-final-dir
   - installer detection
   - registry persistence and missing-path pruning
8. Add portable install + uninstall cleanup integration tests in `tests/claudio-desktop`.
9. Add desktop workspace test execution to CI after the first stable batch lands.

## Success Criteria

- install cancel/fail/cleanup regressions are caught automatically
- Windows-specific installer behavior is covered in CI
- desktop tests do not touch real user data
- auth/protocol regressions surface before packaging
- orchestration-level integration tests live in `tests/claudio-desktop`
- `cargo test --workspace` becomes the canonical Rust test entry point
- new desktop logic has obvious seams for adding tests instead of extending giant untestable flows
