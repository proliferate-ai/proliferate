#!/usr/bin/env bash
# gemini (Gemini CLI) gateway smoke.
#
# Drives the gemini CLI through the LiteLLM ROOT /v1beta genai facade with a
# freshly minted scoped virtual key, an isolated HOME carrying
# ~/.gemini/settings.json (selectedType=gemini-api-key), and
# GEMINI_CLI_TRUST_WORKSPACE=true.
# Recipe: HARNESS-MATRIX.md (live-verified via the facade).
#
# REQUIRES a real Google upstream behind the proxy: LiteLLM's genai→anthropic
# translation sends temperature+top_p together and Anthropic rejects it, so
# gemini model names must NOT be aliased to other providers. The gateway's
# gemini-3.5-flash entry reads GEMINI_API_KEY from the proxy environment; this
# runner therefore SKIPs unless GEMINI_UPSTREAM_AVAILABLE=1 asserts that the
# proxy really has a Google key.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$SCRIPT_DIR/lib.sh"

command -v gemini >/dev/null 2>&1 || skip "gemini: CLI not installed"
if [ "${GEMINI_UPSTREAM_AVAILABLE:-0}" != "1" ]; then
  skip "gemini: needs a real Google upstream behind the proxy (set GEMINI_UPSTREAM_AVAILABLE=1 when the gateway has GEMINI_API_KEY configured)"
fi

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

mint_smoke_key "agent-gateway-smoke-gemini-$(date +%s)-$$"
TMP_ROOT="$(new_tmp_root gemini)"
mkdir -p "$TMP_ROOT/home/.gemini" "$TMP_ROOT/workdir"
OUT="$TMP_ROOT/output.log"

cat >"$TMP_ROOT/home/.gemini/settings.json" <<'EOF'
{
  "security": {
    "auth": {
      "selectedType": "gemini-api-key"
    }
  }
}
EOF

log "gemini: one-shot via $GATEWAY_BASE_URL model=$SMOKE_GEMINI_MODEL"
status=0
(
  cd "$TMP_ROOT/workdir"
  run_harness 120 "$OUT" \
    env -u GOOGLE_API_KEY -u GOOGLE_APPLICATION_CREDENTIALS \
    -u GOOGLE_GENAI_USE_VERTEXAI \
    HOME="$TMP_ROOT/home" \
    GEMINI_CLI_TRUST_WORKSPACE=true \
    GOOGLE_GEMINI_BASE_URL="$GATEWAY_BASE_URL" \
    GEMINI_API_KEY="$SMOKE_KEY" \
    gemini -p "$SMOKE_PROMPT" -m "$SMOKE_GEMINI_MODEL"
) || status=$?

assert_gateway_ok gemini "$status" "$OUT"
