# Agent Contract — System Spec

## 1. Scope & Purpose

### In Scope
- System prompt contract for setup, coding, automation, and scratch sessions
- OpenCode tool schemas and execution domains:
	- `verify`
	- `save_snapshot`
	- `save_service_commands`
	- `save_env_files`
	- `automation.complete`
	- `request_env_variables`
- Capability injection rules (which files must be written into sandboxes, and when)
- Gateway callback contract for intercepted tools (`POST /proliferate/:sessionId/tools/:toolName`)
- Agent/model configuration contract (canonical IDs, OpenCode IDs, provider mapping)

### Out of Scope
- Gateway websocket/session runtime state machine (see `sessions-gateway.md`)
- Provider boot internals and snapshot restoration mechanics (see `sandbox-providers.md`)
- Automation run orchestration beyond the `automation.complete` interface (see `automations-runs.md`)
- Secret CRUD, encryption, and env-file generation runtime (see `secrets-environment.md`)
- LLM proxy key issuance and spend accounting (see `llm-proxy.md`)

### Mental Models

1. **Contract, not implementation detail inventory.** This spec defines behavioral contracts and invariants. File trees and concrete model structs live in code.
2. **Two channels exist for tool execution.**
	- Gateway-mediated tools execute server-side over synchronous HTTP callbacks.
	- Sandbox-local tools execute in the OpenCode runtime and drive UI through streamed tool events.
3. **Prompts are policy; tools are capability.** Prompts tell the agent what it should do, while tool files define what it can do.
4. **Providers do capability injection, not business logic.** Modal and E2B write the same tool/config artifacts; gateway handlers own platform side effects.
5. **Mode-gating is defense in depth.** Availability is enforced by both injected file set and handler runtime checks for setup-only tools.

### Things Agents Get Wrong

- `automation` prompt **extends** coding prompt; it does not replace it (`getAutomationSystemPrompt()` wraps `getCodingSystemPrompt()`).
- Setup mode wins precedence over automation in prompt selection (`session_type === "setup"` is checked before `client_type === "automation"`).
- `request_env_variables` is **not** gateway-mediated; it runs locally and returns immediately.
- `save_env_files` is active and setup-only; it is not a removed/legacy capability.
- `automation.complete` is injected in all session modes today; prompt guidance, not file-level gating, prevents out-of-mode calls.
- OpenCode tool registration is file discovery from `.opencode/tool/*.ts`; `opencode.json` does not register tools.
- OpenCode config currently sets `"mcp": {}`; it does not explicitly provision Playwright MCP in `getOpencodeConfig()`.
- Gateway callback idempotency is in-memory and retention-based (5 minutes), not durable.
- Most tool wrappers return `result.result` text to OpenCode even on gateway-side `success: false`; failures are often surfaced as tool output, not thrown exceptions.
- `session.system_prompt` fully overrides mode-derived prompt selection.

### Key Invariants
- Tool schema source of truth is `packages/shared/src/opencode-tools/index.ts`.
- Setup-only tools are `save_service_commands` and `save_env_files`; all other contract tools are injected in all session modes.
- Gateway intercept registry is authoritative for server-side execution (`apps/gateway/src/hub/capabilities/tools/index.ts`).
- Sandbox callback auth must validate `req.auth.source === "sandbox"` on tool routes.
- Session-scoped sandbox auth token and gateway URL must be injected before OpenCode tool callbacks can work.

---

## 2. Core Concepts

### System Prompt Selection — `Implemented`
- Prompt builders live in `packages/shared/src/prompts.ts`.
- Selection precedence in `apps/gateway/src/lib/session-store.ts`:
	- Setup session -> `getSetupSystemPrompt(repoName)`
	- Else automation client -> `getAutomationSystemPrompt(repoName)`
	- Else coding -> `getCodingSystemPrompt(repoName)`
- Scratch sessions use `getScratchSystemPrompt()` when no configuration exists.
- `session.system_prompt` overrides all computed prompt selection.

### Tool Surface — `Implemented`

| Tool | Execution domain | Mode availability | Key schema constraints |
|---|---|---|---|
| `verify` | Gateway-mediated | All sessions | `{ folder?: string }` |
| `save_snapshot` | Gateway-mediated | All sessions | `{ message?: string }` |
| `automation.complete` (`automation_complete` alias) | Gateway-mediated | Injected in all sessions | `run_id`, `completion_id`, `outcome` required by handler |
| `save_service_commands` | Gateway-mediated | Setup only | `commands[]` 1-10; name/command/cwd/workspacePath limits validated in gateway |
| `save_env_files` | Gateway-mediated | Setup only | `files[]` 1-10; relative paths only; format=`dotenv`; mode=`secret`; keys[] 1-50 |
| `request_env_variables` | Sandbox-local | All sessions | `keys[]` with optional `type`, `required`, `suggestions` |

Primary references:
- Tool definitions: `packages/shared/src/opencode-tools/index.ts`
- Handler registry: `apps/gateway/src/hub/capabilities/tools/index.ts`
- Handler implementations: `apps/gateway/src/hub/capabilities/tools/*.ts`

### Gateway Callback Contract — `Implemented`
- Sandbox wrappers call:
	- `POST /proliferate/:sessionId/tools/:toolName`
	- Body: `{ tool_call_id: string, args: Record<string, unknown> }`
	- Auth: `Authorization: Bearer <SANDBOX_MCP_AUTH_TOKEN>`
- Router behavior in `apps/gateway/src/api/proliferate/http/tools.ts`:
	- Reject non-sandbox sources (`403`).
	- Deduplicate by `tool_call_id` via in-memory inflight + completed caches.
	- Completed cache retention is 5 minutes.
	- Execute handler once per idempotency key and reuse cached result for retries.

### Snapshot Boundary Retry Semantics — `Implemented`
- `TOOL_CALLBACK_HELPER` retries callback transport failures (`ECONNRESET`, `ECONNREFUSED`, `fetch failed`, `AbortError`) with exponential backoff.
- Retries must reuse the same `tool_call_id`.
- `save_snapshot` can trigger freeze/thaw boundaries where this retry behavior is required for correctness.

### Capability Injection — `Implemented`
- Both providers write:
	- Tool `.ts` + `.txt` pairs in `{repoDir}/.opencode/tool/`
	- OpenCode config to both global and repo-local paths
	- Plugin at `/home/user/.config/opencode/plugin/proliferate.mjs`
	- `.opencode/instructions.md` and `.proliferate/actions-guide.md`
	- Preinstalled tool deps (`package.json`, `node_modules`) into `.opencode/tool/`
- Setup-only tool files are removed in non-setup sessions to prevent setup snapshot leakage.

### Agent/Model Configuration — `Implemented`
- Only `opencode` agent type exists.
- Canonical model IDs are defined in `packages/shared/src/agents.ts` and map to:
	- `anthropic/*` OpenCode IDs for Anthropic models
	- `litellm/*` OpenCode IDs for non-Anthropic models
- `getOpencodeConfig()` emits provider blocks for both `anthropic` and `litellm`, with `permission: { "*": "allow", "question": "deny" }` and currently empty MCP config (`"mcp": {}`).

---

## 5. Conventions & Patterns

### Do
- Define all contract tools in `packages/shared/src/opencode-tools/index.ts` as exported string templates.
- Export both `.ts` and `.txt` artifacts per tool.
- Keep setup-only tool gating aligned in both places:
	- Provider injection/removal logic
	- Gateway handler runtime checks
- Use `tool_call_id` consistently for callback idempotency.
- Use Zod validation for structured handler args (`save_service_commands`, `save_env_files`).

### Don't
- Do not register tools in `opencode.json`.
- Do not move gateway side effects (DB/provider/S3 writes) into sandbox tool code.
- Do not assume `session.agent_config.tools` filters injected tools; it is currently carried through context but not enforced.
- Do not modify coding/setup prompts without checking automation prompt side effects.

### Error Handling
- Intercepted handlers return `InterceptedToolResult` with `{ success, result, data? }`.
- Callback helper converts HTTP/network errors into structured `{ success: false, result: string }`.
- Tool wrappers usually return `result.result` to OpenCode; callers should treat tool output content as authoritative for success/failure messaging.

### Reliability
- Callback timeout per attempt is 120 seconds.
- Retry behavior is exponential backoff with `MAX_RETRIES = 5` (up to 6 attempts total including first try).
- OpenCode readiness probe uses exponential backoff (200ms base, 1.5x, max 2s, 30s budget).
- Idempotency is process-memory scoped and lost on gateway restart.

### Testing Conventions
- Unit-test each intercepted handler's schema + guard behavior.
- Route-level tests should assert:
	- sandbox-source auth enforcement
	- inflight dedup behavior
	- completed-result cache reuse by `tool_call_id`
- Prompt tests should assert mode-specific expectations, especially setup vs automation precedence.

---

## 6. Subsystem Deep Dives (Invariant Set)

### 6.1 Prompt Contract Invariants — `Implemented`
- The prompt selection function must stay pure and precedence-ordered: setup first, then automation, then coding.
- Scratch sessions must not reuse configuration-backed prompt selection logic.
- `session.system_prompt` override remains authoritative and bypasses mode-derived prompt composition.
- Automation prompt must continue to include coding prompt content plus explicit completion requirements.
- Setup prompt must preserve setup-only behavioral constraints (no source edits, explicit verification/snapshot workflow, env-file guidance).

### 6.2 Tool Definition Invariants — `Implemented`
- The canonical tool schema and wrapper logic must live in a single module (`opencode-tools/index.ts`).
- Each tool must ship as a pair: executable module (`*.ts`) and companion guidance (`*.txt`).
- Schema invariants are part of this contract:
	- `verify`: optional `folder`.
	- `save_snapshot`: optional `message`.
	- `automation.complete`: required `run_id`, `completion_id`, and `outcome`.
	- `save_service_commands`: `commands[]` length 1-10 with bounded command metadata fields.
	- `save_env_files`: `files[]` length 1-10, relative paths only, `format=dotenv`, `mode=secret`.
	- `request_env_variables`: `keys[]` payload with optional `type`, `required`, and `suggestions`.
- Tool names in wrappers, provider-written filenames, and gateway registry must remain consistent:
	- `automation.complete` wrapper file is `automation_complete.ts`.
	- Gateway must continue supporting both `automation.complete` and `automation_complete`.
- Setup-only capabilities (`save_service_commands`, `save_env_files`) must not be available in non-setup sessions after provider initialization.

### 6.3 Callback Transport Invariants — `Implemented`
- Gateway-mediated tools must execute through synchronous HTTP callbacks, not patching OpenCode parts post hoc.
- Callback auth must reject any non-sandbox caller regardless of bearer token presence.
- Idempotency key semantics:
	- `tool_call_id` uniquely identifies the logical callback execution window.
	- Duplicate in-flight keys must await the same promise.
	- Duplicate completed keys within retention must return cached results.
- Snapshot-boundary retries must preserve `tool_call_id`.
- `automation.complete` must use `completion_id` as callback idempotency key in the tool wrapper.

### 6.4 Capability Injection Invariants — `Implemented`
- Providers must write equivalent contract artifacts regardless of provider backend (Modal/E2B).
- OpenCode config must be written to both global and repo-local paths.
- Provider boot must set callback-critical env vars in sandbox runtime:
	- `SANDBOX_MCP_AUTH_TOKEN`
	- `PROLIFERATE_GATEWAY_URL`
	- `PROLIFERATE_SESSION_ID`
- Provider restore paths must remove setup-only tools in non-setup sessions to prevent snapshot contamination.

### 6.5 OpenCode Runtime Configuration Invariants — `Implemented`
- OpenCode server must bind to `0.0.0.0:4096`.
- Plugin path must reference the global Proliferate plugin file.
- Permission policy must continue to deny `question` while allowing command execution (`"*": "allow"`).
- Canonical model IDs must remain transformable into:
	- OpenCode model ID (`toOpencodeModelId`)
	- Provider API model ID (`toApiModelId`)
- Non-Anthropic models must route via the `litellm` OpenCode provider block.

### 6.6 Environment Request and Persistence Invariants — `Implemented`
- `request_env_variables` must remain sandbox-local and non-blocking from gateway callback perspective.
- UI env-request state depends on streamed tool events (`tool_start`) and must remain compatible with `request_env_variables` payload shape.
- User env submissions must merge into `/tmp/.proliferate_env.json` via provider `writeEnvFile()` implementations.
- Secret persistence policy is controlled by submission inputs (`persist` per key, fallback `saveToConfiguration`) and is not owned by the tool schema itself.
- `save_env_files` must persist env-file generation spec (not secret values) and remain setup-session-gated.

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| `sessions-gateway.md` | This -> Gateway | `POST /proliferate/:sessionId/tools/:toolName` | Tool callbacks are part of gateway runtime lifecycle |
| `sandbox-providers.md` | This -> Providers | Tool/config injection contract | Providers materialize tool files and OpenCode config defined here |
| `automations-runs.md` | Runs -> This | `automation.complete` payload contract | Run completion depends on this tool schema and idempotency rules |
| `repos-prebuilds.md` | This -> Configurations | `save_service_commands`, `save_env_files` writes | Setup tools persist reusable configuration metadata |
| `secrets-environment.md` | This <-> Secrets | `request_env_variables`, submit-env write path | Tool requests values; secrets subsystem persists optional org secrets |
| `llm-proxy.md` | Proxy -> This | OpenCode provider options | Proxy URL/key populate OpenCode provider options |
| `actions.md` | This -> Actions | Prompt + actions bootstrap guidance | Prompts and bootstrap file document `proliferate actions` usage |

### Security & Auth
- Gateway-mediated tools execute with server-side credentials; sandbox code does not receive direct DB/S3/provider credentials.
- Callback endpoints enforce sandbox-origin authentication (`req.auth.source === "sandbox"`).
- Prompt/tool guidance requires key-level extraction from env JSON, avoiding full-file echoing.
- Prompts continue to forbid requesting raw integration API keys when integrations are connected.

### Observability
- Tool callback route logs execution events with `toolName`, `toolCallId`, and `sessionId`.
- Session telemetry tracks tool call IDs and active tool call counts.
- OpenCode readiness and key runtime operations emit `[P-LATENCY]`/latency logs.
- `session_tool_invocations` schema exists for audit, but current callback router does not use it as a write-through idempotency store.

---

## 8. Acceptance Gates

- [ ] Typecheck passes (`pnpm typecheck`)
- [ ] Gateway tool handler tests pass
- [ ] Prompt/tool references are synchronized (including `save_env_files`)
- [ ] Provider injection rules match handler runtime gates for setup-only tools
- [ ] Section 6 invariants are validated against current implementation
- [ ] If contract behavior changed, `docs/specs/feature-registry.md` is updated

---

## 9. Known Limitations & Tech Debt

- [ ] **`automation.complete` is not mode-gated at injection time** — injected in non-automation sessions; enforced only by prompt expectations.
- [ ] **Dual naming for automation completion** — registry supports both `automation.complete` and `automation_complete` for compatibility.
- [ ] **Mixed tool authoring styles** — `verify` still uses raw export object while other tools use `tool()` API.
- [ ] **Custom prompt override bypasses safety text** — `session.system_prompt` can omit mode-critical instructions.
- [ ] **Idempotency cache is in-memory only** — gateway restart drops dedup state and may permit rare duplicate side effects.
- [ ] **Idempotency key namespace is global to process map** — cache key is `tool_call_id` only, not scoped by session/tool.
- [ ] **`session_tool_invocations` table is not integrated into callback execution path** — durable audit/idempotency coupling is still missing.
