# External Tool Access — RFC / Decision Context

> **Purpose:** Frame the problem space, landscape, and options for extending Proliferate's agent tool access beyond the current hand-written adapters. Written to enable a decision, not to advocate for a specific approach.
>
> **Date:** 2026-02-13

---

## 1. What Problem Are We Solving?

Proliferate agents can currently interact with exactly three external services: Linear, Sentry, and Slack. Each requires a hand-written adapter (~150-200 lines of code, plus a gateway route, risk classification, and a markdown guide). Adding a fourth integration (e.g., Notion, Stripe, HubSpot, Jira, PagerDuty) requires:

- Writing an adapter in `packages/services/src/actions/adapters/`
- Registering it in the static adapter registry
- Writing a CLI guide
- Deploying a new gateway version

Meanwhile, the broader ecosystem has standardized on **MCP (Model Context Protocol)** as the way to give agents tool access. There are production MCP servers for 100+ services — Notion (22 tools), Stripe (20+ tools), Sentry (26 tools vs our 5), GitHub, Jira, Confluence, HubSpot, PagerDuty, Datadog, Postgres, and more. Every major coding agent (Claude Code, OpenWork, Cursor, Windsurf) supports MCP natively.

**The gap:** Users want their agents to interact with more services. We can either keep writing adapters one-by-one, or find a way to leverage the MCP ecosystem.

---

## 2. Current Architecture

### How Agents Access External Services Today

```
Agent (sandbox)
  │
  │ proliferate actions list          → discovers available integrations
  │ proliferate actions run ...       → invokes an action
  │ proliferate actions guide ...     → gets usage docs
  │
  ▼
proliferate CLI (sandbox) ──HTTP──► Gateway ──► ActionAdapter.execute() ──► External API
                                       │
                                   risk check (read/write/danger)
                                   grant evaluation (CAS)
                                   approval flow (WebSocket → dashboard)
                                   audit log (DB)
                                   token resolution (Nango OAuth)
```

**Key properties of this design:**
- OAuth tokens never enter the sandbox (resolved server-side by gateway)
- Every action invocation is logged to `action_invocations` table
- Risk classification gates write operations behind human approval
- Grants provide reusable auto-approve permissions with call budgets
- The agent uses a simple CLI — no protocol knowledge needed

### How OAuth Integrations Work

Integrations (GitHub, Linear, Sentry, Slack) are OAuth connections managed via Nango or native flows. They produce records in the `integrations` table, which get bound to sessions via `session_connections`. The gateway resolves live tokens via `integrations.getToken()` at invocation time.

### How Automations Use External Services

The automation pipeline (trigger → enrich → execute → finalize) interacts with external services at multiple points:

| Stage | External Access | Mechanism |
|---|---|---|
| **Trigger ingestion** | GitHub/Linear/Sentry/PostHog → webhooks/polling | Trigger providers (dedicated adapters) |
| **Enrichment** | None (pure computation on trigger context) | — |
| **Execution** | Agent runs in sandbox, can use `proliferate actions` | Same as interactive sessions |
| **Finalization** | Slack notifications | Worker calls Slack API directly |

Automations inherit whatever external tool access the agent has in its session. If we expand agent tool access, automations get it too.

### What OpenCode Already Supports (Inside Our Sandboxes)

OpenCode, which runs inside every Proliferate sandbox, natively supports:

| Primitive | Where Configured | How Discovered |
|---|---|---|
| **MCP servers** | `opencode.json` → `"mcp"` dict | OpenCode connects at startup |
| **Skills** | `.opencode/skills/<name>/SKILL.md` | Filesystem scan |
| **Plugins** | `opencode.json` → `"plugin"` array | Config + filesystem |
| **Commands** | `.opencode/commands/<name>.md` | Filesystem scan |
| **Custom tools** | `.opencode/tool/<name>.ts` | Filesystem scan |

Today, Proliferate writes a static `opencode.json` with only one MCP server (Playwright) and a minimal plugin. These extensibility primitives are available but mostly unused.

---

## 3. The MCP Ecosystem

### Protocol Basics

MCP is a JSON-RPC 2.0 protocol between a **client** (the agent/host) and **servers** (tool providers). Two transports:
- **stdio**: client spawns server as child process, communicates via stdin/stdout
- **HTTP (Streamable)**: client connects to a remote URL

Key operations:
- `tools/list` → returns `[{ name, description, inputSchema (JSON Schema), annotations }]`
- `tools/call` → sends `{ name, arguments }`, returns `{ content: [{ type: "text", text }], isError }`

### What Real MCP Servers Look Like

| Server | Tools | Auth | Start Command |
|---|---|---|---|
| **Sentry** (`@sentry/mcp-server`) | 26 tools (issues, traces, projects, docs, AI search) | `SENTRY_ACCESS_TOKEN` env var | `npx @sentry/mcp-server` |
| **Notion** (`@notionhq/notion-mcp-server`) | ~22 tools (pages, blocks, search, comments) | `NOTION_TOKEN` env var | `npx @notionhq/notion-mcp-server` |
| **Stripe** (`@stripe/mcp`) | 20+ tools (customers, invoices, payments) | `STRIPE_SECRET_KEY` env var | `npx @stripe/mcp` |

Key patterns:
- Auth is always via **environment variables** (API keys or tokens)
- Tools have **annotations** (`readOnlyHint`, `destructiveHint`) that map to risk levels
- Input schemas are **JSON Schema** objects
- Responses are text content (JSON or formatted Markdown)

### Comparison: Our Sentry Adapter vs Sentry MCP Server

| | Proliferate Adapter | Sentry MCP Server |
|---|---|---|
| Tools | 5 | 26 |
| Code | ~210 lines, hand-maintained | 0 lines (npm package) |
| Features | Basic CRUD | AI-powered search, trace analysis, project management, docs |
| Schema | Custom `ActionParam[]` | JSON Schema 7 (standard) |
| Risk hints | Manual per-action | `annotations.readOnlyHint` / `destructiveHint` |

---

## 4. Competitive Context

### OpenWork (different-ai, ~9.6k stars)

OpenWork exposes all of OpenCode's extensibility primitives through a polished desktop UI:
- MCP servers: add/remove via UI, OAuth quick-connect for popular services
- Skills: markdown-based behavioral patterns, installable from a hub
- Plugins: npm packages or local JS/TS files
- Commands: reusable prompt templates
- Hot-reload: file watcher updates everything live

OpenWork is local-first — MCP servers run on the user's machine. No server-side mediation, no approval flow, no audit trail.

### Claude Code / Claude Desktop

Native MCP support. Users configure MCP servers in settings, agent discovers tools automatically. Same local-first model as OpenWork.

### What They Have That We Don't

- **Breadth**: Access to 100+ services via MCP ecosystem
- **Zero-code extensibility**: Users add services without writing adapter code
- **Simplicity**: "Add a Notion MCP server" vs "wait for Proliferate to build a Notion adapter"

### What We Have That They Don't

- **Server-side token management**: OAuth tokens never leave the server
- **Approval flow**: Risk-classified operations require human approval
- **Audit trail**: Every action invocation is logged
- **Team-wide configuration**: Platform provides centrally managed connector access (org-scoped via `org_connectors` table)
- **Automation integration**: Tools are available in triggered automation runs, not just interactive sessions

---

## 5. Design Dimensions

Any approach needs to address these questions:

### A. Where do MCP server processes run?

| Location | Tokens | Latency | Ops Complexity | Security |
|---|---|---|---|---|
| **In the sandbox** | In sandbox env | Low (local) | None (OpenCode manages) | API keys in sandbox |
| **On the gateway** | Server-side | Medium (IPC) | Process lifecycle mgmt | API keys server-side |
| **Dedicated sidecar/service** | Server-side | Medium (network) | New service to deploy | API keys isolated |
| **Remote MCP (vendor-hosted)** | At vendor | High (network) | None | Keys at vendor |

### B. How does the agent discover and invoke tools?

| Mechanism | Agent Simplicity | Platform Control | Audit |
|---|---|---|---|
| **OpenCode native MCP** (agent calls tools directly) | Highest | None | None |
| **`proliferate` CLI** (gateway-mediated) | High | Full (risk, approval, grants) | Full |
| **Hybrid** (some direct, some CLI) | Lower (two systems) | Partial | Partial |

### C. How do credentials flow?

| Source | For OAuth Integrations | For BYOK API Keys |
|---|---|---|
| **Nango/platform** | Token resolved server-side | N/A |
| **Secrets system** | N/A | Injected as env var |
| **Direct env var** | N/A | User provides at session start |

### D. How is it configured?

| Level | Scope | Persistence |
|---|---|---|
| **Per-configuration** (JSONB on configurations table) | Project-wide, all sessions | Survives sessions |
| **Per-session** (session config) | One session | Ephemeral |
| **Per-org** (org-level config) | All projects | Survives everything |
| **Per-repo** (committed to repo, e.g. `.opencode/`) | Follows the code | Versioned with code |

---

## 6. Options

### Option 1: MCP Servers in the Sandbox (OpenCode-Native)

Add MCP server configs to configurations. At sandbox boot, write them into `opencode.json`. OpenCode manages the MCP servers natively inside the sandbox. The agent discovers and calls tools through OpenCode's built-in MCP support.

**What changes:**
- `mcp_servers` JSONB on configurations table
- `getOpencodeConfig()` becomes composable (accepts dynamic MCP servers)
- API key secrets injected as env vars into sandbox (existing secrets system)
- UI for configuring MCP servers on configurations

**What doesn't change:**
- Gateway, CLI, Actions system — all untouched
- OAuth integrations stay as Actions
- MCP tools and Actions are separate systems

**Properties:**
- Simplest to build (~1 week)
- API keys are in the sandbox (same as any other secret the user provides)
- No approval flow for MCP tools (OpenCode auto-allows everything)
- No platform-level audit of MCP tool calls
- Agent has two tool systems: `proliferate actions` for OAuth services, native MCP for BYOK
- Automations get MCP tools automatically (they run in the same sandbox)
- Pre-installing MCP servers in the sandbox image or installing at boot time adds latency

### Option 2: Gateway-Mediated MCP Connectors (CLI-Mediated)

The gateway is the MCP client. MCP tools are surfaced through the existing Actions pipeline, so the agent keeps using `proliferate actions run`.

**V1 scope (recommended): remote HTTP connectors only**

For `remote_http` MCP servers, the gateway makes direct HTTP JSON-RPC calls to the vendor endpoint. There is no separate runner service and no child-process lifecycle to manage in this phase.

**What changes in V1:**
- Org-scoped connector catalog resolved by gateway at session runtime
- `McpHttpAdapter` (or equivalent) using `@modelcontextprotocol/sdk` for remote transport
- `GET /available` merges OAuth adapters and connector-discovered tools
- Secrets resolved server-side and mapped to connector auth (headers/env-derived config)
- MCP annotations mapped to risk levels (`read`/`write`/`danger`) with safe defaults

**What doesn't change in V1:**
- `proliferate` CLI contract — no new agent-facing invocation surface
- Approval flow, grants, and audit logging continue to gate execution
- Existing OAuth integrations (Linear/Sentry/Slack/GitHub) keep using current adapter path

**Properties of V1:**
- Moderate complexity (~1-2 weeks, no process management)
- API keys stay server-side (never enter sandbox)
- Full approval/audit parity for connector-backed actions
- Latency profile close to existing adapter fetch calls (HTTP + JSON-RPC envelope)
- Only supports vendors that expose remote MCP endpoints

**Future extension (not in V1):**
- Optional `stdio` connector execution on gateway for curated/self-host deployments that need non-HTTP MCP servers
- This adds process lifecycle and packaging complexity, so it is explicitly deferred

### Option 3: Hybrid — Sandbox MCP + Gateway Actions

MCP servers run in the sandbox (Option 1) for read-heavy, low-risk tool access. OAuth integrations stay as gateway-mediated Actions for write operations that need approval. The two systems coexist.

**What changes:**
- Everything from Option 1
- System prompt updated to document both systems
- Agent bootstrap guide explains when to use which

**What doesn't change:**
- Actions system — untouched
- Gateway — untouched

**Properties:**
- Moderate complexity (~1-2 weeks)
- Read-heavy MCP tools (Notion search, Stripe list, etc.) work without approval overhead
- Write operations on OAuth services still get approval
- Agent has two systems to learn, but each is clear about what it does
- Natural upgrade path: start here, later unify if needed

### Option 4: Actions Become a Remote MCP Server

Refactor the Actions system as a remote MCP server that OpenCode connects to. All tool access — both platform-managed and BYOK — goes through the MCP protocol. The `proliferate` CLI is replaced by native MCP tool calls.

**What changes:**
- New remote MCP server endpoint in the gateway
- Adapters (Linear, Sentry, Slack) exposed as MCP tools
- BYOK MCP servers proxied through the same endpoint
- OpenCode connects to `proliferate` remote MCP server in `opencode.json`
- Approval flow adapted to MCP protocol (pending responses)
- `proliferate actions` CLI deprecated

**What doesn't change:**
- Adapter code (Linear, Sentry, Slack)
- Token resolution, risk classification, grants, audit

**Properties:**
- Most complex (~6-8 weeks)
- Cleanest end-state: one protocol, one discovery mechanism
- Agent uses native MCP tools for everything
- Requires solving MCP approval flow (MCP has no native "wait for human approval" concept)
- Breaking change for existing `proliferate actions` CLI users
- Risk: MCP protocol may evolve in ways that break assumptions

### Option 5: Do Nothing (Keep Hand-Writing Adapters)

Add integrations one at a time as customer demand requires. Each adapter is ~200 lines.

**Properties:**
- Zero architectural risk
- Full control over every integration's behavior
- Doesn't scale — each integration is a deploy
- Falls behind competitors on breadth
- Doesn't leverage the MCP ecosystem at all

---

## 7. Decision Framework

### What matters most?

| If you prioritize... | Lean toward... |
|---|---|
| **Ship fast, validate demand** | Option 1 (sandbox MCP) or Option 2 V1 (`remote_http`) |
| **Security and audit parity** | Option 2 (gateway MCP) |
| **Unified agent experience** | Option 2 (gateway MCP) or Option 4 (remote MCP) |
| **Minimal ops burden** | Option 1 (sandbox MCP) |
| **Long-term architectural cleanliness** | Option 4 (remote MCP) |
| **Competitive parity now** | Option 2 V1 (`remote_http`) or Option 1 (sandbox MCP) |
| **Automation pipeline integration** | Any option — automations run in sandboxes, so all options work |

### What's the actual user need?

Two distinct personas:

1. **"I want my agent to read from Notion/Jira/Confluence during coding sessions."** This is read-heavy, low-risk. If governance is not required, sandbox-native MCP (Option 1) is the lightest path. If team-level governance is required, Option 2 V1 (`remote_http`) keeps a single audited tool path.

2. **"I want my agent to create Jira tickets, update PagerDuty incidents, post to Slack channels as part of automations."** This is write-heavy, needs audit trails. Gateway-mediated (Option 2) is the natural fit.

Most users will start with persona 1. Persona 2 emerges as trust builds.

### Incremental path

Options can still be layered, but the cleanest first step is a narrow Option 2 scope:
1. Start with Option 2 V1: gateway-mediated `remote_http` connectors (governed path)
2. Validate demand and operational behavior with a small catalog
3. Add gateway `stdio` support only if specific high-value servers require it
4. Revisit protocol-level unification (Option 4) after connector demand and approval UX are validated

Each step is independently valuable. No step requires undoing previous work.

### Recommendation (2026-02-13)

Adopt **Option 2 with a strict V1 transport scope and org-wide config scope**:
1. Keep `remote_http` connectors as the only MCP transport in cloud V1.
2. Keep OAuth adapters and the current `proliferate actions` contract unchanged.
3. Do **not** introduce a separate connector-runner service in V1.
4. Use a single org-scoped connector catalog so all sessions in an org share the same connector set by default.
5. Defer gateway `stdio` connectors and native sandbox MCP expansion to later phases.

This path preserves approval, grants, and audit guarantees while removing configuration-level setup friction.

### Implementation Status (2026-02-13)

**Current baseline (implemented): Option 2 transport path with org-scoped connector catalog.**
- Connector types + Zod schemas: `packages/shared/src/connectors.ts`
- DB: `org_connectors` table (`packages/db/drizzle/0022_org_connectors.sql`), legacy `configurations.connectors` JSONB retained but no longer read
- MCP client module: `packages/services/src/actions/connectors/` (list tools, call tool, risk derivation)
- Secret resolver: `packages/services/src/secrets/service.ts:resolveSecretValue`
- Gateway wiring: `apps/gateway/src/api/proliferate/http/actions.ts` (available, guide, invoke, approve)
- CRUD/UI: `apps/web/src/server/routers/integrations.ts` + `apps/web/src/app/settings/tools/page.tsx`

**Approved next step (completed): migrated connector source-of-truth from configuration scope to org scope under Integrations ownership.**

### MCP Server Reality Check (2026-02-13)

Based on upstream docs reviewed through Context7 and vendor documentation:

| Server | Transport Reality | Auth Reality | V1 (`remote_http`) Fit |
|---|---|---|---|
| **Context7** | Hosted MCP endpoint at `https://mcp.context7.com/mcp` | Header-based API key (`CONTEXT7_API_KEY`, or bearer in some clients) | **Strong fit** (catalog candidate) |
| **PostHog MCP** | Hosted MCP endpoint documented as `https://mcp.posthog.com/sse` | Personal API key bearer token or OAuth-scoped access | **Conditional fit** (verify Streamable HTTP compatibility vs SSE endpoint behavior) |
| **Playwright MCP** | Primarily local stdio, but can run as standalone HTTP server (`npx @playwright/mcp --port 8931`) | No central SaaS key model by default; typically local/self-host runtime | **Self-host fit** (requires org-hosted endpoint, not turnkey cloud preset) |

Protocol constraints that matter for gateway connectors:
- Streamable HTTP servers may return `Mcp-Session-Id` during `initialize`; when present, clients must send it on subsequent requests.
- Session termination can return `404`, after which clients should re-initialize.
- `tools/list` may paginate via cursor; `tools/call` can return `isError` and/or structured content.

Reference docs:
- MCP spec (transports/session semantics): <https://github.com/modelcontextprotocol/specification>
- Context7 MCP server setup: <https://github.com/upstash/context7>
- Playwright MCP server setup: <https://github.com/microsoft/playwright-mcp>
- PostHog MCP endpoint/auth docs: <https://posthog.com/docs/model-context-protocol>

### Delivery Plan (2026-02-13) — Completed

Migration from configuration-scoped to org-wide connector management is complete.

#### Phase 1 — Org Connector Data Model + Service Layer (`Done`)

1. Org-scoped `org_connectors` table + `packages/services/src/connectors/` service layer.
2. Backfill migration `0022_org_connectors.sql` copied configuration connectors to org scope, deduplicating by `(organization_id, url, name)`.

#### Phase 2 — Org-Level API + UI Surface (`Done`)

1. Integrations-owned connector routes in `apps/web/src/server/routers/integrations.ts`.
2. Settings → Tools UI (`apps/web/src/app/settings/tools/page.tsx`) with preset quick-setup, advanced form, and connection validation.

#### Phase 3 — Gateway Resolution Switch (`Done`)

1. Gateway loads enabled connectors by org/session context, not by configuration.
2. Risk/grant/approval/audit behavior and `connector:<uuid>` integration prefix preserved.

#### Phase 4 — Cleanup (`Partial`)

1. Configuration connector CRUD routes removed. Legacy `configurations.connectors` JSONB column retained for data preservation but no longer read at runtime.

#### Non-goals (unchanged)

1. No separate connector-runner service.
2. No gateway `stdio` connector support.
3. No parallel "second tool plane" in CLI; keep `proliferate actions` as the single governed path.

### Why not "CLI-dynamic MCP everywhere" as the default cloud model?

- It bypasses the existing governance plane (risk checks, approvals, grants, invocation audit) unless we re-implement those controls in a second tool path.
- It increases agent complexity (two invocation systems with overlapping capabilities).
- It pushes more credentials and policy decisions into the sandbox runtime by default.
- It makes behavior less predictable across sessions unless connector configs are persisted and versioned centrally.

For self-hosted teams that want maximum flexibility, native sandbox MCP remains a viable extension path. It should be a deliberate deployment mode, not the default cloud control plane.

---

## 8. Open Questions

1. **Do users actually want MCP servers, or do they want "more integrations"?** MCP is a means, not an end. If users just want Notion access, we could write a Notion adapter in a day. MCP matters if users want 10+ integrations or if they want to bring custom/internal tools.

2. **How important is approval for BYOK tools?** If a user provides their own Notion API key, do they expect approval flow on write operations? Or is the act of providing the key implicit trust?

3. **What's the MCP server installation story?** Popular MCP servers are npm packages (50-200MB installed). Pre-installing in Docker images is controlled but static. Runtime `npx` is flexible but slow and fragile. This is an operational question that affects all options except Option 5.

4. **How do MCP servers interact with the snapshot system?** If MCP servers are installed in the sandbox (Option 1), they persist across snapshots. If the MCP server package updates, stale snapshots have old versions. The base snapshot version key would need to include MCP server configs.

5. **What about MCP servers that need OAuth, not API keys?** Some MCP servers (Sentry, GitHub) support OAuth flows. Today those services use Nango-managed OAuth through our integrations system. Running their MCP server would bypass Nango. Should we support this, or keep OAuth services on the Actions path?

6. **How does this affect the system prompt?** The agent needs to know what tools are available and how to use them. With sandbox MCP (Option 1), OpenCode handles discovery natively. With gateway MCP (Option 2), the existing `proliferate actions list` handles it. With hybrid (Option 3), the system prompt needs to explain both.

7. **Should we optimize remote MCP session reuse beyond the current stateless-per-call design?** Today we initialize per call and retry once on `404`, which is robust and simple. Is additional pooled session/client state worth the complexity for latency-sensitive connectors?

---

## Appendix: Key Files

| File | What It Does |
|---|---|
| `packages/services/src/actions/adapters/types.ts` | `ActionAdapter` interface |
| `packages/services/src/actions/adapters/index.ts` | Static adapter registry (`Map`) |
| `packages/services/src/actions/adapters/sentry.ts` | Example hand-written adapter |
| `packages/services/src/actions/service.ts` | Risk classification, grant evaluation, invocation lifecycle |
| `apps/gateway/src/api/proliferate/http/actions.ts` | Gateway HTTP routes for actions |
| `packages/sandbox-mcp/src/proliferate-cli.ts` | `proliferate` CLI (runs in sandbox) |
| `packages/shared/src/sandbox/opencode.ts` | `getOpencodeConfig()` — generates `opencode.json` |
| `packages/shared/src/sandbox/config.ts` | Plugin template, env instructions, constants |
| `packages/shared/src/providers/modal-libmodal.ts` | Modal provider — sandbox boot, file injection |
| `packages/shared/src/providers/e2b.ts` | E2B provider — same interface |
| `packages/db/src/schema/schema.ts` | Configurations table (has `service_commands` JSONB) |
