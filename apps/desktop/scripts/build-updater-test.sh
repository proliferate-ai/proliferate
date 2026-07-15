#!/usr/bin/env bash
# Build a TEST-FLAVOR desktop app whose auto-updater points at a local manifest
# server and trusts a throwaway signing key. Used by the tier-4 upgrade test to
# produce an N-1 build, stage an N artifact, and watch a real auto-update.
#
# The shipped tauri.conf.json is never edited. We generate a gitignored overlay
# (plugins.updater.{endpoints,pubkey} only) and pass it to `tauri build --config`,
# which Tauri deep-merges on top of the real config.
#
# Required:
#   UPDATER_URL   full URL to the served latest.json (e.g. http://127.0.0.1:8787/latest.json)
# Optional:
#   UPDATER_PUBKEY / TAURI_SIGNING_PRIVATE_KEY / TAURI_SIGNING_PRIVATE_KEY_PASSWORD
#       Bring your own keypair. If UPDATER_PUBKEY is unset a throwaway keypair is
#       generated per run under a temp dir and used to sign this build only.
#   TARGET        rust target triple (default: host)
#   BUNDLES       tauri --bundles value (default: app)
set -euo pipefail

DESKTOP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DESKTOP_DIR"

: "${UPDATER_URL:?UPDATER_URL is required (URL of the served latest.json)}"

TARGET="${TARGET:-$(rustc -vV | awk '/host:/{print $2}')}"
BUNDLES="${BUNDLES:-app}"

# Per-run throwaway keypair unless the caller supplied one.
KEYDIR=""
if [[ -z "${UPDATER_PUBKEY:-}" ]]; then
  KEYDIR="$(mktemp -d "${TMPDIR:-/tmp}/proliferate-updater-testkey.XXXXXX")"
  trap 'rm -rf "$KEYDIR"' EXIT
  echo "Generating throwaway TEST-ONLY signing keypair in $KEYDIR ..."
  # -w writes the private key; empty password for unattended signing.
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" \
    pnpm tauri signer generate -w "$KEYDIR/test.key" --password "" >/dev/null
  export TAURI_SIGNING_PRIVATE_KEY="$KEYDIR/test.key"
  export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
  # The .pub file content IS the value tauri.conf.json's `pubkey` expects
  # (base64 of the minisign public key) -- use it verbatim, do not re-encode.
  UPDATER_PUBKEY="$(tr -d '\n' < "$KEYDIR/test.key.pub")"
fi

export UPDATER_URL UPDATER_PUBKEY
node scripts/make-updater-test-conf.mjs

echo "Building test-flavor app (target=$TARGET bundles=$BUNDLES) ..."
echo "  updater endpoint: $UPDATER_URL"
pnpm tauri build --target "$TARGET" --bundles "$BUNDLES" \
  --config src-tauri/updater-test.conf.json

echo "Done. Test build trusts the throwaway key and polls $UPDATER_URL."
