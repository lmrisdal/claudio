# Rust to C# migration plan

Build a C# version of the Rust desktop sidecar (`claudio-core`) and the Windows game uninstaller (`claudio-uninstaller`) on .NET 10, compiled with Native AOT. It lives next to the Rust code, so the two can be compared directly. **No Rust is deleted until the project owner has compared them and decided, in phase 8.** Electron, the SPA and the JSON-lines protocol stay as they are.

**Status:** implemented side by side with Rust on `feature/csharp` (2026-11-02). Rust is untouched and still the default. Linux is verified end to end. Windows code compiles but has never run on Windows, and phase 0 Windows items, the phase 5 exit tests, the phase 6 real-game checks and the phase 8 beta and decision are open. See 'Implementation status' below.

## Implementation status (2026-11-02)

**Built and verified on Linux**

- `src/claudio-core-cs`: all 29 protocol methods, Native AOT 8.2 MB. The shell contract suite (103 tests: contract, process, golden files, downloads with a fake HTTP server, portable and installer installs through a fake `umu-run`, executables, Steam VDF) passes against Rust, the C# JIT build and the C# Native AOT build. `scripts/compare-sidecars.mjs` reports 0 differences on 31 requests plus the data files.
- `src/claudio-uninstaller-cs`: ported, 3.1 MB Native AOT on Linux, phase 1 and phase 2 smoke-tested by hand against a fixture.
- `tests/claudio-core-cs`: 130 unit tests. Rust has 151 test attributes, of which about 20 are process or integration tests that the shell contract suite covers instead, and the Windows-only tests (`windows_integration/tests.rs`, `windows_*_flow.rs`) have not been ported.
- Phase 7 tooling: `fetch-7zip.mjs`, `stage-sidecar.mjs` (a Rust stage contains exactly the files it did before, tested), `electron-builder.yml` reading from `sidecar/`, version bump and release checks for both projects, CI steps and the `sidecar` release input, `THIRD-PARTY-NOTICES.md`, VS Code task.

**Checked by hand on Windows (project owner, 2026-11-02):** a portable `.7z` install, the uninstall dialog and file removal, the Start Menu shortcut, and the Apps & features entry all work after the AOT JSON fix. CI on `windows-2025` runs the unit tests, the Native AOT publish and the contract suite (the Windows-only integration tests are in `core-windows.test.ts`).

**Still never run on Windows**

CsWin32 layer (`Windows/`): `CreateProcessW` with NUL handles, `ShellExecuteExW` elevation, process tracking, `SetThreadExecutionState` on a dedicated thread, `.lnk` creation, registry registration and deregistration, the uninstaller, innoextract, the installer retry flow and scene overrides. It compiles for `win-x64` as a JIT build. Native AOT for Windows needs the CI Windows runner. The Windows contract flows (`windows_installer_flow.rs`, `windows_registration_flow.rs`) have not been ported to tests.

Two things in the Windows code that differ from Rust and need checking on Windows: the sidecar marks its own stdio handles non-inheritable at startup so launched children cannot keep the protocol pipe open (Rust does not), and `CLAUDIO_START_MENU_DIR` and `CLAUDIO_DESKTOP_DIR` are test overrides for the shortcut folders.

**Linux checks run on 2026-11-02**

- Packaged AppImage with the C# sidecar (`electron-builder --linux AppImage`): the sidecar, `7-zip/7zzs` (executable bit kept) and `THIRD-PARTY-NOTICES.md` are inside. `7zzs` extracts an archive when run from the mounted AppImage, the packaged core answers `ping`, and `scripts/smoke.mjs` passes against the AppImage.
- OpenSSL hidden with `bwrap` (libssl.so.3 and libcrypto.so.3 replaced by `/dev/null`): Rust keeps working because it bundles its TLS. The C# core aborted the whole process with "No usable version of libssl was found". Fixed with a guard (`Install/Tls.cs`) that returns an error string for HTTPS URLs when no libssl can be loaded and keeps plain HTTP working. `core-openssl.test.ts` covers both. Static linking, tried in an Ubuntu 24.04 podman container (`dotnet-sdk-10.0`, `clang`, `zlib1g-dev`, `libssl-dev`, `cmake`, `make`): `-p:StaticOpenSslLinking=true` produces a 13.3 MB binary with no libssl or libcrypto dependency. With OpenSSL hidden it still fetched `https://github.com`, and the full shell suite passes against it. CI and release now publish the Linux sidecar that way (the guard compiles out via `STATIC_OPENSSL`); cost is +5 MB and OpenSSL fixes then arrive with Claudio releases, not the distro. It fails to link on this Arch host, which has no `libssl.a`.
- Private CA behaviour: not tested, not needed by the project owner.

**Not done**

- Phase 0: items 1, 2 (Windows half), 3 (missing OpenSSL), 4, 5 (SteamOS, AppImage), 8, 9, 10, 11.
- Phase 5 exit: real Inno Setup, NSIS, MSI and GOG installs with UAC.
- Phase 6 exit: a real game through Proton.
- Phase 8: beta through the auto-updater, the section 9 checklist, and the owner's decision. Nothing is deleted.
- The LGPL text itself is linked from `THIRD-PARTY-NOTICES.md`, not bundled.
- Audio muting is deliberately not ported.

## 1. Decisions

| Decision | Choice | Reason |
| --- | --- | --- |
| Language and runtime | C# on .NET 10 with Native AOT | The API is already C#, so Rust leaves the stack. Users need no .NET runtime. |
| 7z extraction | Bundle unmodified official 7-Zip and run it as a separate process | Fastest option tested. It verifies checksums itself. SharpCompress took 2-3x as long as Rust, skipped 7z CRC checks, and 0.50.7 crashed on a valid solid Deflate archive. |
| ZIP, tar, tar.gz | .NET built-ins | Within about 10% of Rust in testing. |
| Windows audio muting | Do not port to C# | Decided by the project owner. The Rust code is left as it is, and keeps muting until the phase 8 decision. |
| `.lnk` shortcuts | Keep, through CsWin32 and `IShellLinkW` | Windows writes the file, and CsWin32 generates the bindings. |
| Strategy | Build C# next to Rust behind the existing protocol, compare, then decide | Electron only sees a binary that speaks JSON lines, so the two implementations can be tested against the same contract. |
| Rust code | Stays in place, working and in CI, until the phase 8 decision | Keeps the comparison honest and the decision open. Rust remains the default sidecar until then. |
| Platforms | Linux x64 and Windows x64 | These are the only release targets today. Do not add macOS paths. |

Out of scope: new features, protocol changes, API or SPA changes, and any change to Electron beyond the paths and packaging listed in phase 7.

## 2. Evidence

Results from throwaway tests. The Windows test code is on branch `feature/windows-aot-spike`.

| Tested | Environment | Result |
| --- | --- | --- |
| Native AOT build with CsWin32 | `windows-2025` CI | Built and ran. Test binary 2.1 MB. |
| Shortcut created, then launched from the `.lnk` | `windows-2025` CI | Passed on STA and MTA threads, with Japanese paths and the correct working directory. |
| Official `7za.exe` 26.05 extraction | `windows-2025` CI | LZMA2, LZMA, PPMd, BCJ, BCJ2, BZip2, Deflate and Copy all byte-identical. |
| Corrupted and truncated archives | `windows-2025` CI | Rejected with exit code 2. |
| `Process.Kill(entireProcessTree: true)` during extraction | `windows-2025` CI | Exited in 5 ms. Partial files deleted with no lock error. |
| 7-Zip progress with `-bsp1 -bso0` | Linux (system `7z`) and Windows | Percent plus current file, separated by `\r` and backspaces. |
| ZIP, tar, tar.gz with .NET built-ins | Linux Native AOT | Byte-identical, with speed close to Rust. |

**Not yet tested.** Phase 0 must close these:

- UAC elevation and killing an elevated process.
- A Native AOT `WinExe` speaking the protocol over piped stdio on Windows.
- HTTPS from a Native AOT binary, particularly on Linux hosts.
- The static Linux 7-Zip binary `7zzs`.
- Password-protected archives with 7-Zip (they must fail, not hang).
- Registry access under Native AOT.
- Real game archives and installers.

**Phase 0 results, Linux (2026-11-02, Arch host, system `7z` 26.05, .NET SDK 10.0.302):**

| Item | Result |
| --- | --- |
| 2. `WinExe` + Native AOT on Linux | Publishes and runs (6.0 MB with `HttpClient`). JSON-line style stdin/stdout loop works. Windows half still open. |
| 3. HTTPS under Native AOT | `https://github.com` returned 200 on a host with OpenSSL 3. Missing-OpenSSL hosts (SteamOS, minimal distros) and `StaticOpenSslLinking` still open. |
| 5. `7zzs` 26.05 on Linux (Arch) | SHA-256 matches the plan. Statically linked. LZMA2, LZMA, PPMd, BCJ, BZip2, Deflate and Copy extract byte-identical. Corruption exits 2. Password-protected archives (with and without header encryption) exit 255 with stdin closed. Open: BCJ2, SteamOS, and running from a mounted AppImage. |
| 6. Password-protected 7z, stdin closed | Exit 255 ("Break signaled"), no hang. |
| 7. Traversal and symlinks | `../evil.txt` stored in an archive extracted inside the destination only. A stored absolute symlink was rewritten to a path inside the destination. Nothing written outside. |
| Truncated 7z (half the file) | Exit 2, "Unexpected end of archive". |

Still open: items 1, 4, 5 (SteamOS and AppImage only), 8, 9, 10, 11, and the Windows half of 2. The spike lives only in the scratchpad and is not committed.

**Open question:** reading the test shortcuts through `WScript.Shell` returned an empty target and working directory, even though they launched correctly from the right folder. The cause is unknown. Phase 0 resolves it.

## 3. What is being ported

| Unit | Size | Notes |
| --- | --- | --- |
| `src/claudio-core` | About 8,600 lines of production Rust | Plus inline tests and test support |
| `src/claudio-uninstaller` | 223 lines | Standalone Windows program |
| `tests/claudio-core` and `src/claudio-core/tests` | 151 test attributes across the workspace | 132 inline, 4 process-level, 15 integration |

The Rust code holds these contracts, all of which must survive the port:

- The protocol: 29 methods in [`rpc/dispatch.rs`](src/claudio-core/src/rpc/dispatch.rs), the `install-progress` event, and the `confirm` request.
- `settings.json` and `installed-games.json` in the data directory.
- `.claudio-download-complete.json` in download workspaces.
- `uninstall-config.json` next to `uninstall.exe` in installed games.
- The `HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Claudio-<id>` registry keys.
- The binary names `claudio-core` and `claudio-game-uninstaller.exe`.

## 4. Target layout

Follow the repo's existing project naming (`src/claudio-api/Claudio.Api.csproj`). Each C# project gets its own folder beside its Rust counterpart, so Cargo and .NET never see each other's files, and either side can be removed cleanly later. No Rust file moves.

```text
src/claudio-core/                               Rust, unchanged
src/claudio-core-cs/Claudio.Core.csproj         AssemblyName claudio-core
src/claudio-uninstaller/                        Rust, unchanged
src/claudio-uninstaller-cs/Claudio.Uninstaller.csproj  AssemblyName claudio-game-uninstaller
tests/claudio-core/                             Rust, unchanged
tests/claudio-core-cs/Claudio.Core.Tests.csproj
target/{debug,release}/                         Rust build output, unchanged
artifacts/claudio-core-cs/{debug,release}/      C# build output, already ignored by .gitignore
scripts/fetch-7zip.mjs                          downloads and verifies pinned 7-Zip
scripts/stage-sidecar.mjs                       copies the chosen sidecar for packaging
scripts/compare-sidecars.mjs                    runs both sidecars and prints the differences
THIRD-PARTY-NOTICES.md
```

The `-cs` suffix only lasts until the decision. If C# is chosen, phase 8 removes it. `src/claudio-core/icons` stays where it is throughout, because [`generate-icons.sh`](scripts/generate-icons.sh) uses it as its source.

Project settings for both programs:

```xml
<OutputType>WinExe</OutputType>
<PublishAot>true</PublishAot>
<InvariantGlobalization>true</InvariantGlobalization>
<JsonSerializerIsReflectionEnabledByDefault>false</JsonSerializerIsReflectionEnabledByDefault>
<IncludeSourceRevisionInInformationalVersion>false</IncludeSourceRevisionInInformationalVersion>
<AllowUnsafeBlocks>true</AllowUnsafeBlocks>
<TreatWarningsAsErrors>true</TreatWarningsAsErrors>
```

- `WinExe` matches the Rust `windows_subsystem = "windows"` setting, so no console window appears.
- Inherit `net10.0` from [`Directory.Build.props`](Directory.Build.props), and add package versions to [`Directory.Packages.props`](Directory.Packages.props).
- Guard Windows and Linux code with `OperatingSystem.IsWindows()` and `IsLinux()`. Treat analyzer warning CA1416 as an error.
- Dependencies: `Microsoft.Windows.CsWin32` (0.3.264 was tested) and `System.IO.Hashing`. Tests use TUnit and AwesomeAssertions, as the API tests do. Do not use SharpCompress here.
- Keep the rules from [`src/claudio-core/AGENTS.md`](src/claudio-core/AGENTS.md): no explanatory comments, 400-line file limit, path-aware error logging, no warnings. Replace its `unwrap()` rule with an equivalent: failures are logged with context and returned as error strings, not left to crash the process.

## 5. Phases

Each phase ends with its tests passing on Linux and Windows CI, against both sidecars once C# exists. Work on one long-lived `feature/` branch, rebased on `main` regularly. Rust stays shipping from `main` until phase 8.

Rules until the phase 8 decision:

- **Do not delete, move or change Rust code as part of this work.** Rust is the reference that C# is compared against.
- A Rust fix that lands on `main` during the port gets a contract test and is ported to C#, so the two do not drift apart.

### Phase 0: close the unknowns

Extend the existing spike. **Stop and revisit the decision if any item fails with no workaround.**

1. On a real Windows machine (CI has no UAC prompt): elevate with `ShellExecuteExW`, read the PID, poll for exit, read the exit code, and terminate the process from the non-elevated parent.
2. Native AOT `WinExe` on Windows: exchange JSON lines over pipes with Electron's `CoreProcess`, with `windowsHide: true`. Also confirm the same project setting publishes and runs on Linux, because the tests so far used `Exe`.
3. HTTPS under Native AOT on Ubuntu, a Steam Deck or SteamOS host, and a minimal distro. Native AOT uses the host's OpenSSL, so confirm what happens if it is missing, and whether `StaticOpenSslLinking` is a supported fix for this .NET version.
4. HTTPS against a server with a private CA. Rust bundles its CA roots and .NET uses the OS store, so this behaviour will change. Record the result in the release notes.
5. `7zzs` on Ubuntu 24.04 and SteamOS: all methods, progress, corruption, kill, and execution from inside a mounted AppImage.
6. A password-protected 7z with stdin closed: must exit with an error, not wait for input.
7. Directory traversal entries and symlinks in 7z archives: confirm nothing is written outside the destination.
8. Read-only files: confirm `Directory.Delete` fails on them on Windows, which is the reason for the helper in section 6.
9. Registry read, write and `DeleteSubKeyTree` under Native AOT.
10. Find out why `WScript.Shell` returned empty fields. Open the same shortcut in Explorer and check its properties, then read it through a copy with an ASCII file name. A wrong answer here means the shortcut is not correct.
11. Measure the real uninstaller size, since one copy ships in every portable game. Check Windows Defender's view of a Native AOT binary that copies itself to `%TEMP%` and relaunches.

**Exit:** all items pass or have a written workaround, and the results are added to section 2.

### Phase 1: contract tests against Rust

Write the safety net while Rust is still the only implementation.

1. Make [`real-core.test.ts`](src/claudio-electron/tests/real-core.test.ts) honour `CLAUDIO_CORE_PATH`, so one suite can target either binary.
2. Copy the 4 Linux process tests from [`core_process.rs`](src/claudio-core/tests/core_process.rs) into it, leaving the originals in place, and make them run on Windows where they apply:
   - stdout stays pure protocol when a launched child writes to stdout
   - the core exits on stdin close and leaves running games alive
   - no subprocess inherits the protocol stdout
   - launch passes saved arguments without shell expansion
3. Add a contract case for each of the 29 methods: success shape, `null` versus missing fields, the literal error strings, and malformed input.
4. Capture golden files from Rust: `settings.json`, `installed-games.json` (including the legacy `linuxRuntimeBackend` and `bottleName` entry), the download marker, `uninstall-config.json`, and a Steam `shortcuts.vdf`. Commit them as test fixtures.
5. Add a fake HTTP server for download flows: 200, 206, 404 fallback, 429, 5xx, a dropped connection, and a mid-download cancel.

**Exit:** the suite passes against the current Rust binary on both platforms in CI.

### Phase 1 progress (2026-11-02, Linux, against `target/debug/claudio-core`)

Done, all in `src/claudio-electron/tests/`:

- `support/core-harness.ts`: spawns any sidecar named by `CLAUDIO_CORE_PATH` (default `target/debug`), with its own data directory.
- `real-core.test.ts` now honours `CLAUDIO_CORE_PATH`.
- `core-processes.test.ts`: three of the four Linux process tests (stdout purity, exit on stdin close with games alive, no shell expansion of saved arguments). The fourth, "no `Stdio::inherit`", scans Rust source and has no black-box form, so it stays in Rust. Windows variants are not written.
- `core-contract.test.ts`: 37 cases for framing, ping/log, settings, installed games, missing-game errors, install control, paths, proton and server connection.
- `core-golden.test.ts` with `fixtures/golden/settings.json`. Note Rust writes floats as `1.0` and pretty-prints with 2 spaces; C# must match byte-for-byte or the golden test needs relaxing.

Not done: contract cases for the 11 methods that need a server or a real install (`install_game`, `retry_cached_install`, `download_game_package`, `update_game_launch_settings`, `launch_game` success on Windows, and so on), golden files for `installed-games.json`, the download marker, `uninstall-config.json` and `shortcuts.vdf`, the fake HTTP server, and Windows CI runs.

### Phase 3 progress (2026-11-02)

`src/claudio-core-cs/Claudio.Core.csproj` builds with warnings as errors, `dotnet format` is clean, and the Native AOT publish is 7.0 MB. Build output goes to `artifacts/claudio-core-cs/<debug|release>/`.

Ported: entry and `--resource-dir` parsing, the protocol loop (single writer channel, concurrent requests, 500 ms shutdown grace, `confirm` with `c1`, `c2` ids), the dispatcher and param parsing, `ping`, `log`, settings (including byte-identical `settings.json`, with `1.0` floats), the installed games registry (atomic save with flush), file logging with rotation, `desktop_check_server_connection`, install path resolution and validation, `cleanup_failed_install`, `uninstall_game` (without Windows deregistration), `cancel_install`, `restart_install_interactive` and `has_active_operations` (no installs yet).

Results against the Rust contract suite: JIT and Native AOT builds both pass all 43 tests, including the golden `settings.json` and the 3 Linux process tests.

Also ported on Linux: `launch_game` (via `/bin/sh -c 'exec ...' </dev/null >/dev/null 2>&1`, same PID, exact launch argument parser), `stop_game` and `list_running_games`. Windows launch (CsWin32 `CreateProcessW`) and Proton launches (`winePrefix`) return a not-implemented error.

Stubs, not yet ported: `open_install_folder`, `list_game_executables`, `add_steam_shortcut`, `set_game_exe`, `update_game_launch_settings`, `install_game`, `retry_cached_install`, `download_game_package`, and the Proton directory scan (only the two fixed entries). The Rust unit tests have not been ported yet.

### Phase 4 progress (2026-11-02, Linux)

Ported: package download (manifest, ticket fallback, 404 retry via ticket, `Content-Disposition` filename, 4 MiB writer behind a 32-chunk queue, speed limit re-read every second, cancel), individual-file download (2 concurrent, 5 attempts with `500ms * 2^(n-1)` backoff capped at 10 s, `Range` resume, 200-instead-of-206 rewrite, 429/5xx retry, 404 fatal), extraction (ZIP with per-entry CRC check and `enclosed_name` rules, tar and tar.gz through `System.Formats.Tar` with a progress and cancel stream, tar.gz drained to the end so a bad trailer fails, 7z through the bundled `7-zip/7zzs` or `7za.exe` with `-bsp1` progress, copy for non-archives), `FileOps` helpers and `download_game_package` including cancel cleanup. Own CRC-32 table instead of `System.IO.Hashing`, to avoid a new package until it is needed.

`core-downloads.test.ts` (23 cases, fake HTTP server in `tests/support/fake-server.ts`) passes against Rust, C# JIT and C# Native AOT, except that the ZIP cases are skipped for Rust: it extracts ZIP through `tar -xf`, which is the broken path described in section 6. Total C# result: 66 of 66 contract tests on JIT and on Native AOT (publish is 7.2 MB), Rust 148 of 148.

Not yet done: `install_game` and `retry_cached_install` (portable and installer flows, cached download marker, `.lnk`/registry/shortcut registration), which on Linux need the umu prefix work from phase 6; throttle-specific tests; real-game-size timing against Rust.

### Phase 6 start: portable installs on Linux (2026-11-02)

Ported ahead of schedule so `install_game` can be tested: `install_game` and `retry_cached_install` for portable games (cached download marker, progress ranges 60 / 60-95 / 96 / 100, registry upsert, cleanup), the Proton prefix runtime (`UmuCommand.PreparePrefix`, `RunWait`, `SpawnPrefixCommand`, managed umu 1.4.0 download and cache, binary search dirs, `LoggedChild` with a 40-line tail), Proton discovery and selection, `.desktop` desktop and app-menu shortcuts, and `launch_game` for Proton prefixes.

`core-install.test.ts` (10 cases) runs against a fake `umu-run` seeded into the data directory's `tools/umu-launcher/1.4.0/`. It pins the registry field order, the marker shape, the progress events, the retry flow, the shortcut contents and the umu environment. It passes against Rust, C# JIT and C# Native AOT, with identical behaviour. Total: 76 of 76 on both C# builds, Rust 181 of 181.

Still open on Linux: Windows-installer-on-Proton installs (`installer_install_linux`), Steam `shortcuts.vdf`, `add_steam_shortcut`, `list_game_executables`, `set_game_exe`, `update_game_launch_settings`, `open_install_folder`. All of Windows (phase 5) is open.

### Phase 2: set up the side-by-side comparison

Make both sidecars easy to run and compare before any install logic is ported.

**Running either sidecar**

- Create the three C# projects from section 4, with Rust untouched. The Cargo workspace does not change.
- `CLAUDIO_CORE_PATH` already selects the sidecar in development, and the resource directory follows it, so [`paths.ts`](src/claudio-electron/src/main/paths.ts) does not change. Without the variable, Electron uses Rust from `target/`. To run C#, point it at `artifacts/claudio-core-cs/debug/claudio-core`.
- Add a `build core (C#)` task to `.vscode/tasks.json` next to `build core`.

**Comparing them**

`scripts/compare-sidecars.mjs` sends the same requests to both binaries and prints every difference:

- Responses, events and the data files written, after normalising values that always differ, such as temp paths and timestamps.
- For a fixed set of test archives: install time, peak memory and the installed files.
- Startup time and binary sizes.

Each intentional change in section 6 goes on an allow-list with a reason, so anything else in the output is a bug in one of the two.

**Keeping their data apart**

Both sidecars use the same data directory by default, so a comparison must not let one overwrite the other's files:

- Linux: give each binary its own `XDG_DATA_HOME`.
- Windows: the `dirs` crate asks Windows for the folder and does not read environment variables, so there is no override today, and adding one would change Rust. Run the two one after the other, and have the script back up and restore `%LOCALAPPDATA%\Claudio`. Use a test account or VM, never a profile with real games.

**Exit:** the comparison script runs on both platforms with Rust and the empty C# project, and reports the missing C# methods as differences.

### Phase 3: foundation

Port with no install logic yet:

- Program entry, including `--resource-dir` and `--resource-dir=` parsing.
- The protocol loop, requests, `Host`, events and `confirm`.
- Settings, registry, logging, version, ping, and the server connection check.

**Exit:** ping, settings, registry and connection contract tests pass against the C# binary, in both JIT and Native AOT builds. Files written by each sidecar load correctly in the other.

### Phase 4: downloads and extraction

Port downloads (both modes), ZIP, tar, tar.gz, the 7-Zip wrapper, file operations, path handling, and portable installs with their progress ranges.

**Exit:** portable install, retry, cancel and download-only flows pass on both platforms. Resume, throttling and corruption tests pass.

### Phase 5: Windows integration

Port the following, then the uninstaller:

- Installer detection, arguments and retries.
- `innoextract`, elevation and process tracking.
- Scene overrides, sleep prevention, game launch, `.lnk` shortcuts and registry registration.

**Exit:** the 9 Windows flows in `windows_installer_flow.rs` and `windows_registration_flow.rs` pass. A real Inno Setup, NSIS, MSI and GOG installer each install and cancel correctly on real Windows, with a UAC prompt.

### Phase 6: Linux integration

Port the following:

- umu management and prefix commands.
- Proton discovery, `.desktop` shortcuts and Steam VDF.
- Linux installer flow and game launch.

**Exit:** a real game installs and launches through Proton. A shortcut appears in Steam, and an existing `shortcuts.vdf` round-trips byte-identical for unchanged entries.

### Phase 7: tooling and packaging

Make these changes on the branch. They add C# alongside the Rust build and do not replace it. Rust stays the default, and every package can be built with either sidecar.

**Electron**

- Keep the default development path in [`paths.ts`](src/claudio-electron/src/main/paths.ts) pointing at Rust. Keep `CLAUDIO_CORE_PATH` and `CLAUDIO_CORE_PROFILE`.
- `real-core.test.ts` runs against whichever binary `CLAUDIO_CORE_PATH` names, as set up in phase 1.
- In development the resource directory is the folder holding the core binary. The C# dev build must therefore also place `claudio-game-uninstaller.exe` (Windows) and `7-zip/` in `artifacts/claudio-core-cs/<profile>/`, or installs that need them will fail.

**Packaging**

- `scripts/stage-sidecar.mjs <rust|csharp>` copies the chosen sidecar's files into a git-ignored `src/claudio-electron/sidecar/` folder, keeping executable bits. For Rust that is the binaries from `target/release`. For C# it is the published binaries, plus `7-zip/` with the binary, `License.txt` and the LGPL text, and `THIRD-PARTY-NOTICES.md`. It excludes `.dbg` and `.pdb` files.
- [`electron-builder.yml`](src/claudio-electron/electron-builder.yml): point the Linux and Windows `extraResources` at that folder, so both sidecars package the same way. A Rust package must contain the same files as before, which a test confirms.

**7-Zip**

`scripts/fetch-7zip.mjs` downloads 7-Zip 26.05 and fails on any hash mismatch:

| File | SHA-256 |
| --- | --- |
| `7z2605-linux-x64.tar.xz` (use `7zzs`) | `22cf82fcc6eb7474f1d5bb4f02c0f8ebd573a718089d6833dc30f8350a3b232e` |
| `7z2605-extra.7z` (use `x64/7za.exe`) | `f27a8f103c84785026edcba1f67faf1357225df9d19ddb0b7760d55947141bc7` |
| `7z2605-src.tar.xz` (attach to releases) | `0b6080b8c3e7a579161d2d495224c0e51c467576cb4c7048b0ab485ef44cc22e` |
| `7zr.exe` (only to unpack `extra.7z` on Windows) | `9bf582b894dfa665f852d7e9112b02290a1c303c2d95a21fcdc41ffcb03143b7` |

Download from `https://github.com/ip7z/7zip/releases/download/26.05/`. Take `License.txt` from the same version, because it differs from older copies. Confirm the executable bit survives AppImage packaging.

**CI** ([`ci.yml`](.github/workflows/ci.yml), `desktop` job)

- Keep all the Rust toolchain, fmt, clippy, test and build steps.
- Add `actions/setup-dotnet@v5`, `dotnet format` with `--verify-no-changes` on each new project (the repo has no solution file), `dotnet test --project tests/claudio-core-cs`, and a sidecar build.
- Add one Native AOT publish per OS. Run the contract suite against that binary and against the Rust binary. JIT test runs do not prove Native AOT behaviour.
- Run `compare-sidecars.mjs` and fail on any difference that is not on the allow-list.
- On Ubuntu, install the Native AOT prerequisites (`clang`, `zlib1g-dev`).
- Keep the `api` job's `--locked-mode` restore passing after `Directory.Packages.props` changes.

**Release** ([`release.yml`](.github/workflows/release.yml))

- Add a `sidecar` input to `workflow_dispatch`, with options `rust` and `csharp`. It defaults to `rust`, and tag pushes also build Rust.
- For `csharp`: build with `dotnet publish -c Release -r linux-x64` and `-r win-x64`, publish the uninstaller on Windows, run `fetch-7zip.mjs`, and attach `7z2605-src.tar.xz` to the GitHub Release.
- The existing Rust build steps stay for `rust`. Both run `stage-sidecar.mjs` before packaging.
- The existing packaged-app smoke tests stay as the final gate for both.

**Version tooling**

- [`bump_version.cjs`](scripts/bump_version.cjs): write the version to both `src/claudio-core/Cargo.toml` and `<Version>` in `Claudio.Core.csproj`.
- [`release-version.cjs`](scripts/release-version.cjs): keep reading `Cargo.toml`, and fail if the two versions differ. Keep reading the project's own version rather than a dependency's, which is what `workflows.test.cjs` checks for Cargo today.
- [`Makefile`](Makefile): keep `cargo check --workspace`, add `dotnet build src/claudio-core-cs`, and also stage `Claudio.Core.csproj`.
- Extend `scripts/bump-version.test.cjs` and `scripts/workflows.test.cjs` to cover both.

**Licence obligations for 7-Zip**

- Docs state that Claudio uses parts of 7-Zip, that it is under the GNU LGPL, and link to www.7-zip.org for source.
- `License.txt` and the LGPL text ship in both packages.
- Matching source is attached to each GitHub Release.
- 7-Zip stays unmodified and is never compiled into a Claudio binary, which would bring in LGPL section 6.

### Phase 8: compare and decide

Nothing is deleted before step 4.

1. Build a C# beta from the branch as a prerelease, with `sidecar: csharp`, and take it through the real auto-updater from the last Rust version on both platforms. Existing installs, settings and `uninstall.exe` copies must keep working.
2. Run the checklist in section 9.
3. Write up the comparison from `compare-sidecars.mjs` and the beta, with Rust and C# in adjacent columns:
   - Contract suite and test results, and every remaining difference.
   - Install time on real game archives for each format, peak memory, and startup time.
   - Sidecar, uninstaller and installer sizes.
   - Lines of code, and CI build time.
   - Bugs found in each, and anything still unresolved, such as Windows Defender results.
   - How each one was to work on, in the project owner's judgement.
4. **The project owner chooses Rust or C#.** Then follow the matching path below.

**If C# is chosen**

1. Change the defaults to C#: the `paths.ts` development path, the `real-core.test.ts` default binary, tag-push builds, and the `sidecar` input in the release workflow. Update `paths.test.ts`.
2. Merge the branch and ship. Rust is still in the tree and can still be released with `sidecar: rust`.
3. In a follow-up PR once the release is confirmed healthy, delete:
   - Rust source, `Cargo.toml`, `Cargo.lock`, and `.gitignore` entries for Rust
   - the Rust steps and `sidecar` input in CI and release, and the Cargo handling in the version tooling and `Makefile`
   - `scripts/build-windows-xwin.sh` and `scripts/check-windows-xwin.sh`
   - `.agents/skills/rust-best-practices` and its `skills-lock.json` entry
4. In the same PR, drop the `-cs` suffix: `src/claudio-core-cs` to `src/claudio-core` (keeping `icons`), the same for the uninstaller and tests, and `artifacts/claudio-core-cs` to `artifacts/claudio-core`. Remove `compare-sidecars.mjs`, and simplify `stage-sidecar.mjs` to one sidecar.
5. Update the docs:
   - `README.md` lines on Rust and `cargo-xwin`
   - `AGENTS.md`, which also wrongly calls the API Axum-based Rust and lists a `tests/claudio-api-rs` folder that does not exist
   - `src/claudio-core/AGENTS.md`, `src/claudio-core/README.md`, `src/claudio-uninstaller/README.md`
   - `src/claudio-electron/AGENTS.md` line 10 (`dirs::data_local_dir()`) and the comment at `src/claudio-electron/src/main/index.ts:49`
   - `.vscode/tasks.json` (`build core` tasks)

**If Rust is chosen**

1. Do not merge the C# branch. `main` has none of it, so nothing needs removing. Keep the branch until step 3 is done.
2. Merge useful work that is not C#-specific in its own PR: the contract suite, golden files and fake HTTP server, pointed at Rust.
3. Raise the bugs the comparison found in Rust as separate work, starting with those in section 6: ZIP through `tar -xf`, sleep prevention, and tar.gz corruption.
4. Decide separately whether Windows audio muting stays, since removing it was decided for the C# port.

**In either case,** delete branch `feature/windows-aot-spike`, and the C# branch once nothing else needs it.

**Rollback:** until the Rust code is deleted, a release with `sidecar: rust` or the last Rust tag restores the old sidecar. Each sidecar must read the other's data files, as tested from phase 3, so nothing needs migrating back. Uninstallers copied into games by the C# version are standalone and keep working.

## 6. Traps

Each of these is a place where a direct translation would compile and then misbehave. Every one needs a test.

### Process and stdio

| Rust behaviour | Trap in C# | Required approach |
| --- | --- | --- |
| `Stdio::null()` for games and installers | .NET has no null option. Without redirection a child can inherit protocol stdout. Redirecting to a pipe breaks when the sidecar exits, and on Linux a later write can kill the game with `SIGPIPE`. | **Linux:** launch through `/bin/sh -c 'exec "$0" "$@" </dev/null >/dev/null 2>&1'`, which keeps the PID. **Windows:** `CreateProcessW` through CsWin32 with handles to `NUL`. Put this in one `DetachedProcess` helper. Never use bare `Process.Start` for games or installers. |
| `raw_arg` on Windows | `ArgumentList` re-quotes and breaks NSIS `/D=` | Pass the exact line from `windows_argument_line`, ported as is, to `CreateProcessW`. |
| `__COMPAT_LAYER=RunAsInvoker` | Must not apply to MSI | Keep the `installer_type != Msi` condition. |
| Error 740 from spawn | Lost unless checked | Map the `CreateProcessW` error 740 to `RequiresAdministrator`. |
| Elevated launch | The `Process` API hides handle behaviour | Port `ShellExecuteExW`, `WaitForSingleObject`, `GetExitCodeProcess` and `TerminateProcess` directly through CsWin32. |
| umu child with piped stdout and stderr | Deadlock if not drained | Port `process_log.rs` as is: drain both streams, keep a 40-line tail. |
| Process tracking | Includes any process whose name ends in `.tmp`, or matches the installer exe | Port the logic in `audio.rs` exactly with Toolhelp. Use the wide `PROCESSENTRY32W`. |

### Install control

| Rust behaviour | Trap in C# | Required approach |
| --- | --- | --- |
| `set_cancelled(false)` during an interactive restart | A `CancellationTokenSource` cannot be reset | Keep volatile flags, as Rust does. For async I/O, expose a token from a source that is replaced on reset. |
| `spawn_blocking` for long work | Blocking the thread pool for a long installer | Use `Task.Factory.StartNew` with `LongRunning`. |
| `confirm` blocks until answered | Must return false when stdin closes | Pending confirms complete with `false` on shutdown. |
| Sleep prevention | `SetThreadExecutionState` applies per thread, and .NET can resume on another thread after `await` | Hold it on one dedicated thread for the life of the operation. **Check Rust too:** it has the same exposure through `tokio`. |

### JSON

| Rust behaviour | Trap in C# | Required approach |
| --- | --- | --- |
| `Option<T>` `None` writes `null` | An ignore-null setting would drop the field | Keep `DefaultIgnoreCondition.Never`. |
| Missing or null non-`Option` field is an error | Defaults silently | Set `RespectNullableAnnotations` and use `[JsonRequired]`. |
| `DesktopSettings` with a missing `windowWidth` or `windowHeight` falls back to all defaults | Would keep a partial object | Port this exactly, and add a golden test. |
| `#[serde(default)]` fields | | Mark as optional with the same default. `logLevel` defaults to `info`. |
| Corrupt `installed-games.json` is an error and left in place, empty file means no games | Easy to swallow | Port the existing tests from `registry.rs`. |
| Unknown fields ignored | Do not enable strict handling | Legacy `bottleName` fixture must still load. |
| Empty `Vec` writes `[]` | Null collection writes `null` | Initialize collections. |
| Non-ASCII text written directly | Default encoder escapes it | Use `JavaScriptEncoder.UnsafeRelaxedJsonEscaping` for files and protocol. |
| Protocol `id` can be any JSON value, and confirm IDs are strings like `c1` | | Hold `id` as `JsonElement` and echo it unchanged. |
| `params: null` is treated as `{}` | | Port from `params.rs`. |
| stdout carries UTF-8 lines | `Console.Out` can add a BOM or a different encoding | Write UTF-8 bytes directly to `Console.OpenStandardOutput()`, one writer through a `Channel`. |

All models go in a source-generated `JsonSerializerContext`. Keep field names camelCase, and keep enum values `portable` and `installer`.

### Files and paths

| Rust behaviour | Trap in C# | Required approach |
| --- | --- | --- |
| `Path::join` with an absolute path replaces | `Path.Join` does not | Use `Path.Combine`. |
| `fs::remove_dir_all` | Expected to fail on read-only Windows files in .NET (phase 0 confirms) | One `FileOps.DeleteTree` helper that clears attributes, and retries as `cleanup_directory` does. |
| `fs::rename` replaces a file | `File.Move` does not by default | `File.Move(overwrite: true)` in the registry and VDF saves. |
| Registry save writes a temp file, syncs, then renames, added in `35dd878` | Losing the sync reopens the corruption bug | `FileStream.Flush(true)` before the move. |
| `with_extension` | | `Path.ChangeExtension`, tested with titles containing dots. |
| `raw_os_error()` in messages, including 5 and 740 | .NET wraps these | Keep logs path-aware. Map `UnauthorizedAccessException` and `HResult` to the same messages as `paths.rs`. |
| `title` sort with `cmp` | Culture sorting differs | `StringComparer.Ordinal`. |
| `BTreeMap` in VDF | `Dictionary` has no order | `SortedDictionary` with `StringComparer.Ordinal`. Preserve int tags 2, 4 and 6 as read. |

### Downloads

| Rust behaviour | Trap in C# | Required approach |
| --- | --- | --- |
| `reqwest::Client::new()` has no overall timeout | `HttpClient` defaults to 100 seconds, which fails large downloads | `Timeout.InfiniteTimeSpan` and `HttpCompletionOption.ResponseHeadersRead`. |
| Connection check timeouts are 3 s | | Keep both limits from `http_client.rs`. |
| Rust rejects invalid custom headers with an error | `TryAddWithoutValidation` would not | Use validating `Add`, and return the error. |
| Bundled CA roots | .NET uses OS trust | Behaviour change, see phase 0. |
| Downloads use the exact numbers in section 7 | | Copy them as constants. |

### Archives

| Requirement | Approach |
| --- | --- |
| ZIP CRC must be verified. .NET did not detect corruption in testing, while Rust did. | Compare `ZipArchiveEntry.Crc32` to a CRC computed during the copy. |
| tar.gz corruption passed silently in both Rust and C#, probably because reading stops before the gzip trailer. | After extraction, read the gzip stream to its end, and confirm a test detects the corruption. |
| Cancel and progress during ZIP | Use a manual entry loop, not `ZipFile.ExtractToDirectory`. Skip entries that escape the destination, as `enclosed_name` does. |
| Cancel and progress during tar | Wrap the input in a stream that reports progress and throws on cancel, as `ProgressReader` does. Return `Install cancelled.`. |
| 7-Zip stdout | Always redirected and drained. Never inherited. |
| 7-Zip command | `x -y -aoa -bsp1 -bso0 -bse2 -sccUTF-8 -o<dest> <archive>` using `ArgumentList` and closed stdin. |
| 7-Zip results | Non-zero exit is failure. Log the operation, paths and stderr. On cancel, kill the process and leave cleanup to the existing staging logic. Report 100% on success, because the last update can be far lower. |
| 7-Zip location | `<resource dir>/7-zip/7zzs` or `7za.exe`, with a clear error if missing. |

### Behaviour that changes on purpose

- `extract_archive_subprocess` runs `tar -xf` for `.zip`, `.tar`, `.tar.gz` and `.tgz` ([`extract.rs:36`](src/claudio-core/src/services/game_install/extract.rs)). GNU tar 1.35 refused a ZIP file when tested, so download-with-extract of a ZIP looks broken on Linux today, on systems where `tar` is GNU tar. Use the managed extractors for this path too and drop the external `tar` dependency. Test it.
- Audio muting is not in the C# version. Silent installers may play sound, so add that to the release notes if C# ships.
- 7z archives now get 7-Zip's behaviour for file attributes and timestamps.
- OS certificate trust replaces bundled roots.

### Existing issues to leave alone during the port

Do not fix these in the port, so that behaviour diffs stay meaningful. Raise them as separate work:

- `infer_filename` and individual-file `rel_path` handling do not reject path traversal from a server response.
- `filename*=UTF-8''` is not percent-decoded.
- `is_process_running` on Linux shells out to `ps`, and stopping games shells out to `kill` and `pkill`.
- `CLAUDIO_COMMIT_SHA` is read at runtime, though the release workflow only sets it at build time.

## 7. Module map

Rust paths are relative to `src/claudio-core/src`. Literal strings, including all error messages, are copied unchanged. A search of the SPA found no matching on these messages, but they reach users, and the contract tests pin them.

| Rust | C# | Notes |
| --- | --- | --- |
| `main.rs`, `rpc/mod.rs`, `rpc/message.rs` | `Program.cs`, `Rpc/RpcServer.cs`, `Rpc/Messages.cs` | Each request runs concurrently. After stdin closes, allow 500 ms for shutdown and leave games running. |
| `rpc/dispatch.rs`, `rpc/params.rs` | `Rpc/Dispatcher.cs`, `Rpc/Params.cs` | Keep `Command {method} not found` and `invalid args for command`. Serde's detail text may differ, and contract tests must only pin the prefix. |
| `rpc/backend.rs`, `host.rs` | `Host/RpcHost.cs`, `Host/IHost.cs` | Confirm IDs `c1`, `c2`. Keep `RecordingHost` for tests. |
| `models.rs`, `settings.rs` | `Models.cs`, `Settings.cs`, `Json/CoreJsonContext.cs` | Data directories below. |
| `registry.rs` | `InstalledGamesRegistry.cs` | One global lock. Reads prune missing install paths and save. |
| `logging.rs` | `Logging/FileLogger.cs` | `[ts][LEVEL][target] msg`, UTC, 10 MiB rotation to `claudio.old.log`, mirrored to stderr. Own logger, no logging package. |
| `version.rs`, `commands/ping.rs` | `Version.cs`, `Commands/Ping.cs` | Platform string must be `linux` or `windows`. |
| `http_client.rs`, `commands/server_connection.rs` | `Commands/ServerConnection.cs` | HTML with 200 is not OK. |
| `commands/games.rs` | `Commands/Games.cs` | Thin layer. |
| `game_install/state.rs` | `Install/InstallState.cs` | Section 6. |
| `game_install/api.rs`, `install.rs` | `Install/InstallApi.cs`, `Install/Installer.cs` | Split to keep under 400 lines. |
| `game_install/download.rs`, `download_individual.rs` | `Install/PackageDownload.cs`, `Install/IndividualDownload.cs` | Numbers below. |
| `game_install/extract.rs`, `extract_7z.rs` | `Install/Extract.cs`, `Install/SevenZipExtractor.cs` | Section 6. |
| `file_ops.rs`, `paths.rs`, `progress.rs`, `request_headers.rs` | `Install/FileOps.cs`, `Install/InstallPaths.cs`, `Install/Progress.cs`, `Install/RequestHeaders.cs` | `sanitize_segment` is copied exactly. |
| `portable_install.rs`, `installer_install.rs`, `installer_install_linux.rs`, `prefix_paths.rs`, `launch_settings.rs` | `Install/PortableInstall.cs`, `Install/WindowsInstallerFlow.cs`, `Install/LinuxInstallerFlow.cs`, `Install/PrefixPaths.cs`, `Install/LaunchSettings.cs` | Progress ranges below. |
| `installer_detect.rs`, `installer_arguments.rs`, `installer_run.rs`, `installer_cleanup.rs` | `Install/InstallerDetect.cs`, `InstallerArguments.cs`, `InstallerRun.cs`, `InstallerCleanup.cs` | Scan the first 2 MiB for `Inno Setup`, `GOG.com` (ASCII and UTF-16) and `Nullsoft`. |
| `installer_elevated.rs`, `game_elevation.rs` | `Windows/ElevatedProcess.cs`, `Windows/GameElevation.cs` | Without muting. |
| `installer_innoextract.rs` | `Install/InnoExtract.cs` | Downloads the latest release at runtime. Flatten `app/`, remove `tmp/`. |
| `windows_integration/*` | `Windows/ProcessTracking.cs`, `Windows/SleepPrevention.cs`, `Windows/Registration.cs`, `Windows/ShellLink.cs`, `Windows/ShellDirectories.cs` | `.lnk` target and working directory, as `mslnk` set them. |
| `services/game_runtime.rs`, `launch_arguments.rs` | `Runtime/GameRuntime.cs`, `Runtime/LaunchArguments.cs` | Windows passes parameters raw, Linux parses them. |
| `linux_umu.rs`, `linux_umu_command.rs`, `linux_proton.rs`, `linux_host_paths.rs`, `process_log.rs` | `Linux/Umu.cs`, `Linux/UmuCommand.cs`, `Linux/Proton.cs`, `Linux/HostPaths.cs`, `Linux/ProcessLog.cs` | umu pinned at 1.4.4. Read its zipapp tar with `System.Formats.Tar`. |
| `linux_steam_shortcuts.rs` | `Linux/SteamShortcuts.cs` | Lossy UTF-8 on read, backup to `.vdf.claudio.bak`, atomic replace. |
| `src/claudio-uninstaller/src/main.rs` | `src/claudio-uninstaller/Program.cs` | Same two phases and `--do-delete` arguments. `MessageBoxW` through CsWin32, flags `0x124`, `0x10`, `0x40`. |

**Data directories**

| Purpose | Linux | Windows |
| --- | --- | --- |
| Core data | `$XDG_DATA_HOME/claudio` if absolute, otherwise `~/.local/share/claudio` | `%LOCALAPPDATA%\Claudio` |
| Start Menu | n/a | `%APPDATA%\Microsoft\Windows\Start Menu\Programs` |
| App menu shortcuts | `<XDG data>/applications` | n/a |
| Default games folder | `~/Games` | `C:\Games` |

Check every path against the `dirs` crate result with a test. The contract tests already rely on `XDG_DATA_HOME`. Desktop lookup falls back to the home folder on Linux when `dirs::desktop_dir()` finds nothing, and .NET's `SpecialFolder.Desktop` may behave differently here, so test it.

**Numbers to copy exactly**

| Item | Value |
| --- | --- |
| Individual download threshold | Fewer than 100 files in the manifest |
| Concurrent file downloads | 2 |
| Attempts per file | 5, backoff `500ms * 2^(n-1)`, capped at 10 s |
| Retryable | Request and read errors, HTTP 5xx, HTTP 429 |
| Resume | `Range: bytes=<size>-`. Append only on 206. On 200, rewrite the file and subtract counted bytes. |
| Writer queues | 32 chunks with a 4 MiB buffer (package), 16 chunks (individual) |
| Speed limit | Re-read from settings every second |
| Progress events | At most every 200 ms for downloads, 100 ms for extraction |
| Progress ranges | Download 0-60 (install) or 0-100 (download-only). Portable extraction 60-95, move at 96. Installer extraction 60-85, then 86, 87, 97. Linux installer step at 88. |
| Download fallback | Manifest 404 goes to `download-ticket`. A 404 from `/download` tries the ticket once. |
| Default filename | `game-<id>.tar` |
| Cleanup retries | 20 attempts, backoff `200ms * n`, capped at 2 s |
| Installer poll | 120 ms. UMU poll 250 ms. |
| Log tail | 40 lines |

## 8. Tests

- **Port the Rust tests.** Every Rust test gets a C# equivalent in `tests/claudio-core-cs`, using the same name in PascalCase, so a side-by-side count proves nothing was lost. Tests for audio muting are the only exception. The Rust tests stay and keep running.
- **Isolation.** Tests that touch the data directory override use `[NotInParallel]`, matching the Rust `serial_test` and lock approach.
- **Contract suite.** Runs against the Rust binary and the C# Native AOT binary on both operating systems, so differences between them and trimming or source-generated JSON faults appear.
- **Data compatibility.** Files written by Rust load in C#, and files written by C# load in Rust.
- **New tests.** One per item in section 6 and per phase 0 finding.
- **Corruption matrix.** ZIP, tar.gz, and each 7z method, with damaged and truncated input.
- **Fixtures.** Golden files from phase 1 must round-trip.

## 9. Definition of done

Before the phase 8 decision:

- [ ] All Rust code and tests are still in place, and still pass in CI.
- [ ] A package built with `sidecar: rust` contains the same files as before this work.
- [ ] Every Rust test has a C# equivalent, and all pass on Linux and Windows.
- [ ] Contract suite passes against the Rust binary and the C# Native AOT builds on both platforms.
- [ ] All 29 protocol methods behave identically, apart from the intentional changes in section 6. `compare-sidecars.mjs` shows nothing beyond its allow-list.
- [ ] Existing `settings.json` and `installed-games.json` load unchanged after an auto-update, and files written by C# load in Rust.
- [ ] Old `uninstall.exe` copies still uninstall, and new ones work on games installed before the update.
- [ ] Real installs: portable ZIP, tar.gz and 7z, Inno Setup, GOG, NSIS and MSI on Windows, including UAC, cancel, and restart-interactive.
- [ ] Real installs through Proton on Linux and SteamOS, including Steam shortcut and `.desktop` entries.
- [ ] Large-archive check with real game data. Record install time against Rust, including the 2-3x library difference that 7-Zip is meant to remove.
- [ ] Sidecar and uninstaller sizes recorded. Installer size growth accepted.
- [ ] 7-Zip licence items from phase 7 are in the packages and on the release.
- [ ] `vp check` and `vp test` pass in `src/claudio-electron`, and `node --test scripts/*.test.cjs` passes.
- [ ] Packaged-app smoke tests pass in the release workflow.
- [ ] Beta auto-update from the last Rust release confirmed on both platforms.
- [ ] Comparison from phase 8 written up, and the project owner has decided.

## 10. Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| A Windows installer edge case regresses | Medium | High | Direct port of Win32 calls, real installer matrix, keep Rust until a healthy release |
| Rust and C# drift apart during the port | Medium | Medium | Same contract suite and comparison script on both in CI, and Rust fixes get ported |
| Keeping both slows CI and adds upkeep | Certain | Low | Accepted until the decision, then one side is removed |
| Native AOT fails only in published builds | Medium | Medium | Warnings as errors, contract suite on AOT builds |
| HTTPS fails on a host missing OpenSSL | Low | High | Phase 0 test, static linking if supported |
| Defender flags the uninstaller's self-copy | Unknown | Medium | Phase 0 test. Reputation may need code signing, which CI turns off today. |
| Cannot build for Windows from Linux | Certain | Low | Windows CI. `cargo-xwin` has no equivalent, so local Windows checks need CI or a VM. |
| CsWin32 is prerelease-labelled on NuGet | Low | Low | Pin the version. Generated code can be replaced with hand-written bindings. |
| Binary size grows | Certain | Low | About 2 MB for the Windows test binary before HTTP and JSON. Rust comparison was 1.1 MB on Linux. Accept after measuring. |
| 7-Zip supply chain | Low | High | Pinned version and SHA-256, official source only |

## 11. Effort

Estimates for one developer who knows C# and has access to Windows and Linux test machines. These are judgement, not measurement.

| Phase | Estimate |
| --- | --- |
| 0. Close unknowns | 2-3 days |
| 1. Contract tests | 3-4 days |
| 2. Side-by-side setup | 1-2 days |
| 3. Foundation | 2-3 days |
| 4. Downloads and extraction | 3-5 days |
| 5. Windows integration and uninstaller | 4-6 days |
| 6. Linux integration | 3-4 days |
| 7. Tooling and packaging | 2-3 days |
| 8. Compare and decide, then remove one side | 2-3 days, plus time on a beta |
| **Total** | **About 4-6 weeks** |

This replaces the earlier rough estimate of 2-4 weeks, because it now includes the contract suite, the real installer matrix and a beta cycle.

## 12. Other notes

- **Licence:** the repo has no licence file at its root, and GitHub detects none. This does not conflict with 7-Zip, but it should be a deliberate choice.
- **First step:** phase 0. Nothing else should start until it passes.
