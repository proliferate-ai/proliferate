#!/usr/bin/env bash
# Publish the bare AnyHarness runtime + worker binaries to the downloads CDN.
#
# The cloud server's artifact redirects
# (server/proliferate/server/cloud/runtime_workers/service.py:
# `runtime_artifact_redirect_url` / `worker_artifact_redirect_url`) 302 a sandbox
# worker to
#   {base}/runtime/stable/{version}/{target}/anyharness(.sha256)
#   {base}/worker/stable/{version}/{target}/proliferate-worker(.sha256)
# with an unpinned {base}/{tree}/stable/{target}/... fallback. Nothing in this
# repo published either tree until this script: release-runtime.yml built the
# binaries and attached them to the GitHub Release, but the sandbox self-update
# path reads the CDN, not GitHub (it must stay free of GitHub egress). So the
# worker self-update and the AnyHarness runtime self-update both resolved to
# 404/403 on the CDN. This is the "same mechanism" publisher release-desktop.yml
# already has for the desktop tree — extended to the runtime + worker trees.
#
# The release archives are named by Rust target triple; the CDN paths use the
# os-arch tokens the worker derives (self_update.rs `artifact_target`). This
# script maps between them and uploads the extracted bare binary plus a per-asset
# `.sha256` sibling (the worker derives the checksum URL from the resolved binary
# URL, not from SHA256SUMS — see self_update.rs `checksum_url_for`).
#
# Idempotent + additive: versioned keys are immutable and skipped if present, so
# a re-run never rewrites a published byte. The unpinned "stable" latest pointer
# (--publish-latest) is the one mutable key set and is only moved forward.
#
# Usage:
#   publish-runtime-cdn.sh --artifacts-dir DIR --version X.Y.Z --bucket NAME \
#     [--publish-latest] [--dry-run]
# DIR contains the anyharness-<triple>.tar.gz archives from release-runtime.yml
# (or `gh release download runtime-vX.Y.Z`).
#
# Kept portable to bash 3.2 (macOS default) so the manual backfill and CI use
# the same script.
set -euo pipefail

ARTIFACTS_DIR=""
VERSION=""
BUCKET=""
PUBLISH_LATEST=0
DRY_RUN=0
ONLY_TREE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --artifacts-dir) ARTIFACTS_DIR="$2"; shift 2 ;;
    --version) VERSION="$2"; shift 2 ;;
    --bucket) BUCKET="$2"; shift 2 ;;
    --publish-latest) PUBLISH_LATEST=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    # Publish only "runtime" or "worker" (default: both). Used by the manual
    # backfill to publish the runtime tree alone without touching worker/stable.
    --only-tree) ONLY_TREE="$2"; shift 2 ;;
    *) echo "::error::unknown arg $1" >&2; exit 2 ;;
  esac
done

: "${ARTIFACTS_DIR:?--artifacts-dir is required}"
: "${VERSION:?--version is required}"
: "${BUCKET:?--bucket is required}"

# Rust target triple (release archive) -> CDN os-arch token (worker
# artifact_target). Windows is intentionally absent: sandboxes are linux, desktop
# ships anyharness inside its app bundle, so no self-update path fetches a windows
# runtime/worker.
cdn_token_for() {
  case "$1" in
    x86_64-unknown-linux-musl) echo "linux-x86_64" ;;
    aarch64-unknown-linux-musl) echo "linux-aarch64" ;;
    x86_64-apple-darwin) echo "macos-x86_64" ;;
    aarch64-apple-darwin) echo "macos-aarch64" ;;
    *) echo "" ;;
  esac
}

# Bare binary in the archive -> CDN tree.
tree_for() {
  case "$1" in
    anyharness) echo "runtime" ;;
    proliferate-worker) echo "worker" ;;
    *) echo "" ;;
  esac
}

TRIPLES="x86_64-unknown-linux-musl aarch64-unknown-linux-musl x86_64-apple-darwin aarch64-apple-darwin"
BINARIES="anyharness proliferate-worker"

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

# Portable bare-hex sha256 (Linux CI has sha256sum; macOS has shasum).
sha256_hex() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

upload() {
  # upload <local-file> <s3-key> <immutable:0|1>
  local file="$1" key="$2" immutable="$3"
  local dest="s3://${BUCKET}/${key}"
  if [[ "$immutable" == "1" ]] && aws s3api head-object --bucket "$BUCKET" --key "$key" >/dev/null 2>&1; then
    echo "  skip (exists, immutable): ${key}"
    return
  fi
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "  DRY-RUN put: ${key}"
    return
  fi
  aws s3 cp "$file" "$dest" --only-show-errors
  echo "  put: ${key}"
}

echo "Publishing runtime + worker CDN trees for version ${VERSION} to bucket ${BUCKET}"
for triple in $TRIPLES; do
  token="$(cdn_token_for "$triple")"
  archive="${ARTIFACTS_DIR}/anyharness-${triple}.tar.gz"
  if [[ ! -f "$archive" ]]; then
    echo "::warning::missing archive for ${triple} (${archive}); skipping ${token}"
    continue
  fi
  extract="${workdir}/${token}"
  mkdir -p "$extract"
  tar xzf "$archive" -C "$extract"
  echo "target ${token} (from ${triple}):"
  for binary in $BINARIES; do
    tree="$(tree_for "$binary")"
    if [[ -n "$ONLY_TREE" && "$tree" != "$ONLY_TREE" ]]; then
      continue
    fi
    src="${extract}/${binary}"
    if [[ ! -f "$src" ]]; then
      echo "::warning::archive ${triple} has no ${binary}; skipping"
      continue
    fi
    # Per-asset checksum sibling (bare hex, matching release-runtime.yml).
    sha="$(sha256_hex "$src")"
    shafile="${src}.sha256"
    printf '%s' "$sha" > "$shafile"

    base="${tree}/stable/${VERSION}/${token}/${binary}"
    upload "$src" "${base}" 1
    upload "$shafile" "${base}.sha256" 1

    if [[ "$PUBLISH_LATEST" == "1" ]]; then
      latest="${tree}/stable/${token}/${binary}"
      upload "$src" "${latest}" 0
      upload "$shafile" "${latest}.sha256" 0
    fi
  done
done

echo "Done."
