#!/usr/bin/env bash
# Launch pdev with the loops/rosters sidecar fork checkouts wired in,
# instead of falling back to the Makefile's default (unset-env) resolution
# order, which picks up the stale ~/codex-acp checkout for Codex and the
# packaged/npm claude-agent-acp for Claude.
#
# Usage: ./goals-dev.sh <profile> [extra pdev/make args...]
# Example: ./goals-dev.sh goals
set -euo pipefail

export ANYHARNESS_CLAUDE_AGENT_PROGRAM="$HOME/code/claude-agent-acp/dist/index.js"
export ANYHARNESS_CODEX_AGENT_PROGRAM="$HOME/code/codex-acp/target/debug/codex-acp"

for bin in "$ANYHARNESS_CLAUDE_AGENT_PROGRAM" "$ANYHARNESS_CODEX_AGENT_PROGRAM"; do
  if [[ ! -x "$bin" ]]; then
    echo "goals-dev.sh: expected sidecar binary missing or not executable: $bin" >&2
    exit 1
  fi
done

echo "Using ANYHARNESS_CLAUDE_AGENT_PROGRAM=$ANYHARNESS_CLAUDE_AGENT_PROGRAM"
echo "Using ANYHARNESS_CODEX_AGENT_PROGRAM=$ANYHARNESS_CODEX_AGENT_PROGRAM"

# pdev is a zsh function from ~/.zshrc — run it in an interactive zsh so it
# resolves regardless of the invoking shell. Exported env vars carry through.
exec zsh -ic 'cd ~/proliferate-wt/goals && pdev "$@"' zsh "$@"
