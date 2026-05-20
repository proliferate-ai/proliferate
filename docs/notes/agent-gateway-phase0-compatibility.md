# Agent Gateway Phase 0 Compatibility Proof

Status: Phase 0A implemented; Phase 0B proof harness implemented; live proof
pending external gateway/provider configuration

Date: 2026-05-17

This note is the execution companion for
`docs/architecture/agent-llm-auth-gateway-spec.md` Phase 0B. It records the
probes that must pass before gateway-backed credentials are exposed in product
UI.

Phase 0B is not considered passed by this note alone. It is passed only by a
`--require-live` run in an environment with the LiteLLM proxy, gateway facade,
and provider credentials configured.

Run:

```bash
python3 scripts/agent-gateway-phase0-probe.py all
```

or:

```bash
pnpm agent-gateway:phase0
```

Use `--require-live` when running the official proof. Without it, missing
external services or provider keys report `SKIP` so local dry-runs remain
useful.

## Probe Matrix

```text
litellm
  Proves team-scoped duplicate public model names can be created through
  LiteLLM control-plane APIs and are visible to the matching team keys.
  With provider keys present, also proves live chat routing through those team
  keys.

claude
  Proves an Anthropic-compatible streaming request against the configured
  gateway/LiteLLM path.

codex
  Proves an OpenAI Responses streaming request against the configured
  gateway/LiteLLM path.

opencode
  Records the OpenCode managed-config isolation gate. V1 remains disabled until
  this is explicitly proven.
```

## Environment

LiteLLM control-plane proof:

```text
LITELLM_PROXY_URL=http://127.0.0.1:4000
LITELLM_MASTER_KEY=...
PHASE0_LITELLM_PUBLIC_MODEL=optional-public-name
PHASE0_LITELLM_BACKING_MODEL=gpt-4o-mini
PHASE0_LITELLM_PROVIDER=openai
OPENAI_API_KEY=...
PHASE0_OPENAI_API_KEY_TEAM_A=optional distinct key
PHASE0_OPENAI_API_KEY_TEAM_B=optional distinct key
```

Claude streaming proof:

```text
PHASE0_ANTHROPIC_BASE_URL=https://gateway.example.com/anthropic
PHASE0_GATEWAY_TOKEN=...
PHASE0_ANTHROPIC_MODEL=...
```

Codex Responses proof:

```text
PHASE0_OPENAI_BASE_URL=https://gateway.example.com/openai/v1
PHASE0_GATEWAY_TOKEN=...
PHASE0_RESPONSES_MODEL=...
```

OpenCode isolation decision:

```text
PHASE0_OPENCODE_MANAGED_CONFIG_PROOF=1
```

Only set `PHASE0_OPENCODE_MANAGED_CONFIG_PROOF=1` after AnyHarness can force a
managed OpenCode provider config that project/workspace config cannot override.

## Current Local Run

The local checkout does not currently have a LiteLLM proxy running on port
4000, nor provider tokens in the environment. The dry-run command verifies the
probe harness and reports missing live inputs as `SKIP`.

The official Phase 0B gate is complete only when:

```text
litellm-team-routing          PASS with live_calls=true
litellm-live-chat-routing     PASS for both teams
claude-anthropic-streaming    PASS
codex-responses-streaming     PASS or Codex managed credits explicitly gated off
opencode-managed-config       PASS or OpenCode gateway explicitly gated off
```

If Codex or OpenCode remains gated off, product feature flags must keep those
gateway-backed paths unavailable.
