# Smart Download Plan

## Problem

In Docker, `DownloadService.CreateTarAsync` uses `Path.GetTempPath()` which maps to `/tmp` — a
limited filesystem that fills up quickly when packaging large game folders before serving them.

## Solution

For loose folders (not standalone archives), the Rust desktop client will decide the download
strategy based on a file manifest returned with the download ticket:

- **< 50 files**: download each file individually in parallel via a new bearer-auth endpoint
- **≥ 50 files**: fall back to tar download, but store the tar in the library path instead of `/tmp`

The 50-file threshold is chosen because at that count, 8 concurrent downloads complete in ~7
batches — negligible overhead — while above it a single tar stream is more efficient and avoids
hammering the server with many concurrent connections.

The ticket system is not extended since it only exists to work around browser limitations. The
desktop client already uses bearer tokens for everything, so the new individual-file endpoint is
bearer-auth only.

---

## Files to Change


| File                                               | Change                                                                               |
| -------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `src/claudio-api/Endpoints/GameEndpoints.cs`       | New `download-files` endpoint; modify `CreateDownloadTicket` to return file manifest |
| `src/claudio-api/Services/DownloadService.cs`      | Inject `ClaudioConfig`; use library path for tar storage                             |
| `src/claudio-desktop/src/services/game_install.rs` | Multi-file download logic in `download_game_package_inner`                           |
| `tests/Claudio.Api.Tests/GameEndpointTests.cs`     | New tests                                                                            |


---

## API Changes

### 1. New endpoint: individual file download

```
GET /api/games/{id}/download-files?path=relative/path/to/file
```

- Requires bearer token auth (`.RequireAuthorization()`) — no ticket needed
- Resolves the path using the existing `TryResolveGameFilePath` helper (path traversal protection)
- Returns `Results.File(...)` with `enableRangeProcessing: true`
- Returns 400 for invalid paths, 404 for missing game or file

### 2. Modified: `CreateDownloadTicket` response

For loose folders (not a standalone archive, not a single-archive folder), include a `files`
array listing all files with their relative paths and sizes:

```json
{
  "ticket": "abc123",
  "files": [
    { "path": "data/game.dat", "size": 1048576 },
    { "path": "readme.txt",    "size": 1024 }
  ]
}
```

For standalone archives and single-archive folders, `files` is omitted and the client uses the
existing download flow unchanged.

Also remove the pre-build tar call from `CreateDownloadTicket` — the client now decides the
strategy, so there's no point building the tar eagerly.

### 3. Fix tar storage location

`**DownloadService.cs**`: inject `ClaudioConfig`, change tar path from `Path.GetTempPath()` to
`{config.Library.LibraryPaths[0]}/.claudio/tars/claudio-game-{id}.tar`. Create the directory if
it doesn't exist.

---

## Rust Client Changes

`**download_game_package_inner**` in `game_install.rs`:

After receiving the ticket JSON, inspect the `files` field:

- `**files` absent** (standalone archive / single-archive folder): existing tar/archive download
flow, no changes.
- `**files` present, `len >= 50`**: existing tar download flow (ticket-based), no changes.
Tar is now stored in library path on the server side.
- `**files` present, `len < 50**`: download each file individually:
  - Use `futures::stream::buffer_unordered(8)` for up to 8 concurrent downloads
  - Each request: `GET /api/games/{id}/download-files?path={url-encoded-path}` with bearer auth
  - Write each file to `temp_root` preserving the relative directory structure (create parent
  dirs as needed)
  - Track cumulative bytes downloaded across all files for progress events
  - Respect `speed_limit_kbs` — distribute the limit across active downloads
  - Check `control.is_cancelled()` between files; abort and clean up on cancellation
  - On any single-file failure: abort remaining downloads, clean up `temp_root`, return error

The rest of the install flow (extraction, move to `target_dir`) is unchanged — files end up in
`temp_root` either way.

---

## Tests

New tests in `tests/Claudio.Api.Tests/GameEndpointTests.cs`:

- `DownloadFiles_WithAuth_ReturnsFile` — serve a file from a loose folder
- `DownloadFiles_WithoutAuth_Returns401`
- `DownloadFiles_PathTraversal_ReturnsBadRequest`
- `DownloadFiles_MissingFile_Returns404`
- `DownloadTicket_LooseFolder_IncludesFileManifest`
- `DownloadTicket_StandaloneArchive_OmitsFileManifest`

---

## What Is Not Changed

- `DownloadTicketService` — untouched; still used for browser download flow
- `GET /api/games/{id}/download` — untouched; still serves tar/archive for browser and as
fallback for large (≥ 50 file) loose folders
- `DownloadPackageInput` Rust model — no changes needed
- All existing emulation, browse, and install endpoints

