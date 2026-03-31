#!/usr/bin/env bash
set -euo pipefail

# Regenerate all app icons from frontend/public/favicon.svg
# Requires: npx (Node.js)

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SVG="$REPO_ROOT/frontend/public/favicon.svg"
DESKTOP_ICONS="$REPO_ROOT/src/claudio-desktop/icons"
PUBLIC="$REPO_ROOT/frontend/public"

if [ ! -f "$SVG" ]; then
  echo "Error: $SVG not found" >&2
  exit 1
fi

echo "Generating icons from $SVG"

rm -f /tmp/desktop-icon-XXXXXX.svg /tmp/maskable-XXXXXX.svg

# Desktop app icons (white background for macOS/Windows)
DESKTOP_SVG=$(mktemp /tmp/desktop-icon-XXXXXX.svg)

cat > "$DESKTOP_SVG" <<SVGEOF
<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
  <rect width="48" height="48" fill="#ffffff"/>
  $(grep -v '<?xml\|<svg\|</svg>' "$SVG")
</svg>
SVGEOF

for size in 32 64 128 256; do
  echo "  ${size}x${size}.png"
  npx --yes svgexport "$DESKTOP_SVG" "$DESKTOP_ICONS/${size}x${size}.png" "${size}:${size}"
done

echo "  128x128@2x.png"
npx --yes svgexport "$DESKTOP_SVG" "$DESKTOP_ICONS/128x128@2x.png" "256:256"

echo "  icon.png (512x512)"
npx --yes svgexport "$DESKTOP_SVG" "$DESKTOP_ICONS/icon.png" "512:512"

# Windows Store logos
for size in 30 44 71 89 107 142 150 284 310; do
  echo "  Square${size}x${size}Logo.png"
  npx --yes svgexport "$DESKTOP_SVG" "$DESKTOP_ICONS/Square${size}x${size}Logo.png" "${size}:${size}"
done

echo "  StoreLogo.png (50x50)"
npx --yes svgexport "$DESKTOP_SVG" "$DESKTOP_ICONS/StoreLogo.png" "50:50"

# macOS .icns and Windows .ico
echo "  icon.icns + icon.ico"
npx --yes png2icons "$DESKTOP_ICONS/icon.png" "$DESKTOP_ICONS/icon" -all

# PWA / web icons (transparent background)
echo "  apple-touch-icon.png (180x180)"
npx --yes svgexport "$SVG" "$PUBLIC/apple-touch-icon.png" "180:180"

echo "  icon-192.png"
npx --yes svgexport "$SVG" "$PUBLIC/icon-192.png" "192:192"

echo "  icon-512.png"
npx --yes svgexport "$SVG" "$PUBLIC/icon-512.png" "512:512"

# Maskable icon — logo at 80% on solid background (safe zone for adaptive icons)
echo "  icon-maskable-512.png"
MASKABLE_SVG=$(mktemp /tmp/maskable-XXXXXX.svg)
cat > "$MASKABLE_SVG" <<SVGEOF
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#0a0a0f"/>
  <svg x="51" y="51" width="410" height="410" viewBox="0 0 48 48">
    $(grep -v '<?xml\|<svg\|</svg>' "$SVG")
  </svg>
</svg>
SVGEOF
npx --yes svgexport "$MASKABLE_SVG" "$PUBLIC/icon-maskable-512.png" "512:512"
rm -f "$MASKABLE_SVG" "$DESKTOP_SVG"

echo "Done."
