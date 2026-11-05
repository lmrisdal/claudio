# claudio-api: C# → Rust migration plan

Goal: replace the .NET 10 `src/claudio-api` with a Rust crate so the repo has one backend language, without breaking the SPA or the desktop app.

## Current state

- About 3,900 lines of C#: 4 endpoint groups (31 routes), 9 services, 2 tables (`Games`, `AppPreferences`).
- About 1,900 lines of tests in `tests/claudio-api` (TUnit + `WebApplicationFactory`).
- No authentication in the API. The download and emulation ticket systems were removed for the same reason, so there is no ticket state to port. If auth comes back, use signed short-lived URLs (HMAC of game ID + expiry) instead of a server-side ticket store.
- AGENTS.md is out of date: it describes the API as Axum + SeaORM with tests in `tests/claudio-api-rs/`, and the frontend notes mention JWT. Neither is true today. Fix this as part of the cutover.

### Routes

| Group | Routes |
|---|---|
| `/health` | `GET` |
| `/api/preferences` | `GET`, `PUT` |
| `/api/games` | `GET /`, `GET /{id}`, `/{id}/executables`, `/{id}/installer-inspection`, `/{id}/download`, `/{id}/download-files-manifest`, `/{id}/download-files`, `/{id}/download-file`, `/{id}/browse`, `/{id}/emulation`, `POST /{id}/emulation/session`, `GET`/`HEAD /{id}/emulation/files/{**path}` |
| `/api/admin` | `POST /scan`, `POST /scan/igdb`, `GET /scan/igdb/status`, `PUT /games/{id}`, `GET /games/{id}/executables`, `POST /games/{id}/igdb/search`, `POST /igdb/search`, `POST /games/{id}/igdb/apply`, `POST /games/{id}/compress`, `POST /games/{id}/compress/cancel`, `GET /compress/status`, `GET /tasks/status`, `POST /games/{id}/tag-folder`, `DELETE /games/{id}`, `DELETE /games/missing`, `GET /steamgriddb/search`, `GET /steamgriddb/{id}/covers`, `GET /steamgriddb/{id}/heroes`, `POST /games/{id}/upload-image` (multipart), `GET /config`, `PUT /config` |
| Static | `wwwroot` (SPA), `/images` (from the config dir), `index.html` fallback |

## Crate layout

`src/claudio-api` becomes a Cargo workspace member next to `src/claudio-desktop/core`. Integration tests go in `tests/claudio-api-rs`.

| C# | Rust |
|---|---|
| ASP.NET minimal APIs | `axum` + `tower-http` (CORS, `ServeDir` for `wwwroot` and `/images`, SPA fallback) |
| EF Core (SQLite + Npgsql) | SeaORM (or `sqlx` with the `Any` driver) |
| EF migrations | A fresh initial migration, including `IgdbAttemptedAt` and `HeroAttemptedAt`. No compatibility with existing EF databases: the one live server will be set up again by hand. |
| Tomlyn config, `ConfigLoader`, `ConfigFileService` | `serde` + `toml`, with the same env overrides and write-back |
| `BackgroundService` + `Channel` | `tokio::spawn` workers + `mpsc`, shut down through `tokio_util::sync::CancellationToken` |
| `IHttpClientFactory` | One shared `reqwest::Client` |
| SharpCompress / `ZipArchive` / `TarWriter` | `zip`, `sevenz-rust2` (already used by core), `tar` + `flate2`. ISO files are passed through unchanged. |
| Range downloads | `tower-http` `ServeFile` for single files; custom streaming for zipped downloads and the manifest |
| `JsonStringEnumConverter(CamelCase)` | `#[serde(rename_all = "camelCase")]` |
| `ILogger` | `tracing` + `tracing-subscriber`, with the level taken from `server.log_level` |

Consider moving the archive helpers from `claudio-core` into a small shared crate, so the API can use them without pulling in desktop-only dependencies.

## Phases

Each phase ends with the SPA still working against the new server.

1. **Skeleton.** Config loading, DB connection and migrations, `/health`, static files and SPA fallback, CORS. Switch the Dockerfile to a Rust build stage.
2. **Library scan.** Platform and game directory walk, `pc` → `win` platform normalisation, hidden names, excluded platforms, archive files as games, `DetectInstallType`, size calculation, missing detection, compression temp-file cleanup, periodic scan task. Port `LibraryScanServiceTests` first: they are the best spec of this behaviour.
3. **Read endpoints.** `GET /api/games`, `/{id}`, `/executables`, `/browse`, `/installer-inspection`, preferences.
4. **Downloads.** Single-file Range downloads, the files manifest, archive streaming. This is the riskiest phase: test resume, slow clients and Unicode filenames (`UnicodeDownloadTests`).
5. **Metadata.** IGDB client (Twitch client-credentials token, Apicalypse queries, folder-name parsing, candidate selection) and SteamGridDB. Keep the attempted-at backoff from the C# fix: automatic sweeps skip games tried within 7 days, and the manual IGDB scan forces a retry. Port `MetadataBackgroundServiceTests`.
6. **Admin.** Compression queue and cancel, tag-folder, delete and delete-missing, image upload, config GET/PUT, task status.
7. **Emulation.** Platform definition table, session endpoint (returns the ROM URL) and the file route.
8. **Cutover.** Port the remaining tests (`axum::Router` + `tower::ServiceExt::oneshot`, temporary SQLite DB). Delete the C# project, its test project, the `Directory.Packages.props` entries and the .NET CI steps. Update AGENTS.md, the README and Docker docs.

## Things to watch

- **Case-insensitive comparisons.** The C# code uses `OrdinalIgnoreCase` for platform names, excluded platforms, file extensions and installer names. Rust string comparisons are case-sensitive by default.
- **Slow downloads.** Kestrel's `MinResponseDataRate` is disabled so slow clients aren't dropped. Make sure no timeout layer wraps the download routes, and that streaming applies backpressure instead of buffering.
- **JSON shape.** The SPA and the desktop app depend on the camelCase field names and enum strings. Use snapshot tests on response bodies, ideally recorded from the C# server.
- **Folder-name parsing.** The current `ParseFolderName` doesn't strip tags like `(USA)`, `[T-En by …]` or Wii U title IDs, so many games never match. Port it as it is first, then improve it in a separate change with its own tests.
- **Config file write-back.** `PUT /api/admin/config` rewrites `config.toml`. Use `toml_edit` to keep comments and key order.

## Done when

- The Rust server passes the ported test suite on SQLite and Postgres.
- The SPA and the desktop app work against it with no frontend changes.
- An existing `config.toml` works without changes. The database starts fresh.
- The C# project and .NET tooling are gone from the repo, Docker and CI.
