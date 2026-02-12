# MCP Extensibility — Design Spec

## 1. Problem & Motivation

Proliferate's automation system is powerful but closed: adding a new integration (trigger source, action adapter, notification channel) requires TypeScript code changes, a rebuild, and a deploy. Users cannot extend the agent's capabilities without modifying the platform itself.

MCP (Model Context Protocol) is the emerging standard for giving AI agents access to external tools and data. OpenCode — the coding agent running inside every Proliferate sandbox — already supports MCP servers natively. By letting users **connect MCP servers** to their sessions and automations, Proliferate can become a platform where the community builds integrations rather than the core team shipping each one.

### What "Connect an MCP" means

A user configures one or more MCP servers on an automation (or session). When the sandbox boots, those MCP servers are started alongside Playwright and are immediately available to the agent. The agent discovers them like any other tool — no code changes needed.

```
User configures MCP server on automation
  → stored in enabledTools JSONB
  → flows through session creation pipeline
  → injected into OpenCode config at sandbox boot
  → agent discovers tools via MCP protocol
```

---

## 2. Current State Audit

### What already works

| Layer | Current State | Notes |
|-------|--------------|-------|
| OpenCode MCP support | `opencode.json` has an `mcp` block | Currently hardcoded to Playwright only |
| `enabledTools` JSONB | Exists on `automations` table | Only used for `slack_notify.channelId` backward compat |
| `agentConfig` JSONB | Exists on `sessions` table | Only stores `modelId` today |
| Sandbox boot pipeline | Writes `opencode.json` to sandbox | Both Modal and E2B providers |
| UI tool config | `ToolListItem` component pattern | Toggle + nested config fields |
| Base image | Playwright MCP pre-installed | Pattern for pre-installing MCP servers |

### What's hardcoded

| Component | File | Issue |
|-----------|------|-------|
| MCP block in OpenCode config | `packages/shared/src/sandbox/opencode.ts:58-64` | Only Playwright, no parameterization |
| `getOpencodeConfig()` signature | `packages/shared/src/sandbox/opencode.ts:18` | No MCP servers parameter |
| `AgentConfig` type | `packages/shared/src/agents.ts` | Only `agentType` + `modelId` |
| `CreateSessionOptions.agentConfig` | `apps/gateway/src/lib/session-creator.ts` | Only `{ modelId?: string }` |
| Automation → session request | `apps/worker/src/automation/index.ts:237-270` | `enabledTools` not passed through |

### Data flow gap

```
automations.enabledTools  ──X──  NOT read by worker
                                 NOT passed to session creation
                                 NOT in CreateSandboxOpts
                                 NOT in getOpencodeConfig()
                                 NOT in opencode.json mcp block
```

The infrastructure exists at both ends (DB storage and OpenCode runtime) but the pipeline between them is missing.

---

## 3. Design

### 3.1 MCP Server Configuration Schema

Store MCP server configs in `enabledTools` under a dedicated `mcp_servers` key:

```typescript
// In enabledTools JSONB on automations table (or agentConfig on sessions)
interface EnabledTools {
  // Existing tool configs...
  slack_notify?: ToolConfig;
  create_linear_issue?: ToolConfig;
  email_user?: ToolConfig;
  create_session?: ToolConfig;

  // NEW: MCP server definitions
  mcp_servers?: Record<string, McpServerConfig>;
}

interface McpServerConfig {
  /** "local" = stdio process, "sse" = remote SSE endpoint */
  type: "local" | "sse";
  /** For type "local": command + args to spawn */
  command?: string[];
  /** For type "sse": remote URL */
  url?: string;
  /** Environment variables to pass to the MCP process */
  env?: Record<string, string>;
  /** Whether this server is active */
  enabled: boolean;
  /** Optional: restrict to specific tools from this server */
  allowedTools?: string[];
  /** User-facing description */
  description?: string;
}
```

Example stored value:

```json
{
  "mcp_servers": {
    "github": {
      "type": "local",
      "command": ["npx", "-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}" },
      "enabled": true,
      "description": "GitHub issues, PRs, and repo management"
    },
    "postgres": {
      "type": "local",
      "command": ["npx", "-y", "@modelcontextprotocol/server-postgres", "${DATABASE_URL}"],
      "enabled": true,
      "description": "Query and manage PostgreSQL databases"
    },
    "custom-api": {
      "type": "sse",
      "url": "https://mcp.example.com/sse",
      "enabled": true,
      "description": "Internal API tools"
    }
  }
}
```

### 3.2 Pipeline Changes (Data Flow)

The MCP server config needs to flow through 7 layers:

```
1. UI (automation detail page)
   ↓  enabledTools.mcp_servers stored in DB
2. Worker (handleExecute)
   ↓  reads automation.enabledTools, passes mcp_servers to session creation
3. Gateway (session-creator.ts)
   ↓  accepts mcpServers in CreateSessionOptions
4. Session record
   ↓  stored in sessions.agent_config JSONB (alongside modelId)
5. Sandbox provider (CreateSandboxOpts)
   ↓  mcpServers field added to opts
6. setupEssentialDependencies()
   ↓  passes mcpServers to getOpencodeConfig()
7. getOpencodeConfig()
   ↓  merges user MCP servers with Playwright in the mcp block
```

#### Layer-by-layer changes

**Layer 1: `AgentConfig` type** (`packages/shared/src/agents.ts`)

```typescript
export interface AgentConfig {
  agentType: AgentType;
  modelId: ModelId;
  mcpServers?: Record<string, McpServerConfig>;  // NEW
}
```

**Layer 2: `getOpencodeConfig()`** (`packages/shared/src/sandbox/opencode.ts`)

Add an optional `mcpServers` parameter and merge with the default Playwright entry:

```typescript
export function getOpencodeConfig(
  opencodeModelId: string,
  anthropicBaseUrl?: string,
  anthropicApiKey?: string,
  mcpServers?: Record<string, McpServerConfig>,  // NEW
): string {
  // Build MCP block: always include Playwright, merge user servers
  const allServers = {
    playwright: { /* existing config */ },
    ...mcpServers,
  };
  // Serialize into the JSON template
}
```

**Layer 3: `CreateSandboxOpts`** (`packages/shared/src/sandbox-provider.ts`)

No change needed — `agentConfig` already flows through and it's JSONB in the DB. The expanded `AgentConfig` type carries `mcpServers` automatically.

**Layer 4: Both providers** (`packages/shared/src/providers/modal-libmodal.ts`, `e2b.ts`)

In `setupEssentialDependencies()`, extract `mcpServers` from `agentConfig` and pass to `getOpencodeConfig()`:

```typescript
const agentConfig = opts.agentConfig || getDefaultAgentConfig();
const opencodeModelId = toOpencodeModelId(agentConfig.modelId);
const opencodeConfig = getOpencodeConfig(
  opencodeModelId,
  llmProxyBaseUrl,
  undefined,
  agentConfig.mcpServers,  // NEW
);
```

**Layer 5: Worker automation handler** (`apps/worker/src/automation/index.ts`)

In `handleExecute()`, read `automation.enabledTools.mcp_servers` and include it in the session creation request:

```typescript
const sessionRequest = {
  // ... existing fields ...
  agentConfig: {
    modelId: automation.modelId,
    mcpServers: (automation.enabledTools as any)?.mcp_servers,  // NEW
  },
};
```

**Layer 6: Gateway session creator** (`apps/gateway/src/lib/session-creator.ts`)

Widen `CreateSessionOptions.agentConfig` to accept the full type:

```typescript
agentConfig?: {
  modelId?: string;
  mcpServers?: Record<string, McpServerConfig>;  // NEW
};
```

### 3.3 Environment Variable Interpolation

MCP server configs often reference secrets (API tokens, database URLs). These should come from the session's environment variables, not be hardcoded in the config.

Use `${VAR_NAME}` syntax in MCP server `command` and `env` fields. During `getOpencodeConfig()` generation, interpolate against the sandbox's `envVars`:

```
User stores: "env": { "GITHUB_TOKEN": "${GITHUB_TOKEN}" }
Sandbox has: envVars.GITHUB_TOKEN = "ghp_abc123"
Result:      "env": { "GITHUB_TOKEN": "ghp_abc123" }
```

This keeps secrets out of the automation config and leverages the existing secrets/environment system (`packages/services/src/secrets/`).

### 3.4 UI Design

Add an "MCP Servers" section to the automation detail page, below the existing "Actions" section. Follow the existing `ToolListItem` pattern:

```
┌─────────────────────────────────┐
│ MCP Servers                     │
├─────────────────────────────────┤
│ 🔌  GitHub MCP         [toggle] │
│     npx -y @mcp/server-github   │
├─────────────────────────────────┤
│ 🔌  Postgres MCP       [toggle] │
│     npx -y @mcp/server-postgres │
├─────────────────────────────────┤
│ + Add MCP Server                │
└─────────────────────────────────┘
```

Clicking "Add MCP Server" opens a form with:
- **Name** (display label, also the key in the config)
- **Type** dropdown: "Local command" or "Remote SSE"
- **Command** (for local): text input for the command array
- **URL** (for SSE): URL input
- **Environment variables**: key-value pairs (values support `${SECRET_NAME}` syntax)
- **Description**: optional text

A curated gallery of popular MCP servers (GitHub, Slack, Postgres, Filesystem, etc.) could pre-fill the form, similar to how trigger providers are listed today.

### 3.5 Interactive Sessions

The same mechanism should work for interactive (non-automation) sessions. Two entry points:

1. **Prebuild-level defaults**: Store default MCP servers on the prebuild config. Every session created from that prebuild inherits them.
2. **Session-level override**: Allow users to add/remove MCP servers when creating a session (or from the session settings panel).

The prebuild approach is more practical — users configure MCP servers once per project, and every session gets them automatically.

### 3.6 Security Considerations

**Sandboxed execution**: MCP servers run inside the sandbox, which is already an isolated container. A malicious MCP server cannot escape the sandbox.

**Secret handling**: MCP server configs stored in `enabledTools` should never contain raw secrets. Use `${VAR_NAME}` references resolved at boot time from the session's environment variables (which come from the encrypted secrets system).

**Network access**: Sandboxes have outbound internet access. SSE-type MCP servers connecting to external URLs are allowed. No additional network policy changes needed.

**npm package execution**: `npx -y` commands download and run arbitrary code. This is acceptable because the sandbox is ephemeral and isolated — the same trust model as the agent running `npm install` on any project.

**Command injection**: The `command` array should be validated as an array of strings and passed directly to `execve` (not through a shell). OpenCode already handles this correctly for MCP server spawning.

---

## 4. Implementation Phases

### Phase 1: Plumb the pipeline (backend-only)

Wire `mcpServers` through the full stack so that if the config exists, it reaches the sandbox. No UI yet — power users can set it via API.

**Files to change:**
- `packages/shared/src/agents.ts` — extend `AgentConfig`
- `packages/shared/src/sandbox/opencode.ts` — add `mcpServers` param to `getOpencodeConfig()`
- `packages/shared/src/providers/modal-libmodal.ts` — pass `mcpServers` through
- `packages/shared/src/providers/e2b.ts` — pass `mcpServers` through
- `apps/gateway/src/lib/session-creator.ts` — widen `agentConfig` type
- `apps/worker/src/automation/index.ts` — read `enabledTools.mcp_servers`, pass to session

**Validation**: Add Zod schema for `McpServerConfig` in `packages/shared/src/contracts/automations.ts`.

### Phase 2: Automation UI

Add the MCP server configuration UI to the automation detail page.

**Files to change:**
- `apps/web/src/app/dashboard/automations/[id]/page.tsx` — add MCP servers section
- Potentially a new `McpServerForm` component in `apps/web/src/components/automations/`

### Phase 3: Interactive session support

Allow MCP servers to be configured at the prebuild level and inherited by sessions.

**Files to change:**
- `packages/db/src/schema/prebuilds.ts` — add `mcpServers` to prebuild config (or reuse existing JSONB)
- `apps/gateway/src/lib/session-creator.ts` — read prebuild MCP config during `buildSandboxOptions()`
- Session creation UI — add MCP server picker

### Phase 4: MCP server gallery

Curated list of popular MCP servers with one-click setup.

**Data source:** A static JSON registry of known MCP servers (name, description, command, required env vars), similar to how `TRIGGERS` is a static map today.

---

## 5. Relationship to Existing Extension Points

### MCP servers vs. Action Adapters

Action adapters (Linear, Sentry) run **server-side** in the gateway. MCP servers run **inside the sandbox**. They solve different problems:

| | Action Adapters | MCP Servers |
|---|---|---|
| Runs where | Gateway (server-side) | Sandbox (agent-side) |
| Auth | OAuth tokens via Nango | Env vars in sandbox |
| Approval flow | Risk-based (read/write/danger) | Agent decides |
| Adding new ones | TypeScript code change + deploy | User config, no deploy |
| Best for | Sensitive operations needing approval | Read-heavy integrations, custom APIs |

They are complementary. Over time, some action adapters could be replaced by MCP servers for simpler use cases.

### MCP servers vs. Custom Webhooks

Custom webhooks are **inbound** (trigger events). MCP servers are **outbound** (agent capabilities). No overlap.

### MCP servers vs. `agentInstructions`

Agent instructions tell the agent **what to do**. MCP servers give the agent **new tools to use**. They work together — instructions can reference tools provided by MCP servers.

---

## 6. What This Unlocks

With MCP extensibility, users can:

1. **Connect any API** — Use MCP servers for Jira, PagerDuty, Datadog, custom internal APIs — without waiting for Proliferate to build native integrations
2. **Database access** — Give the agent read access to production databases for debugging (Postgres MCP, MySQL MCP)
3. **File system tools** — Access shared filesystems, S3 buckets, Google Drive
4. **Monitoring** — Connect to Grafana, CloudWatch, or custom dashboards
5. **Communication** — Slack MCP, Discord MCP, email tools beyond the built-in notification channels
6. **Custom tools** — Build bespoke MCP servers for internal workflows and connect them via SSE

This is the path to making Proliferate a platform rather than a product — the community builds the integrations.

---

## 7. Spec Cross-References

| Spec | Affected Section | Change |
|------|-----------------|--------|
| `agent-contract.md` | §6.4 OpenCode Configuration | Document mcpServers in config generation |
| `sandbox-providers.md` | §6.4 Boot sequence | Document MCP server injection |
| `automations-runs.md` | §6.4 Execution | Document enabledTools.mcp_servers flow |
| `sessions-gateway.md` | §6.1 Session creation | Document agentConfig.mcpServers |
| `feature-registry.md` | — | Add "MCP Extensibility" feature entry |
