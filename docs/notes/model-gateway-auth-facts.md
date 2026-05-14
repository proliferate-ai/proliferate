# Model Gateway And Harness Auth Facts

Status: reference note, not an authoritative implementation spec.

Last source inspection: 2026-05-13.

This note captures empirical facts found by static source inspection while
investigating whether managed cloud can route ACP-launched harness model calls
through a centralized Proliferate model gateway.

It intentionally separates facts from product decisions. It does not claim a
live end-to-end smoke test has been run.

## Source Revisions Inspected

Local checkouts inspected:

- `/Users/pablo/claude-agent-acp` at `9ca5f44`
- `/Users/pablo/claude-code` at `d46bd99`
- `/Users/pablo/opencode` at `21f8027ef`
- `/Users/pablo/codex-acp` at `6f82c7a`
- `/Users/pablo/codex` at `a3be74143`
- `/Users/pablo/gemini-cli` at `18cdbbf81`

## Boundary Fact

ACP is not the model gateway protocol.

ACP is the local agent-control protocol between AnyHarness and a harness process.
The model gateway is reached later, when that harness process makes provider API
requests.

Observed shape:

```text
AnyHarness
  -> starts ACP harness process
  -> talks ACP over stdio/NDJSON
  -> harness process calls model provider API
  -> provider API base URL / auth can point at Proliferate model gateway
```

Therefore, gateway enforcement is a launch/config/auth concern for each
harness. It is not a generic ACP feature unless the harness exposes gateway
auth/config through ACP.

## Claude Agent ACP Facts

Claude ACP support lives in `/Users/pablo/claude-agent-acp`, not directly in
`/Users/pablo/claude-code`.

Relevant files:

- [`/Users/pablo/claude-agent-acp/src/acp-agent.ts`](/Users/pablo/claude-agent-acp/src/acp-agent.ts)
- [`/Users/pablo/claude-code/src/utils/managedEnv.ts`](/Users/pablo/claude-code/src/utils/managedEnv.ts)
- [`/Users/pablo/claude-code/src/utils/managedEnvConstants.ts`](/Users/pablo/claude-code/src/utils/managedEnvConstants.ts)
- [`/Users/pablo/claude-code/src/services/api/client.ts`](/Users/pablo/claude-code/src/services/api/client.ts)

### ACP Gateway Auth Facts

`claude-agent-acp` advertises a `gateway` auth method only when the ACP client
advertises gateway support:

- `request.clientCapabilities?.auth?._meta?.gateway === true`
- source: `ClaudeAcpAgent.initialize()` in
  [`acp-agent.ts`](/Users/pablo/claude-agent-acp/src/acp-agent.ts:379)

The advertised auth method has:

- `id: "gateway"`
- `_meta.gateway.protocol: "anthropic"`
- source: [`acp-agent.ts`](/Users/pablo/claude-agent-acp/src/acp-agent.ts:386)

`authenticate()` stores the gateway metadata:

- source: [`acp-agent.ts`](/Users/pablo/claude-agent-acp/src/acp-agent.ts:536)

The gateway metadata shape is:

```ts
{
  gateway: {
    baseUrl: string;
    headers: Record<string, string>;
  }
}
```

Source: [`GatewayAuthMeta`](/Users/pablo/claude-agent-acp/src/acp-agent.ts:231).

### Claude Gateway Env Injection Facts

`createEnvForGateway()` maps gateway metadata into Claude Code env vars:

```text
ANTHROPIC_BASE_URL=<gateway.baseUrl>
ANTHROPIC_CUSTOM_HEADERS=<newline-delimited headers>
ANTHROPIC_AUTH_TOKEN=""
```

Source: [`createEnvForGateway`](/Users/pablo/claude-agent-acp/src/acp-agent.ts:1697).

That gateway env is spread after inherited env and after user-provided options
env in the Claude SDK options:

- `...process.env`
- `...userProvidedOptions?.env`
- `...createEnvForGateway(this.gatewayAuthMeta)`
- source: [`acp-agent.ts`](/Users/pablo/claude-agent-acp/src/acp-agent.ts:1494)

Empirical implication: gateway env wins over inherited env and user-provided
options env for the exact keys it sets.

### Claude Code Provider Routing Facts

Claude Code has a host-managed provider-routing guard.

When `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST` is truthy, settings-sourced env vars
that control provider routing are stripped.

Source:

- [`withoutHostManagedProviderVars`](/Users/pablo/claude-code/src/utils/managedEnv.ts:38)
- provider-managed variable list in
  [`managedEnvConstants.ts`](/Users/pablo/claude-code/src/utils/managedEnvConstants.ts:14)

The stripped provider-managed env vars include:

- `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST`
- `CLAUDE_CODE_USE_BEDROCK`
- `CLAUDE_CODE_USE_VERTEX`
- `CLAUDE_CODE_USE_FOUNDRY`
- `ANTHROPIC_BASE_URL`
- `ANTHROPIC_BEDROCK_BASE_URL`
- `ANTHROPIC_VERTEX_BASE_URL`
- `ANTHROPIC_FOUNDRY_BASE_URL`
- `ANTHROPIC_API_KEY`
- `ANTHROPIC_AUTH_TOKEN`
- `CLAUDE_CODE_OAUTH_TOKEN`
- provider/model default env vars such as `ANTHROPIC_MODEL`

The same strip list does not include `ANTHROPIC_CUSTOM_HEADERS` in the inspected
revision.

Source:

- provider-managed env set:
  [`managedEnvConstants.ts`](/Users/pablo/claude-code/src/utils/managedEnvConstants.ts:14)
- safe env set includes `ANTHROPIC_CUSTOM_HEADERS`:
  [`managedEnvConstants.ts`](/Users/pablo/claude-code/src/utils/managedEnvConstants.ts:108)

Claude Code selects Bedrock, Vertex, and Foundry before normal first-party
Anthropic routing.

Source:

- API provider branches in
  [`client.ts`](/Users/pablo/claude-code/src/services/api/client.ts:153)

Claude Code's normal first-party Anthropic client path constructs an Anthropic
SDK client.

Source:

- [`client.ts`](/Users/pablo/claude-code/src/services/api/client.ts:300)

Claude Code reads custom headers from `ANTHROPIC_CUSTOM_HEADERS`.

Source:

- [`client.ts`](/Users/pablo/claude-code/src/services/api/client.ts:330)

### Claude Required Gateway Shape

Claude Code model calls use Anthropic Messages API through the Anthropic SDK.

Observed call paths include:

- streaming `beta.messages.create({ stream: true })`
- non-streaming `beta.messages.create(...)`

Source:

- [`claude.ts`](/Users/pablo/claude-code/src/services/api/claude.ts:1818)
- [`claude.ts`](/Users/pablo/claude-code/src/services/api/claude.ts:840)

The Anthropic SDK endpoint for beta messages is:

- `POST /v1/messages?beta=true`

Source:

- [`messages.ts`](/Users/pablo/claude-agent-acp/node_modules/@anthropic-ai/sdk/src/resources/beta/messages/messages.ts:134)

Other Anthropic-compatible endpoints may be used by optional paths:

- `GET /v1/models`
- `POST /v1/messages/count_tokens?beta=true`

Sources:

- [`modelCapabilities.ts`](/Users/pablo/claude-code/src/utils/model/modelCapabilities.ts:85)
- [`models.ts`](/Users/pablo/claude-agent-acp/node_modules/@anthropic-ai/sdk/src/resources/models.ts:39)
- [`messages.ts`](/Users/pablo/claude-agent-acp/node_modules/@anthropic-ai/sdk/src/resources/beta/messages/messages.ts:208)

## OpenCode Facts

Relevant files:

- [`/Users/pablo/opencode/packages/opencode/src/cli/cmd/acp.ts`](/Users/pablo/opencode/packages/opencode/src/cli/cmd/acp.ts)
- [`/Users/pablo/opencode/packages/opencode/src/config/provider.ts`](/Users/pablo/opencode/packages/opencode/src/config/provider.ts)
- [`/Users/pablo/opencode/packages/opencode/src/provider/provider.ts`](/Users/pablo/opencode/packages/opencode/src/provider/provider.ts)
- [`/Users/pablo/opencode/packages/opencode/src/acp/agent.ts`](/Users/pablo/opencode/packages/opencode/src/acp/agent.ts)
- [`/Users/pablo/opencode/packages/opencode/src/config/config.ts`](/Users/pablo/opencode/packages/opencode/src/config/config.ts)

### ACP Launch Facts

OpenCode ACP launch command is `opencode acp`.

Source:

- [`AcpCommand`](/Users/pablo/opencode/packages/opencode/src/cli/cmd/acp.ts:12)

The ACP command:

- sets `OPENCODE_CLIENT = "acp"`
- starts an internal local OpenCode server
- creates an SDK client against that local server
- wires ACP over stdio using `AgentSideConnection`

Source:

- [`cmd/acp.ts`](/Users/pablo/opencode/packages/opencode/src/cli/cmd/acp.ts:22)

The ACP command defines a `--cwd` option, but the inspected handler calls
`bootstrap(process.cwd(), ...)`.

Source:

- `--cwd` definition:
  [`cmd/acp.ts`](/Users/pablo/opencode/packages/opencode/src/cli/cmd/acp.ts:16)
- bootstrap call:
  [`cmd/acp.ts`](/Users/pablo/opencode/packages/opencode/src/cli/cmd/acp.ts:24)

### Provider Config Facts

OpenCode provider config supports:

- provider `api`
- provider `name`
- provider `env`
- provider `id`
- provider `npm`
- provider `options.apiKey`
- provider `options.baseURL`
- provider `models`
- arbitrary extra options

Source:

- [`ConfigProvider.Info`](/Users/pablo/opencode/packages/opencode/src/config/provider.ts:71)

Bundled provider factories include:

- `@ai-sdk/openai-compatible`
- `@ai-sdk/openai`
- `@ai-sdk/anthropic`
- `@ai-sdk/google`
- `@ai-sdk/google-vertex`
- `@ai-sdk/gateway`

Source:

- [`BUNDLED_PROVIDERS`](/Users/pablo/opencode/packages/opencode/src/provider/provider.ts:92)

`resolveSDK()` passes provider `baseURL`, `apiKey`, and merged headers into the
AI SDK provider factory.

Source:

- [`resolveSDK`](/Users/pablo/opencode/packages/opencode/src/provider/provider.ts:1414)

For `@ai-sdk/openai-compatible`, OpenCode sets `includeUsage = true` unless
disabled.

Source:

- [`provider.ts`](/Users/pablo/opencode/packages/opencode/src/provider/provider.ts:1426)

OpenCode supports `enabled_providers` and `disabled_providers`.

Source:

- config schema:
  [`config.ts`](/Users/pablo/opencode/packages/opencode/src/config/config.ts:139)
- provider filtering:
  [`provider.ts`](/Users/pablo/opencode/packages/opencode/src/provider/provider.ts:1132)

### OpenCode ACP Model Selection Facts

OpenCode ACP default model selection reads configured model state and validates
against available providers.

Source:

- [`defaultModel`](/Users/pablo/opencode/packages/opencode/src/acp/agent.ts:1594)

ACP exposes session model configuration and accepts model changes.

Source:

- [`setSessionConfigOption`](/Users/pablo/opencode/packages/opencode/src/acp/agent.ts:1286)

Prompt handling sends the selected `{ providerID, modelID }` to the OpenCode SDK
session prompt path.

Source:

- [`agent.ts`](/Users/pablo/opencode/packages/opencode/src/acp/agent.ts:1470)

### OpenCode Required Gateway Shape

When using `@ai-sdk/openai-compatible`, the gateway must support an
OpenAI-compatible chat-completions style interface.

When using `@ai-sdk/openai`, OpenCode can use OpenAI Responses API paths for
models/provider paths that select responses.

Observed code facts:

- bundled `@ai-sdk/openai-compatible` provider exists
- bundled `@ai-sdk/openai` provider exists
- OpenCode has provider-specific `getModel()` logic for responses-capable
  providers

Source:

- [`BUNDLED_PROVIDERS`](/Users/pablo/opencode/packages/opencode/src/provider/provider.ts:92)
- OpenAI custom loader:
  [`provider.ts`](/Users/pablo/opencode/packages/opencode/src/provider/provider.ts:175)

## Codex ACP Facts

Relevant files:

- [`/Users/pablo/codex-acp/src/lib.rs`](/Users/pablo/codex-acp/src/lib.rs)
- [`/Users/pablo/codex-acp/src/codex_agent.rs`](/Users/pablo/codex-acp/src/codex_agent.rs)
- [`/Users/pablo/codex/codex-rs/model-provider-info/src/lib.rs`](/Users/pablo/codex/codex-rs/model-provider-info/src/lib.rs)
- [`/Users/pablo/codex/codex-rs/config/src/config_toml.rs`](/Users/pablo/codex/codex-rs/config/src/config_toml.rs)
- [`/Users/pablo/codex/codex-rs/login/src/auth/external_bearer.rs`](/Users/pablo/codex/codex-rs/login/src/auth/external_bearer.rs)

### ACP Launch And Config Facts

`codex-acp` parses CLI `-c key=value` overrides and passes them into Codex
config loading.

Source:

- [`main.rs`](/Users/pablo/codex-acp/src/main.rs:6)
- [`run_main`](/Users/pablo/codex-acp/src/lib.rs:39)

`codex-acp` uses `Config::load_with_cli_overrides_and_harness_overrides(...)`.

Source:

- [`lib.rs`](/Users/pablo/codex-acp/src/lib.rs:52)

Codex ACP sessions clone the loaded base config and mutate session-specific
fields such as cwd and MCP servers.

Source:

- [`build_session_config`](/Users/pablo/codex-acp/src/codex_agent.rs:135)

### Codex Auth Gate Facts

`codex-acp` only requires stored/login auth when
`self.config.model_provider_id == "openai"`.

Source:

- [`check_auth`](/Users/pablo/codex-acp/src/codex_agent.rs:126)

Empirical implication: a custom provider id such as `proliferate` or `gateway`
does not hit that exact `openai` auth requirement in the inspected revision.

### Codex Provider Config Facts

Codex custom provider config supports:

- `name`
- `base_url`
- `env_key`
- `experimental_bearer_token`
- `auth`
- `wire_api`
- `query_params`
- `http_headers`
- `env_http_headers`
- retry/timeout fields
- `requires_openai_auth`
- `supports_websockets`

Source:

- [`ModelProviderInfo`](/Users/pablo/codex/codex-rs/model-provider-info/src/lib.rs:72)

Codex currently accepts only `wire_api = "responses"`; `wire_api = "chat"` is
rejected in the inspected revision.

Source:

- [`WireApi`](/Users/pablo/codex/codex-rs/model-provider-info/src/lib.rs:40)

`base_url` is copied into the effective API provider.

Source:

- [`to_api_provider`](/Users/pablo/codex/codex-rs/model-provider-info/src/lib.rs:190)

`env_key` reads an API key from the named environment variable.

Source:

- [`api_key`](/Users/pablo/codex/codex-rs/model-provider-info/src/lib.rs:214)

Codex supports command-backed bearer token auth for custom providers.

Source:

- [`BearerTokenRefresher`](/Users/pablo/codex/codex-rs/login/src/auth/external_bearer.rs:17)
- [`run_provider_auth_command`](/Users/pablo/codex/codex-rs/login/src/auth/external_bearer.rs:101)

`auth.command` cannot be combined with `env_key`, `experimental_bearer_token`,
or `requires_openai_auth`.

Source:

- [`ModelProviderInfo::validate`](/Users/pablo/codex/codex-rs/model-provider-info/src/lib.rs:126)

Built-in provider IDs are reserved and cannot be overridden through
`model_providers`.

Source:

- `validate_reserved_model_provider_ids` in
  [`config_toml.rs`](/Users/pablo/codex/codex-rs/config/src/config_toml.rs:735)

### Codex Required Gateway Shape

Codex requires an OpenAI Responses-compatible gateway.

Minimum observed requirement:

- base URL convention is usually `https://gateway.example/v1`
- Codex calls `POST <base_url>/responses`
- streaming expects OpenAI Responses-style SSE events

Observed supported SSE event names include:

- `response.created`
- `response.output_text.delta`
- `response.output_item.done`
- `response.completed`

Sources:

- request endpoint:
  [`responses.rs`](/Users/pablo/codex/codex-rs/codex-api/src/endpoint/responses.rs:115)
- SSE response handling:
  [`responses.rs`](/Users/pablo/codex/codex-rs/codex-api/src/sse/responses.rs:236)

## Gemini CLI ACP Facts

Relevant files:

- [`/Users/pablo/gemini-cli/packages/cli/src/config/config.ts`](/Users/pablo/gemini-cli/packages/cli/src/config/config.ts)
- [`/Users/pablo/gemini-cli/packages/cli/src/gemini.tsx`](/Users/pablo/gemini-cli/packages/cli/src/gemini.tsx)
- [`/Users/pablo/gemini-cli/packages/cli/src/acp/acpClient.ts`](/Users/pablo/gemini-cli/packages/cli/src/acp/acpClient.ts)
- [`/Users/pablo/gemini-cli/packages/core/src/core/contentGenerator.ts`](/Users/pablo/gemini-cli/packages/core/src/core/contentGenerator.ts)

### ACP Launch Facts

Gemini CLI has an `--acp` flag.

Source:

- [`config.ts`](/Users/pablo/gemini-cli/packages/cli/src/config/config.ts:340)

When `config.getAcpMode()` is true, Gemini dispatches to `runAcpClient(...)`.

Source:

- [`gemini.tsx`](/Users/pablo/gemini-cli/packages/cli/src/gemini.tsx:560)

### ACP Gateway Auth Facts

Gemini ACP advertises an auth method:

- `id: AuthType.GATEWAY`
- name: `AI API Gateway`
- `_meta.gateway.protocol: "google"`
- `_meta.gateway.restartRequired: "false"`

Source:

- [`acpClient.ts`](/Users/pablo/gemini-cli/packages/cli/src/acp/acpClient.ts:163)

Gemini ACP `authenticate()` accepts gateway metadata:

```json
{
  "methodId": "gateway",
  "_meta": {
    "gateway": {
      "baseUrl": "https://gateway.example.com",
      "headers": {
        "Authorization": "Bearer token"
      }
    }
  }
}
```

Source:

- schema parse in
  [`acpClient.ts`](/Users/pablo/gemini-cli/packages/cli/src/acp/acpClient.ts:222)
- test coverage in
  [`acpClient.test.ts`](/Users/pablo/gemini-cli/packages/cli/src/acp/acpClient.test.ts:291)

`authenticate()` stores `baseUrl` and custom headers on the agent and passes
them to `config.refreshAuth(...)`.

Source:

- [`acpClient.ts`](/Users/pablo/gemini-cli/packages/cli/src/acp/acpClient.ts:244)

### Gemini Gateway Propagation Facts

`AuthType.GATEWAY` exists in core config.

Source:

- [`contentGenerator.ts`](/Users/pablo/gemini-cli/packages/core/src/core/contentGenerator.ts:59)

For `AuthType.GATEWAY`, Gemini sets:

- `apiKey = apiKey || "gateway-placeholder-key"`
- `vertexai = false`

Source:

- [`createContentGeneratorConfig`](/Users/pablo/gemini-cli/packages/core/src/core/contentGenerator.ts:155)

`createContentGenerator()` includes `AuthType.GATEWAY` in the GoogleGenAI path.

Source:

- [`contentGenerator.ts`](/Users/pablo/gemini-cli/packages/core/src/core/contentGenerator.ts:259)

Custom headers are merged into GoogleGenAI `httpOptions.headers`.

Source:

- [`contentGenerator.ts`](/Users/pablo/gemini-cli/packages/core/src/core/contentGenerator.ts:264)

If `config.baseUrl` is present, it is set as `httpOptions.baseUrl`.

Source:

- [`contentGenerator.ts`](/Users/pablo/gemini-cli/packages/core/src/core/contentGenerator.ts:276)

GoogleGenAI is constructed with:

```ts
new GoogleGenAI({
  apiKey,
  vertexai,
  httpOptions,
  ...
})
```

Source:

- [`contentGenerator.ts`](/Users/pablo/gemini-cli/packages/core/src/core/contentGenerator.ts:285)

### Gemini Required Gateway Shape

Because `AuthType.GATEWAY` sets `vertexai = false`, the gateway must emulate the
Gemini Developer API shape, not Vertex AI.

Observed request paths from the installed `@google/genai` package include:

- `POST /v1beta/models/{model}:generateContent`
- `POST /v1beta/models/{model}:streamGenerateContent?alt=sse`
- `POST /v1beta/models/{model}:countTokens`
- `POST /v1beta/models/{model}:batchEmbedContents` if embeddings are used

Sources:

- `/Users/pablo/gemini-cli/node_modules/@google/genai/dist/node/index.mjs`
  around request path construction for generate, streaming, count tokens, and
  embeddings.

Gemini gateway headers must tolerate the SDK's placeholder API-key behavior.
The inspected code uses `gateway-placeholder-key` when no API key is supplied.

Source:

- [`contentGenerator.ts`](/Users/pablo/gemini-cli/packages/core/src/core/contentGenerator.ts:155)

## Cross-Harness Facts

### Gateway API Shapes Are Not One Protocol

The inspected harnesses require different gateway protocol surfaces:

```text
Claude Agent ACP:
  Anthropic-compatible Messages API.

OpenCode:
  OpenAI-compatible chat/completions or Responses, depending provider config.

Codex ACP:
  OpenAI Responses API.

Gemini CLI ACP:
  Google GenAI / Gemini Developer API.
```

Therefore, a centralized gateway can be one product service, but it must expose
multiple protocol facades.

### LiteLLM Fact

LiteLLM is a candidate implementation detail for provider routing and protocol
translation. This note has not verified live compatibility of LiteLLM with each
harness's exact streaming/tool-call shape.

Source inspected externally:

- `https://github.com/BerriAI/litellm`
- `https://docs.litellm.ai/`

### Enforcement Depends On Launch Control

Static source inspection supports this empirical statement:

Managed cloud can route model calls through a gateway when it controls:

- the ACP process binary and arguments
- the process working directory
- the process environment
- the harness config directory or config content
- the ACP `authenticate` call when the harness exposes gateway auth
- allowed provider/model config

The same inspection found harness-specific override risks if user/project config
is allowed to participate without isolation.

Observed override risk examples:

- Claude: inherited env and settings can affect provider selection unless
  provider-managed env is stripped; `ANTHROPIC_CUSTOM_HEADERS` was not in the
  provider-managed strip list in the inspected revision.
- OpenCode: `OPENCODE_CONFIG` alone is not enough for final enforcement because
  project config can be loaded later; `OPENCODE_CONFIG_CONTENT`, managed config,
  and `--pure` are stronger.
- Codex: provider id/model provider must be forced through config overrides or
  managed config; model ids should still be validated at the gateway.
- Gemini: gateway base URL and headers are process-memory ACP auth state, so a
  fresh ACP process must receive gateway auth metadata again.

## Things Not Proven By This Note

This note does not prove:

- live end-to-end operation through a fake gateway
- LiteLLM compatibility with Claude Code's exact Anthropic beta streaming
  fields
- LiteLLM compatibility with Codex's exact Responses API SSE shape
- LiteLLM compatibility with Gemini's Google GenAI API shape
- that existing AnyHarness launch adapters already perform all required
  isolation/hardening
- that every optional model-listing, count-token, embedding, or compact endpoint
  is implemented in the eventual gateway

Those require smoke tests or implementation-level verification.
