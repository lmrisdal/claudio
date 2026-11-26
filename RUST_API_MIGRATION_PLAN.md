# Rust API migration plan

Port `src/claudio-api` (ASP.NET Core, .NET 10, about 3,700 lines without migrations) to Rust, so the backend and the desktop sidecar share one language and one toolchain. When it's done, the repo has Rust and TypeScript and no C#.

## Goals and non-goals

- Keep the HTTP API the web app and the desktop shell use today: same paths, JSON shapes (camelCase fields, camelCase enum strings), status codes and download behaviour. The frontend should not need changes. The one planned client change is in the sidecar's download progress (see File streaming).
- Keep both SQLite and PostgreSQL, chosen at runtime from `config.toml`.
- Keep the `config.toml` format and `CLAUDIO_CONFIG_PATH`.
- **No data migration.** Existing databases are not carried over; set the server up fresh and let the library scan and the IGDB/SteamGridDB sweeps fill it again. The EF Core migration history is dropped.
- Not a redesign. Behaviour changes wait until the port is done and tested.

## Target stack

| Concern | C# today | Rust |
| --- | --- | --- |
| HTTP server | ASP.NET Core minimal APIs, Kestrel | `axum` on `tokio` |
| CORS, static files, SPA fallback | `UseCors`, `UseStaticFiles`, `MapFallbackToFile` | `tower-http` (`CorsLayer`, `ServeDir` with `not_found_service(ServeFile::new("index.html"))`) |
| Database | EF Core, Sqlite and Npgsql providers | `sea-orm` with `sqlx-sqlite` + `sqlx-postgres`, `sea-orm-migration` |
| Config | Tomlyn | `serde` + `toml` to read, `toml_edit` to update credentials and keep comments |
| HTTP client | `IHttpClientFactory` | `reqwest` (rustls), one shared client |
| IGDB | `IGDB` NuGet package | Hand-written Apicalypse queries over `reqwest`, Twitch client-credentials token cached with its expiry |
| zip / tar / tar.gz | `System.IO.Compression`, `System.Formats.Tar` | `zip`, `tar`, `flate2` (the same crates `claudio-core` uses) |
| 7z | SharpCompress | `sevenz-rust2` (already used by `claudio-core`) |
| ISO 9660 / UDF | DiscUtils | See risks below |
| Background services | `BackgroundService` + `Channel<T>` | `tokio::spawn` tasks + `tokio::sync::mpsc`, `CancellationToken` from `tokio-util` |
| Logging | `ILogger`, level from config | `tracing` + `tracing-subscriber`, level from `server.log_level` |
| Tests | xUnit + `WebApplicationFactory` | `tests/claudio-api-rs`, calling the router in-process with `tower::ServiceExt::oneshot`, temp dirs with `tempfile` |

## Layout

```
src/claudio-api-rs/          # new crate, renamed to src/claudio-api once C# is deleted
  src/main.rs                # load config, connect DB, run migrations, spawn workers, serve
  src/lib.rs                 # build_app(state) -> Router, so tests can call it
  src/config.rs              # ClaudioConfig + loader + credential writer
  src/state.rs               # AppState: db, config, http client, service handles
  src/error.rs               # ApiError -> status code + body (NotFound, BadRequest, Conflict, Problem)
  src/entity/                # game.rs, app_preferences.rs
  src/migration/             # one m0001_initial migration
  src/routes/                # health.rs, games.rs, admin.rs, preferences.rs
  src/files/                 # path resolving, archive listing/reading, disc images, range streaming
  src/services/              # library_scan.rs, igdb.rs, steamgriddb.rs, compression.rs, download.rs
tests/claudio-api-rs/        # integration tests
```

Add both crates to the root `Cargo.toml` workspace. If archive reading ends up identical in the API and `claudio-core`, move it into a small shared crate later rather than up front.

## Database

One initial migration from the current model:

- **`games`**: `id` (auto-increment PK), `title`, `platform`, `folder_name`, `folder_path`, `install_type` (string: `portable` / `installer`), `summary`, `genre`, `release_year`, `cover_url`, `hero_url`, `igdb_id` (i64), `igdb_slug`, `size_bytes` (i64), `is_missing`, `installer_exe`, `game_exe`, `developer`, `publisher`, `game_mode`, `series`, `franchise`, `game_engine`, `is_processing`, `igdb_attempted_at`, `hero_attempted_at` (UTC timestamps). Unique index on `(platform, folder_name)`.
- **`app_preferences`**: `id`, `preferences_json` (default `'{}'`), `updated_at`.

Store `install_type` as a string, not an int, so the database is readable and the JSON mapping is trivial.

The two databases differ in a few places:

- **Title search** (`GET /api/games?search=`) uses `LIKE`, which is case-insensitive on SQLite and case-sensitive on Postgres. Use `LOWER(title) LIKE LOWER(?)` so both behave the same.
- **SQLite**: turn on WAL mode and a busy timeout when connecting, because the scan, the metadata workers and requests all write.
- **Timestamps**: use `DateTimeUtc` everywhere.

## Endpoint checklist

Port each one with its tests. The C# source is `src/claudio-api/Endpoints/`.

**Health**
- [ ] `GET /health` → `{ "status": "ok" }`

**Games** (`/api/games`)
- [ ] `GET /` with `platform` and `search` query, ordered by title
- [ ] `GET /{id}`
- [ ] `GET /{id}/executables`
- [ ] `GET /{id}/installer-inspection?path=` (exe/msi type, scan for `requireAdministrator` / `highestAvailable` in UTF-8 and UTF-16LE, including inside archives and ISOs)
- [ ] `GET /{id}/download`: standalone archive or ISO as is, single archive in a folder as is, otherwise a tar of the folder streamed directly (see File streaming)
- [ ] `GET /{id}/download-files-manifest` (409 while processing)
- [ ] `GET /{id}/download-files` and `GET /{id}/download-file` with `?path=`
- [ ] `GET /{id}/browse?path=` (folders, archives, ISOs)
- [ ] `GET /{id}/emulation`
- [ ] `POST /{id}/emulation/session`
- [ ] `GET`/`HEAD /{id}/emulation/files/{*path}`

**Admin** (`/api/admin`)
- [ ] `POST /scan`
- [ ] `POST /scan/igdb`, `GET /scan/igdb/status`
- [ ] `PUT /games/{id}`
- [ ] `GET /games/{id}/executables`
- [ ] `POST /games/{id}/igdb/search`, `POST /igdb/search`, `POST /games/{id}/igdb/apply`
- [ ] `POST /games/{id}/compress` (`zip` or `tar`), `POST /games/{id}/compress/cancel`, `GET /compress/status`
- [ ] `GET /tasks/status`
- [ ] `POST /games/{id}/tag-folder`
- [ ] `DELETE /games/{id}?deleteFiles=`, `DELETE /games/missing`
- [ ] `GET /steamgriddb/search`, `GET /steamgriddb/{sgdbGameId}/covers`, `GET /steamgriddb/{sgdbGameId}/heroes`
- [ ] `POST /games/{id}/upload-image` (multipart)
- [ ] `GET /config` (secrets masked), `PUT /config` (writes credentials back to the TOML file)

**Preferences**
- [ ] `GET /api/preferences`, `PUT /api/preferences`

**Static**
- [ ] SPA from `wwwroot` with `index.html` fallback
- [ ] `/images` from `<config dir>/images`
- [ ] Permissive CORS

## File streaming

The custom `StreamingPhysicalFileResult` in C# (range parsing, byte-copy loop, read timeout) is not ported. Files on disk are served with `tower-http`'s `ServeFile`, which already handles `Range` (`206`, `Content-Range`, `416`), `Accept-Ranges`, `HEAD` and conditional requests, and doesn't buffer for slow clients.

How the clients download today (`claudio-core` `game_install/download.rs`):

- A folder with fewer than 100 files is fetched file by file through `/download-files?path=`. These requests resume with `Range: bytes=N-` and need a `206`.
- Everything else goes through `/download` as a single response. The client doesn't resume it and uses `Content-Length` for progress. The web app links to `/download` directly.

The plan:

- **One helper**, `serve_file(path, download_name: Option<&str>)`, calls `ServeFile` and adds `Content-Disposition: attachment; filename="<ascii fallback>"; filename*=UTF-8''<percent-encoded>` when a name is given. `UnicodeDownloadTests` checks it.
- **`/download-files`, `/download-file`, emulation files, standalone archives and single-archive folders** all go through `serve_file`.
- **Folders with 100 or more files** stream a tar straight into the response. A `tar::Builder` runs in `spawn_blocking` and writes through `tokio_util::io::SyncIoBridge` into the response body, so there's no temp file under `.claudio/tars` and no 10-minute cache. The response has no `Content-Length`, so:
  - The sidecar already has the manifest for these games. It should take its progress total from the sum of the manifest's file sizes when `Content-Length` is missing. That's a small change in `download.rs`.
  - Browser downloads of such folders show an unknown size. Acceptable.
  - Clean up any leftover `.claudio/tars` folder once in the scan.
- **No per-read timeout.** hyper doesn't drop slow clients, and a hung NAS read is left to the client's timeout and retry.
- Path resolving must reject `..`, absolute paths and hidden names (`__MACOSX`, `.DS_Store`, `@eaDir`, `#recycle`, `Thumbs.db`, `.claudio`), and match case-insensitively the way the C# code does.
- Run blocking archive and filesystem work (listing, tar streaming, compression, directory sizes) in `spawn_blocking`.

## Background work

Each C# hosted service becomes a task spawned in `main` with a handle stored in `AppState`:

- **Library scan:** runs once at startup, then every `library.scan_interval_secs`. `POST /admin/scan` runs a scan right away, and scans never overlap (`tokio::sync::Mutex`). Afterwards it queues the IGDB and SteamGridDB sweeps.
- **IGDB:** a queue of sweeps (a pending flag plus a force flag), a status struct behind a mutex, and the 7-day retry rule from `MetadataRetryPolicy`.
- **SteamGridDB:** per-game hero fetches without duplicates, plus a full sweep, with the same retry rule.
- **Compression:** a FIFO queue, one job at a time, progress percent, cancelling queued or running jobs, and resetting `is_processing` flags at startup.

## Risks

1. **ISO 9660 / UDF.** DiscUtils handles both and prefers UDF on bridge discs. Rust has usable ISO 9660 crates but little UDF support. Options, in order of preference:
   1. Run an external `7z` (7-Zip lists and extracts ISO and UDF): `7z l -slt` to list, `7z e -so` to read one file. Add `7zip` to the Docker image. The desktop sidecar plan already bundles 7-Zip, so this keeps them consistent.
   2. An ISO 9660 + Joliet crate, accepting truncated names on UDF-only discs.
   3. A small UDF reader of our own. Only if 1 and 2 fall short.

   Settle this with a spike on a few real game ISOs before porting the browse, installer-inspection and emulation code.
2. **IGDB matching.** `IgdbService` (600 lines) has title cleanup, platform-slug matching and cover-replacement rules. Port it with unit tests copied from the C# behaviour before running it against the real API.
3. **7z reading on the server.** `sevenz-rust2` speed on large solid archives is acceptable in the sidecar. Opening one entry here means decompressing the solid block, the same as SharpCompress today.
4. **JSON shape drift.** Use `#[serde(rename_all = "camelCase")]` on every DTO and enum, and add a snapshot test of `GameDto` and the status responses so a renamed field fails a test instead of the frontend.

## Phases

1. **Skeleton.** Crate, config loader (port `ConfigLoaderTests`), `AppState`, SeaORM entities and the initial migration on SQLite and Postgres, health endpoint, SPA and `/images` serving, CORS. Test harness in `tests/claudio-api-rs` with a temp SQLite database.
2. **Read-only game endpoints.** List, get, executables, browse, manifest. Archive listing for zip, tar, tar.gz, 7z. ISO spike (risk 1).
3. **Downloads.** `serve_file` helper, single files, standalone archives, streamed tar. Port `GameEndpointTests` download cases and `UnicodeDownloadTests`. Change the sidecar to take its progress total from the manifest when `Content-Length` is missing. Check from the desktop client against the dev server that file-by-file downloads resume and that large folders show progress.
4. **Library scan.** Port `LibraryScanService` and `LibraryScanServiceTests`, plus the scheduled worker.
5. **Admin and preferences.** Game edits, delete, tag-folder, upload-image, config get/put with `toml_edit`, preferences.
6. **Metadata.** IGDB and SteamGridDB services, workers and status endpoints. Port `MetadataBackgroundServiceTests`, with HTTP mocked by `wiremock`.
7. **Compression.** Queue, progress, cancel, status. Then the emulation endpoints and installer inspection.
8. **Switch over.**
   - Docker: replace the .NET stages with a `rust:alpine` (musl) build stage and an `alpine` runtime (plus `7zip` if risk 1 goes that way). Keep the existing `docker-compose.yml` and `docker-compose.postgres.yml`.
   - CI: drop the `setup-dotnet` job and add Postgres as a service container so `cargo test` covers both databases.
   - Vite: keep the `/api` proxy to `:8080` and the `wwwroot` output path (moved to the new crate if the folder moves).
   - Run the web app and the desktop client against the Rust server for a few days with a real library.
9. **Clean up.** Delete `src/claudio-api` (C#), `tests/claudio-api`, `global.json`, `Directory.Build.props`, `Directory.Packages.props` and any other .NET files, then rename `claudio-api-rs` to `claudio-api`. Update AGENTS.md: build commands, test commands, architecture. Delete `feature/csharp` once the Rust sidecar is final.

## Done when

- Every box in the endpoint checklist is ticked and has a test.
- `cargo test --workspace` passes on SQLite and Postgres in CI.
- The web app works unchanged against the Rust server. The desktop client works with only the progress-total change, including resuming an interrupted file-by-file download.
- The Docker image builds and runs from a fresh `config.toml`.
- No C# is left in the repo.
