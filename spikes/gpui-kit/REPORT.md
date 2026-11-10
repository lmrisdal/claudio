# Native UI for Claudio desktop: findings and plan

Date: 2026-11-10. Status: research plus an unrun spike. Nothing here has been measured on Linux yet.

## 1. Problem

- Tauri was dropped because the WebKitGTK webview was slow in an AppImage on Linux. The Tauri
  Linux graphics workarounds (`WEBKIT_DISABLE_DMABUF_RENDERER` and similar) did not help.
- Electron is also slow, especially on cold start.
- Goal: find out whether a Rust-native UI is viable.

Constraints given by the project owner during this research:

- Rewrite cost is not a concern.
- Accessibility is not a priority.
- Still required: controller (gamepad) and keyboard navigation, Linux support, good text input,
  an image-heavy library grid, fast cold start.

## 2. What the code shows today

- The SPA is about 16.8k lines of TypeScript across 111 components (`src/claudio-web`). It uses
  Headless UI (27 files with `Dialog`, 17 with select/listbox/menu patterns), TanStack Query,
  React Router, Tailwind and a lot of gamepad/focus code.
- The Electron shell (`src/claudio-desktop/app`) is small, about 1,250 lines. The Rust sidecar
  (`claudio-core`) talks JSON lines over stdio and would carry over to any new shell.
- Cold-start finding in `src/main/index.ts`: the main window is not created until the sidecar has
  been spawned and has answered `get_settings` (`await refreshProxySettings()`). Sidecar boot time
  is therefore added to every cold start. This is verified from the code and not yet measured.
- The window stays hidden until `ready-to-show`, and `electron-updater` is imported eagerly.

## 3. Hypothesis: the AppImage may be the common cause

Tauri and Electron were both slow as AppImages. An AppImage mounts a compressed squashfs through
FUSE on every launch. One developer reported cutting an Electron launcher from over 10 seconds to
about 4 by changing the compression (a single anecdote, not a benchmark). A native Rust UI inside
an AppImage would pay the same mount cost. This is unconfirmed.

Test, on the Linux machine:

```bash
./Claudio-*.AppImage --appimage-extract
time ./squashfs-root/claudio
```

Compare with launching the AppImage itself from a cold disk cache. If the extracted copy is much
faster, fix packaging first (compression setting, or ship a `.deb` or tarball). I did not verify
the exact electron-builder option names.

## 4. Options evaluated

| Option | Verdict | Main reasons (source-checked unless noted) |
|---|---|---|
| Dioxus (default desktop) | No | Renders in a system webview, the same architecture as Tauri. |
| Dioxus-native (Blitz) | No | Blitz calls itself beta. Roadmap items still open: password input (#482), `<select>`, IME, clipboard events, `position: sticky`, `line-clamp`. |
| Blinc | No | Active (569 stars), Linux listed as stable on wgpu/Vulkan, but uses its own builder API, and keyboard navigation and screen-reader work are current roadmap focus. |
| egui | Viable, second tier | Mature (32k stars, 0.37). Open IME issues (#8813), Wayland drag-and-drop broken (#1563), resize flicker on glow (#903), immediate-mode layout limits. No gamepad support found. |
| Slint | Viable, safest | Wayland and X11, a software renderer option, GPLv3 or royalty-free licence (GPLv3 is compatible with AGPLv3; check Slint's FAQ). Gamepad input is an open request (#12854). IME, grid virtualization and cold start not verified. |
| Xilem | No | README calls it an experimental architecture. |
| Iced | No | Slow development pace per 2026 comparisons. |
| GTK4 (gtk-rs) | Not researched in depth | Linux-first. Windows needs more setup and it suits a custom controller-driven UI poorly. |
| Freya | Unknown | Only old READMEs found. |
| **GPUI + gpui-kit** | **Top pick for features and polish** | See section 5. |
| Fix the existing stack | Cheapest first step | See sections 2 and 3: parallelize sidecar start, test the AppImage mount cost. |

## 5. GPUI with gpui-kit

[gpui-kit](https://github.com/longbridge/gpui-kit): 20k stars, version 0.9.1, pushed daily,
Apache-2.0. It bundles `gpui-base` and `gpui-component`.

Strengths:

- 75+ components, virtual lists, virtual-scrolling data tables, dock layout, Markdown, charts.
- Dialogs use a focus trap, which matches the project's dialog requirements.
- Headless UI integration tests that drive input and assert focus.
- The project claims it is extracted from the shipped Longbridge Pro app (not independently verified).

Risks:

- GPUI is pre-1.0 and breaks often. gpui-kit pins a matching GPUI.
- Linux rendering goes through wgpu and needs a Vulkan-capable GPU. Zed's docs describe a
  `NoSupportedDeviceFound` failure when none is found, and very slow software Vulkan (llvmpipe). I
  found no software fallback in the GPUI Linux code. A device-loss recovery issue is open (zed#23288).
- Open Linux issues in the Zed repo: UI stalls on GNOME 50 under Wayland (zed#53522, workaround is
  XWayland), shortcuts not working on non-Latin layouts (zed#14053).
- The zed#14222 "slow to start on Linux" report is about the whole editor and should not be read as
  GPUI's baseline. I found no cold-start numbers for a small GPUI app.
- No gamepad support exists in any evaluated toolkit. It must be written (SDL or `gilrs`, turned
  into focus movement and key events).
- Known and set aside by the owner: screen readers cannot yet read text inputs, dialogs or tables
  in gpui-kit (#3818, #3870, #3595, #3647).

Compared with Slint: gpui-kit has better components and polish. Slint is more established and has
a software renderer for machines without a good GPU.

## 6. Plan

1. Fix the cheap things in Electron first, because they are independent of any rewrite:
   - Create the main window in parallel with sidecar startup. Let the API proxy wait for settings
     on first request.
   - Add startup timing markers (process start, sidecar ready, window shown, first SPA paint).
   - Lazy-load `electron-updater`.
2. Run the AppImage extract test. If it shows the mount is the cost, fix compression or packaging.
3. Run the gpui-kit spike on the Linux machine (`spikes/gpui-kit`, branch
   `feature/gpui-kit-spike`):
   - Cold start inside the AppImage and extracted, versus Electron.
   - Smooth scrolling and memory with 5,000 tiles.
   - Wayland versus XWayland, GNOME behaviour.
   - Typing in a non-Latin layout and with an IME.
   - A machine without a Vulkan GPU.
   - Controller shim feeding focus movement (not yet scaffolded).
4. If numbers favour it, repeat the checklist with Slint and pick between them. Decide using
   measured cold start and the GPU-less case.
5. If native wins, migrate in stages: reuse `claudio-core` as is, build the shell and library grid
   first, then game detail, downloads and settings. Keep Electron shipping until parity.

## 7. Open questions and unverified items

- Real cold-start numbers on Linux for Electron, extracted Electron and the spike.
- Whether AppImage mounting is the dominant cost.
- gpui-kit image decoding and caching for thousands of covers.
- IME on Linux for gpui-kit and Slint.
- Which input API Slint exposes for injecting controller events.
- The target audience's GPUs and whether a Vulkan requirement is acceptable.
