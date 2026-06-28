#!/usr/bin/env bash
# Strip bundled libraries that must never ship inside an AppImage because they
# have to match the host's graphics/compositor stack at runtime.
#
# Why: the Linux AppImage is built on an older base image than the systems it
# runs on. linuxdeploy bundles libwayland-* alongside WebKitGTK. On a newer host
# (e.g. Fedora 43 / Mesa 26), the host's libEGL is loaded against these stale
# bundled libwayland libs, eglGetPlatformDisplay fails with EGL_BAD_PARAMETER,
# the WebKit render process aborts, and the window shows a blank white screen.
# Removing the bundled copies makes the AppImage fall back to the host's
# libwayland, which is exactly what these libraries require.
#
# This repacks the AppImage by reusing its own embedded runtime header, so no
# appimagetool is required.
#
# Usage: scripts/strip-appimage-libs.sh path/to/App.AppImage
set -euo pipefail

APPIMAGE="${1:?usage: strip-appimage-libs.sh <AppImage>}"
APPIMAGE="$(readlink -f "$APPIMAGE")"

# Libraries that must defer to the host. These are on the upstream AppImage
# excludelist (https://github.com/AppImage/pkg2appimage/blob/master/excludelist).
EXCLUDE_GLOBS=(
  "libwayland-client.so*"
  "libwayland-cursor.so*"
  "libwayland-egl.so*"
  "libwayland-server.so*"
)

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

cd "$workdir"
"$APPIMAGE" --appimage-extract >/dev/null

removed=0
for glob in "${EXCLUDE_GLOBS[@]}"; do
  while IFS= read -r -d '' f; do
    rm -f "$f"
    echo "stripped $(basename "$f")"
    removed=$((removed + 1))
  done < <(find squashfs-root -type f -name "$glob" -path "*/lib/*" -print0)
done

if [ "$removed" -eq 0 ]; then
  echo "No excluded libraries were bundled; AppImage left unchanged."
  exit 0
fi

# Preserve the original AppImage runtime header, then append a fresh squashfs.
offset="$("$APPIMAGE" --appimage-offset)"
dd if="$APPIMAGE" of=runtime.bin bs=1 count="$offset" status=none
mksquashfs squashfs-root payload.squashfs -root-owned -noappend -comp gzip -b 128K -no-progress >/dev/null

cat runtime.bin payload.squashfs > "$APPIMAGE.patched"
chmod +x "$APPIMAGE.patched"
mv "$APPIMAGE.patched" "$APPIMAGE"
echo "Repacked $APPIMAGE ($removed lib(s) stripped)."
