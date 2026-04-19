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

### Desktop (Tauri)

```bash
./scripts/check-windows-xwin.sh           # cross-check Windows desktop + uninstaller via cargo-xwin
./scripts/build-windows-xwin.sh           # cross-build Windows desktop + uninstaller via cargo-xwin
```

### Docker

```bash
docker compose -f docker/docker-compose.yml up --build
```

## Architecture

Monorepo with a Rust API, Tauri desktop client, and a React frontend:

- **`src/claudio-api`** — Axum-based Rust API. Serves the SPA as static files and provides REST endpoints.
- **`src/claudio-desktop`** — Tauri desktop client.
- **`src/claudio-web/`** — React 19 SPA built with Vite. Output goes to `src/claudio-api/wwwroot/`. Uses TanStack React Query for data fetching, React Router for routing, Tailwind CSS v4 (via Vite plugin, no tailwind.config).
- **`tests/claudio-api-rs/`** — Rust integration test crate for API behavior.

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
- Game downloads use streaming with `enableRangeProcessing` for resume support.
- IGDB integration authenticates via Twitch OAuth (client credentials flow).

## Testing

- **New features must include tests.** Add or update Rust tests for isolated logic and endpoint behavior.
- **Changes to existing code must run relevant tests** (`cargo test`). If behavior changes, update the tests to match.
- API integration tests live in `tests/claudio-api-rs/`.
