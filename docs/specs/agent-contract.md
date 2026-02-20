# Agent Contract — System Spec

## 1. Scope & Purpose

### In Scope
- System prompt modes: setup, coding, automation — what each injects and how they differ
- OpenCode tool schemas: `save_snapshot`, `save_service_commands`, `automation.complete`, `request_env_variables`
- Capability injection: how tools and instructions are registered in the sandbox OpenCode config
- Tool input/output contracts and validation rules
- Agent/model configuration and selection

### Out of Scope
- How gateway-mediated tools are executed at runtime by the gateway hub — see `sessions-gateway.md`
- How tool files are written into the sandbox filesystem (provider boot) — see `sandbox-providers.md`
- Action tools / external-service operations (`proliferate actions`) — see `actions.md`
- Automation run lifecycle that calls `automation.complete` — see `automations-runs.md` §6
- LLM proxy key generation and model routing — see `llm-proxy.md`

### Mental Model

The agent contract defines **what the agent can do and how it should behave** inside a sandbox. It is the interface between the Proliferate platform and the OpenCode coding agent, expressed through three artifacts:

1. **System prompts** — mode-specific instructions that shape agent behavior
2. **Tool definitions** — TypeScript modules written into the sandbox that give the agent platform capabilities
3. **OpenCode configuration** — JSON config that sets the model, provider, plugin, and permissions

The gateway selects a system prompt based on session type and client type, then both providers (Modal and E2B) write identical tool files and config into the sandbox. OpenCode discovers tools by scanning `.opencode/tool/` at startup.

**Core entities:**
- **System prompt** — a mode-specific instruction string injected as the agent's system message. Three modes: setup, coding, automation.
- **Tool definition** — a TypeScript module + companion `.txt` description file placed in `{repoDir}/.opencode/tool/`. Defines the tool's schema and an `execute()` implementation that either (a) performs a synchronous gateway callback for gateway-mediated tools, or (b) runs locally for sandbox-local tools (`request_env_variables`).
- **OpenCode config** — JSON written to `{repoDir}/opencode.json` and `/home/user/.config/opencode/opencode.json`. Sets model, provider, plugin, permissions, and MCP servers.
- **Agent config** — model ID and optional tools array stored per-session in the database.

**Key invariants:**
- Mode-scoped tool injection: setup-only tools (`save_service_commands`) are injected only for setup sessions. Shared tools (`save_snapshot`, `request_env_variables`, `automation.complete`) are injected for all sessions. The system prompt controls which tools the agent is encouraged to use.
- Three of four tools are gateway-mediated (executed server-side via synchronous HTTP callbacks). Only `request_env_variables` runs in the sandbox.
- Tool definitions are string templates exported from `packages/shared/src/opencode-tools/index.ts`. They are the single source of truth for tool schemas.
- The system prompt can be overridden per-session via `session.system_prompt` in the database.

---

## 2. Core Concepts

### System Prompt Modes — `Implemented`
Three prompt builders produce mode-specific system messages. The gateway selects one based on `session_type` and `client_type`. All prompts identify the agent as running inside **Proliferate** and document the `proliferate` CLI capabilities (services, actions, local workflow via `npx @proliferate/cli`). The setup prompt additionally includes a UI handoff line telling the agent to direct users to the "Done — Save Snapshot" button when setup is complete.
- Key detail agents get wrong: automation mode extends coding mode (it appends to it), not replaces it.
- Reference: `packages/shared/src/prompts.ts`

### Gateway-Mediated Tools (Synchronous Callbacks) — `Implemented`
Most platform tools are executed **server-side** by the gateway via synchronous sandbox-to-gateway HTTP callbacks. Tool execution does not use SSE interception or PATCH-based result delivery.

1. OpenCode invokes a tool.
2. For gateway-mediated tools (`save_snapshot`, `save_service_commands`, `automation.complete`), the tool `execute()` issues a blocking `POST /proliferate/:sessionId/tools/:toolName` to the gateway using the shared `callGatewayTool()` helper.
3. The gateway authenticates the request using the sandbox HMAC token (`Authorization: Bearer <token>`, `source: "sandbox"`).
4. The gateway enforces idempotency by `tool_call_id` using in-memory inflight/completed caches (with a 5-minute retention window for completed results).
5. The gateway executes the tool handler and returns the result in the HTTP response body.

Sandbox-side retry requirement:
- The `callGatewayTool()` helper retries network-level failures (`ECONNRESET`, `ECONNREFUSED`, `fetch failed`, timeout) with exponential backoff (500ms base, up to 5 retries) using the same `tool_call_id`.
- This is required for snapshot boundaries: `save_snapshot` may freeze the sandbox and drop the active TCP socket mid-request (see Snapshot TCP-Drop Retry Trap below).

- Key detail agents get wrong: `request_env_variables` is NOT gateway-mediated — it runs in the sandbox. The gateway detects it via SSE events to show the UI prompt.
- Reference: `apps/gateway/src/api/proliferate/http/tools.ts`, `apps/gateway/src/hub/capabilities/tools/`, `packages/shared/src/opencode-tools/index.ts`

### Snapshot TCP-Drop Retry Trap — `Implemented`
`save_snapshot` can freeze the sandbox at the provider layer, which tears down active TCP sockets. When the sandbox resumes, an in-flight callback request from the sandbox tool wrapper may surface as `fetch failed`, `ECONNRESET`, or `ETIMEDOUT`.

Sandbox-side requirement:
- Generate `tool_call_id` once per logical tool execution.
- Retry network-level callback failures with the **same** `tool_call_id`.
- Keep retrying until success or a non-retriable application error.

Gateway-side requirement:
- Use in-memory inflight dedup (`tool_call_id` -> `Promise`) and completed-result cache to ensure retries do not duplicate side effects.

This pair guarantees that snapshot-boundary drops are recoverable without double execution.

Reference wrapper loop (from `TOOL_CALLBACK_HELPER` in `packages/shared/src/opencode-tools/index.ts`):

```ts
async function callGatewayTool(toolName, toolCallId, args) {
	const url = GATEWAY_URL + "/proliferate/" + SESSION_ID + "/tools/" + toolName;
	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		try {
			const res = await fetch(url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer " + AUTH_TOKEN,
				},
				body: JSON.stringify({ tool_call_id: toolCallId, args }),
				signal: AbortSignal.timeout(120000),
			});
			if (!res.ok) {
				return { success: false, result: "Gateway error " + res.status };
			}
			return await res.json();
		} catch (err) {
			const isRetryable = err?.cause?.code === "ECONNRESET"
				|| err?.message?.includes("fetch failed")
				|| err?.message?.includes("ECONNRESET")
				|| err?.message?.includes("ECONNREFUSED")
				|| err?.name === "AbortError";
			if (isRetryable && attempt < MAX_RETRIES) {
				await new Promise(r => setTimeout(r, RETRY_BASE_MS * Math.pow(2, attempt)));
				continue;
			}
			throw err;
		}
	}
}
```

### OpenCode Tool Discovery — `Implemented`
OpenCode automatically discovers tools by scanning `{repoDir}/.opencode/tool/*.ts` at startup. Tools are not registered in `opencode.json` — they are filesystem-discovered.
- Key detail agents get wrong: the `opencode.json` config does not list tools. Tool registration is purely file-based.
- Reference: `packages/shared/src/sandbox/opencode.ts:getOpencodeConfig`

### Agent/Model Configuration — `Implemented`
A static registry maps agent types to supported models. Currently only the `opencode` agent type exists, with three model options. Model IDs are transformed between internal canonical format, OpenCode format, and Anthropic API format.
- Key detail agents get wrong: OpenCode model IDs use a different format (`anthropic/claude-opus-4-6`) than canonical IDs (`claude-opus-4.6`) or API IDs (`claude-opus-4-6`).
- Reference: `packages/shared/src/agents.ts`

---

## 3. File Tree

```
packages/shared/src/
├── prompts.ts                          # System prompt builders (setup/coding/automation)
├── agents.ts                           # Agent/model registry and ID transforms
├── opencode-tools/
│   └── index.ts                        # All tool definitions (string templates) + descriptions
│                                       #   incl. TOOL_CALLBACK_HELPER (shared HTTP retry logic)
└── sandbox/
    ├── config.ts                       # Plugin template, env instructions, paths, ports
    └── opencode.ts                     # OpenCode config generator, readiness check

apps/gateway/src/
├── api/proliferate/http/
│   └── tools.ts                        # POST /:sessionId/tools/:toolName (sandbox callbacks)
├── lib/
│   ├── session-store.ts                # buildSystemPrompt() — mode selection logic
│   └── opencode.ts                     # OpenCode HTTP helpers (create session, send prompt, etc.)
└── hub/capabilities/tools/
    ├── index.ts                        # Intercepted tools registry
    ├── save-snapshot.ts                # save_snapshot handler (provider snapshot)
    ├── automation-complete.ts          # automation.complete handler (run finalization)
    └── save-service-commands.ts        # save_service_commands handler (configuration update)
```

---

## 4. Data Models & Schemas

### Core TypeScript Types

```typescript
// packages/shared/src/agents.ts
type ModelId = "claude-opus-4.6" | "claude-opus-4.5" | "claude-sonnet-4";
type AgentType = "opencode";

interface AgentConfig {
  agentType: AgentType;
  modelId: ModelId;
}

// apps/gateway/src/hub/capabilities/tools/index.ts
interface InterceptedToolResult {
  success: boolean;
  result: string;
  data?: Record<string, unknown>;
}

interface InterceptedToolHandler {
  name: string;
  execute(hub: SessionHub, args: Record<string, unknown>): Promise<InterceptedToolResult>;
}
```

### Tool Callback Request/Response

```typescript
// POST /proliferate/:sessionId/tools/:toolName
// Auth: sandbox HMAC token (Authorization: Bearer <token>)

// Request body
interface ToolCallbackRequest {
  tool_call_id: string;   // Unique per tool call, used for idempotency
  args: Record<string, unknown>;
}

// Response body (200 OK)
interface ToolCallbackResponse {
  success: boolean;
  result: string;
  data?: Record<string, unknown>;
}
```

### Model ID Transforms

| Context | `claude-opus-4.6` | `claude-opus-4.5` | `claude-sonnet-4` |
|---------|-------------------|--------------------|--------------------|
| Canonical (DB, internal) | `claude-opus-4.6` | `claude-opus-4.5` | `claude-sonnet-4` |
| OpenCode config | `anthropic/claude-opus-4-6` | `anthropic/claude-opus-4-5` | `anthropic/claude-sonnet-4-5` |
| Anthropic API | `claude-opus-4-6` | `claude-opus-4-5-20251101` | `claude-sonnet-4-20250514` |

Source: `packages/shared/src/agents.ts:toOpencodeModelId`, `toAnthropicApiModelId`

### Session Agent Config (DB column)

```typescript
// Stored in sessions.agent_config JSONB column
{
  modelId?: string;   // Canonical model ID
  tools?: string[];   // Optional tool filter (not currently used for filtering)
}
```

Source: `apps/gateway/src/lib/session-store.ts:SessionRecord`

### Session Tool Invocations (DB table)

```typescript
// packages/db/src/schema/schema.ts — session_tool_invocations
{
  id: uuid;                // Primary key
  sessionId: uuid;         // FK → sessions.id (cascade delete)
  organizationId: text;    // FK → organization.id (cascade delete)
  toolName: text;
  toolCallId: text;        // Idempotency key
  status: text;            // e.g. "completed", "failed"
  createdAt: timestamp;
}
// Indexes: session, organization, status
```

Source: `packages/db/src/schema/schema.ts`

---

## 5. Conventions & Patterns

### Do
- Define new tool schemas in `packages/shared/src/opencode-tools/index.ts` as string template exports — this keeps all tool definitions in one place.
- Export both a `.ts` tool definition and a `.txt` description file for each tool — OpenCode uses both.
- Use Zod validation in gateway handlers for tools with complex schemas (e.g., `save_service_commands`). Simpler tools (`save_snapshot`) use inline type coercion.
- Return `InterceptedToolResult` from all handlers — the `success` field drives error reporting.
- Use the shared `callGatewayTool()` helper (from `TOOL_CALLBACK_HELPER`) in tool `execute()` implementations to get automatic retry-on-network-error with `tool_call_id` idempotency.

### Don't
- Register tools in `opencode.json` — OpenCode discovers them by scanning `.opencode/tool/`.
- Add new `console.*` calls in gateway tool handlers — use `@proliferate/logger`.
- Modify system prompts without considering all three modes — automation extends coding, so changes to coding affect automation too.
- Add tool-specific logic to providers — providers write files, the gateway handles execution.

### Error Handling

```typescript
// Standard pattern for gateway tool handlers
// Source: apps/gateway/src/hub/capabilities/tools/save-service-commands.ts
async execute(hub, args): Promise<InterceptedToolResult> {
  const parsed = ArgsSchema.safeParse(args);
  if (!parsed.success) {
    return {
      success: false,
      result: `Invalid arguments: ${parsed.error.issues.map(i => i.message).join(", ")}`,
    };
  }
  try {
    // ... perform operation
    return { success: true, result: "...", data: { ... } };
  } catch (err) {
    return {
      success: false,
      result: `Failed to ...: ${err instanceof Error ? err.message : "Unknown error"}`,
    };
  }
}
```

### Reliability
- **Gateway-mediated tool execution**: Tools are executed via blocking sandbox-to-gateway HTTP callbacks (`POST /proliferate/:sessionId/tools/:toolName`) and return results synchronously. No SSE interception or PATCH-based result delivery.
- **Idempotency**: Tool calls are idempotent by `tool_call_id` via in-memory inflight/completed caches in the gateway tools router. `automation.complete` additionally accepts a `completion_id` idempotency key at the domain level.
- **Retry semantics**: The `callGatewayTool()` helper retries on network-level failures (`ECONNRESET`, `ECONNREFUSED`, `fetch failed`, `AbortError`) with exponential backoff (500ms base, max 5 retries) using the same `tool_call_id`. The gateway returns the cached result for duplicate `tool_call_id`s.
- **Timeouts**: Tool callbacks use a 120-second `AbortSignal.timeout`. OpenCode readiness check uses exponential backoff (200ms base, 1.5x, max 2s per attempt, 30s total). Source: `packages/shared/src/sandbox/opencode.ts:waitForOpenCodeReady`

### Testing Conventions
- Tool handler tests live alongside handlers in gateway tests.
- Test gateway tool handlers by mocking `SessionHub` methods (e.g., `hub.saveSnapshot`) and by exercising the tools route (idempotency by `tool_call_id`).
- Verify Zod validation rejects malformed args for `save_service_commands`.
- System prompt tests: assert each mode includes the expected tool references and omits out-of-scope ones.

---

## 6. Subsystem Deep Dives

### 6.1 System Prompt Mode Selection — `Implemented`

**What it does:** Selects the appropriate system prompt based on session type and client type.

**Happy path:**
1. Gateway loads session context via `loadSessionContext()` (`apps/gateway/src/lib/session-store.ts:85`)
2. If `session.system_prompt` is set (custom override), use it directly (`session-store.ts:223-229`)
3. Otherwise, call `buildSystemPrompt(session_type, repoName, client_type)` (`session-store.ts:71-83`)
4. Selection logic:
   - `session_type === "setup"` -> `getSetupSystemPrompt(repoName)`
   - `client_type === "automation"` -> `getAutomationSystemPrompt(repoName)`
   - Otherwise -> `getCodingSystemPrompt(repoName)`

**Mode differences:**

| Aspect | Setup | Coding | Automation |
|--------|-------|--------|------------|
| Base prompt | Unique | Unique | Extends Coding |
| Goal | Get repo running, save snapshot | Implement changes | Complete task, report outcome |
| `save_snapshot` | Required at end | Available | Available |
| `request_env_variables` | Emphasized | Available | Available |
| `save_service_commands` | Emphasized | Not available | Not available |
| `automation.complete` | Not mentioned | Not mentioned | **Mandatory** |
| Source code edits | Forbidden | Encouraged | Encouraged |
| `proliferate` CLI | Documented | Documented | Documented |
| Actions integration | Documented | Documented | Documented |

**Files touched:** `packages/shared/src/prompts.ts`, `apps/gateway/src/lib/session-store.ts`

### 6.2 Tool Definitions and Schemas

**What it does:** Defines all platform tools as TypeScript string templates that get written into sandbox filesystems.

Each tool is exported as two constants from `packages/shared/src/opencode-tools/index.ts`:
- `*_TOOL` — the `.ts` module source (OpenCode tool API)
- `*_DESCRIPTION` — the `.txt` guidance for agents

All gateway-mediated tools share the `TOOL_CALLBACK_HELPER` — a common `callGatewayTool()` function template that handles the synchronous HTTP callback to the gateway with retry logic for the Snapshot TCP-Drop scenario.

#### `save_snapshot` tool — `Implemented`

**Schema:**
```typescript
{
  message?: string  // Brief summary of what's configured
}
```

**Behavior:** Gateway executes server-side (gateway-mediated via tool callback), triggers provider snapshot. For setup sessions: updates configuration snapshot. For coding sessions: updates session snapshot. Returns `{ snapshotId, target }`.

#### `save_service_commands` tool — `Implemented`

**Schema:**
```typescript
{
  commands: Array<{
    name: string       // 1-100 chars
    command: string    // 1-1000 chars
    cwd?: string       // max 500 chars, relative to workspace root
    workspacePath?: string  // max 500 chars, for multi-repo setups
  }>  // min 1, max 10 items
}
```

**Behavior:** Gateway executes server-side (gateway-mediated via tool callback), validates with Zod, persists to configuration `service_commands` JSONB. Requires `session.configuration_id`. Returns `{ configurationId, commandCount }`.

**Scope:** Setup sessions only. The tool file is only injected into sandboxes when `sessionType === "setup"`. The gateway handler also rejects calls from non-setup sessions at runtime as a defense-in-depth measure.

#### `automation.complete` tool — `Implemented`

**Schema:**
```typescript
{
  run_id: string            // Required
  completion_id: string     // Required (idempotency key)
  outcome: "succeeded" | "failed" | "needs_human"
  summary_markdown?: string
  citations?: string[]
  diff_ref?: string
  test_report_ref?: string
  side_effect_refs?: string[]
}
```

**Behavior:** Gateway executes server-side (gateway-mediated via tool callback), updates run record with outcome + completion JSON, updates trigger event status. Registered under both `automation.complete` and `automation_complete` names. Source: `apps/gateway/src/hub/capabilities/tools/index.ts:41`

#### `request_env_variables` tool — `Implemented`

**Schema:**
```typescript
{
  keys: Array<{
    key: string             // Env var name
    description?: string
    type?: "env" | "secret" // env = file only, secret = file + encrypted DB
    required?: boolean      // Default: true
    suggestions?: Array<{
      label: string
      value?: string        // Preset value
      instructions?: string // Setup instructions
    }>
  }>
}
```

**Behavior:** NOT gateway-mediated. Runs in sandbox, returns immediately with a summary string. The gateway detects this tool call via SSE events and triggers a form in the user's UI. User-submitted values are written to `/tmp/.proliferate_env.json`. The agent then extracts values with `jq` into config files.

**Files touched:** `packages/shared/src/opencode-tools/index.ts`

### 6.3 Capability Injection Pipeline — `Implemented`

**What it does:** Writes tool files, config, plugin, and instructions into the sandbox so OpenCode can discover them.

**Happy path:**
1. Provider (Modal or E2B) calls `setupEssentialDependencies()` during sandbox boot (`packages/shared/src/providers/modal-libmodal.ts:988`, `packages/shared/src/providers/e2b.ts:568`)
2. Plugin written to `/home/user/.config/opencode/plugin/proliferate.mjs` — minimal SSE-mode plugin (`PLUGIN_MJS` from `packages/shared/src/sandbox/config.ts:16-31`)
3. Tool `.ts` files + `.txt` description files written to `{repoDir}/.opencode/tool/` (count varies by mode — see mode-scoped injection rules below)
4. Pre-installed `package.json` + `node_modules/` copied from `/home/user/.opencode-tools/` to `{repoDir}/.opencode/tool/`
5. OpenCode config written to both `{repoDir}/opencode.json` and `/home/user/.config/opencode/opencode.json`
6. Environment instructions appended to `{repoDir}/.opencode/instructions.md` (from `ENV_INSTRUCTIONS` in `config.ts`)
7. Actions bootstrap guide written to `{repoDir}/.proliferate/actions-guide.md` (from `ACTIONS_BOOTSTRAP` in `config.ts`). This guide identifies the agent as running inside Proliferate, documents the `proliferate actions` CLI, and mentions the local CLI (`npx @proliferate/cli`).
8. OpenCode server started: `cd {repoDir} && opencode serve --port 4096 --hostname 0.0.0.0`
9. Gateway waits for readiness via `waitForOpenCodeReady()` with exponential backoff

**Mode-scoped injection rules:**
- `save_service_commands` is injected only when `sessionType === "setup"`.
- When `sessionType !== "setup"`, providers explicitly remove `save_service_commands` files (cleanup from setup snapshots that may include them).
- Shared tools (`save_snapshot`, `request_env_variables`, `automation.complete`) are injected for all sessions.

**Sandbox filesystem layout after injection:**
```
/home/user/.config/opencode/
├── opencode.json                        # Global config
└── plugin/
    └── proliferate.mjs                  # SSE-mode plugin (no event pushing)

{repoDir}/
├── opencode.json                        # Local config (same content)
├── .opencode/
│   ├── instructions.md                  # ENV_INSTRUCTIONS (services, tools, setup hints)
│   └── tool/
│       ├── request_env_variables.ts / request_env_variables.txt
│       ├── save_snapshot.ts / save_snapshot.txt
│       ├── automation_complete.ts / automation_complete.txt
│       ├── save_service_commands.ts / save_service_commands.txt  [setup only]
│       ├── package.json                 # Pre-installed deps
│       └── node_modules/                # Pre-installed deps
└── .proliferate/
    └── actions-guide.md                 # CLI actions documentation
```

**Edge cases:**
- Config is written to both global and local paths for OpenCode discovery reliability.
- File write mechanics differ by provider (Modal uses shell commands, E2B uses `files.write` SDK). For provider-specific boot details, see `sandbox-providers.md` §6.

**Files touched:** `packages/shared/src/sandbox/config.ts`, `packages/shared/src/sandbox/opencode.ts`, `packages/shared/src/providers/modal-libmodal.ts`, `packages/shared/src/providers/e2b.ts`

### 6.4 OpenCode Configuration — `Implemented`

**What it does:** Generates the `opencode.json` that configures the agent's model, provider, permissions, and MCP servers.

**Generated config structure:**
```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "anthropic/claude-opus-4-6",
  "provider": {
    "anthropic": {
      "options": {
        "baseURL": "https://llm-proxy.example.com",
        "apiKey": "..."
      }
    }
  },
  "server": { "port": 4096, "hostname": "0.0.0.0" },
  "plugin": ["/home/user/.config/opencode/plugin/proliferate.mjs"],
  "permission": { "*": "allow", "question": "deny" },
  "mcp": {
    "playwright": {
      "type": "local",
      "command": ["playwright-mcp", "--headless", "--browser", "chromium",
                  "--no-sandbox", "--isolated", "--caps", "vision"],
      "enabled": true
    }
  }
}
```

**Key decisions:**
- `permission: { "*": "allow", "question": "deny" }` — agent can run any command, but cannot use native browser dialogs.
- Playwright MCP is always enabled with headless Chromium and vision capabilities.
- Server binds to `0.0.0.0:4096` so the gateway can reach it via tunnel URL.

**Files touched:** `packages/shared/src/sandbox/opencode.ts:getOpencodeConfig`

### 6.5 Gateway-Mediated Tools Contract — `Implemented`

**What it does:** Defines the contract between sandbox-side tool implementations and gateway-side handlers using synchronous HTTP callbacks.

**Gateway-mediated vs sandbox-local tools:**

| Tool | Gateway-mediated? | Reason |
|------|-------------------|--------|
| `save_snapshot` | Yes | Needs provider API access |
| `automation.complete` | Yes | Needs database access |
| `save_service_commands` | Yes | Needs database access |
| `request_env_variables` | No | Runs locally; gateway uses SSE events to drive UI |

**Callback request:**
- Method: `POST /proliferate/:sessionId/tools/:toolName`
- Auth: sandbox HMAC token (`Authorization: Bearer <token>`, verified as `source: "sandbox"`)
- Body:
  - `tool_call_id: string` (unique per tool call, used for idempotency)
  - `args: Record<string, unknown>`

**Callback response:**
- `200`: `{ success: boolean, result: string, data?: object }`
- `4xx/5xx`: standard error response

**Idempotency:** The gateway tools router maintains in-memory inflight (`tool_call_id` -> `Promise<ToolCallResult>`) and completed-result (`tool_call_id` -> `ToolCallResult`, 5-minute retention) caches. Duplicate calls return the cached result without re-executing. The `session_tool_invocations` DB table records tool calls for audit and observability.

**Handler contract:** Every gateway tool handler implements `InterceptedToolHandler` — a `name` string and an `execute(hub, args)` method returning `InterceptedToolResult { success, result, data? }`. Handlers are registered in `apps/gateway/src/hub/capabilities/tools/index.ts`.

**Registration:** `automation.complete` is registered under two names (`automation.complete` and `automation_complete`) to handle both dot-notation and underscore-notation from agents. Source: `apps/gateway/src/hub/capabilities/tools/index.ts:40-41`

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| `sessions-gateway.md` | This -> Gateway | `POST /proliferate/:sessionId/tools/:toolName` | Gateway executes tool handlers via synchronous callbacks; tool schemas defined here |
| `sandbox-providers.md` | This -> Providers | Tool file templates + `getOpencodeConfig()` | Providers consume definitions, write files into sandbox |
| `automations-runs.md` | Runs -> This | `automation.complete` tool schema | Automation runs inject `run_id`/`completion_id` via system prompt; agent calls tool to finalize |
| `repos-prebuilds.md` | This -> Prebuilds | `save_service_commands` | Tool persists config to configuration records |
| `secrets-environment.md` | Secrets -> This | `request_env_variables` + `/tmp/.proliferate_env.json` | Secrets written to env file; tool requests new ones |
| `llm-proxy.md` | Proxy -> This | `anthropicBaseUrl` / `anthropicApiKey` in OpenCode config | LLM proxy URL embedded in agent config |
| `actions.md` | This -> Actions | `proliferate actions` CLI in system prompts | Prompts document CLI usage; actions spec owns the runtime |

### Security & Auth
- Gateway-mediated tools run on the gateway with full DB/provider access — sandboxes never have these credentials.
- Tool callbacks authenticate with the sandbox HMAC token and require `source: "sandbox"` — requests from other sources are rejected with 403.
- `request_env_variables` instructs agents to never `cat` or `echo` the env file directly — only extract specific keys with `jq`.
- OpenCode permissions deny `question` tool to prevent native browser dialogs.
- System prompts instruct agents never to ask for API keys for connected integrations (tokens resolved server-side).

### Observability
- Gateway tool handlers log via `@proliferate/logger` with `sessionId` context.
- Tool callback executions log `toolName`, `toolCallId`, duration, and final status. The `session_tool_invocations` DB table provides an audit trail.
- `waitForOpenCodeReady()` logs latency metrics with `[P-LATENCY]` prefix.

---

## 8. Acceptance Gates

- [ ] Typecheck passes (`pnpm typecheck`)
- [ ] Gateway tool handler tests pass
- [ ] System prompts reference only tools that exist in `packages/shared/src/opencode-tools/index.ts`
- [ ] Tool definitions in `opencode-tools/index.ts` match handler schemas in `apps/gateway/src/hub/capabilities/tools/`
- [ ] This spec is updated (file tree, tool schemas, mode table)

---

## 9. Known Limitations & Tech Debt

- [ ] **`automation.complete` not yet mode-gated** — `automation.complete` is injected for all sessions, not just automation clients. The system prompt controls usage, but the tool file is present in non-automation sessions. Impact: possible out-of-mode calls. Expected fix: inject `automation_complete.ts` only when `clientType === "automation"`.
- [ ] **`save_env_files` tool pending removal** — The `save_env_files` tool and its gateway handler (`apps/gateway/src/hub/capabilities/tools/save-env-files.ts`) still exist in the codebase but are targeted for removal. It is injected only for setup sessions. Expected fix: remove tool definition, handler, and provider injection code.
- [ ] **Dual registration for automation.complete** — Registered under both `automation.complete` and `automation_complete` to handle agent variation. Impact: minor registry bloat. Expected fix: standardize on one name once agent behavior is stable.
- [ ] **No tool versioning** — Tool schemas are string templates with no version tracking. If a schema changes, running sessions continue with the old version until sandbox restart. Impact: potential schema mismatch during deploys. Expected fix: version stamp in tool file path or metadata.
- [ ] **Custom system prompt bypass** — `session.system_prompt` in the DB overrides mode selection entirely. No validation that the custom prompt includes required tool instructions. Impact: automation sessions with custom prompts may not call `automation.complete`. Expected fix: append mode-critical instructions even when custom prompt is set.
- [ ] **In-memory idempotency only** — Tool call idempotency uses in-memory maps on the gateway instance. If the gateway restarts between a tool call and its retry, the cached result is lost. The `session_tool_invocations` DB table exists for audit but is not currently used for idempotency lookups. Impact: rare double-execution on gateway restart during snapshot thaw. Expected fix: use `session_tool_invocations` as the idempotency store.
