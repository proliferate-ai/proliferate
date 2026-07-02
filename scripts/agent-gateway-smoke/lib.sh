#!/usr/bin/env bash
# Shared helpers for the agent-gateway smoke harness.
#
# Configuration (env vars):
#   AGENT_GATEWAY_LITELLM_BASE_URL     proxy base URL (default http://127.0.0.1:14000)
#   AGENT_GATEWAY_LITELLM_MASTER_KEY   master key for management calls (required)
#   AGENT_GATEWAY_SMOKE_MODEL          model for the core completion check
#                                      (default claude-haiku-4-5)
#   AGENT_GATEWAY_SMOKE_HARNESS_MODEL  VERSIONED model id the harness CLIs pin
#                                      (default claude-haiku-4-5-20251001; must be
#                                      in the proxy model_list — CLIs send dated ids)
#   AGENT_GATEWAY_SMOKE_GROK_MODEL     model id for the grok CLI (default grok-4-fast)
#   AGENT_GATEWAY_SMOKE_GEMINI_MODEL   model id for the gemini CLI (default gemini-3.5-flash)

set -euo pipefail

GATEWAY_BASE_URL="${AGENT_GATEWAY_LITELLM_BASE_URL:-http://127.0.0.1:14000}"
GATEWAY_BASE_URL="${GATEWAY_BASE_URL%/}"
GATEWAY_MASTER_KEY="${AGENT_GATEWAY_LITELLM_MASTER_KEY:-}"
SMOKE_MODEL="${AGENT_GATEWAY_SMOKE_MODEL:-claude-haiku-4-5}"
SMOKE_HARNESS_MODEL="${AGENT_GATEWAY_SMOKE_HARNESS_MODEL:-claude-haiku-4-5-20251001}"
SMOKE_GROK_MODEL="${AGENT_GATEWAY_SMOKE_GROK_MODEL:-grok-4-fast}"
SMOKE_GEMINI_MODEL="${AGENT_GATEWAY_SMOKE_GEMINI_MODEL:-gemini-3.5-flash}"
SMOKE_PROMPT="Reply with exactly: GATEWAY_OK"
SMOKE_MARKER="GATEWAY_OK"

# Exit code runners use to signal SKIP; run.sh treats it as non-fatal, any
# other non-zero exit as FAIL.
SKIP_EXIT_CODE=77

log() {
  printf '[smoke] %s\n' "$*"
}

fail() {
  printf '[smoke] FAIL: %s\n' "$*" >&2
  exit 1
}

skip() {
  printf '[smoke] SKIP: %s\n' "$*"
  exit "$SKIP_EXIT_CODE"
}

# new_tmp_root LABEL -> prints a fresh private temp dir for a harness run
new_tmp_root() {
  mktemp -d "${TMPDIR:-/tmp}/agent-gateway-smoke-$1.XXXXXX"
}

# marker_present OUTPUT_FILE
# True when the smoke marker appears on a line that is NOT an echo of the
# prompt itself (codex exec, for example, prints the user instructions back
# into its transcript, which would otherwise false-positive the check).
marker_present() {
  local out="$1"
  [ -f "$out" ] || return 1
  grep -- "$SMOKE_MARKER" "$out" 2>/dev/null | grep -qv 'Reply with exactly'
}

# kill_harness_tree PID
# TERM (then KILL) the whole process group rooted at PID, falling back to the
# single process when no group exists. Reaps the direct child.
kill_harness_tree() {
  local pid="$1"
  kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
  sleep 1
  kill -KILL -- "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
}

# run_harness SECS OUTPUT_FILE CMD [ARGS...]
# Runs CMD with stdout+stderr captured to OUTPUT_FILE and polls once a second:
#   - marker in output -> kill the process group, return 0 (some CLIs — e.g.
#     opencode — leave a server running after the one-shot answer, so we cannot
#     wait for a natural exit)
#   - CMD exits        -> return its exit code (after sweeping the group)
#   - SECS elapse      -> kill the process group, return 124
# perl setpgrp gives CMD its own process group so lingering children die with
# it. Implemented in shell because stock macOS has no coreutils `timeout`.
run_harness() {
  local secs="$1" out="$2"
  shift 2
  : >"$out"
  if command -v perl >/dev/null 2>&1; then
    perl -e 'setpgrp(0, 0); exec @ARGV or die "exec failed: $!"' -- "$@" \
      >"$out" 2>&1 &
  else
    "$@" >"$out" 2>&1 &
  fi
  local pid=$!
  local waited=0 status=0
  while :; do
    if marker_present "$out"; then
      # 2>/dev/null also swallows bash's async "Terminated" job notice.
      kill_harness_tree "$pid" 2>/dev/null
      return 0
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
      wait "$pid" || status=$?
      # Sweep group members the CLI may have left behind.
      kill -TERM -- "-$pid" 2>/dev/null || true
      return "$status"
    fi
    if [ "$waited" -ge "$secs" ]; then
      kill_harness_tree "$pid" 2>/dev/null
      return 124
    fi
    sleep 1
    waited=$((waited + 1))
  done
}

# assert_gateway_ok HARNESS STATUS OUTPUT_FILE
# PASS when OUTPUT_FILE contains the smoke marker; otherwise dump a tail of
# the harness output and FAIL (calling out timeouts when STATUS is 124).
assert_gateway_ok() {
  local harness="$1" status="$2" out="$3"
  if marker_present "$out"; then
    log "PASS: $harness reached the gateway ($SMOKE_MARKER)"
    return 0
  fi
  if [ -f "$out" ]; then
    log "$harness output (tail):" >&2
    tail -n 20 "$out" | sed 's/^/[smoke]   | /' >&2 || true
  fi
  if [ "$status" -eq 124 ]; then
    fail "$harness: timed out before $SMOKE_MARKER appeared in the output"
  fi
  fail "$harness: $SMOKE_MARKER not found in the output (harness exit $status)"
}

require_master_key() {
  if [ -z "$GATEWAY_MASTER_KEY" ]; then
    fail "AGENT_GATEWAY_LITELLM_MASTER_KEY is required."
  fi
}

require_tools() {
  command -v curl >/dev/null 2>&1 || fail "curl is required."
  command -v python3 >/dev/null 2>&1 || fail "python3 is required."
}

# admin_request METHOD PATH [JSON_BODY]
# Prints the response body; returns non-zero on HTTP >= 400.
admin_request() {
  local method="$1" path="$2" body="${3:-}"
  local args=(-sS -X "$method" "$GATEWAY_BASE_URL$path" \
    -H "Authorization: Bearer $GATEWAY_MASTER_KEY" \
    -H "Content-Type: application/json" \
    -w '\n%{http_code}')
  if [ -n "$body" ]; then
    args+=(-d "$body")
  fi
  local response status payload
  response="$(curl "${args[@]}")"
  status="${response##*$'\n'}"
  payload="${response%$'\n'*}"
  printf '%s' "$payload"
  [ "$status" -lt 400 ]
}

# json_field JSON FIELD
json_field() {
  python3 -c 'import json,sys; print(json.loads(sys.argv[1]).get(sys.argv[2], ""))' "$1" "$2"
}

check_proxy_health() {
  log "proxy-health: GET $GATEWAY_BASE_URL/health/liveliness"
  curl -fsS "$GATEWAY_BASE_URL/health/liveliness" >/dev/null \
    || fail "proxy health check failed at $GATEWAY_BASE_URL/health/liveliness"
  log "proxy-health OK"
}

# mint_smoke_key ALIAS -> sets SMOKE_KEY and SMOKE_TOKEN_ID
mint_smoke_key() {
  local alias="$1"
  log "mint-key: alias=$alias"
  local payload
  payload="$(admin_request POST /key/generate \
    "{\"key_alias\":\"$alias\",\"max_budget\":1,\"metadata\":{\"purpose\":\"agent-gateway-smoke\"}}")" \
    || fail "key/generate failed: $payload"
  SMOKE_KEY="$(json_field "$payload" key)"
  SMOKE_TOKEN_ID="$(json_field "$payload" token_id)"
  [ -n "$SMOKE_KEY" ] || fail "key/generate returned no key: $payload"
  log "mint-key OK (token_id=$SMOKE_TOKEN_ID)"
}

# delete_smoke_key TOKEN_ID
delete_smoke_key() {
  local token_id="$1"
  [ -n "$token_id" ] || return 0
  admin_request POST /key/delete "{\"keys\":[\"$token_id\"]}" >/dev/null \
    || log "warning: cleanup of smoke key $token_id failed"
}

# check_models_list VIRTUAL_KEY
check_models_list() {
  local virtual_key="$1"
  log "models-list: GET /v1/models with the virtual key"
  local payload
  payload="$(curl -fsS "$GATEWAY_BASE_URL/v1/models" \
    -H "Authorization: Bearer $virtual_key")" \
    || fail "GET /v1/models with virtual key failed"
  echo "$payload" | python3 -c '
import json, sys

payload = json.load(sys.stdin)
models = [item["id"] for item in payload.get("data", [])]
if not models:
    raise SystemExit("no models visible to the virtual key")
print("[smoke] models visible:", ", ".join(sorted(models)))
' || fail "models-list check failed"
  echo "$payload" | python3 -c "
import json, sys
models = [item['id'] for item in json.load(sys.stdin).get('data', [])]
raise SystemExit(0 if '$SMOKE_MODEL' in models else 'smoke model $SMOKE_MODEL not in model list')
" || fail "smoke model $SMOKE_MODEL is not served by the proxy"
  log "models-list OK"
}

# check_chat_completion VIRTUAL_KEY
check_chat_completion() {
  local virtual_key="$1"
  log "chat-completion: POST /v1/chat/completions model=$SMOKE_MODEL"
  local payload
  payload="$(curl -fsS "$GATEWAY_BASE_URL/v1/chat/completions" \
    -H "Authorization: Bearer $virtual_key" \
    -H "Content-Type: application/json" \
    -d "{\"model\":\"$SMOKE_MODEL\",\"max_tokens\":32,\"messages\":[{\"role\":\"user\",\"content\":\"Reply with the single word: pong\"}]}")" \
    || fail "chat completion request failed"
  echo "$payload" | python3 -c '
import json, sys

payload = json.load(sys.stdin)
content = payload["choices"][0]["message"]["content"]
if not content or not content.strip():
    raise SystemExit("chat completion returned empty content")
print("[smoke] completion content:", content.strip()[:120])
' || fail "chat completion returned no content"
  log "chat-completion OK"
}

# check_spend_log_visible TOKEN_ID
# Spend log writes are async in LiteLLM; poll for up to ~30s.
check_spend_log_visible() {
  local token_id="$1"
  local start_date end_date
  start_date="$(python3 -c 'import datetime; print((datetime.date.today()-datetime.timedelta(days=1)).isoformat())')"
  end_date="$(python3 -c 'import datetime; print((datetime.date.today()+datetime.timedelta(days=1)).isoformat())')"
  log "spend-log: polling /spend/logs for token $token_id"
  local attempt payload
  for attempt in $(seq 1 15); do
    payload="$(admin_request GET "/spend/logs?summarize=false&start_date=$start_date&end_date=$end_date")" \
      || fail "GET /spend/logs failed: $payload"
    if echo "$payload" | python3 -c "
import json, sys
rows = json.load(sys.stdin)
match = [r for r in rows if r.get('api_key') == '$token_id']
if not match:
    raise SystemExit(1)
row = match[0]
print('[smoke] spend row:', json.dumps({k: row.get(k) for k in ('request_id', 'model', 'spend', 'total_tokens')}))
"; then
      log "spend-log OK"
      return 0
    fi
    sleep 2
  done
  fail "no spend log row appeared for token $token_id"
}
