#!/usr/bin/env bash
# Run the full catalog probe matrix. Skips contexts whose credentials are
# missing (with a warning) so partial runs are possible. Credentials come
# from .probe-secrets.env at the repo root when present; the probe scrubs
# them from spawned agents' environments, injecting only per-context.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BIN="$ROOT/target/debug/anyharness"
SECRETS="$ROOT/.probe-secrets.env"

[ -f "$SECRETS" ] && source "$SECRETS"

echo "── building anyharness"
(cd "$ROOT/anyharness" && cargo build -q -p anyharness) || exit 1

echo "── reconciling harness installs"
"$BIN" install-agents 2>/dev/null | grep -E "^agent=" || true

failures=0
skipped=0

probe() { # probe <agent> <context> [extra args...]
  local agent="$1" context="$2"; shift 2
  echo "── probe $agent × $context"
  if RUST_LOG=warn "$BIN" catalog-probe --agent "$agent" --auth-context "$context" "$@"; then :; else
    echo "✗ $agent × $context FAILED"
    failures=$((failures + 1))
  fi
}

skip() { echo "── skip $1 × $2 ($3)"; skipped=$((skipped + 1)); }

need_env() { [ -n "${!1:-}" ]; }

CLAUDE_TRIALS=(--trial-model claude-fable-5 --trial-model claude-opus-4-8)

if need_env ANTHROPIC_API_KEY; then
  probe claude anthropic-api "${CLAUDE_TRIALS[@]}"
else skip claude anthropic-api "ANTHROPIC_API_KEY not set"; fi

if need_env CLAUDE_CODE_OAUTH_TOKEN; then
  probe claude anthropic-oauth "${CLAUDE_TRIALS[@]}"
else skip claude anthropic-oauth "CLAUDE_CODE_OAUTH_TOKEN not set (run \`claude setup-token\`)"; fi

if need_env OPENAI_API_KEY; then
  probe codex openai-api
else skip codex openai-api "OPENAI_API_KEY not set"; fi

if [ -f "${PROBE_CODEX_OAUTH_AUTH_JSON:-$HOME/.codex/auth.json}" ]; then
  probe codex openai-oauth
else skip codex openai-oauth "no codex auth.json (run \`codex login\`)"; fi

probe opencode baseline --model-switch-timeout-secs 6
if need_env ANTHROPIC_API_KEY; then
  probe opencode anthropic-api --model-switch-timeout-secs 6
else skip opencode anthropic-api "ANTHROPIC_API_KEY not set"; fi
if need_env OPENAI_API_KEY; then
  probe opencode openai-api --model-switch-timeout-secs 6
else skip opencode openai-api "OPENAI_API_KEY not set"; fi
if need_env GEMINI_API_KEY; then
  probe opencode gemini-api --model-switch-timeout-secs 6
else skip opencode gemini-api "GEMINI_API_KEY not set"; fi

if need_env GEMINI_API_KEY; then
  probe gemini gemini-api --model-switch-timeout-secs 3
else skip gemini gemini-api "GEMINI_API_KEY not set"; fi
if [ -f "${PROBE_GEMINI_OAUTH_CREDS:-$HOME/.gemini/oauth_creds.json}" ]; then
  probe gemini google-oauth --model-switch-timeout-secs 3
else skip gemini google-oauth "no gemini oauth creds (run \`gemini\` and log in)"; fi

# cursor: machine login (keychain); probe fails cleanly if not logged in
probe cursor cursor-login --model-switch-timeout-secs 5

echo "── done: ${failures} failed, ${skipped} skipped"
exit "$failures"
