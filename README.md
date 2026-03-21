# Claudio

> **Note:** This project was built entirely with [Claude Code](https://claude.ai/code) (Claude Opus 4.6).

A self-hosted game library manager for organizing, browsing, and downloading your game collection.

## Features

- **Library management** — Automatically scans configured directories and organizes games by platform
- **IGDB integration** — Auto-matches games against IGDB for metadata including covers, summaries, genres, developers, and more
- **File browsing** — Browse game folder contents directly in the browser, including inside zip/tar/tar.gz archives
- **Downloads** — Download games as tar bundles with resume support; pre-zipped games are served directly
- **Search** — Global search dialog (Cmd/Ctrl+K) for quick access to any game
- **Admin panel** — User management, manual library scanning, IGDB metadata fetching, and per-game editing
- **Multi-platform** — Supports PC, Mac, Linux, consoles (Switch, PlayStation, Xbox, Nintendo), and more
- **Dark/light mode** — Theme toggle with system preference detection

## Quick Start

### Docker

```bash
docker run -d \
  --name claudio \
  -p 8080:8080 \
  -v /path/to/games:/games:ro \
  -v claudio-data:/config \
  claudio
```

Open http://localhost:8080 and register your first user (automatically gets admin role).

### Docker Compose

```yaml
services:
  claudio:
    build:
      context: .
      dockerfile: docker/Dockerfile
    ports:
      - "8080:8080"
    volumes:
      - /path/to/games:/games:ro
      - claudio-data:/config
    environment:
      - CLAUDIO_IGDB_CLIENT_ID=your_client_id
      - CLAUDIO_IGDB_CLIENT_SECRET=your_client_secret

volumes:
  claudio-data:
```

### Environment Variables

| Variable | Description | Default |
|---|---|---|
| `CLAUDIO_LIBRARY_PATHS` | Comma-separated game library paths | `/games` |
| `CLAUDIO_IGDB_CLIENT_ID` | IGDB/Twitch client ID | |
| `CLAUDIO_IGDB_CLIENT_SECRET` | IGDB/Twitch client secret | |
| `CLAUDIO_JWT_SECRET` | JWT signing key (auto-generated if unset) | |
| `CLAUDIO_DB_PROVIDER` | `sqlite` or `postgres` | `sqlite` |
| `CLAUDIO_DB_SQLITE_PATH` | SQLite database file path | `/config/claudio.db` |
| `CLAUDIO_DB_POSTGRES` | PostgreSQL connection string | |

Alternatively, create a `config.toml` file — see [config.example.toml](config.example.toml) for the schema.

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
- Games can be loose files, or a single zip/tar/tar.gz archive
- Background scanning runs every 2 minutes to pick up changes

## Development

### Prerequisites

- [.NET 10 SDK](https://dotnet.microsoft.com/download)
- [Node.js 22+](https://nodejs.org/)

### Backend

```bash
dotnet run --project src/Claudio.Api
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The Vite dev server runs on port 5173 and proxies API requests to the backend on port 5118.

## Tech Stack

- **Backend:** ASP.NET minimal APIs, Entity Framework Core, SQLite/PostgreSQL
- **Frontend:** React 19, Vite, TanStack Query, Tailwind CSS v4, Headless UI
- **Auth:** JWT with configurable expiry
- **Metadata:** IGDB API via Twitch OAuth
