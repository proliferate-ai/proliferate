#!/usr/bin/env bash
# grok (Grok CLI) gateway smoke.
#
# Drives the grok CLI through the LiteLLM proxy with a freshly minted scoped
# virtual key and an isolated HOME. The CLI discovers models dynamically via
# GET /v1/models (GROK_MODELS_BASE_URL) and then POSTs /v1/chat/completions,
# so the grok-named model must be in the proxy model_list (grok-4-fast and
# grok-build are aliased in server/litellm/config.yaml; the CLI does not care
# about the upstream provider).
# Recipe: HARNESS-MATRIX.md (live-verified).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$SCRIPT_DIR/lib.sh"

command -v grok >/dev/null 2>&1 || skip "grok: CLI not installed"

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

mint_smoke_key "agent-gateway-smoke-grok-$(date +%s)-$$"
TMP_ROOT="$(new_tmp_root grok)"
mkdir -p "$TMP_ROOT/home" "$TMP_ROOT/workdir"
OUT="$TMP_ROOT/output.log"

log "grok: one-shot via $GATEWAY_BASE_URL model=$SMOKE_GROK_MODEL"
status=0
(
  cd "$TMP_ROOT/workdir"
  run_harness 120 "$OUT" \
    env -u XAI_BASE_URL \
    HOME="$TMP_ROOT/home" \
    GROK_MODELS_BASE_URL="$GATEWAY_BASE_URL/v1" \
    XAI_API_KEY="$SMOKE_KEY" \
    grok -p "$SMOKE_PROMPT" -m "$SMOKE_GROK_MODEL"
) || status=$?

assert_gateway_ok grok "$status" "$OUT"
