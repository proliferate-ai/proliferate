#!/usr/bin/env bash
# Agent-gateway smoke: proxy health -> mint key -> models list -> chat
# completion -> spend log visible, then per-harness CLI runners.
#
# Usage:
#   AGENT_GATEWAY_LITELLM_MASTER_KEY=sk-... ./run.sh
#
# See README.md for configuration.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$SCRIPT_DIR/lib.sh"

require_tools
require_master_key

SMOKE_KEY=""
SMOKE_TOKEN_ID=""

cleanup() {
  delete_smoke_key "$SMOKE_TOKEN_ID"
}
trap cleanup EXIT

check_proxy_health
mint_smoke_key "agent-gateway-smoke-$(date +%s)-$$"
check_models_list "$SMOKE_KEY"
check_chat_completion "$SMOKE_KEY"
check_spend_log_visible "$SMOKE_TOKEN_ID"

log "core proxy checks passed"

# Per-harness runners. Each is independent: it checks its CLI is installed
# (SKIP otherwise), mints its own scoped virtual key, builds an isolated
# home/config under mktemp, runs the CLI one-shot against the gateway, and
# asserts the reply marker. SKIP (exit $SKIP_EXIT_CODE) is non-fatal; any
# other non-zero exit marks the overall run failed.
HARNESS_FAILURES=""
HARNESS_SUMMARY=""

for harness in claude codex opencode grok; do
  runner="$SCRIPT_DIR/$harness.sh"
  if [ ! -x "$runner" ]; then
    log "SKIP: $harness (no runner at $runner)"
    HARNESS_SUMMARY="$HARNESS_SUMMARY $harness=SKIP"
    continue
  fi
  log "--- harness: $harness ---"
  status=0
  "$runner" || status=$?
  if [ "$status" -eq 0 ]; then
    HARNESS_SUMMARY="$HARNESS_SUMMARY $harness=PASS"
  elif [ "$status" -eq "$SKIP_EXIT_CODE" ]; then
    HARNESS_SUMMARY="$HARNESS_SUMMARY $harness=SKIP"
  else
    HARNESS_SUMMARY="$HARNESS_SUMMARY $harness=FAIL"
    HARNESS_FAILURES="$HARNESS_FAILURES $harness"
  fi
done

log "harness results:$HARNESS_SUMMARY"

if [ -n "$HARNESS_FAILURES" ]; then
  fail "harness runner(s) failed:$HARNESS_FAILURES"
fi

log "PASS"
