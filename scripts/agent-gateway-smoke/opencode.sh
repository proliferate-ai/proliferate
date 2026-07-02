#!/usr/bin/env bash
# opencode gateway smoke.
#
# Drives opencode run through the LiteLLM proxy with a freshly minted scoped
# virtual key. Provider config lives in an opencode.json in the isolated
# workdir (explicit models map is REQUIRED); XDG dirs are isolated too.
# Recipe: HARNESS-MATRIX.md (live-verified).
#
# Notes from the matrix:
#   - The CLI process lingers after completion (its server keeps running), so
#     the run is bounded by run_harness, which detects the marker in the
#     output and kills the whole process group.
#   - Some opencode builds (observed on 1.16.2) drop buffered stdout on exit
#     when stdout is not a TTY: the assistant text never reaches the log even
#     though the gateway round trip succeeded. The session storage in the
#     isolated XDG_DATA_HOME is authoritative, so when the marker is missing
#     from stdout we fall back to checking the stored assistant parts.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$SCRIPT_DIR/lib.sh"

command -v opencode >/dev/null 2>&1 || skip "opencode: CLI not installed"

require_tools
require_master_key

SMOKE_KEY=""
SMOKE_TOKEN_ID=""
TMP_ROOT=""

cleanup() {
  delete_smoke_key "$SMOKE_TOKEN_ID"
  if [ -n "$TMP_ROOT" ]; then
    rm -rf "$TMP_ROOT"
  fi
}
trap cleanup EXIT

mint_smoke_key "agent-gateway-smoke-opencode-$(date +%s)-$$"
TMP_ROOT="$(new_tmp_root opencode)"
mkdir -p "$TMP_ROOT/workdir" "$TMP_ROOT/xdg-config" "$TMP_ROOT/xdg-data" \
  "$TMP_ROOT/xdg-cache" "$TMP_ROOT/xdg-state"
OUT="$TMP_ROOT/output.log"

cat >"$TMP_ROOT/workdir/opencode.json" <<EOF
{
  "\$schema": "https://opencode.ai/config.json",
  "provider": {
    "proliferate": {
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "$GATEWAY_BASE_URL/v1",
        "apiKey": "{env:PROLIFERATE_GATEWAY_KEY}"
      },
      "models": {
        "$SMOKE_HARNESS_MODEL": {}
      }
    }
  }
}
EOF

# marker_in_session_storage
# True when the isolated opencode data dir contains an assistant text part
# that is exactly the smoke marker (the stored user prompt is the full
# "Reply with exactly: ..." string, so an exact match cannot false-positive).
marker_in_session_storage() {
  python3 - "$TMP_ROOT/xdg-data" "$SMOKE_MARKER" <<'PY'
import json
import pathlib
import sqlite3
import sys

data_dir = pathlib.Path(sys.argv[1])
marker = sys.argv[2]


def texts_from_sqlite(db_path):
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        for (data,) in conn.execute("SELECT data FROM part"):
            try:
                part = json.loads(data)
            except (TypeError, ValueError):
                continue
            if part.get("type") == "text":
                yield str(part.get("text", ""))
    finally:
        conn.close()


def texts_from_json_files(root):
    # Older opencode layouts store message parts as JSON files.
    for path in root.rglob("*.json"):
        try:
            doc = json.loads(path.read_text())
        except (OSError, ValueError):
            continue
        stack = [doc]
        while stack:
            node = stack.pop()
            if isinstance(node, dict):
                if node.get("type") == "text":
                    yield str(node.get("text", ""))
                stack.extend(node.values())
            elif isinstance(node, list):
                stack.extend(node)


texts = []
for db in data_dir.rglob("opencode.db"):
    try:
        texts.extend(texts_from_sqlite(db))
    except sqlite3.Error:
        pass
if not texts:
    texts.extend(texts_from_json_files(data_dir))

sys.exit(0 if any(t.strip() == marker for t in texts) else 1)
PY
}

log "opencode: one-shot via $GATEWAY_BASE_URL model=proliferate/$SMOKE_HARNESS_MODEL"
status=0
(
  cd "$TMP_ROOT/workdir"
  run_harness 120 "$OUT" \
    env -u OPENAI_API_KEY -u ANTHROPIC_API_KEY \
    XDG_CONFIG_HOME="$TMP_ROOT/xdg-config" \
    XDG_DATA_HOME="$TMP_ROOT/xdg-data" \
    XDG_CACHE_HOME="$TMP_ROOT/xdg-cache" \
    XDG_STATE_HOME="$TMP_ROOT/xdg-state" \
    PROLIFERATE_GATEWAY_KEY="$SMOKE_KEY" \
    opencode run -m "proliferate/$SMOKE_HARNESS_MODEL" "$SMOKE_PROMPT"
) || status=$?

if ! marker_present "$OUT" && marker_in_session_storage; then
  log "PASS: opencode reached the gateway ($SMOKE_MARKER via session storage; CLI dropped stdout)"
  exit 0
fi

assert_gateway_ok opencode "$status" "$OUT"
