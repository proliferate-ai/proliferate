#!/bin/bash
# Rasterize dmg-background.svg into the multi-resolution TIFF that
# tauri.conf.json points at. Finder picks the 2x page on Retina displays,
# which is what keeps the installer window crisp.
#
# Requires: Google Chrome (headless rasterizer) + macOS tiffutil.
set -euo pipefail
cd "$(dirname "$0")"

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

for scale in 1 2; do
  "$CHROME" --headless=new --disable-gpu --default-background-color=00000000 \
    --window-size=660,400 --force-device-scale-factor="$scale" \
    --screenshot="$TMP/bg-${scale}x.png" \
    "file://$PWD/dmg-background.svg" >/dev/null 2>&1
done

tiffutil -cathidpicheck "$TMP/bg-1x.png" "$TMP/bg-2x.png" -out dmg-background.tiff
echo "wrote $(pwd)/dmg-background.tiff"
