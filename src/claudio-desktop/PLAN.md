# Claudio Desktop App — Tauri v2

## Context

Claudio currently has a stub `src/Claudio.Desktop` .NET project. The goal is to build a real desktop app that wraps the existing React frontend in a native webview, with native capabilities the browser can't provide: installing Windows games, launching them, and (future) embedded libretro emulation.

We're using **Tauri v2** instead of Avalonia because:
- The app is fundamentally a webview wrapper — Tauri's core purpose
- System webview means ~5-10MB binaries (no bundled Chromium or .NET runtime)
- Built-in IPC with automatic serde serialization replaces manual bridge plumbing
- Built-in auto-updater, system tray, and native dialogs
- Custom window chrome lives in React (HTML/CSS), not a separate UI framework

The tradeoff is Rust instead of C# for native code. Since the desktop app talks to the Claudio server via REST, only a small set of bridge-specific types need Rust equivalents — `Claudio.Shared` DTOs are not needed.

The existing `src/Claudio.Desktop` .NET project and its reference in the solution file will be removed and replaced with the Tauri project.

---

## Phase 1: Tauri Shell with WebView

**Goal**: Window with custom chrome, server URL setup, and embedded webview loading the React frontend.

### Step 1 — Project setup

**Create Tauri project at `src/claudio-desktop/`.**

Initialize with `cargo create-tauri-app` or manually scaffold. The frontend source stays in `frontend/` — Tauri points to it via config.

**`src/claudio-desktop/Cargo.toml` dependencies:**
```toml
[dependencies]
tauri = { version = "2", features = ["devtools"] }
tauri-plugin-dialog = "2"
tauri-plugin-opener = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
dirs = "6"
tokio = { version = "1", features = ["full"] }
reqwest = { version = "0.12", features = ["json", "stream"] }
rusqlite = { version = "0.32", features = ["bundled"] }
chrono = { version = "0.4", features = ["serde"] }
```

**`src/claudio-desktop/tauri.conf.json`:**
```json
{
  "productName": "Claudio",
  "identifier": "com.claudio.desktop",
  "build": {
    "devUrl": "http://localhost:5173",
    "frontendDist": "../../frontend/dist"
  },
  "app": {
    "windows": [
      {
        "title": "Claudio",
        "width": 1280,
        "height": 800,
        "decorations": false,
        "center": true
      }
    ]
  }
}
```

**Install Tauri npm dependencies in `frontend/`:**
```bash
npm install @tauri-apps/api @tauri-apps/cli
```

Add Tauri scripts to `frontend/package.json`:
```json
"scripts": {
  "tauri": "tauri",
  "tauri:dev": "tauri dev",
  "tauri:build": "tauri build"
}
```

**Remove the .NET desktop project:**
- Delete `src/Claudio.Desktop/Claudio.Desktop.csproj`, `Program.cs`
- Remove the project reference from `Claudio.sln`
- Keep this `PLAN.md` (move to `src/claudio-desktop/PLAN.md`)

### Step 2 — Application entry point

**Files to create:**
- `src/claudio-desktop/src/main.rs` — Tauri entry point, prevents additional console window on Windows
- `src/claudio-desktop/src/lib.rs` — Plugin registration, command handlers, app setup

```rust
// main.rs
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    claudio_desktop_lib::run();
}
```

```rust
// lib.rs
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::ping,
            commands::get_settings,
            commands::update_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Claudio");
}
```

### Step 3 — Settings service

**Files to create:**
- `src/claudio-desktop/src/settings.rs`

```rust
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DesktopSettings {
    pub server_url: Option<String>,
    pub window_width: f64,
    pub window_height: f64,
    pub window_x: Option<f64>,
    pub window_y: Option<f64>,
    pub default_install_path: Option<String>,
}
```

- Reads/writes `settings.json` in `dirs::data_local_dir()/claudio/`
- Creates directory and default settings file on first run
- Exposed via `get_settings` and `update_settings` Tauri commands

### Step 4 — Custom window chrome (frontend)

**Files to create:**
- `frontend/src/components/DesktopTitleBar.tsx`

Since `decorations: false` in Tauri config, the title bar is a React component:

```tsx
// Only renders when running in Tauri
export function DesktopTitleBar() {
  if (!('__TAURI_INTERNALS__' in window)) return null;

  return (
    <div data-tauri-drag-region className="desktop-title-bar">
      <span>Claudio</span>
      <div className="window-controls">
        <button onClick={() => getCurrentWindow().minimize()}>−</button>
        <button onClick={() => getCurrentWindow().toggleMaximize()}>□</button>
        <button onClick={() => getCurrentWindow().close()}>×</button>
      </div>
    </div>
  );
}
```

- `data-tauri-drag-region` gives native drag-to-move behavior
- Styled to match the app's dark theme
- Rendered at the top of the app layout, above the existing header

**Files to modify:**
- Root layout component — render `<DesktopTitleBar />` above existing content
- CSS — add title bar styles, adjust body padding when in desktop mode

### Step 5 — Server setup flow

**Files to create:**
- `frontend/src/pages/DesktopSetup.tsx` — React route for first-run server URL configuration

Flow:
1. App starts → React checks `await invoke('get_settings')` for `server_url`
2. If no `server_url`, render the setup page (URL input, connect button)
3. Validate by hitting `GET {url}/api/auth/providers`
4. On success, `invoke('update_settings', { settings: { server_url: url } })`
5. Reload the app or redirect to the main view, now proxying to the configured server

**Tauri config consideration:** In desktop mode, the frontend needs to make requests to a user-configured server URL instead of the relative `/api` path. The setup flow saves this URL, and the API client reads it to prefix requests.

**Files to modify:**
- `frontend/src/api/client.ts` — When in desktop mode, prefix requests with the saved server URL instead of using relative `/api` paths
- `frontend/src/App.tsx` or router config — add the `/desktop/setup` route

### Step 6 — Desktop detection & bridge hook

**Files to create:**
- `frontend/src/hooks/useDesktop.ts`

```typescript
import { invoke } from '@tauri-apps/api/core';

export function useDesktop() {
  const isDesktop = '__TAURI_INTERNALS__' in window;

  async function call<T>(command: string, args?: Record<string, unknown>): Promise<T | null> {
    if (!isDesktop) return null;
    return invoke<T>(command, args);
  }

  return { isDesktop, call };
}
```

No custom bridge shim needed — `@tauri-apps/api/core` handles everything:
- `invoke(command, args)` → calls Rust `#[tauri::command]` functions
- Automatic JSON serialization/deserialization via serde
- Returns a Promise that resolves with the result or rejects with an error

### Step 7 — Initial bridge command

**Files to create:**
- `src/claudio-desktop/src/commands/mod.rs`
- `src/claudio-desktop/src/commands/ping.rs`

```rust
#[tauri::command]
pub fn ping() -> PingResponse {
    PingResponse {
        version: env!("CARGO_PKG_VERSION").to_string(),
        platform: std::env::consts::OS.to_string(),
    }
}
```

### Phase 1 file structure
```
src/claudio-desktop/
├── Cargo.toml
├── build.rs                  # Tauri build script (generated)
├── tauri.conf.json
├── PLAN.md
├── capabilities/
│   └── default.json          # Tauri v2 permissions
├── icons/                    # App icons (various sizes)
└── src/
    ├── main.rs
    ├── lib.rs
    ├── settings.rs
    └── commands/
        ├── mod.rs
        └── ping.rs

frontend/src/
├── components/
│   └── DesktopTitleBar.tsx    # Custom window chrome
├── hooks/
│   └── useDesktop.ts          # Tauri bridge hook
└── pages/
    └── DesktopSetup.tsx       # Server URL configuration
```

---

## Phase 2: Native Game Management

**Goal**: Download, install, track, and launch games natively.

### Step 8 — Local SQLite database

**Files to create:**
- `src/claudio-desktop/src/db.rs` — Database setup, migrations, connection management
- `src/claudio-desktop/src/models.rs` — Data structures

```rust
#[derive(Debug, Serialize, Deserialize)]
pub struct InstalledGame {
    pub id: i64,
    pub remote_game_id: i32,
    pub server_url: String,
    pub title: String,
    pub platform: String,
    pub install_type: InstallType,  // "portable" | "installer"
    pub install_path: String,
    pub game_exe: Option<String>,
    pub installed_at: String,       // ISO 8601
    pub size_bytes: i64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum InstallType {
    Portable,
    Installer,
}
```

Uses `rusqlite` with bundled SQLite. DB stored in `dirs::data_local_dir()/claudio/claudio.db`. Auto-migrate on startup with a simple version table.

### Step 9 — Game install service

**Files to create:**
- `src/claudio-desktop/src/services/mod.rs`
- `src/claudio-desktop/src/services/game_install.rs`

Handles:
- **Download**: Authenticated `GET /api/games/{id}/download` via `reqwest` with range headers for resume support. Streams to temp file.
- **Progress**: Emits `install-progress` events to the frontend via `app.emit("install-progress", payload)`. Frontend listens with `listen("install-progress", callback)` — no polling needed.
- **Portable games**: Extract archive to `{default_install_path}/{title}/`
- **Installer games** (Windows): Extract archive, spawn the `.exe` from `GameDto.installer_exe` via `Command::new()`, prompt user for install location after completion
- **Cancellation**: Track active downloads with `CancellationToken`-style abort via `tokio`

Auth token is passed from the frontend as a command argument (read from `localStorage` in JS before calling `invoke`).

### Step 10 — Game registry service

**Files to create:**
- `src/claudio-desktop/src/services/game_registry.rs`

CRUD on `InstalledGame` table: register after install, unregister on uninstall, verify install paths still exist on startup.

### Step 11 — Game launch service

**Files to create:**
- `src/claudio-desktop/src/services/game_launch.rs`

Spawns game process via `Command::new()`, tracks running state, handles missing exe (prompt user to browse via Tauri's dialog plugin).

### Step 12 — Tauri commands

**Files to create/modify:**
- `src/claudio-desktop/src/commands/games.rs`
- `src/claudio-desktop/src/commands/settings.rs`
- `src/claudio-desktop/src/commands/dialogs.rs`

| Command | Description |
|---|---|
| `get_installed_games` | List all locally installed games |
| `get_installed_game` | Check if a specific game is installed by remote ID |
| `install_game` | Start download + install (async, emits progress events) |
| `cancel_install` | Cancel in-progress install |
| `launch_game` | Launch an installed game |
| `uninstall_game` | Remove from registry, optionally delete files |
| `open_folder` | Open install folder in OS file explorer (via `opener` plugin) |
| `browse_for_folder` | Native folder picker (via `dialog` plugin) |
| `get_settings` / `update_settings` | Desktop settings CRUD |

Progress updates use Tauri's event system instead of polling:
```rust
// Rust — emit progress
app.emit("install-progress", InstallProgress { game_id, percent, status });
```
```typescript
// Frontend — listen for progress
import { listen } from '@tauri-apps/api/event';
listen('install-progress', (event) => { /* update UI */ });
```

### Step 13 — Frontend integration

**Files to modify:**
- `frontend/src/hooks/useDesktop.ts` — Add typed wrappers for all game management commands
- Game detail page — Detect desktop mode, show Install/Launch/Uninstall buttons conditionally
- Add install progress UI (progress bar component, listens to `install-progress` events)

### Phase 2 file structure additions
```
src/claudio-desktop/src/
├── models.rs
├── db.rs
└── services/
    ├── mod.rs
    ├── game_install.rs
    ├── game_registry.rs
    └── game_launch.rs
└── commands/
    ├── games.rs
    ├── settings.rs
    └── dialogs.rs
```

---

## Future: Libretro Integration (not in scope)

The architecture supports this without structural changes:
- `services/libretro.rs` for core management and emulation sessions
- Tauri window with a canvas element for emulator video output (WebGL)
- Tauri commands: `start_emulation`, `stop_emulation`, `save_state`, `load_state`
- Audio via Web Audio API, input via existing gamepad hook

---

## Verification

### Phase 1
1. `cd src/claudio-desktop && cargo build` compiles without errors
2. `npm run tauri dev` (from `frontend/`) launches a Tauri window with the React frontend
3. First run shows the server setup form
4. After entering a valid Claudio server URL, the webview loads the React frontend
5. User can log in, browse library, and use all existing web features
6. `'__TAURI_INTERNALS__' in window` is `true` in the webview console
7. `invoke('ping')` returns `{ version, platform }`
8. Custom title bar supports drag-to-move and minimize/maximize/close
9. Window position/size persists across restarts

### Phase 2
1. Install button appears in game detail view when in desktop mode
2. Downloading a game shows real-time progress via events
3. Portable games extract to the configured install path
4. Installer games run the .exe and register the install location
5. Launch button starts the installed game
6. Uninstall removes from registry and optionally deletes files
