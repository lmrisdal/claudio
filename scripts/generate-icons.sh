#!/usr/bin/env bash
set -euo pipefail

# Regenerate all app icons from src/claudio-web/public/favicon.svg
# Requires: npx (Node.js)

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SVG="$REPO_ROOT/src/claudio-web/public/favicon.svg"
DESKTOP_ICONS="$REPO_ROOT/src/claudio-desktop/icons"
PUBLIC="$REPO_ROOT/src/claudio-web/public"
TRAY_SVG="$DESKTOP_ICONS/tray-icon.svg"

if [ ! -f "$SVG" ]; then
  echo "Error: $SVG not found" >&2
  exit 1
fi

echo "Generating icons from $SVG"

SVG_BODY=$(grep -v '<?xml\|<svg\|</svg>' "$SVG")

# Clean up stale temp files from interrupted runs
rm -f /tmp/desktop-icon-white-* /tmp/desktop-icon-transparent-* /tmp/icon-mac-* /tmp/maskable-*

# Desktop app icons
# - macOS: white background
# - Windows: transparent background
DESKTOP_SVG_WHITE_BASE=$(mktemp /tmp/desktop-icon-white-XXXXXX)
DESKTOP_SVG_TRANSPARENT_BASE=$(mktemp /tmp/desktop-icon-transparent-XXXXXX)
MASKABLE_SVG_BASE=$(mktemp /tmp/maskable-XXXXXX)
MAC_ICON_PNG_BASE=$(mktemp /tmp/icon-mac-XXXXXX)

DESKTOP_SVG_WHITE="${DESKTOP_SVG_WHITE_BASE}.svg"
DESKTOP_SVG_TRANSPARENT="${DESKTOP_SVG_TRANSPARENT_BASE}.svg"
MASKABLE_SVG="${MASKABLE_SVG_BASE}.svg"
MAC_ICON_PNG="${MAC_ICON_PNG_BASE}.png"

mv "$DESKTOP_SVG_WHITE_BASE" "$DESKTOP_SVG_WHITE"
mv "$DESKTOP_SVG_TRANSPARENT_BASE" "$DESKTOP_SVG_TRANSPARENT"
mv "$MASKABLE_SVG_BASE" "$MASKABLE_SVG"
mv "$MAC_ICON_PNG_BASE" "$MAC_ICON_PNG"

cleanup() {
  rm -f "$DESKTOP_SVG_WHITE" "$DESKTOP_SVG_TRANSPARENT" "$MASKABLE_SVG" "$MAC_ICON_PNG"
}
trap cleanup EXIT

cat > "$DESKTOP_SVG_WHITE" <<SVGEOF
<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
  <rect width="48" height="48" fill="#ffffff"/>
  $SVG_BODY
</svg>
SVGEOF

cat > "$DESKTOP_SVG_TRANSPARENT" <<SVGEOF
<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
  $SVG_BODY
</svg>
SVGEOF

for size in 32 64 128 256; do
  echo "  ${size}x${size}.png"
  npx --yes svgexport "$DESKTOP_SVG_TRANSPARENT" "$DESKTOP_ICONS/${size}x${size}.png" "${size}:${size}"
done

echo "  128x128@2x.png"
npx --yes svgexport "$DESKTOP_SVG_TRANSPARENT" "$DESKTOP_ICONS/128x128@2x.png" "256:256"

echo "  icon.png (512x512 transparent)"
npx --yes svgexport "$DESKTOP_SVG_TRANSPARENT" "$DESKTOP_ICONS/icon.png" "512:512"

if [ -f "$TRAY_SVG" ]; then
  echo "  tray-icon.png (64x64)"
  npx --yes svgexport "$TRAY_SVG" "$DESKTOP_ICONS/tray-icon.png" "64:64"
fi

# Windows Store logos (transparent)
for size in 30 44 71 89 107 142 150 284 310; do
  echo "  Square${size}x${size}Logo.png"
  npx --yes svgexport "$DESKTOP_SVG_TRANSPARENT" "$DESKTOP_ICONS/Square${size}x${size}Logo.png" "${size}:${size}"
done

echo "  StoreLogo.png (50x50)"
npx --yes svgexport "$DESKTOP_SVG_TRANSPARENT" "$DESKTOP_ICONS/StoreLogo.png" "50:50"

# macOS .icns and Windows .ico
echo "  icon-mac.png (512x512 white)"
npx --yes svgexport "$DESKTOP_SVG_WHITE" "$MAC_ICON_PNG" "512:512"

echo "  icon.icns (white background for macOS)"
npx --yes png2icons "$MAC_ICON_PNG" "$DESKTOP_ICONS/icon" -icns

echo "  icon.ico (transparent background for Windows)"
npx --yes png2icons "$DESKTOP_ICONS/icon.png" "$DESKTOP_ICONS/icon" -ico

# PWA / web icons (transparent background)
echo "  apple-touch-icon.png (180x180)"
npx --yes svgexport "$SVG" "$PUBLIC/apple-touch-icon.png" "180:180"

echo "  icon-192.png"
npx --yes svgexport "$SVG" "$PUBLIC/icon-192.png" "192:192"

echo "  icon-512.png"
npx --yes svgexport "$SVG" "$PUBLIC/icon-512.png" "512:512"

# Maskable icon — logo at 80% on solid background (safe zone for adaptive icons)
echo "  icon-maskable-512.png"
cat > "$MASKABLE_SVG" <<SVGEOF
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#0a0a0f"/>
  <svg x="51" y="51" width="410" height="410" viewBox="0 0 48 48">
    $(grep -v '<?xml\|<svg\|</svg>' "$SVG")
  </svg>
</svg>
SVGEOF
npx --yes svgexport "$MASKABLE_SVG" "$PUBLIC/icon-maskable-512.png" "512:512"

echo "Done."
