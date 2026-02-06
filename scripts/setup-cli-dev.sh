#!/bin/bash
# Setup script for CLI development
# Downloads opencode binary from anomalyco/opencode and prepares local dev environment

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
CLI_DIR="$ROOT_DIR/packages/cli"
BIN_DIR="$CLI_DIR/bin"

echo "Setting up CLI development environment..."

# Detect platform
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$OS" in
  darwin) PLATFORM="darwin" ;;
  linux) PLATFORM="linux" ;;
  *)
    echo "Unsupported OS: $OS"
    exit 1
    ;;
esac

case "$ARCH" in
  arm64|aarch64) ARCH_NAME="arm64" ;;
  x86_64|amd64) ARCH_NAME="x64" ;;
  *)
    echo "Unsupported architecture: $ARCH"
    exit 1
    ;;
esac

# Get latest release URL from anomalyco/opencode (the one with --attach support)
RELEASE_URL="https://api.github.com/repos/anomalyco/opencode/releases/latest"

# Determine asset name and extension
if [ "$PLATFORM" = "darwin" ]; then
  ASSET_NAME="opencode-darwin-${ARCH_NAME}.zip"
  EXT="zip"
else
  ASSET_NAME="opencode-linux-${ARCH_NAME}.tar.gz"
  EXT="tar.gz"
fi

echo "Detecting platform: $PLATFORM-$ARCH_NAME"
echo "Looking for: $ASSET_NAME"

# Get download URL (browser_download_url for the specific asset)
DOWNLOAD_URL=$(curl -s "$RELEASE_URL" | grep -o "https://github.com/anomalyco/opencode/releases/download/[^\"]*${ASSET_NAME}" | head -1)

if [ -z "$DOWNLOAD_URL" ]; then
  echo "Could not find download URL for $ASSET_NAME"
  exit 1
fi

echo "Download URL: $DOWNLOAD_URL"

# Create bin directory
mkdir -p "$BIN_DIR"

# Download and extract
TEMP_DIR=$(mktemp -d)
echo "Downloading opencode..."
curl -sL "$DOWNLOAD_URL" -o "$TEMP_DIR/opencode.$EXT"

echo "Extracting..."
if [ "$EXT" = "zip" ]; then
  unzip -q "$TEMP_DIR/opencode.$EXT" -d "$TEMP_DIR"
else
  tar -xzf "$TEMP_DIR/opencode.$EXT" -C "$TEMP_DIR"
fi

# Find the binary
BINARY=$(find "$TEMP_DIR" -name "opencode" -type f | head -1)

if [ -z "$BINARY" ]; then
  echo "Could not find opencode binary in archive"
  ls -laR "$TEMP_DIR"
  exit 1
fi

# Copy to bin directory with platform-specific name
TARGET_NAME="opencode-${PLATFORM}-${ARCH_NAME}"
cp "$BINARY" "$BIN_DIR/$TARGET_NAME"
chmod +x "$BIN_DIR/$TARGET_NAME"

# Cleanup
rm -rf "$TEMP_DIR"

# Verify
VERSION=$("$BIN_DIR/$TARGET_NAME" -v 2>&1 | tail -1)
echo ""
echo "✓ OpenCode $VERSION installed to: $BIN_DIR/$TARGET_NAME"
echo ""
echo "To test the CLI:"
echo "  pnpm cli:local login    # Login to local dev server"
echo "  pnpm cli:local chat     # Start a session"
echo ""
echo "Make sure you have running:"
echo "  1. pnpm dev:web         # Web app (API) on localhost:3000"
echo "  2. pnpm dev:gateway     # Gateway"
