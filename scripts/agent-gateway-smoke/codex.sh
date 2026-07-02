#!/usr/bin/env bash
# codex (Codex CLI) gateway smoke.
#
# Drives codex exec through the LiteLLM proxy (/v1/responses bridge) with a
# freshly minted scoped virtual key and an isolated CODEX_HOME whose
# config.toml points a custom provider at the gateway (wire_api = "responses").
# Recipe: HARNESS-MATRIX.md (live-verified, including anthropic upstream).
#
# Notes from the matrix:
#   - --skip-git-repo-check is REQUIRED: codex exec hangs outside a git repo.
#   - Sanitize OPENAI_API_KEY / ANTHROPIC_API_KEY so ambient creds cannot leak
#     into the run; auth comes solely from env_key (PROLIFERATE_GATEWAY_KEY).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$SCRIPT_DIR/lib.sh"

command -v codex >/dev/null 2>&1 || skip "codex: CLI not installed"

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

mint_smoke_key "agent-gateway-smoke-codex-$(date +%s)-$$"
TMP_ROOT="$(new_tmp_root codex)"
mkdir -p "$TMP_ROOT/codex-home" "$TMP_ROOT/workdir"
OUT="$TMP_ROOT/output.log"

cat >"$TMP_ROOT/codex-home/config.toml" <<EOF
model_provider = "proliferate"
model = "$SMOKE_HARNESS_MODEL"

[model_providers.proliferate]
name = "Proliferate Gateway"
base_url = "$GATEWAY_BASE_URL/v1"
env_key = "PROLIFERATE_GATEWAY_KEY"
wire_api = "responses"
EOF

log "codex: one-shot via $GATEWAY_BASE_URL model=$SMOKE_HARNESS_MODEL"
status=0
(
  cd "$TMP_ROOT/workdir"
  run_harness 180 "$OUT" \
    env -u OPENAI_API_KEY -u OPENAI_BASE_URL -u ANTHROPIC_API_KEY \
    CODEX_HOME="$TMP_ROOT/codex-home" \
    PROLIFERATE_GATEWAY_KEY="$SMOKE_KEY" \
    codex exec -m "$SMOKE_HARNESS_MODEL" --skip-git-repo-check "$SMOKE_PROMPT"
) || status=$?

assert_gateway_ok codex "$status" "$OUT"
