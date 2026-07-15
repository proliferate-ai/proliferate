# Harness ↔ LiteLLM Compatibility Matrix (live-verified, LiteLLM main-stable)

## Re-verification — 2026-07-03 (P4, agent-auth cleanup, REAL upstreams)

Re-ran `scripts/agent-gateway-smoke/run.sh` (proxy-health, mint-key,
models-list, chat-completion, spend-log, then all four per-harness runners)
against a fresh local `litellm` + `litellm-db` (main-stable image, remapped
to host port 14001 — 14000 was held by an unrelated stale `litellm-probe`
container) with **real** Anthropic/OpenAI/xAI provider keys (not mocks, not
the invalid dev key the prior pass hit). Added one manual tool-call check
each for claude and codex (opencode/grok tool-calling was not part of the
original claims, so left as plain-completion only, matching prior scope).

| Harness  | Plain completion | Tool call | Verdict |
| --- | --- | --- | --- |
| claude   | PASS — `POST /v1/messages?beta=true`, real anthropic upstream | PASS — Bash tool round-trip via `--dangerously-skip-permissions`, model replied "Done! The bash tool is working correctly." | **WORKS** |
| codex    | PASS — `/v1/responses` bridge, real anthropic upstream via `claude-haiku-4-5-20251001` | PASS — shell `exec` tool via `--dangerously-bypass-approvals-and-sandbox`, command executed (`echo GATEWAY_TOOL_OK`) and model reported the result; ~27k tokens | **WORKS** (cross-provider path only, see known limitation below) |
| opencode | PASS — `POST /v1/chat/completions`, marker recovered from session storage (stdout still drops on this opencode build) | not re-tested this pass | **WORKS** |
| grok     | PASS — `GET /v1/models` discovery + `POST /v1/chat/completions`, real xAI upstream (`xai/grok-4-1-fast`) | not re-tested this pass | **WORKS** |
| gemini   | N/A | N/A | **REMOVED from scope** — gemini is no longer an agent kind in `catalogs/agents/catalog.json`, has no entries in `server/litellm/config.yaml`, and has no smoke runner. The section below is kept for historical record only; do not treat it as current. |

**Known limitation (external, not a bug):** `gpt-5-mini` / `gpt-5.2` return
404 through the real OpenAI upstream:
`litellm.NotFoundError: ... "Your organization must be verified to use the
model \`gpt-5-mini\`. Please go to:
https://platform.openai.com/settings/organization/general..."`. This
**supersedes** the prior note below ("blocked by an invalid OPENAI_API_KEY
in the dev .env") — the key used this pass is valid (confirmed via the
proxy's own env), the account itself needs OpenAI org verification. Codex
is fully verified end-to-end via its supported cross-provider path
(`claude-haiku-4-5-20251001`); the native gpt-5-family path stays
blocked-external until org verification completes.

**P3 catalog cross-check** (runtime probe path once, per plan): `GET
/v1/models` with a minted virtual key returned `claude-haiku-4-5,
claude-haiku-4-5-20251001, claude-opus-4-6, claude-opus-4-6-20260205,
claude-sonnet-4-5, claude-sonnet-4-5-20250929, gpt-5-mini,
gpt-5-mini-2025-08-07, gpt-5.2, gpt-5.2-2025-12-11, grok-4, grok-4-fast,
grok-build, grok-code-fast-1`. Compared against each agent's
`session.gatewayPolicy` in `catalogs/agents/catalog.json`:
- **opencode**: `gatewayPolicy.seedModels` = `[claude-sonnet-4-5,
  claude-sonnet-4-5-20250929, claude-haiku-4-5,
  claude-haiku-4-5-20251001]` — all 4 present in the live list. **Match.**
- **claude**: `gatewayPolicy` = `{providers:[anthropic], roles.small_fast:
  claude-haiku-4-5-20251001}` — model present. **Match.**
- **codex**: `gatewayPolicy` = `{providers:[openai]}` — provider
  represented in `model_list`. **Match.**
- **grok**: `gatewayPolicy` = `{}` (deliberately empty). **Finding, not a
  mismatch:** grok is the one harness whose gatewayPolicy carries no
  `seedModels`/model ids to diff against the live list, because the CLI
  resolves models purely via dynamic `GET /v1/models` discovery — there is
  nothing in the catalog to compare beyond "the endpoint responds with a
  non-empty list," which it does. Worth a follow-up decision (not a bug)
  on whether grok's gatewayPolicy should ever carry an explicit seed list
  for parity with opencode/claude.

**Spend:** ~$0.12 total across every check this pass (core smoke +
4-harness plain completions + 2 tool-call checks + the intentional $0
gpt-5-mini 404 probe) — well under the $5 cap. Dominant cost is Claude
Haiku (plain + tool-call runs, ~500–34k tokens each depending on whether a
tool round-trip was involved); one grok-4-fast completion (~$0.002); the
gpt-5-mini probe cost $0 (rejected before generation).

## claude (Claude Code CLI) — WORKS
Recipe:
  env -u ANTHROPIC_API_KEY -u CLAUDE_CODE_USE_BEDROCK \
    CLAUDE_CONFIG_DIR=<isolated> \
    ANTHROPIC_BASE_URL=http://<proxy> \
    ANTHROPIC_AUTH_TOKEN=<virtual-key> \
    claude -p "..." --model claude-haiku-4-5-20251001
- Endpoints observed: POST /v1/messages?beta=true (repeated), count_tokens variants. Streaming + tool calls (Bash) verified end-to-end via proxy.
- CRITICAL: adapter must UNSET/override CLAUDE_CODE_USE_BEDROCK, AWS_BEARER_TOKEN_BEDROCK, CLAUDE_CODE_USE_VERTEX and ANTHROPIC_API_KEY — ambient provider env silently reroutes the CLI (observed: requests went to bedrock-runtime.us-east-1 despite ANTHROPIC_BASE_URL, and the "400 invalid model" came from Bedrock, not the proxy).
- Versioned model ids (claude-haiku-4-5-20251001) required in proxy model_list; CLI sends versioned ids. Alias entries additionally useful for humans.
- One transient 400 on first /v1/messages?beta=true observed (likely small-fast model id claude-3-5-haiku-* not in config) — add ANTHROPIC_SMALL_FAST_MODEL=<gateway model> or include the small-model id in config; verify in PR6.
- **RESOLVED (2026-07-03 re-verification):** `claude.sh` now pins `ANTHROPIC_SMALL_FAST_MODEL=$SMOKE_HARNESS_MODEL`; zero 400s observed across plain-completion and Bash-tool-call runs against the real anthropic upstream this pass.

## codex (Codex CLI) — WORKS (incl. anthropic upstream!)
Recipe:
  CODEX_HOME=<isolated> with config.toml:
    model_provider = "proliferate"
    model = "<default model>"
    [model_providers.proliferate]
    name = "Proliferate Gateway"
    base_url = "http://<proxy>/v1"
    env_key = "PROLIFERATE_GATEWAY_KEY"
    wire_api = "responses"
  env: PROLIFERATE_GATEWAY_KEY=<vk>; sanitize OPENAI_API_KEY/ANTHROPIC_API_KEY.
  codex exec -m claude-haiku-4-5-20251001 --skip-git-repo-check "..."
- LiteLLM main-stable SERVES /v1/responses and translates it to anthropic upstream: plain completion AND a shell tool call both succeeded (verified "codex_tool_ok" run → DONE; endpoints: POST /v1/responses 200s).
- The spec's feared "Unsupported tool type: namespace"/client_metadata errors did NOT reproduce on current LiteLLM — the /v1/responses bridge appears to have matured. Codex-on-gateway is NOT OpenAI-only.
- codex exec without --skip-git-repo-check hangs outside a git repo — adapters must pass it or run in a repo.
- gpt-5-mini upstream test blocked by an invalid OPENAI_API_KEY in the dev .env (upstream 401) — openai-family path unverified here, but it's the native wire format (low risk).
- **UPDATED (2026-07-03 re-verification):** with a valid OPENAI_API_KEY, gpt-5-mini/gpt-5.2 now fail with a *different*, external error — `404 ... organization must be verified` — not a key problem. The cross-provider path (claude-haiku-4-5-20251001, tested here for both plain completion and a shell tool call) remains the verified, supported route; native gpt-5-family stays blocked-external pending OpenAI org verification (out of scope to fix).

## opencode — WORKS
Recipe (opencode.json in workdir; XDG_CONFIG_HOME isolated, XDG_DATA_HOME ambient for native auth coexistence):
  {"provider":{"proliferate":{"npm":"@ai-sdk/openai-compatible","options":{"baseURL":"http://<proxy>/v1","apiKey":"{env:PROLIFERATE_GATEWAY_KEY}"},"models":{"claude-haiku-4-5-20251001":{}}}}}
  opencode run -m proliferate/claude-haiku-4-5-20251001 "..."
- Endpoint: POST /v1/chat/completions 200. Explicit models map REQUIRED (confirms spec).
- CLI process lingers after completion (server keeps running) — headless runners need a timeout/kill; the completion itself returned in ~2s.
- Title-gen uses the same model (small=true agent=title observed) — no extra alias needed.
- **RE-VERIFIED (2026-07-03):** plain completion against real anthropic upstream still PASSes; marker recovered from the isolated session-storage sqlite db (stdout still drops on the currently-installed opencode build, as noted above — not new). `gatewayPolicy.seedModels` cross-checked live against `GET /v1/models`: all 4 seed model ids present (see the re-verification summary at the top of this file).

## grok — WORKS
Recipe:
  HOME=<isolated> GROK_MODELS_BASE_URL=http://<proxy>/v1 XAI_API_KEY=<vk> grok -p "..." -m grok-4-fast
- Endpoints: GET /v1/models (dynamic discovery — confirms spec), then POST /v1/chat/completions 200.
- grok-named aliases mapped to anthropic upstream work fine (CLI doesn't care about upstream provider).
- grok-build alias was pre-added; no separate grok-build call observed in this single-turn run — likely interactive/title-gen only; keep the alias in gateway config anyway (cheap).
- **RE-VERIFIED (2026-07-03):** real xAI upstream (`xai/grok-4-1-fast`), `GET /v1/models` discovery + `POST /v1/chat/completions` both PASS; spend row confirms real xAI billing (~$0.002, 10,320 tokens). `session.gatewayPolicy` for grok in `catalogs/agents/catalog.json` is `{}` (no seedModels) — see the P3 catalog cross-check finding at the top of this file: not a mismatch, just the one harness with nothing declared to diff.

## gemini — PARTIAL (works via facade; alias-to-anthropic broken; needs real Google upstream) — REMOVED, HISTORICAL RECORD ONLY (see 2026-07-03 note above)
- LiteLLM genai facade route: POST /v1beta/models/<model>:generateContent with x-goog-api-key: <vk> — WORKS (200, correct genai response shape). NOTE: /gemini/v1beta/... 500s; use the ROOT /v1beta path.
- gemini CLI recipe that reaches the proxy: HOME=<isolated> + ~/.gemini/settings.json {"security":{"auth":{"selectedType":"gemini-api-key"}}} + GEMINI_CLI_TRUST_WORKSPACE=true + GOOGLE_GEMINI_BASE_URL=http://<proxy> + GEMINI_API_KEY=<vk>. CLI calls streamGenerateContent on gemini-3.5-flash (its default; -m respected).
- FAILS only because our test aliases gemini→anthropic upstream: the genai→anthropic translation sends temperature+top_p together (Anthropic rejects; litellm drop_params does not fix this path). With a REAL Google upstream key (prod managed pool) this translation never happens → expected to work. Action: managed config must include real gemini upstream models; do not alias gemini to other providers.
- **2026-07-03: gemini was removed from the agent-auth cleanup's scope entirely** (P1 of this branch) — no `gemini` agent kind in `catalogs/agents/catalog.json`, no gemini entries in `server/litellm/config.yaml`, no `gemini.sh` smoke runner. Nothing above was re-run or re-verified; kept verbatim as the historical record of what was true pre-removal. Spec §4 item 3 below is likewise moot post-removal.

## Attribution & metadata
- Spend logs: per-request rows with api_key = mint-time token_id; key_alias in metadata.user_api_key_alias; team_id present when key is team-scoped. Per-key attribution confirmed for claude/codex/opencode/grok runs.
- Sandboxes/adapters can rely on key-granularity attribution; request-level tags via body metadata worked in earlier probing (metadata.tags accepted on /v1/chat/completions).
- **RE-VERIFIED (2026-07-03):** spend rows for this pass's real-upstream runs again carry `api_key` = mint-time token_id (spot-checked via `GET /spend/logs`; e.g. the grok run's row showed `model=xai/grok-4-1-fast` billed to its own minted key). No regressions.

## Spec §4 corrections (vs agent-auth-litellm.md)
1. Codex: REMOVE the "OpenAI-family only" risk — LiteLLM /v1/responses bridges to anthropic correctly now (tool calls included). wire_api="responses" is the right setting; adapter must add --skip-git-repo-check for exec mode. `codex login --with-api-key` is NOT needed when env_key is set in provider config.
2. Claude: the adapter MUST sanitize ambient provider env (CLAUDE_CODE_USE_BEDROCK, AWS_BEARER_TOKEN_BEDROCK, CLAUDE_CODE_USE_VERTEX, ANTHROPIC_API_KEY) — ambient Bedrock env silently reroutes and produces misleading errors. Proxy config needs VERSIONED model ids (CLI sends claude-haiku-4-5-20251001 style), plus consider ANTHROPIC_SMALL_FAST_MODEL for the sidecar small-model calls.
3. Gemini: gateway route works via ROOT /v1beta genai facade (not /gemini prefix); gemini CLI needs selectedType=gemini-api-key settings + GEMINI_CLI_TRUST_WORKSPACE=true; managed pool must carry a real Google upstream (cross-provider aliasing breaks on temperature/top_p). **MOOT as of 2026-07-03 — gemini removed from scope entirely (see above).**
4. **(new, 2026-07-03)** gpt-5-family (gpt-5-mini, gpt-5.2) is blocked-external on the real OpenAI upstream: `404 ... organization must be verified`, independent of the gateway/adapter — this is an OpenAI account-verification requirement, not something to fix in this codebase. Codex's verified, supported route is the cross-provider path (claude-haiku-4-5-20251001).
5. **(new, 2026-07-03)** grok's `session.gatewayPolicy` in `catalogs/agents/catalog.json` is the only one of the four live agent kinds with no `seedModels`/model ids declared (`{}`), by design (dynamic `GET /v1/models` discovery). Not a bug; flagged as a parity question for a future pass, not a correctness gap — the live endpoint does serve a non-empty, correct model list.
