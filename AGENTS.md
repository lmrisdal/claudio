@DESIGN_SKILL.md

This file provides guidance to Claude Code (claude.ai/code) and other AI agents when working with code in this repository.

## Build & Run Commands

### Backend (.NET 10)

```bash
dotnet build src/Claudio.Api                        # build API
dotnet run --project src/Claudio.Api                # run API (serves on port 5118)
dotnet test                                         # run all tests
dotnet test --project tests/Claudio.Api.Tests       # run API tests only
```

### Frontend (React + Vite)

```bash
cd frontend
npm install                               # install deps
npm run dev                               # dev server with HMR (port 5173, proxies /api to :5118)
npm run build                             # production build → src/Claudio.Api/wwwroot/
npx tsc --noEmit                          # type-check without emitting
npm run lint                              # ESLint
```

### EF Core Migrations

```bash
dotnet ef migrations add <Name> --project src/Claudio.Api
dotnet ef database update --project src/Claudio.Api
```

### Docker

```bash
docker compose -f docker/docker-compose.yml up --build
```

## Architecture

Monorepo with three .NET projects and a React frontend:

- **`src/Claudio.Api`** — ASP.NET minimal API. Serves the SPA as static files and provides REST endpoints. Uses **minimal APIs with route groups**, not controllers.
- **`src/Claudio.Shared`** — Shared DTOs (`GameDto`, `UserDto`, `ClaudioConfig`) and enums (`UserRole`, `InstallType`). Referenced by both API and Desktop.
- **`src/Claudio.Desktop`** — Future Avalonia UI client (stub).
- **`frontend/`** — React 19 SPA built with Vite. Output goes to `src/Claudio.Api/wwwroot/`. Uses TanStack React Query for data fetching, React Router for routing, Tailwind CSS v4 (via Vite plugin, no tailwind.config).
- **`tests/Claudio.Api.Tests/`** — TUnit + AwesomeAssertions test project.

### Backend structure

Endpoints are in `src/Claudio.Api/Endpoints/` as static classes with extension methods. Services are singletons registered in `Program.cs`. Database is EF Core with `AppDbContext` containing `Users` and `Games` tables, supporting SQLite and PostgreSQL.

### Configuration

TOML config loaded from `CLAUDIO_CONFIG_PATH` env var or `/config/config.toml`. See `config/config.example.toml` for schema. Local dev config is at `config/config.toml` (gitignored, contains secrets).

### Frontend patterns

- API client at `frontend/src/api/client.ts` — wraps fetch with JWT auth header injection and error handling.
- Auth context at `frontend/src/hooks/useAuth.tsx` — JWT parsing, login/register/logout.
- CSS theming uses custom properties in `index.css` (`:root` for dark, `.light` for light mode) with Tailwind semantic tokens (`text-text-primary`, `bg-surface`, `bg-surface-raised`, etc.).
- TypeScript strict mode with `verbatimModuleSyntax` — use `import type` for type-only imports.

### Package management

NuGet versions are centralized in `Directory.Packages.props` — add versions there, not in individual `.csproj` files.

## Key Conventions

- **Minimal APIs only** — never use MVC controllers.
- JSON serialization uses `JsonStringEnumConverter` with camelCase — enums serialize as lowercase strings.
- The SPA is served via `UseStaticFiles` + `MapFallbackToFile("index.html")`.
- Game downloads use streaming with `enableRangeProcessing` for resume support.
- IGDB integration authenticates via Twitch OAuth (client credentials flow).

## Testing

- **New features must include tests.** Write unit tests for isolated logic (services, stores) and integration tests using `WebApplicationFactory<Program>` for endpoint behavior.
- **Changes to existing code must run relevant tests** (`dotnet test`). If changes break existing tests, update the tests to match the new behavior — do not delete tests without replacement.
- Tests use **TUnit** (`[Test]` attribute) and **AwesomeAssertions** (`.Should()` fluent API).
- Use `[NotInParallel]` for tests that mutate process-global state (e.g. environment variables, shared `WebApplicationFactory` instances).
- Integration tests use `ClaudioWebApplicationFactory` (in the test project) which provides an isolated SQLite DB and test config per factory instance.
