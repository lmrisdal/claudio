# Claudio

A self-hosted game library manager for organizing, browsing, and downloading your game collection.

## Features

- **Library management** — Automatically scans configured directories and organizes games by platform
- **IGDB integration** — Auto-matches games against IGDB for metadata including covers, summaries, genres, developers, and more
- **File browsing** — Browse game folder contents directly in the browser, including inside zip/7z/tar/tar.gz archives
- **Downloads** — Download games as tar bundles with resume support; pre-zipped games are served directly
- **Search** — Global search dialog (Cmd/Ctrl+K) for quick access to any game
- **Admin panel** — Manual library scanning, IGDB metadata fetching, and per-game editing
- **Multi-platform** — Supports PC, Mac, Linux, consoles (Switch, PlayStation, Xbox, Nintendo), and more
- **Dark/light mode** — Theme toggle with system preference detection

## Quick Start

### Docker

```bash
docker run -d \
  --name claudio \
  -e PUID=1000 -e PGID=1000 \
  -p 8080:8080 \
  -v /path/to/games:/games \
  -v claudio-data:/config \
  ghcr.io/lmrisdal/claudio:latest
```

Open http://localhost:8080 to start using Claudio.

### Docker Compose

```yaml
services:
  claudio:
    image: ghcr.io/lmrisdal/claudio:latest
    container_name: claudio
    ports:
      - "8080:8080" # host:container
    volumes:
      - claudio-data:/config
      - /path/to/games:/games
    environment:
      - PUID=1000
      - PGID=1000
      - CLAUDIO_IGDB_CLIENT_ID=your_client_id
      - CLAUDIO_IGDB_CLIENT_SECRET=your_client_secret
      # - CLAUDIO_PORT=8080

volumes:
  claudio-data:
```

### Environment Variables

| Variable                         | Description                                                      | Default                |
| -------------------------------- | ---------------------------------------------------------------- | ---------------------- |
| `PUID`                           | User ID to run the process as                                    | `0` (root)             |
| `PGID`                           | Group ID to run the process as                                   | `0` (root)             |
| `CLAUDIO_PORT`                   | HTTP port                                                        | `8080`                 |
| `CLAUDIO_LOG_LEVEL`              | Log level: `error`, `warn`, `info`, `debug`, `trace`             | `warn`                 |
| `CLAUDIO_LIBRARY_PATHS`          | Comma-separated game library paths                               | `/games`               |
| `CLAUDIO_SCAN_INTERVAL`          | Library scan interval in seconds                                 | `120`                  |
| `CLAUDIO_IGDB_CLIENT_ID`         | IGDB/Twitch client ID                                            |                        |
| `CLAUDIO_IGDB_CLIENT_SECRET`     | IGDB/Twitch client secret                                        |                        |
| `CLAUDIO_STEAMGRIDDB_API_KEY`    | SteamGridDB API key (for cover art search)                       |                        |
| `CLAUDIO_DB_PROVIDER`            | `sqlite` or `postgres`                                           | `sqlite`               |
| `CLAUDIO_DB_SQLITE_PATH`         | SQLite database file path                                        | `/config/claudio.db`   |
| `CLAUDIO_DB_POSTGRES`            | PostgreSQL connection string                                     |                        |

Alternatively, create a `config.toml` file — see [config.example.toml](config.example.toml) for the schema.

### Reverse Proxy

Claudio does not include built-in authentication. Put it behind your reverse
proxy or SSO gateway if you need access control. The desktop app supports
custom headers on the server selection screen for proxy-specific routing or
identity headers.

### Data Persistence

Keep the `/config` volume persistent; it contains the SQLite database and app
configuration.

## Library Structure

Games are organized by platform in your library directories:

```
/games/
  pc/
    Hades II (2025)/
    Celeste (2018) (igdb-26226)/
  switch/
    The Legend of Zelda Breath of the Wild (2017)/
```

- Folder names are parsed for title, year, and optional IGDB ID
- Adding `igdb-NNNNN` to a folder name forces a specific IGDB match (e.g. `Celeste (2018) (igdb-26226)`)
- Games can be loose files, or a single zip/7z/tar/tar.gz archive
- Background scanning runs every 2 minutes to pick up changes (configurable via `CLAUDIO_SCAN_INTERVAL`)

## Development

### Prerequisites

- [Rust toolchain](https://www.rust-lang.org/tools/install)
- [Node.js 24+](https://nodejs.org/)

### Backend

```bash
dotnet run src/claudio-api
```

### Frontend

```bash
cd src/claudio-web
vp install
vp dev
```

The Vite dev server runs on port 5173 and proxies API requests to the backend on port 8080.

### Desktop app

The desktop app is an Electron shell (`src/claudio-desktop/app`) around the `claudio-web` SPA, plus a headless Rust sidecar (`src/claudio-desktop/core`) that handles installs, game launching and Proton/umu.

```bash
cd src/claudio-desktop/app
vp install
vp run package        # builds the AppImage (Linux) or installer (Windows) into release/
```

Build `claudio-core` (`cargo build --release -p claudio-core --bin claudio-core`) and the SPA (`CLAUDIO_DESKTOP_BUILD=1 vp build` in `src/claudio-web`) first, because the package bundles both. To run without packaging, use `vp run dev` from `src/claudio-desktop/app`; it picks up `target/debug/claudio-core` and `src/claudio-web/dist`.

AppImage notes (electron-builder 26): the legacy AppImage runtime needs `libfuse2`, or run it with `--appimage-extract-and-run`. The generated launcher adds `--no-sandbox` for desktop-entry launches, which keeps the app working on Ubuntu 24.04 where AppArmor restricts unprivileged user namespaces.

### Desktop Windows Cross-Check From Linux

For faster local Windows-target validation without changing the release target, install `cargo-xwin` once:

```bash
cargo install cargo-xwin
```

Then run either of these from the repo root:

```bash
./scripts/check-windows-xwin.sh
./scripts/build-windows-xwin.sh
```

These scripts cross-check or cross-build `claudio-core` and the bundled uninstaller for `x86_64-pc-windows-msvc`. They do not replace the real Windows packaging/release flow, which still runs on Windows for the NSIS installer.

### CI and releases

GitHub Actions has three workflows:

- **CI** runs on every PR to `main` and every merge. It checks the API, web app,
  Linux/Windows desktop code, and server container. Configure branch protection to
  require **CI passed**, replacing any checks from the old Tests workflow.
- **Release** runs when a `v*` tag is pushed. It validates the application versions,
  runs CI on that commit, and packages the desktop app and amd64/arm64 server
  images. Both container architectures and the packaged Linux/Windows apps are
  smoke-tested. Publishing uploads those tested artifacts without rebuilding.
- **Docs** deploys documentation changes on `main` to GitHub Pages. Pages must use
  GitHub Actions as its deployment source in repository settings.

To publish a release from the current branch:

```bash
make bump 0.2.2
```

This updates the three application versions, runs `cargo check --workspace` to
refresh `Cargo.lock`, commits all four version files, and creates the annotated
`v0.2.2` tag. It asks before pushing the commit and that tag. To push without the
prompt, use `make bump 0.2.2 push=true`. If validation fails, it stops before
committing or tagging.

The tag must match the Electron, frontend, and Rust sidecar versions. Stable
releases publish a GitHub release and GHCR images tagged `0.2.2` and `latest`.
Prerelease versions such as `0.3.0-beta.1` publish a GitHub prerelease and container
images tagged `0.3.0-beta.1` and `dev`, leaving `latest` unchanged. Build metadata (`+...`) is not supported
for releases because it cannot be used in a container tag.

To test packaging without publishing, run **Release → Run workflow** on the
selected branch. Download the desktop packages and compressed Docker image
archives from that run's artifacts; they are retained for 14 days. Load an image
with `docker load --input container-amd64.tar.gz`. Merges do not publish dev
releases or update container tags.

Publishing needs only the workflow's GitHub token with `contents: write` and
`packages: write`; PR checks have read-only repository access. A failed publish
can be retried using **Re-run failed jobs**: built artifacts are reused and the
GitHub release stays in draft until the container images have been published.

## Tech Stack

- **Backend:** C#, .NET 10, EF Core, SQLite/PostgreSQL
- **Frontend:** React 19, Vite, TanStack Query, Tailwind CSS v4, Headless UI
- **Metadata:** IGDB API via Twitch OAuth

## License

Claudio is licensed under the [GNU Affero General Public License v3.0](LICENSE). Bundled and downloaded third-party components keep their own licenses; see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
