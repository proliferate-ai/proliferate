# Agent Gateway Smoke Harness

End-to-end checks against a LiteLLM agent-gateway deployment: proxy health,
virtual-key mint, per-key model list, one chat completion, and spend-log
visibility, followed by per-harness CLI runs (claude, codex, opencode, grok,
gemini) that each drive the real CLI through the gateway.

## Usage

```sh
# Against the local docker-compose gateway
# (docker compose -f server/docker-compose.yml up -d litellm, or make dev AGENT_GATEWAY=litellm)
AGENT_GATEWAY_LITELLM_MASTER_KEY=sk-proliferate-local-dev \
  ./scripts/agent-gateway-smoke/run.sh

# Against staging
AGENT_GATEWAY_LITELLM_BASE_URL=https://llm.staging.example \
AGENT_GATEWAY_LITELLM_MASTER_KEY=... \
  ./scripts/agent-gateway-smoke/run.sh
```

## Configuration

| Env var | Default | Meaning |
| --- | --- | --- |
| `AGENT_GATEWAY_LITELLM_BASE_URL` | `http://127.0.0.1:14000` | Proxy base URL |
| `AGENT_GATEWAY_LITELLM_MASTER_KEY` | (required) | Master key for management calls |
| `AGENT_GATEWAY_SMOKE_MODEL` | `claude-haiku-4-5` | Model exercised by the core completion check |
| `AGENT_GATEWAY_SMOKE_HARNESS_MODEL` | `claude-haiku-4-5-20251001` | **Versioned** model id the harness CLIs pin (must be in the proxy `model_list` — CLIs send dated ids) |
| `AGENT_GATEWAY_SMOKE_GROK_MODEL` | `grok-4-fast` | Model id the grok CLI requests (aliased in `server/litellm/config.yaml`) |
| `AGENT_GATEWAY_SMOKE_GEMINI_MODEL` | `gemini-3.5-flash` | Model id the gemini CLI requests |
| `GEMINI_UPSTREAM_AVAILABLE` | unset | Set to `1` when the proxy has a real Google upstream (`GEMINI_API_KEY`); otherwise `gemini.sh` SKIPs |

Every minted smoke key has a $1 budget, is tagged with
`metadata.purpose=agent-gateway-smoke`, and is deleted on exit.

## Checks

`run.sh` runs, in order:

1. `proxy-health` — `GET /health/liveliness`
2. `mint-key` — `POST /key/generate` with a unique alias
3. `models-list` — `GET /v1/models` using the minted virtual key (not the
   master key); asserts the smoke model is served
4. `chat-completion` — one small `POST /v1/chat/completions` on the virtual key
5. `spend-log-visible` — polls `GET /spend/logs?summarize=false` (spend writes
   are async) until a row with `api_key == <minted token_id>` appears

Then each per-harness runner (`claude.sh`, `codex.sh`, `opencode.sh`,
`grok.sh`, `gemini.sh`) runs independently. Results are aggregated into a
`harness results: claude=PASS codex=PASS ...` line; any FAIL makes `run.sh`
exit non-zero, SKIPs do not.

## Per-harness runners

Each runner (also runnable standalone with the same env vars):

1. SKIPs cleanly (exit 77) if its CLI is not installed.
2. Mints its own scoped virtual key (deleted on exit).
3. Builds an **isolated** home/config under a `mktemp -d` dir (removed on
   exit) so ambient user config can never leak in.
4. Runs the CLI one-shot with the prompt `Reply with exactly: GATEWAY_OK`,
   bounded by a timeout that kills the CLI's whole process group (needed for
   opencode, whose server lingers after the answer).
5. Asserts `GATEWAY_OK` appears in the output (ignoring echoes of the prompt
   itself) and prints `PASS`/`FAIL`.

Recipes are the live-verified ones in [HARNESS-MATRIX.md](HARNESS-MATRIX.md).
Per-harness notes:

- **claude** — sets `CLAUDE_CONFIG_DIR`, `ANTHROPIC_BASE_URL`,
  `ANTHROPIC_AUTH_TOKEN`. **Env sanitization is required**: the runner
  `env -u`'s `ANTHROPIC_API_KEY`, `CLAUDE_CODE_USE_BEDROCK`,
  `CLAUDE_CODE_USE_VERTEX`, and `AWS_BEARER_TOKEN_BEDROCK` — ambient provider
  env silently reroutes the CLI to Bedrock/Vertex despite
  `ANTHROPIC_BASE_URL`, producing misleading errors. Uses the versioned model
  id (the CLI sends dated ids) and pins `ANTHROPIC_SMALL_FAST_MODEL` to the
  same gateway model so sidecar small-model calls stay on the proxy.
- **codex** — isolated `CODEX_HOME` with a `config.toml` declaring a custom
  provider (`base_url=<proxy>/v1`, `env_key=PROLIFERATE_GATEWAY_KEY`,
  `wire_api = "responses"`); runs `codex exec --skip-git-repo-check` (exec
  hangs outside a git repo without it). Sanitizes `OPENAI_API_KEY` /
  `ANTHROPIC_API_KEY`. LiteLLM's `/v1/responses` bridge translates to the
  anthropic upstream.
- **opencode** — `opencode.json` in the isolated workdir with the
  `@ai-sdk/openai-compatible` provider and an **explicit models map**
  (required); XDG dirs isolated. The CLI leaves its server running after the
  one-shot answer, so the runner detects the marker and kills the process
  group instead of waiting for exit.
- **grok** — isolated `HOME`, `GROK_MODELS_BASE_URL=<proxy>/v1`,
  `XAI_API_KEY=<vk>`. The CLI discovers models via `GET /v1/models`, so
  `grok-4-fast`/`grok-build` are aliased to Anthropic Haiku in
  `server/litellm/config.yaml` (the CLI doesn't care about the upstream).
- **gemini** — isolated `HOME` with `~/.gemini/settings.json`
  (`security.auth.selectedType=gemini-api-key`),
  `GEMINI_CLI_TRUST_WORKSPACE=true`, `GOOGLE_GEMINI_BASE_URL=<proxy>` (the
  CLI uses the ROOT `/v1beta` genai facade; the `/gemini`-prefixed path
  500s). **SKIPs unless `GEMINI_UPSTREAM_AVAILABLE=1`**: gemini model names
  must map to a real Google upstream — LiteLLM's genai→anthropic translation
  sends `temperature`+`top_p` together, which Anthropic rejects, so
  cross-provider aliasing is broken for this path.
