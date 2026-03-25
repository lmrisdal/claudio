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
- **Flexible auth** — Local accounts, GitHub, Google, or any OpenID Connect provider (Authentik, Authelia, Pocket ID, etc.). Proxy authentication for reverse-proxy SSO setups
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
  ghcr.io/lmrisdal/claudio:latest
```

Open http://localhost:8080 and register your first user (automatically gets admin role).

### Docker Compose

```yaml
services:
  claudio:
    image: ghcr.io/lmrisdal/claudio:latest
    ports:
      - "8080:8080"  # host:container
    volumes:
      - claudio-data:/config
      - /path/to/games:/games:ro
    environment:
      - CLAUDIO_IGDB_CLIENT_ID=your_client_id
      - CLAUDIO_IGDB_CLIENT_SECRET=your_client_secret
      # - CLAUDIO_GITHUB_CLIENT_ID=your_github_client_id
      # - CLAUDIO_GITHUB_CLIENT_SECRET=your_github_client_secret
      # - CLAUDIO_GITHUB_REDIRECT_URI=https://your-host/api/auth/github/callback
      # - CLAUDIO_GOOGLE_CLIENT_ID=your_google_client_id
      # - CLAUDIO_GOOGLE_CLIENT_SECRET=your_google_client_secret
      # - CLAUDIO_GOOGLE_REDIRECT_URI=https://your-host/api/auth/google/callback
      # - CLAUDIO_PORT=8080

volumes:
  claudio-data:
```

### Environment Variables

| Variable | Description | Default |
|---|---|---|
| `CLAUDIO_PORT` | HTTP port | `8080` |
| `CLAUDIO_LIBRARY_PATHS` | Comma-separated game library paths | `/games` |
| `CLAUDIO_IGDB_CLIENT_ID` | IGDB/Twitch client ID | |
| `CLAUDIO_IGDB_CLIENT_SECRET` | IGDB/Twitch client secret | |
| `CLAUDIO_STEAMGRIDDB_API_KEY` | SteamGridDB API key (for cover art search) | |
| `CLAUDIO_DB_PROVIDER` | `sqlite` or `postgres` | `sqlite` |
| `CLAUDIO_DB_SQLITE_PATH` | SQLite database file path | `/config/claudio.db` |
| `CLAUDIO_DB_POSTGRES` | PostgreSQL connection string | |
| `CLAUDIO_DISABLE_AUTH` | Disable authentication entirely (open access, everyone is admin) | `false` |
| `CLAUDIO_DISABLE_LOCAL_LOGIN` | Disable username/password login and registration | `false` |
| `CLAUDIO_DISABLE_USER_CREATION` | Prevent creation of new local and external users | `false` |
| `CLAUDIO_PROXY_AUTH_HEADER` | HTTP header for proxy authentication (e.g. `Remote-User`) | |
| `CLAUDIO_PROXY_AUTH_AUTO_CREATE` | Auto-create users from proxy auth header | `false` |
| `CLAUDIO_GITHUB_CLIENT_ID` | GitHub OAuth app client ID | |
| `CLAUDIO_GITHUB_CLIENT_SECRET` | GitHub OAuth app client secret | |
| `CLAUDIO_GITHUB_REDIRECT_URI` | GitHub OAuth callback URL | |
| `CLAUDIO_GOOGLE_CLIENT_ID` | Google OAuth client ID | |
| `CLAUDIO_GOOGLE_CLIENT_SECRET` | Google OAuth client secret | |
| `CLAUDIO_GOOGLE_REDIRECT_URI` | Google OAuth callback URL | |

Alternatively, create a `config.toml` file — see [config.example.toml](config.example.toml) for the schema.

### OAuth Login

Claudio supports GitHub and Google login out of the box, plus any OpenID Connect provider. If a provider is not fully configured, its login button is hidden from the UI.

You can configure GitHub and Google through either environment variables or `config.toml`.

Example `config.toml`:

```toml
[auth.github]
client_id = "your_github_client_id"
client_secret = "your_github_client_secret"
redirect_uri = "https://your-host/api/auth/github/callback"

[auth.google]
client_id = "your_google_client_id"
client_secret = "your_google_client_secret"
redirect_uri = "https://your-host/api/auth/google/callback"
```

Notes:

- The redirect URI must exactly match the callback URL registered with the provider.
- For GitHub, register `https://your-host/api/auth/github/callback` as the authorization callback URL.
- For Google, register `https://your-host/api/auth/google/callback` as an authorized redirect URI.
- The first user created (local or external) automatically becomes admin.
- Existing users are automatically linked when signing in with an external provider whose verified email matches their account.
- Set `CLAUDIO_DISABLE_LOCAL_LOGIN=true` to require external providers only.
- Set `CLAUDIO_DISABLE_USER_CREATION=true` to block new account creation. Existing users can still sign in, but first-time registration and first-time external sign-in will be rejected.

### Custom OIDC Providers

Claudio also supports custom OpenID Connect providers through `config.toml`. This is intended for self-hosted identity systems such as Authentik, Authelia, and Pocket ID.

Each provider is defined as an `[[auth.oidc_providers]]` block:

```toml
[[auth.oidc_providers]]
slug = "authentik"
display_name = "Authentik"
logo_url = "https://auth.example.com/static/dist/assets/icons/icon.png"
discovery_url = "https://auth.example.com/application/o/claudio/.well-known/openid-configuration"
client_id = "your_oidc_client_id"
client_secret = "your_oidc_client_secret"
redirect_uri = "https://claudio.example.com/api/auth/oidc/authentik/callback"
```

Provider fields:

- `slug`: stable provider identifier used in callback URLs
- `display_name`: button label shown in the login UI
- `logo_url`: optional image shown beside the provider button
- `discovery_url`: full OIDC discovery document URL ending in `/.well-known/openid-configuration`
- `redirect_uri`: must match the provider-side callback exactly
- `scope`: optional, defaults to `openid profile email`
- `user_id_claim`: optional, defaults to `sub`
- `username_claim`: optional, defaults to `preferred_username`
- `name_claim`: optional, defaults to `name`
- `email_claim`: optional, defaults to `email`

If your provider uses the standard OIDC claim names, you can omit `scope` and the claim mapping fields entirely. Only set them when your provider needs non-default values.

Examples:

- Authentik: `discovery_url = "https://auth.example.com/application/o/claudio/.well-known/openid-configuration"`
- Authelia: `discovery_url = "https://auth.example.com/.well-known/openid-configuration"`
- Pocket ID: use Pocket ID's full `/.well-known/openid-configuration` URL as `discovery_url`

Notes:

- Custom OIDC providers are currently configured through `config.toml`, not environment variables.
- The login UI renders every configured provider and uses `logo_url` when present.
- Existing users are linked by verified email when a matching OIDC login succeeds.
- If discovery returns HTML instead of JSON, the configured `discovery_url` is probably pointing at a login page or app URL rather than the actual discovery document.

### Proxy Authentication

For reverse-proxy SSO setups (Authelia, Authentik, etc.), Claudio can trust a header set by the proxy to identify the user:

```toml
[auth]
proxy_auth_header = "Remote-User"
proxy_auth_auto_create = true
```

Or via environment variables: `CLAUDIO_PROXY_AUTH_HEADER=Remote-User` and `CLAUDIO_PROXY_AUTH_AUTO_CREATE=true`.

When a request arrives with this header, Claudio creates or finds the user and issues a token automatically. Only use this when the proxy is the sole entry point — Claudio trusts the header value unconditionally.

### Data Persistence

Claudio stores a signing key (`claudio-signing.key`) alongside the database in the config directory. This key signs authentication tokens — if it's lost, all users will need to sign in again. Make sure the `/config` volume is persistent.

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
- **Auth:** OpenIddict (OAuth 2.0 / OpenID Connect), ASP.NET Core Identity
- **Metadata:** IGDB API via Twitch OAuth
