#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_FILE="${1:-$ROOT_DIR/logs.txt}"
CONSOLE_FILE="${2:-$ROOT_DIR/console.txt}"

: > "$LOG_FILE"
: > "$CONSOLE_FILE"

echo "Writing server logs to: $LOG_FILE"
echo "Writing client console logs to: $CONSOLE_FILE"
echo "Starting dev stack..."

cd "$ROOT_DIR"
DEV_CONSOLE_LOG_PATH="$CONSOLE_FILE" pnpm dev 2>&1 | tee -a "$LOG_FILE"
