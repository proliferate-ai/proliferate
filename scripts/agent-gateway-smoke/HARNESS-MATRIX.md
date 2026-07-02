# Harness ↔ LiteLLM Compatibility Matrix (live-verified, LiteLLM main-stable)

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

## opencode — WORKS
Recipe (opencode.json in workdir; XDG_CONFIG_HOME/XDG_DATA_HOME isolated):
  {"provider":{"proliferate":{"npm":"@ai-sdk/openai-compatible","options":{"baseURL":"http://<proxy>/v1","apiKey":"{env:PROLIFERATE_GATEWAY_KEY}"},"models":{"claude-haiku-4-5-20251001":{}}}}}
  opencode run -m proliferate/claude-haiku-4-5-20251001 "..."
- Endpoint: POST /v1/chat/completions 200. Explicit models map REQUIRED (confirms spec).
- CLI process lingers after completion (server keeps running) — headless runners need a timeout/kill; the completion itself returned in ~2s.
- Title-gen uses the same model (small=true agent=title observed) — no extra alias needed.

## grok — WORKS
Recipe:
  HOME=<isolated> GROK_MODELS_BASE_URL=http://<proxy>/v1 XAI_API_KEY=<vk> grok -p "..." -m grok-4-fast
- Endpoints: GET /v1/models (dynamic discovery — confirms spec), then POST /v1/chat/completions 200.
- grok-named aliases mapped to anthropic upstream work fine (CLI doesn't care about upstream provider).
- grok-build alias was pre-added; no separate grok-build call observed in this single-turn run — likely interactive/title-gen only; keep the alias in gateway config anyway (cheap).

## gemini — PARTIAL (works via facade; alias-to-anthropic broken; needs real Google upstream)
- LiteLLM genai facade route: POST /v1beta/models/<model>:generateContent with x-goog-api-key: <vk> — WORKS (200, correct genai response shape). NOTE: /gemini/v1beta/... 500s; use the ROOT /v1beta path.
- gemini CLI recipe that reaches the proxy: HOME=<isolated> + ~/.gemini/settings.json {"security":{"auth":{"selectedType":"gemini-api-key"}}} + GEMINI_CLI_TRUST_WORKSPACE=true + GOOGLE_GEMINI_BASE_URL=http://<proxy> + GEMINI_API_KEY=<vk>. CLI calls streamGenerateContent on gemini-3.5-flash (its default; -m respected).
- FAILS only because our test aliases gemini→anthropic upstream: the genai→anthropic translation sends temperature+top_p together (Anthropic rejects; litellm drop_params does not fix this path). With a REAL Google upstream key (prod managed pool) this translation never happens → expected to work. Action: managed config must include real gemini upstream models; do not alias gemini to other providers.

## Attribution & metadata
- Spend logs: per-request rows with api_key = mint-time token_id; key_alias in metadata.user_api_key_alias; team_id present when key is team-scoped. Per-key attribution confirmed for claude/codex/opencode/grok runs.
- Sandboxes/adapters can rely on key-granularity attribution; request-level tags via body metadata worked in earlier probing (metadata.tags accepted on /v1/chat/completions).

## Spec §4 corrections (vs agent-auth-litellm.md)
1. Codex: REMOVE the "OpenAI-family only" risk — LiteLLM /v1/responses bridges to anthropic correctly now (tool calls included). wire_api="responses" is the right setting; adapter must add --skip-git-repo-check for exec mode. `codex login --with-api-key` is NOT needed when env_key is set in provider config.
2. Claude: the adapter MUST sanitize ambient provider env (CLAUDE_CODE_USE_BEDROCK, AWS_BEARER_TOKEN_BEDROCK, CLAUDE_CODE_USE_VERTEX, ANTHROPIC_API_KEY) — ambient Bedrock env silently reroutes and produces misleading errors. Proxy config needs VERSIONED model ids (CLI sends claude-haiku-4-5-20251001 style), plus consider ANTHROPIC_SMALL_FAST_MODEL for the sidecar small-model calls.
3. Gemini: gateway route works via ROOT /v1beta genai facade (not /gemini prefix); gemini CLI needs selectedType=gemini-api-key settings + GEMINI_CLI_TRUST_WORKSPACE=true; managed pool must carry a real Google upstream (cross-provider aliasing breaks on temperature/top_p).
