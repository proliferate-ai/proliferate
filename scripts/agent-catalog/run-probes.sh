#!/usr/bin/env bash
# Resolve exact pins, install those pins, then run the catalog probe matrix.
#
# Authoritative runs are fail-closed: every required auth context for every
# selected agent must be available and every launched probe must succeed.
# Cursor is opt-in because its ACP process requires a machine-local login. Use
# --allow-partial only for diagnostics; partial state is recorded and cannot be
# promoted by `make catalog-update`.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BIN="$ROOT/target/debug/anyharness"
SECRETS="$ROOT/.probe-secrets.env"
GENERATED="$ROOT/scripts/agent-catalog/generated"
LOGS="$GENERATED/.probe-logs"
STATE="$LOGS/run.state"
CANDIDATE="$LOGS/resolved-candidate.json"
TIMEOUT_RUNNER="$ROOT/scripts/agent-catalog/run-with-timeout.py"
CATALOG="$ROOT/catalogs/agents/catalog.json"
REGISTRY="$ROOT/catalogs/agents/registry.json"

allow_partial="${ALLOW_PARTIAL:-0}"
include_cursor="${CATALOG_PROBE_CURSOR:-0}"
known_agents=(claude codex opencode grok cursor)
default_agents=(claude codex opencode grok)
cli_agents=()
selected_agents=()

is_known_agent() {
  case "$1" in
    claude|codex|opencode|grok|cursor) return 0 ;;
    *) return 1 ;;
  esac
}

add_agent() { # add_agent <array-name> <agent>
  local array_name="$1" candidate="$2" existing
  local current=()
  is_known_agent "$candidate" || {
    echo "unknown catalog probe agent '$candidate' (expected: ${known_agents[*]})" >&2
    exit 2
  }
  case "$array_name" in
    cli_agents) current=("${cli_agents[@]-}") ;;
    selected_agents) current=("${selected_agents[@]-}") ;;
    *) echo "internal error: unknown agent selection '$array_name'" >&2; exit 2 ;;
  esac
  for existing in "${current[@]}"; do
    [ "$existing" = "$candidate" ] && return
  done
  case "$array_name" in
    cli_agents) cli_agents+=("$candidate") ;;
    selected_agents) selected_agents+=("$candidate") ;;
  esac
}

add_agent_list() { # add_agent_list <array-name> <comma-or-space-separated-list>
  local array_name="$1" raw="$2" agent
  local parsed=()
  raw="${raw//,/ }"
  [ -n "${raw//[[:space:]]/}" ] || {
    echo "catalog probe agent selection cannot be empty" >&2
    exit 2
  }
  read -r -a parsed <<< "$raw"
  for agent in "${parsed[@]}"; do
    add_agent "$array_name" "$agent"
  done
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --allow-partial)
      allow_partial=1
      shift
      ;;
    --include-cursor)
      include_cursor=1
      shift
      ;;
    --agent)
      [ "$#" -ge 2 ] || { echo "--agent requires a value" >&2; exit 2; }
      add_agent_list cli_agents "$2"
      shift 2
      ;;
    --agent=*)
      add_agent_list cli_agents "${1#--agent=}"
      shift
      ;;
    *)
      echo "unexpected argument: $1" >&2
      exit 2
      ;;
  esac
done

if [ -n "${cli_agents[*]-}" ]; then
  selected_agents=("${cli_agents[@]}")
elif [ -n "${CATALOG_PROBE_AGENTS:-}" ]; then
  add_agent_list selected_agents "$CATALOG_PROBE_AGENTS"
else
  selected_agents=("${default_agents[@]}")
fi

agent_selected() {
  local candidate="$1" selected
  for selected in "${selected_agents[@]}"; do
    [ "$selected" = "$candidate" ] && return 0
  done
  return 1
}

if agent_selected cursor && [ "$include_cursor" != "1" ]; then
  echo "cursor probing is opt-in; select it together with --include-cursor" >&2
  exit 2
fi
if [ "$include_cursor" = "1" ] && ! agent_selected cursor; then
  add_agent selected_agents cursor
fi

[ -f "$SECRETS" ] && source "$SECRETS"

mkdir -p "$LOGS"
rm -f "$LOGS"/*.log "$LOGS"/*.timeout "$STATE" "$CANDIDATE"
started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf 'startedAt=%s\n' "$started_at" > "$STATE"

contexts_for_agent() {
  case "$1" in
    claude) echo "claude.anthropic-api claude.anthropic-oauth claude.bedrock" ;;
    codex) echo "codex.openai-api codex.openai-oauth codex.bedrock" ;;
    opencode) echo "opencode.baseline opencode.anthropic-api opencode.openai-api opencode.gemini-api opencode.opencode-zen" ;;
    grok) echo "grok.xai-api" ;;
    cursor) echo "cursor.cursor-login" ;;
  esac
}

required_contexts=()
for agent in "${selected_agents[@]}"; do
  for id in $(contexts_for_agent "$agent"); do
    required_contexts+=("$id")
  done
done
for agent in "${known_agents[@]}"; do
  if ! agent_selected "$agent"; then
    for id in $(contexts_for_agent "$agent"); do
      printf 'retained=%s\n' "$id" >> "$STATE"
    done
    echo "── retain $agent at its existing catalog pin"
  fi
done
for id in "${required_contexts[@]}"; do
  printf 'required=%s\n' "$id" >> "$STATE"
done

need_env() { [ -n "${!1:-}" ]; }
codex_oauth_path() {
  printf '%s' "${PROBE_CODEX_OAUTH_AUTH_JSON:-$HOME/.codex/auth.json}"
}
context_available() {
  case "$1" in
    claude.anthropic-api|opencode.anthropic-api) need_env ANTHROPIC_API_KEY ;;
    claude.anthropic-oauth) need_env CLAUDE_CODE_OAUTH_TOKEN ;;
    claude.bedrock|codex.bedrock) need_env AWS_BEARER_TOKEN_BEDROCK ;;
    codex.openai-api|opencode.openai-api) need_env OPENAI_API_KEY ;;
    codex.openai-oauth) [ -f "$(codex_oauth_path)" ] ;;
    opencode.baseline) return 0 ;;
    opencode.gemini-api) need_env GEMINI_API_KEY ;;
    opencode.opencode-zen) need_env OPENCODE_API_KEY ;;
    grok.xai-api) need_env XAI_API_KEY ;;
    cursor.cursor-login) return 0 ;;
    *) return 1 ;;
  esac
}
context_requirement() {
  case "$1" in
    claude.anthropic-api|opencode.anthropic-api) echo "ANTHROPIC_API_KEY" ;;
    claude.anthropic-oauth) echo "CLAUDE_CODE_OAUTH_TOKEN" ;;
    claude.bedrock|codex.bedrock) echo "AWS_BEARER_TOKEN_BEDROCK" ;;
    codex.openai-api|opencode.openai-api) echo "OPENAI_API_KEY" ;;
    codex.openai-oauth) echo "PROBE_CODEX_OAUTH_AUTH_JSON (a readable codex auth.json)" ;;
    opencode.gemini-api) echo "GEMINI_API_KEY" ;;
    opencode.opencode-zen) echo "OPENCODE_API_KEY" ;;
    grok.xai-api) echo "XAI_API_KEY" ;;
    cursor.cursor-login) echo "a working machine-local cursor-agent login" ;;
    *) echo "no credential" ;;
  esac
}

missing=()
for id in "${required_contexts[@]}"; do
  if ! context_available "$id"; then
    missing+=("$id")
    printf 'missing=%s\n' "$id" >> "$STATE"
  fi
done

if [ "${#missing[@]}" -gt 0 ] && [ "$allow_partial" -ne 1 ]; then
  echo "catalog probe preflight failed; required contexts are unavailable:" >&2
  for id in "${missing[@]}"; do
    echo "  - $id: $(context_requirement "$id")" >&2
  done
  printf 'complete=false\n' >> "$STATE"
  echo "Use --allow-partial for diagnostics only; partial runs are not promotable." >&2
  exit 2
fi

active_agents=()
add_active_agent() {
  local candidate="$1" existing
  # Bash 3.2 treats an empty array expansion as unbound under `set -u`.
  # macOS still ships that Bash version, so guard the first insertion.
  for existing in "${active_agents[@]-}"; do
    [ "$existing" = "$candidate" ] && return
  done
  active_agents+=("$candidate")
}
for id in "${required_contexts[@]}"; do
  if context_available "$id"; then
    add_active_agent "${id%%.*}"
  fi
done
if [ "${#active_agents[@]}" -eq 0 ]; then
  printf 'complete=false\n' >> "$STATE"
  echo "no probe contexts are available" >&2
  exit 2
fi
for agent in "${active_agents[@]}"; do
  printf 'agent=%s\n' "$agent" >> "$STATE"
done
agent_csv="$(IFS=,; echo "${active_agents[*]}")"

catalog_backup="$(mktemp)" || exit 1
cp "$CATALOG" "$catalog_backup" || exit 1
restore_catalog() {
  cp "$catalog_backup" "$CATALOG"
  rm -f "$catalog_backup"
}
trap restore_catalog EXIT

echo "── resolving exact pins before installation ($agent_csv)"
node "$ROOT/scripts/agent-catalog/resolve-pins.mjs" \
  --catalog "$CATALOG" \
  --registry "$REGISTRY" \
  --reuse-from "$CATALOG" \
  --agent "$agent_csv" || exit 1
cp "$CATALOG" "$CANDIDATE" || exit 1

echo "── building anyharness against the resolved lockfile"
(cd "$ROOT/anyharness" && cargo build -q -p anyharness) || exit 1

echo "── reconciling resolved harness installs"
install_args=()
for agent in "${active_agents[@]}"; do
  install_args+=(--agent "$agent")
done
"$BIN" install-agents "${install_args[@]}" || exit 1

pids=()
labels=()
logs=()
ids=()

probe() { # probe <agent> <context> [extra args...]
  local agent="$1" context="$2" timeout log snapshot; shift 2
  log="$LOGS/$agent.$context.log"
  snapshot="$GENERATED/$agent.$context.probe.json"
  timeout="${CATALOG_PROBE_TIMEOUT_SECS:-300}"
  [ "$agent" = "cursor" ] && timeout="${CATALOG_CURSOR_PROBE_TIMEOUT_SECS:-60}"
  rm -f "$snapshot" "$log.timeout"
  echo "── probe $agent × $context (timeout ${timeout}s)"
  RUST_LOG=warn python3 "$TIMEOUT_RUNNER" "$timeout" \
    "$BIN" catalog-probe --agent "$agent" --auth-context "$context" \
    --out "$GENERATED" "$@" > "$log" 2>&1 &
  pids+=("$!")
  labels+=("$agent × $context")
  logs+=("$log")
  ids+=("$agent.$context")
}

skip() {
  echo "── skip $1 ($2)"
  printf 'skipped=%s\n' "$1" >> "$STATE"
}

CLAUDE_TRIALS=(--trial-model claude-fable-5 --trial-model claude-opus-4-8)
BEDROCK_TRIALS=(--trial-model global.anthropic.claude-fable-5 --trial-model us.anthropic.claude-opus-4-8)

if agent_selected claude; then
  if context_available claude.anthropic-api; then
    probe claude anthropic-api "${CLAUDE_TRIALS[@]}"
  else
    skip claude.anthropic-api "$(context_requirement claude.anthropic-api)"
  fi
  if context_available claude.anthropic-oauth; then
    probe claude anthropic-oauth "${CLAUDE_TRIALS[@]}"
  else
    skip claude.anthropic-oauth "$(context_requirement claude.anthropic-oauth)"
  fi
  if context_available claude.bedrock; then
    probe claude bedrock "${BEDROCK_TRIALS[@]}"
  else
    skip claude.bedrock "$(context_requirement claude.bedrock)"
  fi
fi
if agent_selected codex; then
  if context_available codex.openai-api; then
    probe codex openai-api
  else
    skip codex.openai-api "$(context_requirement codex.openai-api)"
  fi
  if context_available codex.openai-oauth; then
    probe codex openai-oauth
  else
    skip codex.openai-oauth "$(context_requirement codex.openai-oauth)"
  fi
  if context_available codex.bedrock; then
    probe codex bedrock
  else
    skip codex.bedrock "$(context_requirement codex.bedrock)"
  fi
fi
if agent_selected opencode; then
  probe opencode baseline --model-switch-timeout-secs 6
  if context_available opencode.anthropic-api; then
    probe opencode anthropic-api --model-switch-timeout-secs 6
  else
    skip opencode.anthropic-api "$(context_requirement opencode.anthropic-api)"
  fi
  if context_available opencode.openai-api; then
    probe opencode openai-api --model-switch-timeout-secs 6
  else
    skip opencode.openai-api "$(context_requirement opencode.openai-api)"
  fi
  if context_available opencode.gemini-api; then
    probe opencode gemini-api --model-switch-timeout-secs 6
  else
    skip opencode.gemini-api "$(context_requirement opencode.gemini-api)"
  fi
  if context_available opencode.opencode-zen; then
    probe opencode opencode-zen --model-switch-timeout-secs 6
  else
    skip opencode.opencode-zen "$(context_requirement opencode.opencode-zen)"
  fi
fi
if agent_selected grok; then
  if context_available grok.xai-api; then
    probe grok xai-api --model-switch-timeout-secs 3
  else
    skip grok.xai-api "$(context_requirement grok.xai-api)"
  fi
fi
if agent_selected cursor; then
  probe cursor cursor-login --model-switch-timeout-secs 5
fi

echo "── waiting on ${#pids[@]} probes"
failures=0
for i in "${!pids[@]}"; do
  if wait "${pids[$i]}"; then
    echo "✓ ${labels[$i]}"
    printf 'passed=%s\n' "${ids[$i]}" >> "$STATE"
  else
    code=$?
    if [ "$code" -eq 124 ]; then
      echo "✗ ${labels[$i]} TIMED OUT"
    else
      echo "✗ ${labels[$i]} FAILED — $(tail -1 "${logs[$i]}" 2>/dev/null | cut -c1-160)"
    fi
    echo "  log: ${logs[$i]}"
    printf 'failed=%s\n' "${ids[$i]}" >> "$STATE"
    failures=$((failures + 1))
  fi
done

if [ "$failures" -eq 0 ] && [ "${#missing[@]}" -eq 0 ]; then
  printf 'complete=true\n' >> "$STATE"
  echo "── complete authoritative probe run"
  exit 0
fi

printf 'complete=false\n' >> "$STATE"
echo "── diagnostic run only: ${failures} failed, ${#missing[@]} unavailable"
[ "$failures" -eq 0 ] && exit 0
exit "$failures"
