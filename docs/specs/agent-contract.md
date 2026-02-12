# Agent Contract — System Spec

## 1. Scope & Purpose

### In Scope
- System prompt modes: setup, coding, automation — what each injects and how they differ
- OpenCode tool schemas: `verify`, `save_snapshot`, `save_service_commands`, `save_env_files`, `automation.complete`, `request_env_variables`
- Capability injection: how tools and instructions are registered in the sandbox OpenCode config
- Tool input/output contracts and validation rules
- Agent/model configuration and selection

### Out of Scope
- How intercepted tools are executed at runtime by the gateway hub — see `sessions-gateway.md` §6
- How tool files are written into the sandbox filesystem (provider boot) — see `sandbox-providers.md` §6
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
- **Tool definition** — a TypeScript module + companion `.txt` description file placed in `{repoDir}/.opencode/tool/`. Defines the tool's schema and a stub `execute()` that the gateway may intercept.
- **OpenCode config** — JSON written to `{repoDir}/opencode.json` and `/home/user/.config/opencode/opencode.json`. Sets model, provider, plugin, permissions, and MCP servers.
- **Agent config** — model ID and optional tools array stored per-session in the database.

**Key invariants:**
- All six tools are always injected regardless of session mode. The system prompt alone controls which tools the agent is encouraged to use.
- Five of six tools are intercepted by the gateway (executed server-side). Only `request_env_variables` runs in the sandbox.
- Tool definitions are string templates exported from `packages/shared/src/opencode-tools/index.ts`. They are the single source of truth for tool schemas.
- The system prompt can be overridden per-session via `session.system_prompt` in the database.

---

## 2. Core Concepts

### System Prompt Modes — `Implemented`
Three prompt builders produce mode-specific system messages. The gateway selects one based on `session_type` and `client_type`.
- Key detail agents get wrong: automation mode extends coding mode (it appends to it), not replaces it.
- Reference: `packages/shared/src/prompts.ts`

### Intercepted Tools Pattern — `Implemented`
Most platform tools are stubs in the sandbox. When OpenCode calls them, the gateway's event processor detects the tool name in the SSE stream, short-circuits sandbox execution, runs the handler server-side, and patches the tool result back into OpenCode.
- Key detail agents get wrong: `request_env_variables` is NOT intercepted — it runs in the sandbox and returns immediately. The gateway listens for it via SSE events to trigger the UI form.
- Reference: `apps/gateway/src/hub/capabilities/tools/index.ts`

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
└── sandbox/
    ├── config.ts                       # Plugin template, env instructions, paths, ports
    └── opencode.ts                     # OpenCode config generator, readiness check

apps/gateway/src/
├── lib/
│   ├── session-store.ts                # buildSystemPrompt() — mode selection logic
│   └── opencode.ts                     # updateToolResult() — patches results back to OpenCode
└── hub/capabilities/tools/
    ├── index.ts                        # Intercepted tools registry
    ├── verify.ts                       # verify handler (S3 upload)
    ├── save-snapshot.ts                # save_snapshot handler (provider snapshot)
    ├── automation-complete.ts          # automation.complete handler (run finalization)
    ├── save-service-commands.ts        # save_service_commands handler (prebuild update)
    └── save-env-files.ts              # save_env_files handler (prebuild update)
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

---

## 5. Conventions & Patterns

### Do
- Define new tool schemas in `packages/shared/src/opencode-tools/index.ts` as string template exports — this keeps all tool definitions in one place.
- Export both a `.ts` tool definition and a `.txt` description file for each tool — OpenCode uses both.
- Use Zod validation in gateway handlers for tools with complex schemas (e.g., `save_service_commands`, `save_env_files`). Simpler tools (`verify`, `save_snapshot`) use inline type coercion.
- Return `InterceptedToolResult` from all handlers — the `success` field drives error reporting.

### Don't
- Register tools in `opencode.json` — OpenCode discovers them by scanning `.opencode/tool/`.
- Add new `console.*` calls in gateway tool handlers — use `@proliferate/logger`.
- Modify system prompts without considering all three modes — automation extends coding, so changes to coding affect automation too.
- Add tool-specific logic to providers — providers write files, the gateway handles execution.

### Error Handling

```typescript
// Standard pattern for intercepted tool handlers
// Source: apps/gateway/src/hub/capabilities/tools/save-env-files.ts
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
- **Tool result patching**: `updateToolResult()` retries up to 5 times with 1s delay — the OpenCode message may still be streaming when the first PATCH attempt occurs. Source: `apps/gateway/src/lib/opencode.ts`
- **Idempotency**: `automation.complete` accepts a `completion_id` as an idempotency key.
- **Timeouts**: OpenCode readiness check uses exponential backoff (200ms base, 1.5x, max 2s per attempt, 30s total). Source: `packages/shared/src/sandbox/opencode.ts:waitForOpenCodeReady`

### Testing Conventions
- Tool handler tests live alongside handlers in gateway tests.
- Test intercepted tool handlers by mocking `SessionHub` methods (e.g., `hub.uploadVerificationFiles`, `hub.saveSnapshot`).
- Verify Zod validation rejects malformed args for `save_service_commands` and `save_env_files`.
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
   - `session_type === "setup"` → `getSetupSystemPrompt(repoName)`
   - `client_type === "automation"` → `getAutomationSystemPrompt(repoName)`
   - Otherwise → `getCodingSystemPrompt(repoName)`

**Mode differences:**

| Aspect | Setup | Coding | Automation |
|--------|-------|--------|------------|
| Base prompt | Unique | Unique | Extends Coding |
| Goal | Get repo running, save snapshot | Implement changes, verify | Complete task, report outcome |
| `verify` | Required before snapshot | Encouraged | Available |
| `save_snapshot` | Required at end | Available | Available |
| `request_env_variables` | Emphasized | Available | Available |
| `save_service_commands` | Emphasized | Available | Available |
| `save_env_files` | Emphasized | Available | Available |
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

#### `verify` tool — `Implemented`

**Schema:**
```typescript
{
  folder?: string  // Default: ".proliferate/.verification/"
}
```

**Behavior:** Gateway intercepts, uploads files from the folder to S3, returns S3 key prefix. Agent collects evidence (screenshots, test logs) before calling.

**Style note:** Uses raw `export default { name, description, parameters, execute }` format (not the `tool()` API).

#### `save_snapshot` tool — `Implemented`

**Schema:**
```typescript
{
  message?: string  // Brief summary of what's configured
}
```

**Behavior:** Gateway intercepts, triggers provider snapshot. For setup sessions: updates prebuild snapshot. For coding sessions: updates session snapshot. Returns `{ snapshotId, target }`.

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

**Behavior:** Gateway intercepts, validates with Zod, persists to prebuild `service_commands` JSONB. Requires `session.prebuild_id`. Returns `{ prebuildId, commandCount }`.

#### `save_env_files` tool — `Implemented`

**Schema:**
```typescript
{
  files: Array<{
    path: string          // Relative, no leading /, no .., max 500 chars
    workspacePath?: string // Default "."
    format: "dotenv"      // Only supported format
    mode: "secret"        // Only supported mode
    keys: Array<{
      key: string         // 1-200 chars
      required: boolean
    }>  // min 1, max 50 keys
  }>  // min 1, max 10 files
}
```

**Behavior:** Gateway intercepts, validates with Zod (including path traversal checks), persists to prebuild `env_files` JSONB. Returns `{ prebuildId, fileCount }`.

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

**Behavior:** Gateway intercepts, updates run record with outcome + completion JSON, updates trigger event status. Registered under both `automation.complete` and `automation_complete` names. Source: `apps/gateway/src/hub/capabilities/tools/index.ts:41`

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

**Behavior:** NOT intercepted. Runs in sandbox, returns immediately with a summary string. The gateway detects this tool call via SSE events and triggers a form in the user's UI. User-submitted values are written to `/tmp/.proliferate_env.json`. The agent then extracts values with `jq` into config files.

**Files touched:** `packages/shared/src/opencode-tools/index.ts`

### 6.3 Capability Injection Pipeline — `Implemented`

**What it does:** Writes tool files, config, plugin, and instructions into the sandbox so OpenCode can discover them.

**Happy path:**
1. Provider (Modal or E2B) calls `setupEssentialDependencies()` during sandbox boot (`packages/shared/src/providers/modal-libmodal.ts:988`, `packages/shared/src/providers/e2b.ts:568`)
2. Plugin written to `/home/user/.config/opencode/plugin/proliferate.mjs` — minimal SSE-mode plugin (`PLUGIN_MJS` from `packages/shared/src/sandbox/config.ts:16-31`)
3. Six tool `.ts` files + six `.txt` description files written to `{repoDir}/.opencode/tool/`
4. Pre-installed `package.json` + `node_modules/` copied from `/home/user/.opencode-tools/` to `{repoDir}/.opencode/tool/`
5. OpenCode config written to both `{repoDir}/opencode.json` and `/home/user/.config/opencode/opencode.json`
6. Environment instructions appended to `{repoDir}/.opencode/instructions.md` (from `ENV_INSTRUCTIONS` in `config.ts:84-131`)
7. Actions bootstrap guide written to `{repoDir}/.proliferate/actions-guide.md` (from `ACTIONS_BOOTSTRAP` in `config.ts:137-165`)
8. OpenCode server started: `cd {repoDir} && opencode serve --port 4096 --hostname 0.0.0.0`
9. Gateway waits for readiness via `waitForOpenCodeReady()` with exponential backoff

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
│       ├── verify.ts / verify.txt
│       ├── request_env_variables.ts / request_env_variables.txt
│       ├── save_snapshot.ts / save_snapshot.txt
│       ├── automation_complete.ts / automation_complete.txt
│       ├── save_service_commands.ts / save_service_commands.txt
│       ├── save_env_files.ts / save_env_files.txt
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

### 6.5 Intercepted Tools Contract — `Implemented`

**What it does:** Defines which tools the gateway intercepts and the contract between tool stubs (sandbox-side) and handlers (gateway-side).

**Intercepted vs sandbox-executed tools:**

| Tool | Intercepted? | Reason |
|------|-------------|--------|
| `verify` | Yes | Needs S3 credentials |
| `save_snapshot` | Yes | Needs provider API access |
| `automation.complete` | Yes | Needs database access |
| `save_service_commands` | Yes | Needs database access |
| `save_env_files` | Yes | Needs database access |
| `request_env_variables` | No | Returns immediately; gateway detects via SSE |

**Handler contract:** Every intercepted tool handler implements `InterceptedToolHandler` — a `name` string and an `execute(hub, args)` method returning `InterceptedToolResult { success, result, data? }`. Handlers are registered in `apps/gateway/src/hub/capabilities/tools/index.ts`.

**Registration:** `automation.complete` is registered under two names (`automation.complete` and `automation_complete`) to handle both dot-notation and underscore-notation from agents. Source: `apps/gateway/src/hub/capabilities/tools/index.ts:40-41`

**Result delivery:** After a handler executes, the gateway patches the result back into OpenCode via `updateToolResult()` (`apps/gateway/src/lib/opencode.ts`). This uses a PATCH to the OpenCode session API. Retries up to 5 times with 1s delay since the message may still be streaming.

For the full runtime execution flow (SSE detection, EventProcessor routing, SessionHub orchestration), see `sessions-gateway.md` §6.

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| `sessions-gateway.md` | This → Gateway | `InterceptedToolHandler.execute(hub)` | Gateway hub executes tool handlers; tool schemas defined here |
| `sandbox-providers.md` | This → Providers | Tool file templates + `getOpencodeConfig()` | Providers consume definitions, write files into sandbox |
| `automations-runs.md` | Runs → This | `automation.complete` tool schema | Automation runs inject `run_id`/`completion_id` via system prompt; agent calls tool to finalize |
| `repos-prebuilds.md` | This → Prebuilds | `save_service_commands`, `save_env_files` | Tools persist config to prebuild records |
| `secrets-environment.md` | Secrets → This | `request_env_variables` + `/tmp/.proliferate_env.json` | Secrets written to env file; tool requests new ones |
| `llm-proxy.md` | Proxy → This | `anthropicBaseUrl` / `anthropicApiKey` in OpenCode config | LLM proxy URL embedded in agent config |
| `actions.md` | This → Actions | `proliferate actions` CLI in system prompts | Prompts document CLI usage; actions spec owns the runtime |

### Security & Auth
- Intercepted tools run on the gateway with full DB/S3/provider access — sandbox never has these credentials.
- `request_env_variables` instructs agents to never `cat` or `echo` the env file directly — only extract specific keys with `jq`.
- `save_env_files` validates paths cannot contain `..` (directory traversal prevention).
- OpenCode permissions deny `question` tool to prevent native browser dialogs.
- System prompts instruct agents never to ask for API keys for connected integrations (tokens resolved server-side).

### Observability
- Gateway tool handlers log via `@proliferate/logger` with `sessionId` context.
- `updateToolResult()` logs retry attempts with host/status/timing.
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

- [ ] **No per-mode tool filtering** — All six tools are injected regardless of session mode. Setup-only tools (`save_service_commands`, `save_env_files`) are available in coding mode, and `automation.complete` is available in non-automation sessions. The system prompt is the only control. Impact: agents occasionally call tools outside their intended mode. Expected fix: conditional tool injection based on session type.
- [ ] **Two tool definition styles** — `verify` uses raw `export default { name, description, parameters }` while other tools use the `tool()` plugin API from `@opencode-ai/plugin`. Impact: inconsistent authoring; no functional difference. Expected fix: migrate `verify` to `tool()` API.
- [ ] **Dual registration for automation.complete** — Registered under both `automation.complete` and `automation_complete` to handle agent variation. Impact: minor registry bloat. Expected fix: standardize on one name once agent behavior is stable.
- [ ] **No tool versioning** — Tool schemas are string templates with no version tracking. If a schema changes, running sessions continue with the old version until sandbox restart. Impact: potential schema mismatch during deploys. Expected fix: version stamp in tool file path or metadata.
- [ ] **Custom system prompt bypass** — `session.system_prompt` in the DB overrides mode selection entirely. No validation that the custom prompt includes required tool instructions. Impact: automation sessions with custom prompts may not call `automation.complete`. Expected fix: append mode-critical instructions even when custom prompt is set.
