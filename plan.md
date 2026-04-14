# Claudio Backend: .NET → Rust + Axum Migration Plan

## Current API Surface

The backend has ~60 endpoints across these groups:

- **Health** — 1 endpoint
- **Connect/Auth** — OAuth2 token endpoint, userinfo, registration, external OAuth (GitHub/Google/OIDC), proxy auth (~15 endpoints)
- **Games** — CRUD, file browsing, downloads with range support, emulation file serving (~15 endpoints)
- **Save States** — CRUD with multipart upload + AVIF conversion (6 endpoints)
- **Admin** — user management, library scan, IGDB, compression, SteamGridDB, config (~20 endpoints)
- **Background services** — periodic library scan, IGDB scan, compression queue

## Transition Strategy

This is a hard swap — no backward compatibility with the .NET backend is needed. No data migration for users; all users start fresh. Game metadata can optionally be migrated via a simple SQL copy of the `games` table.

## Code Standards

- Follow idiomatic Rust best practices: proper error handling with `Result`/`?`, strong typing, ownership patterns, and the type system to prevent bugs at compile time.
- Code must be readable and self-explanatory. Comments are not allowed unless they explain a non-obvious "why" — never comment "what" the code does.
- Use meaningful names for types, functions, and variables. Prefer clarity over brevity.
- Leverage Rust's module system for clear organization. Keep files focused and reasonably sized.
- Use `clippy` with default lints. All warnings must be resolved.
- Prefer `thiserror` for custom error types over ad-hoc string errors.
- Use `#[must_use]` where appropriate. Avoid `unwrap()`/`expect()` in production code paths — propagate errors instead.
- Limit source files to 400 lines for readability. If a file grows too large, consider splitting it into smaller components or modules.

## Logging

Use `tracing` throughout the entire application with appropriate log levels so the container log level can be configured externally (e.g., `RUST_LOG=info` or `RUST_LOG=claudio_api=debug`).

- **`error`** — unrecoverable failures: DB connection lost, signing key unreadable, background task panics
- **`warn`** — recoverable issues: failed login attempts, missing game files during scan, expired tickets
- **`info`** — operational events: server startup/shutdown, library scan completed, user registered, game added/removed, compression finished
- **`debug`** — request-level detail: incoming requests (via `tower-http::trace`), query parameters, auth decisions, IGDB API calls
- **`trace`** — fine-grained internals: SQL queries, file I/O operations, token serialization

Use `tracing-subscriber` with `EnvFilter` for runtime log level control. JSON output for production, pretty-printed for development.

## Architectural Decisions

| Decision         | Choice                        | Rationale                                                                    |
| ---------------- | ----------------------------- | ---------------------------------------------------------------------------- |
| HTTP             | Axum 0.8                      | Tower ecosystem, typed extractors, great ergonomics                          |
| Database         | SeaORM                        | Entity derives, migration CLI, partial updates via ActiveModel, sits on SQLx |
| Auth             | Custom JWT via `jsonwebtoken` | Same `/connect/token` contract, RSA-signed JWTs                              |
| Password hashing | Argon2                        | Clean start, no legacy hash compat needed                                    |
| OAuth client     | `oauth2` + `openidconnect`    | GitHub, Google, generic OIDC flows                                           |
| Config           | `toml` + `serde`              | Direct mapping of current TOML config                                        |
| Background tasks | `tokio::spawn`                | Replaces .NET BackgroundService                                              |
| Ticket stores    | `DashMap` with TTL            | Replaces ConcurrentDictionary-based stores                                   |

## Database Schema

Clean schema with 4 tables (down from 11+ in the .NET version):

- **`users`** — id, username, password_hash, email, role, created_at
- **`user_external_logins`** — user_id, provider, provider_key
- **`refresh_tokens`** — token_hash, user_id, expires_at
- **`games`** — same 22 columns as current schema

No user migration — all users start fresh.

## Project Structure

The new API crate joins the existing Cargo workspace (alongside `claudio-desktop`) rather than being standalone. This enables shared types/crates between the API and desktop app if needed later.

```
src/claudio-api/
  Cargo.toml
  src/
    main.rs                 # entry point, config, server startup
    config.rs               # ClaudioConfig serde structs, TOML + env loading
    db.rs                   # SeaORM database connection setup
    auth/
      jwt.rs                # RSA key loading, sign/verify
      middleware.rs          # Axum extractor for authed user + admin guard
      password.rs            # Argon2 hash + verify
    entity/
      user.rs
      user_external_login.rs
      game.rs
      refresh_token.rs
    models/
      user.rs, game.rs
    routes/
      health.rs, connect.rs, auth.rs, games.rs,
      admin.rs
    services/
      igdb.rs, library_scan.rs, download.rs,
      ticket.rs, compression.rs, config_file.rs,
      oauth/{github,google,oidc,state_store}.rs
    util/
      archive.rs, file_browse.rs, emulation.rs
  migration/
    src/
      lib.rs
      m20260414_000001_initial.rs
```

## Dependencies

```toml
[dependencies]
axum = "0.8"
tokio = { version = "1", features = ["full"] }
tower-http = { version = "0.6", features = ["cors", "fs", "trace"] }
sea-orm = { version = "1", features = ["sqlx-sqlite", "sqlx-postgres", "runtime-tokio-rustls"] }
sea-orm-migration = "1"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
toml = "0.8"
jsonwebtoken = "9"
argon2 = "0.5"
rsa = "0.9"
rand = "0.9"
oauth2 = "5"
openidconnect = "4"
reqwest = { version = "0.12", features = ["json", "rustls-tls"] }
dashmap = "6"
tracing = "0.1"
tracing-subscriber = "0.3"
zip = "2"
tar = "0.4"
flate2 = "1"
chrono = { version = "0.4", features = ["serde"] }
base64 = "0.22"
thiserror = "2"
```

## Phased Implementation

### Phase 1: Scaffolding & Core Infrastructure

Bootable Axum server with config loading, database, and health endpoint.

- [x] Create `src/claudio-api/` as a new Cargo project
- [x] Implement `config.rs` — serde structs mirroring `ClaudioConfig`, TOML loading, env var overrides
- [x] Implement `db.rs` — SeaORM connection setup for SQLite or PostgreSQL based on config
- [x] Write initial migration: `users`, `user_external_logins`, `games`, `refresh_tokens`
- [x] Implement `routes/health.rs` — `GET /health`
- [x] Implement `main.rs` — config load, DB connection, Axum router, static file serving with SPA fallback, CORS
- [x] Graceful shutdown via `tokio::signal` — drain connections and flush background tasks on SIGTERM/SIGINT
- [x] Configure request body size limits (sensible defaults, larger limit for multipart upload routes)
- [x] **Verify**: `cargo run` starts, `GET /health` returns `{ "status": "ok" }`, SPA loads from `wwwroot/`

### Phase 2: Authentication

Full auth flow compatible with the existing frontend. This is the hardest phase.

- [x] Implement `auth/password.rs` — Argon2 hash + verify
- [x] Implement `auth/jwt.rs` — load or generate RSA key, sign/verify JWTs with `sub`, `name`, `role` claims
- [x] Implement `auth/middleware.rs` — Axum `FromRequestParts` extractor for authenticated user, admin guard, NoAuth mode
- [x] Implement `routes/connect.rs`:
  - `POST /connect/token` supporting password, refresh_token, `urn:claudio:proxy_nonce`, `urn:claudio:external_login_nonce` grants
  - `GET /connect/userinfo`
  - Response format must match: `{ access_token, token_type: "Bearer", expires_in, refresh_token, scope }`
- [x] Implement `routes/auth.rs` — register, proxy auth, providers list, me, change-password
- [x] Implement nonce/state stores — `DashMap`-based with TTL

### Phase 3: Game Endpoints

All game CRUD and browsing.

- [x] Implement `routes/games.rs`:
  - `GET /api/games` with platform/search filtering
  - `GET /api/games/{id}`
  - `GET /api/games/{id}/executables`
  - `GET /api/games/{id}/browse`
  - `GET /api/games/{id}/emulation`
  - `POST /api/games/{id}/emulation/session`
  - `GET /api/games/{id}/emulation/files/{ticket}/{*path}`
- [x] Implement `util/archive.rs` — zip/tar/iso reading
- [x] Implement `util/file_browse.rs` — filesystem + archive browsing
- [x] Implement `util/emulation.rs` — platform definitions, candidate selection
- [x] Implement `services/ticket.rs` — `DashMap`-based ticket stores

### Phase 4: Downloads & File Serving

Game downloads with range request support.

- [x] Implement `services/download.rs` — tar creation
- [x] Add download endpoints:
  - `POST /api/games/{id}/download-ticket`
  - `GET /api/games/{id}/download` — stream with range support
  - `GET /api/games/{id}/download-files-manifest`
  - `GET /api/games/{id}/download-files`
  - `GET /api/games/{id}/installer-inspection`

### Phase 5: Removed Scope

Save states are being removed rather than ported to Rust.

- [x] Exclude save state functionality from the Rust migration scope

### Phase 6: Admin Endpoints

All admin functionality.

- [x] User management (list, delete, role update)
- [x] Library scan trigger
- [x] Game update, delete, delete missing
- [x] Image upload
- [x] Config get/update
- [x] SteamGridDB proxy endpoints
- [x] Task status aggregation

### Phase 7: Background Services

- [x] `services/library_scan.rs` — filesystem scanner, periodic scan every 2 minutes
- [x] `services/igdb.rs` — Twitch OAuth + IGDB API v4, background scan
- [x] IGDB admin endpoints (`/admin/games/{id}/igdb/search`, `/admin/igdb/search`, `/admin/games/{id}/igdb/apply`)
- [x] `services/compression.rs` — `tokio::sync::mpsc` channel-based queue
- [x] Compression admin endpoints (`/admin/games/{id}/compress`, `/admin/games/{id}/compress/cancel`, `/admin/compress/status`)

### Phase 8: OAuth Providers

- [x] `services/oauth/github.rs` — GitHub OAuth via `oauth2` crate
- [x] `services/oauth/google.rs` — Google OAuth via `oauth2` crate
- [x] `services/oauth/oidc.rs` — generic OIDC via `openidconnect` crate
- [x] Add redirect/callback routes to `routes/oauth.rs`

### Phase 9: Testing

- [x] Integration test harness — temp SQLite DB, in-process Axum router via `tower::ServiceExt`
- [x] Port existing tests: health, auth, games, admin
- [x] Port config coverage: config loading/env overrides and admin config update/masking edge cases
- [x] Port library scan coverage: platform normalization, exclusions, hidden dirs, missing-game marking, multi-path scans
- [x] Port ticket coverage: download/emulation ticket routes plus proxy/external nonce stores
- [x] Do not port save state tests; save state functionality is removed from the Rust migration scope

### Phase 10: Docker & Deployment

- [ ] Multi-stage Dockerfile: build frontend (unchanged) → build Rust API (`rust:alpine` + musl) → runtime (`alpine`)
- [ ] Verify docker-compose works unchanged (same env vars, same volumes)
- [ ] Update `AGENTS.md` with new build commands

## Frontend Compatibility Checklist

The frontend stays completely unchanged. Critical contracts:

- `/connect/token` accepts `application/x-www-form-urlencoded`, returns `{ access_token, token_type, expires_in, refresh_token, scope }`
- All JSON uses camelCase (`#[serde(rename_all = "camelCase")]`)
- Enums serialize as lowercase strings
- Static files from `wwwroot/` with `index.html` fallback
- Images served from `{config_dir}/images/`
- CORS: allow all origins with credentials
- Error responses: plain text bodies (frontend reads `response.text()`)

## Key Risks

| Risk                                   | Mitigation                                                       |
| -------------------------------------- | ---------------------------------------------------------------- |
| JWT signing key format mismatch        | Load same RSA key file; verify JWT structure matches             |
| SQLite vs PostgreSQL query differences | Test all queries against both; SeaORM abstracts most differences |
| Frontend error format assumptions      | Match plain-text error bodies                                    |
| Existing refresh tokens invalidated    | Users re-login once after migration                              |

## Expected Outcome

- **RAM**: 150–200 MB → ~15–30 MB
- **Docker image**: ~300 MB → ~30 MB (static musl binary)
- **Cold start**: ~2s → <100ms
- **Same API, same frontend, same config format**
