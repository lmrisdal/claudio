This file provides guidance to Claude Code (claude.ai/code) and other AI agents when working with code in this repository.

## Build & Run Commands

### Backend (.NET 10)

```bash
dotnet build src/claudio-api               # build API
dotnet run src/claudio-api                 # run API (serves on port 8080)
dotnet test --project tests/claudio-api    # run API tests only
```

### Frontend (React + Vite)

```bash
cd src/claudio-web
vp install                                # install deps
vp dev                                    # dev server with HMR (port 5173, proxies /api to :8080)
vp build                                  # production build → src/claudio-api/wwwroot/
npx tsc --noEmit                          # type-check without emitting
vp lint .                                 # ESLint
```

### Desktop (Electron + C# sidecar)

```bash
dotnet build src/claudio-core                      # JIT build → artifacts/claudio-core/debug/
dotnet test --project tests/claudio-core           # unit tests
dotnet publish src/claudio-core -c Release -r linux-x64 -o artifacts/claudio-core/publish   # Native AOT
node scripts/fetch-7zip.mjs linux artifacts/7-zip  # pinned, hash-verified 7-Zip
node scripts/stage-sidecar.mjs                     # copy the sidecar for electron-builder
cd src/claudio-electron
vp install
vp run dev                                         # bundles the shell and starts Electron
vp run package                                     # AppImage / NSIS installer into release/
vp check && vp test                                # lint, type-check and unit tests
CLAUDIO_CORE_PATH=$PWD/../../artifacts/claudio-core/debug/claudio-core vp test   # shell contract suite
```

### Docker

```bash
docker compose -f docker/docker-compose.yml up --build
```

### Windows test VM (Windows behaviour from a Linux host)

`scripts/windows-vm.sh` runs a Windows 11 VM ([dockur/windows](https://github.com/dockur/windows) under rootless podman with KVM). Use it to test Windows-only code (`src/claudio-core/Windows/`, the Rust `windows_integration/`, installers, the uninstaller) instead of guessing. Native AOT cannot cross-compile to Windows, so Windows binaries are built inside the VM.

```bash
scripts/windows-vm.sh status                  # container state and whether SSH answers; run this first
scripts/windows-vm.sh up                      # start it (it is stopped when not in use)
scripts/windows-vm.sh wait                    # block until SSH answers after a start
scripts/windows-vm.sh push                    # copy the working tree to C:\claudio (push --clean wipes it first)
scripts/windows-vm.sh run 'dotnet test --project tests/claudio-core'
scripts/windows-vm.sh run 'cd src/claudio-electron; $env:CLAUDIO_CORE_PATH="C:\claudio\artifacts\claudio-core\publish\claudio-core.exe"; vp test tests/core- tests/real-core'
scripts/windows-vm.sh run 'dotnet publish src/claudio-core -c Release -r win-x64 -o artifacts/claudio-core/publish'
scripts/windows-vm.sh desktop 'artifacts\claudio-core\publish\claudio-core.exe < request.jsonl'
scripts/windows-vm.sh snapshot clean          # save the disk (stops the VM); restore clean rolls back
scripts/windows-vm.sh down
```

- **`run` is not a normal user.** It is PowerShell over SSH as an administrator with a full token and no desktop, so UAC never prompts, error 740 never happens and `__COMPAT_LAYER=RunAsInvoker` changes nothing. Use it for builds and unit tests only.
- **`desktop` is a normal user.** It runs a `cmd` command line in the signed-in desktop session with the UAC-filtered token, the way Claudio runs for real users, and prints its output and exit code. Use it for installers, elevation, game launch, shortcuts and the uninstaller.
- **UAC prompts and dialogs** appear on the VM screen. Open `http://127.0.0.1:8006/vnc.html?autoconnect=true&resize=scale` in the built-in browser to see them and click through (the plain `:8006` page does not scale to the pane, so clicks miss). The secure desktop is visible there. A `desktop` command that triggers a prompt blocks until it is answered, so run it in the background. Ask the user before approving a prompt that would change something outside the VM test data.
- **Quoting:** `desktop` commands pass through bash, PowerShell and `cmd`. For anything with quotes, copy a `.ps1` or `.cmd` into the VM (`push`, or `scp` with the VM key) and run that file.
- **What the shell suite covers on Windows:** the contract suite only targets the C# sidecar there, and the download and Linux tests skip themselves, so a Windows run covers the contract, golden-file and `core-windows` tests.
- **Reset between installer tests:** `restore clean`, then `up` and `wait`. Snapshots are reflink copies on btrfs, so they are instant. Never leave the VM in a state the next test depends on without a snapshot.
- **Files:** `pull <remote> <local>` copies a file out. The host folder `~/.local/share/claudio-winvm/shared` is `Z:` in Windows.
- **State** (disk, snapshots, SSH key, generated password) lives in `~/.local/share/claudio-winvm`, outside the repo. All ports listen on 127.0.0.1 only.
- **First-time setup** (already done on this machine): `up`, `wait` (Windows installs itself, 20-40 minutes), `provision` (.NET 10 SDK, MSVC build tools for Native AOT, Node.js, Vite+, Rust, and UAC switched back on, since the dockur install turns it off), then `snapshot clean`.

## Architecture

Monorepo with a Rust API, an Electron desktop client backed by a Rust sidecar, and a React frontend:

- **`src/claudio-api`** — Axum-based Rust API. Serves the SPA as static files and provides REST endpoints.
- **`src/claudio-core`** — Headless C# (.NET Native AOT) sidecar for the desktop app: installs, game launching, Proton/umu. JSON lines over stdio, no UI dependencies.
- **`src/claudio-electron`** — Electron shell: windows, tray, `claudio-app://` and `claudio://api` protocols, auto-updates, packaging with electron-builder.
- **`src/claudio-web/`** — React 19 SPA built with Vite. Output goes to `src/claudio-api/wwwroot/`. Uses TanStack React Query for data fetching, React Router for routing, Tailwind CSS v4 (via Vite plugin, no tailwind.config).
- **`tests/claudio-api-rs/`** — Rust integration test crate for API behavior.
- **`tests/claudio-core/`** — Rust integration tests for the sidecar.

### Backend structure

Routes live under `src/claudio-api/src/routes/`, database entities are under `src/claudio-api/src/entity/`, and the app uses SeaORM with SQLite and PostgreSQL support.

### Configuration

TOML config loaded from `CLAUDIO_CONFIG_PATH` env var or `/config/config.toml`. See `config/config.example.toml` for schema. Local dev config is at `config/config.toml` (gitignored, contains secrets).

### Code style

- React components are `PascalCase`, hooks are `useCamelCase`.
- Tailwind classes are used for styling in JSX, with semantic tokens for colors and spacing.
- Only one React component per file.
- Avoid useEffect where possible. See: https://react.dev/learn/you-might-not-need-an-effect
- Limit source files to 400 lines for readability. If a file grows too large, consider splitting it into smaller components or modules.
- Avoid comments that explain "what" the code is doing — the code should be self-explanatory. Use comments to explain "why" if the reasoning is not obvious.

### Frontend patterns

- API client at `src/claudio-web/src/api/client.ts` — wraps fetch with JWT auth header injection and error handling.
- Auth context at `src/claudio-web/src/hooks/useAuth.tsx` — JWT parsing, login/register/logout.
- CSS theming uses custom properties in `index.css` (`:root` for dark, `.light` for light mode) with Tailwind semantic tokens (`text-text-primary`, `bg-surface`, `bg-surface-raised`, etc.).
- TypeScript strict mode with `verbatimModuleSyntax` — use `import type` for type-only imports.

<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, but it invokes Vite through `vp dev` and `vp build`.

## Vite+ Workflow

`vp` is a global binary that handles the full development lifecycle. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

### Start

- create - Create a new project from a template
- migrate - Migrate an existing project to Vite+
- config - Configure hooks and agent integration
- staged - Run linters on staged files
- install (`i`) - Install dependencies
- env - Manage Node.js versions

### Develop

- dev - Run the development server
- check - Run format, lint, and TypeScript type checks
- lint - Lint code
- fmt - Format code
- test - Run tests

### Execute

- run - Run monorepo tasks
- exec - Execute a command from local `node_modules/.bin`
- dlx - Execute a package binary without installing it as a dependency
- cache - Manage the task cache

### Build

- build - Build for production
- pack - Build libraries
- preview - Preview production build

### Manage Dependencies

Vite+ automatically detects and wraps the underlying package manager such as pnpm, npm, or Yarn through the `packageManager` field in `package.json` or package manager-specific lockfiles.

- add - Add packages to dependencies
- remove (`rm`, `un`, `uninstall`) - Remove packages from dependencies
- update (`up`) - Update packages to latest versions
- dedupe - Deduplicate dependencies
- outdated - Check for outdated packages
- list (`ls`) - List installed packages
- why (`explain`) - Show why a package is installed
- info (`view`, `show`) - View package information from the registry
- link (`ln`) / unlink - Manage local package links
- pm - Forward a command to the package manager

### Maintain

- upgrade - Update `vp` itself to the latest version

These commands map to their corresponding tools. For example, `vp dev --port 3000` runs Vite's dev server and works the same as Vite. `vp test` runs JavaScript tests through the bundled Vitest. The version of all tools can be checked using `vp --version`. This is useful when researching documentation, features, and bugs.

## Common Pitfalls

- **Using the package manager directly:** Do not use pnpm, npm, or Yarn directly. Vite+ can handle all package manager operations.
- **Always use Vite commands to run tools:** Don't attempt to run `vp vitest` or `vp oxlint`. They do not exist. Use `vp test` and `vp lint` instead.
- **Running scripts:** Vite+ built-in commands (`vp dev`, `vp build`, `vp test`, etc.) always run the Vite+ built-in tool, not any `package.json` script of the same name. To run a custom script that shares a name with a built-in command, use `vp run <script>`. For example, if you have a custom `dev` script that runs multiple services concurrently, run it with `vp run dev`, not `vp dev` (which always starts Vite's dev server).
- **Do not install Vitest, Oxlint, Oxfmt, or tsdown directly:** Vite+ wraps these tools. They must not be installed directly. You cannot upgrade these tools by installing their latest versions. Always use Vite+ commands.
- **Use Vite+ wrappers for one-off binaries:** Use `vp dlx` instead of package-manager-specific `dlx`/`npx` commands.
- **Import JavaScript modules from `vite-plus`:** Instead of importing from `vite` or `vitest`, all modules should be imported from the project's `vite-plus` dependency. For example, `import { defineConfig } from 'vite-plus';` or `import { expect, test, vi } from 'vite-plus/test';`. You must not install `vitest` to import test utilities.
- **Type-Aware Linting:** There is no need to install `oxlint-tsgolint`, `vp lint --type-aware` works out of the box.

## CI Integration

For GitHub Actions, consider using [`voidzero-dev/setup-vp`](https://github.com/voidzero-dev/setup-vp) to replace separate `actions/setup-node`, package-manager setup, cache, and install steps with a single action.

```yaml
- uses: voidzero-dev/setup-vp@v1
  with:
    cache: true
- run: vp check
- run: vp test
```

## Review Checklist for Agents

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to validate changes.
<!--VITE PLUS END-->

### Controller and keyboard navigation

- SPA is fully keyboard- and controller-navigable with proper focus management and ARIA attributes.
- All interactive elements (buttons, links) are accessible via keyboard, gamepads and screen readers.
- Focus states are clearly visible, and the tab order is logical and intuitive.
- Arrow keys and gamepad navigation work seamlessly for browsing game lists, menus, and dialogs.
- Dialogs trap focus and can be dismissed with Escape key or gamepad B button. When more dialogs are added, ensure they stack properly and manage focus correctly.

## Git Conventions

- All changes must be made in a feature branch, never directly on `main`.
- Make sure to pull the latest `main` and rebase your branch before pushing.
- Feature branches must use the `feature/` prefix (e.g. `feature/normalize-pc-to-win-platform`).

## Key Conventions

- The SPA is served by the Rust API from `wwwroot` with an `index.html` fallback.
- Desktop-only code in the SPA talks to the shell through `src/claudio-web/src/features/desktop/hooks/desktop-bridge.ts` (`window.claudioDesktop`). Do not import Electron or Node APIs in the SPA.
- Game downloads use streaming with `enableRangeProcessing` for resume support.
- IGDB integration authenticates via Twitch OAuth (client credentials flow).

## Testing

- **New features must include tests.** Add or update Rust tests for isolated logic and endpoint behavior.
- **Changes to existing code must run relevant tests** (`cargo test`). If behavior changes, update the tests to match.
- API integration tests live in `tests/claudio-api-rs/`.
