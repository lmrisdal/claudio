# gpui-kit spike

Throwaway experiment to see whether [gpui-kit](https://github.com/longbridge/gpui-kit) can carry
Claudio's UI on Linux. Not part of the Cargo workspace, not built by CI.

```bash
cd spikes/gpui-kit
cargo run --release
SPIKE_EXIT_AFTER_FIRST_RENDER=1 cargo run --release   # prints init-done-ms and first-render-ms, then exits
```

Cover tiles are coloured placeholders. Real image decoding and caching are not covered yet.

## Checklist (run on Linux, inside an AppImage and from an extracted copy)

1. Cold start: compare `first-render-ms` and wall time against the extracted Electron build (`--appimage-extract`).
2. Scroll the 5,000-tile grid: smoothness, memory.
3. Wayland and X11 (`WAYLAND_DISPLAY="" cargo run --release` forces XWayland); GNOME 50 stalls (zed#53522).
4. Type in a non-Latin keyboard layout and with an IME.
5. Controller: feed `gilrs` or SDL events into focus movement (not scaffolded).
6. Machine without a Vulkan GPU: does a window open at all?
