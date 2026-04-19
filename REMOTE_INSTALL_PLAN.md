# Remote Install Plan

## Goal

Allow a user to trigger a PC game download/install from the web app on a phone while the desktop app is running on the user's PC.

## Assumption

- One desktop PC per user for v1.

## Current Architecture

- The web app talks to the server over HTTP.
- The desktop app owns local downloads and installs through Tauri commands.
- Desktop install progress is currently emitted only as local Tauri events.
- The API exposes game metadata and download endpoints, but it does not currently have a server-to-desktop control channel.

## Recommended v1 Design

- Add a persistent outbound desktop connection to the server.
- Let the server broker install commands from the phone/web app to the connected desktop.
- Keep the phone/web UI simple by polling the server for remote install state instead of adding browser realtime immediately.

## Implementation Plan

### 1. Add a desktop control channel on the API

- Create a new authenticated desktop connection endpoint, preferably WebSocket-based.
- Associate the live desktop connection with the authenticated user id.
- Track desktop presence, last seen, and a generated device id plus friendly device name.

### 2. Add server-side command and status models

- Introduce a remote install command payload with an operation id and the vetted game metadata needed by the desktop app.
- Add an in-memory command queue and operation status store for v1.
- Track operation states such as `queued`, `starting`, `downloading`, `extracting`, `installing`, `completed`, `failed`, and `cancelled`.

### 3. Add API endpoints for remote installs

- Add an endpoint to request an install for a game on the connected desktop.
- Add endpoints to list operations and fetch a single operation status.
- Add an endpoint to cancel an active remote install.
- Return a clear error when no desktop is connected for the current user.

### 4. Add a desktop background client

- When the desktop app is logged in and has a configured server URL, open and maintain the control connection in the background.
- Reconnect with backoff after disconnects.
- When an install command is received, call the existing desktop install pipeline instead of creating a second implementation.
- Add an option in th settings to enable or disable the remote install feature, and to set a friendly device name for the desktop.

### 5. Reuse the existing desktop install pipeline

- Keep the current `game_install::install_game` flow as the install engine.
- Refactor progress emission slightly so progress can be sent both to the local Tauri UI and to the server.
- Introduce a minimal progress sink abstraction around the current progress emission helpers.

### 6. Mirror progress back to the server

- Send install progress updates from the desktop app to the server over the control channel.
- Update the server-side operation store as progress arrives.
- Expose completed, failed, and cancelled states to phone/web clients immediately.

### 7. Update the web app for remote installs

- In non-desktop web mode, show an `Install on PC` action when a desktop is online.
- Hide the button if no desktop is connected.
- Add a remote downloads view, or extend the existing downloads page, to show server-backed remote operations.

### 8. Secure the flow

- Only allow authenticated users to control their own connected desktop.
- Do not allow arbitrary file paths or raw desktop commands from the phone.
- For v1, use desktop default install and download locations unless remote path selection is explicitly added later.
- Expire desktop presence and outstanding operations when the connection drops.

### 9. Test all three layers

- API tests for authorization, presence checks, queueing, status transitions, and cancel behavior.
- Desktop tests for connection handling, command execution, progress forwarding, and cancel mapping.
- Web tests for button behavior, offline states, polling updates, and error handling.

## Scope Boundaries For v1

- Support one connected PC per user.
- Do not add multi-device selection yet.
- Do not add browser realtime subscriptions yet.
- Do not add persistent command history unless it becomes necessary.

## Suggested First Slice

1. Add server desktop presence tracking.
2. Add a single remote install request endpoint.
3. Add a desktop background connection that can receive one install command.
4. Forward progress updates back to the server.
5. Add a simple phone/web `Install on PC` button and polling status UI.
