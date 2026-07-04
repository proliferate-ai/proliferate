#!/bin/sh
# Proliferate Self-Host Installer
# Downloads and extracts the latest release of the self-hosted deploy bundle.
# Usage: curl -fsSL https://raw.githubusercontent.com/proliferate-ai/proliferate/main/scripts/self-host/install.sh | sh

set -eu

REPO="proliferate-ai/proliferate"
INSTALL_DIR="./proliferate"
GITHUB_API="https://api.github.com"

log() {
  printf '\033[1;34m==>\033[0m %s\n' "$*" >&2
}

error() {
  printf '\033[1;31mError:\033[0m %s\n' "$*" >&2
  exit 1
}

check_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    error "Required command '$1' not found. Please install it and try again."
  fi
}

# Detect which checksum tool is available
detect_checksum_tool() {
  if command -v sha256sum >/dev/null 2>&1; then
    printf "sha256sum"
  elif command -v shasum >/dev/null 2>&1; then
    printf "shasum"
  else
    printf ""
  fi
}

check_command curl
check_command tar

CHECKSUM_TOOL=$(detect_checksum_tool)

if [ -d "$INSTALL_DIR" ] && [ -n "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ]; then
  error "Directory '$INSTALL_DIR' already exists and is not empty. Remove it or run from a different location."
fi

log "Fetching latest release from GitHub..."
release_url="${GITHUB_API}/repos/${REPO}/releases/latest"
release_json=$(curl -fsSL "$release_url") || error "Failed to fetch release information. Check your network connection."

version=$(printf '%s' "$release_json" | grep -o '"tag_name": *"[^"]*"' | head -n1 | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/')
if [ -z "$version" ]; then
  error "Could not determine latest release version."
fi

log "Latest release: $version"

tarball_name="proliferate-selfhost-${version}.tar.gz"
checksum_name="${tarball_name}.sha256"

tarball_url=$(printf '%s' "$release_json" | grep -o '"browser_download_url": *"[^"]*'"$tarball_name"'"' | head -n1 | sed 's/.*"browser_download_url": *"\([^"]*\)".*/\1/')
checksum_url=$(printf '%s' "$release_json" | grep -o '"browser_download_url": *"[^"]*'"$checksum_name"'"' | head -n1 | sed 's/.*"browser_download_url": *"\([^"]*\)".*/\1/')

if [ -z "$tarball_url" ]; then
  error "Could not find download URL for $tarball_name in release $version."
fi

log "Downloading $tarball_name..."
curl -fsSL -o "$tarball_name" "$tarball_url" || error "Failed to download $tarball_name."

if [ -n "$checksum_url" ]; then
  if [ -z "$CHECKSUM_TOOL" ]; then
    log "WARNING: Neither sha256sum nor shasum found. Skipping checksum verification."
    log "For security, consider installing sha256sum (Linux) or shasum (macOS)."
  else
    log "Downloading checksum..."
    curl -fsSL -o "$checksum_name" "$checksum_url" || log "Checksum file not available (non-fatal)."

    if [ -f "$checksum_name" ]; then
      log "Verifying checksum..."
      case "$CHECKSUM_TOOL" in
        sha256sum)
          if ! sha256sum -c "$checksum_name" >/dev/null 2>&1; then
            rm -f "$tarball_name" "$checksum_name"
            error "Checksum verification failed. The download may be corrupted or tampered with."
          fi
          ;;
        shasum)
          if ! shasum -a 256 -c "$checksum_name" >/dev/null 2>&1; then
            rm -f "$tarball_name" "$checksum_name"
            error "Checksum verification failed. The download may be corrupted or tampered with."
          fi
          ;;
      esac
      log "Checksum verified successfully."
      rm -f "$checksum_name"
    fi
  fi
fi

log "Extracting to $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR"
tar xzf "$tarball_name" -C "$INSTALL_DIR" --strip-components=1 || {
  rm -rf "$INSTALL_DIR"
  rm -f "$tarball_name"
  error "Failed to extract tarball."
}
rm -f "$tarball_name"

log "Installation complete!"
log ""
log "Next steps:"
log "  1. cd $INSTALL_DIR"
log "  2. cp .env.production.example .env.static"
log "  3. Edit .env.static with your configuration (SITE_ADDRESS, API_BASE_URL, etc.)"
log "  4. ./bootstrap.sh"
log ""
log "After bootstrap completes, claim your instance at the URL shown."
log ""
log "For more information, see: https://docs.proliferate.com/deployment/self-hosted"
