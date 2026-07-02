#!/usr/bin/env bash
# claude (Claude Code CLI) gateway smoke.
#
# Drives the claude CLI through the LiteLLM proxy with a freshly minted scoped
# virtual key, an isolated CLAUDE_CONFIG_DIR, and a versioned model id.
# Recipe: HARNESS-MATRIX.md (live-verified).
#
# CRITICAL (see HARNESS-MATRIX.md): ambient provider env silently reroutes the
# CLI — CLAUDE_CODE_USE_BEDROCK / AWS_BEARER_TOKEN_BEDROCK /
# CLAUDE_CODE_USE_VERTEX / ANTHROPIC_API_KEY must be UNSET or requests go to
# Bedrock/Vertex despite ANTHROPIC_BASE_URL (with misleading errors).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$SCRIPT_DIR/lib.sh"

command -v claude >/dev/null 2>&1 || skip "claude: CLI not installed"

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

mint_smoke_key "agent-gateway-smoke-claude-$(date +%s)-$$"
TMP_ROOT="$(new_tmp_root claude)"
mkdir -p "$TMP_ROOT/config" "$TMP_ROOT/workdir"
OUT="$TMP_ROOT/output.log"

log "claude: one-shot via $GATEWAY_BASE_URL model=$SMOKE_HARNESS_MODEL"
status=0
(
  cd "$TMP_ROOT/workdir"
  run_harness 180 "$OUT" \
    env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_MODEL \
    -u CLAUDE_CODE_USE_BEDROCK -u CLAUDE_CODE_USE_VERTEX \
    -u AWS_BEARER_TOKEN_BEDROCK \
    CLAUDE_CONFIG_DIR="$TMP_ROOT/config" \
    ANTHROPIC_BASE_URL="$GATEWAY_BASE_URL" \
    ANTHROPIC_AUTH_TOKEN="$SMOKE_KEY" \
    ANTHROPIC_SMALL_FAST_MODEL="$SMOKE_HARNESS_MODEL" \
    claude -p "$SMOKE_PROMPT" --model "$SMOKE_HARNESS_MODEL"
) || status=$?

assert_gateway_ok claude "$status" "$OUT"
