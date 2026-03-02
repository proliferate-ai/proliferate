# Proliferate — Architecture Context & System Comparisons

> Architecture goals, current state, and detailed comparisons with Sim (sim.so) and background-agents for an independent technical advisor. The advisor has no codebase access — all relevant code and context is included inline.

## Table of Contents

0. [Architecture Goals (Long-Term Vision)](#0-architecture-goals-long-term-vision)
1. [Project Overviews](#1-project-overviews)
2. [OAuth & Integration Management](#2-oauth--integration-management)
3. [Trigger & Webhook Systems](#3-trigger--webhook-systems)
4. [Agent Tool Execution & OpenCode](#4-agent-tool-execution--opencode)
5. [Self-Hosting Trade-offs](#5-self-hosting-trade-offs)
6. [Recommendations](#6-recommendations)

---

## 0. Architecture Goals (Long-Term Vision)

### What Proliferate Is

An **open-source, self-hostable platform** where AI coding agents run in cloud sandboxes to do real software engineering work. Agents get a full dev environment (git, Docker, running services), make code changes, create PRs, and report back. The platform is MIT-licensed; every commit is public.

### Core Architecture Goals

#### 1. Persistent, Long-Running Agents

**Current state:** Ephemeral sessions — spin up sandbox, do task, tear down.

**Target state:** Agents that persist indefinitely, accumulate project context over time, and react to events while nobody's watching. Inspired by [OpenClaw](https://github.com/openclaw/openclaw) — a 24/7 AI agent daemon with persistent memory, heartbeat scheduling, and session management across channels. A Sentry alert at 3am should trigger the agent to investigate and have a draft PR ready by morning.

This means:
- Session lifecycle evolves from ephemeral to long-lived (pausable, resumable, hibernatable)
- Agents build up project understanding over time (not cold-start every task)
- Efficient sandbox hibernation/snapshot/restore to manage cost
- The trigger system becomes the primary input funnel, not just an automation add-on

#### 2. Team-Wide Multi-Client Access

**Any team member can interact with agents from wherever they already work.** The agent is a shared team resource, not locked to one UI.

**Current clients:** Web UI, Slack, Linear, GitHub (PR comments), CLI, VS Code extension.

**Roadmap clients:** Mobile app, desktop app.

The agent doesn't care where the message comes from — Slack, a Linear comment, a GitHub review, a CLI prompt, or a mobile push notification. All funnel into the same agent with the same context. This is a first-class architectural requirement, not a nice-to-have.

#### 3. Fully Self-Hostable with Minimal Infrastructure

**Target:** PostgreSQL + a single binary + sandbox provider. That's it.

**What this means for current architecture:**
- **Kill Redis** — Use Postgres-native queuing (Graphile Worker or pgmq) and LISTEN/NOTIFY for pub/sub
- **Kill Nango** — Self-host OAuth for core integrations (GitHub, Slack, Linear, Sentry, Jira) with tokens encrypted in Postgres
- **Kill BullMQ** — Replace with Postgres-backed job queues (transactional outbox pattern becomes even cleaner when queue and data share the same DB)
- The advisor's "PostgreSQL-centric modular monolith" recommendation aligns with this goal

#### 4. Extensible Actions & MCP Integration

**Robust, low-friction way to add new integrations and actions.** Two tiers:

- **Core integrations** (GitHub, Slack, Linear, Sentry, Jira): Self-hosted OAuth, native API adapters, first-class trigger support. These are maintained by the Proliferate team.
- **Long-tail integrations** (everything else): Via **MCP (Model Context Protocol) servers**. The platform already has an MCP connector catalog (`org_connectors` table) where orgs can register MCP servers with encrypted credentials. The agent in the sandbox can call any MCP tool. This is the extensibility mechanism — adding a new integration means configuring an MCP server, not writing platform code.

The actions system should make it easy to:
- Add new action providers with minimal boilerplate
- Support approval flows (read actions auto-approve, write actions require human approval, danger actions denied by default)
- Classify risk automatically
- Work with both native integrations and MCP connectors

#### 5. Sandbox Provider Abstraction

**Current:** Modal (primary), E2B (secondary). Both are proprietary SaaS.

**Target:** "Bring your own compute." The sandbox provider interface already exists — the goal is to support:
- Modal / E2B for managed SaaS (fast microVM boots, snapshots)
- gVisor on Kubernetes for self-hosters (strong isolation without bare-metal nested virtualization)
- Potentially Fly Machines as a middle ground

Self-hosters shouldn't need a Modal or E2B account. They should be able to run sandboxes on their own K8s cluster.

#### 6. Enterprise-Ready Security

- **Least-privilege sandboxes:** No high-privilege tokens (GH_TOKEN) injected into sandbox environments. Source control operations (PRs, issues) happen in the control plane, not the sandbox.
- **Source control abstraction:** `SourceControlProvider` interface so the platform isn't hardcoded to GitHub. GitLab, Bitbucket support via the same interface.
- **Bot commit attribution:** Agent commits as itself (`Proliferate Bot <bot@proliferate.dev>`) with `Co-authored-by: User Name <email>` trailers. Cryptographically signed bot commits for enterprise compliance.
- **Encrypted credential storage:** AES-256-GCM envelope encryption for all stored tokens.
- **Org/role-based access control:** Already implemented — admin/owner gates on sensitive mutations.

### What We're Asking the Advisor

Given these goals and the detailed system comparisons below, we want architectural recommendations that:

1. Push toward the "Postgres-only, single-binary" self-hosting target
2. Enable persistent long-running agents without unsustainable infrastructure cost
3. Support the multi-client input model (any team member, any surface)
4. Maintain the extensibility story (core integrations + MCP long-tail)
5. Don't sacrifice the durability and reliability we've already built (durable webhook inbox, transactional outbox, trigger event audit trail)

We're especially interested in patterns for:
- **Session state management** for long-lived agents (consistent hashing? event sourcing? Restate.dev?)
- **Sandbox lifecycle** for persistent agents (hibernation strategies, cost management)
- **OAuth architecture** without Nango (self-hosted, encrypted, refreshable)
- **Queue/job replacement** for Redis/BullMQ (Postgres-native alternatives)
- **Multi-client message routing** to a persistent agent

---

## 1. Project Overviews

### Proliferate

Open-source AI coding agent platform. Users create "sessions" that spin up cloud sandboxes (Modal/E2B) running an LLM coding agent (OpenCode). Agents can interact with external services (GitHub, Linear, Sentry, Slack) via OAuth integrations and automation triggers.

**Stack:** TypeScript monorepo, Next.js web app, Express Gateway (WebSocket hub), BullMQ workers, PostgreSQL (Drizzle ORM), Redis, Modal/E2B sandboxes.

### Sim (sim.so)

Open-source AI workflow automation platform. Users build visual DAG workflows with blocks (agent, function, API, condition, router, etc.). Blocks can use 100+ tool integrations via OAuth. Execution runs a topological sort through the DAG, executing each block with resolved credentials.

**Stack:** TypeScript monorepo (Turborepo), Next.js (app + API), PostgreSQL (Drizzle ORM), isolated-vm worker pool for code execution, optional E2B sandboxes. **No Redis.**

---

## 2. OAuth & Integration Management

### 2.1 Architecture Overview

| Aspect | Proliferate | Sim |
|--------|-------------|-----|
| **OAuth broker** | Nango (3rd-party SaaS) + GitHub App | Self-hosted, no 3rd-party service |
| **Provider count** | ~5 core (GitHub, Sentry, Linear, Jira, Slack) | 30+ providers, ~50 service-level OAuth flows |
| **Token storage** | Nango stores tokens; Proliferate stores references (`connectionId`) | Tokens stored directly in `account` table in own Postgres |
| **Token refresh** | Nango handles refresh automatically | Self-managed refresh with provider-specific logic |
| **Credential sharing** | Org-scoped integrations only | `credentialSet` + `credentialSetMember` tables for team sharing |
| **Encryption** | Slack bot tokens encrypted at rest; Nango tokens never local | Tokens stored in plaintext in `account` table |
| **GitHub auth** | GitHub App installations (primary) + optional Nango GitHub | GitHub OAuth via better-auth genericOAuth |
| **Self-hosting burden** | Must deploy Nango (separate infra: DB, workers, dashboard) | Just set CLIENT_ID + CLIENT_SECRET env vars per provider |

### 2.2 Proliferate's Integration System

**Architecture: Nango-brokered references + GitHub App installations**

Proliferate never stores raw OAuth access tokens for Nango-managed integrations. Instead, it stores a `connectionId` reference and fetches live tokens from Nango at use time.

```
User → Nango Connect UI → Nango stores tokens → Callback → Proliferate stores reference
                                                              ↓
                                                    At runtime: getToken()
                                                              ↓
                                                    Nango API → fresh access_token
```

**Token resolution (`packages/services/src/integrations/tokens.ts`):**

```typescript
export async function getToken(integration: IntegrationForToken): Promise<string> {
  // GitHub App → installation token (JWT → GitHub API, cached 50min)
  if (integration.provider === "github-app" && integration.githubInstallationId) {
    return getInstallationToken(integration.githubInstallationId);
  }

  // Nango → OAuth token from Nango API (never stored locally)
  if (integration.provider === "nango" && integration.connectionId) {
    const nango = getNango();
    const connection = await nango.getConnection(
      integration.integrationId,
      integration.connectionId,
    );
    const credentials = connection.credentials as { access_token?: string };
    if (!credentials.access_token) {
      throw new Error(`No access token available for integration ${integration.integrationId}`);
    }
    return credentials.access_token;
  }

  throw new Error(`Unsupported provider ${integration.provider}`);
}
```

**Integration DB schema (simplified):**

```
integrations table:
  id, organizationId, provider ('nango' | 'github-app'),
  integrationId ('linear' | 'sentry' | 'github' | 'github-app'),
  connectionId (Nango connection ID or 'github-app-{installationId}'),
  githubInstallationId, displayName, status, visibility, createdBy
```

**Slack is separate** — stored in `slack_installations` with encrypted bot token, not in `integrations`:

```
slack_installations table:
  id, organizationId, teamId, teamName, encryptedBotToken,
  botUserId, scopes, status, supportChannelId, ...
```

**Strengths:**
- Nango handles all token refresh lifecycle (less code to maintain)
- Raw tokens never touch Proliferate's database
- GitHub App gives fine-grained repo-scoped permissions
- Visibility system (org/private) with creator-or-admin disconnect authorization

**Weaknesses:**
- Self-hosters must deploy Nango (its own DB, workers, dashboard)
- Only ~5 providers supported (GitHub, Sentry, Linear, Jira, Slack)
- Nango is an additional failure point for token resolution
- GitHub App auth logic duplicated across 3 layers (services, web, gateway)

### 2.3 Sim's Integration System

**Architecture: Self-hosted OAuth with direct token storage**

Sim implements OAuth flows for 30+ providers entirely in-house using better-auth's `genericOAuth` plugin. Tokens are stored directly in the `account` table.

```
User → /api/auth/oauth/{provider}/start → Provider OAuth consent → Callback
                                                                       ↓
                                                          Tokens stored in `account` table
                                                                       ↓
                                                          At runtime: getOAuthToken()
                                                                       ↓
                                                          Check expiry → auto-refresh if needed
```

**Provider configuration (`apps/sim/lib/oauth/oauth.ts`, ~1300 lines):**

```typescript
export const OAUTH_PROVIDERS: Record<string, OAuthProviderConfig> = {
  google: {
    name: 'Google',
    icon: GoogleIcon,
    services: {
      gmail: {
        name: 'Gmail',
        providerId: 'google-email',
        scopes: [
          'https://www.googleapis.com/auth/gmail.send',
          'https://www.googleapis.com/auth/gmail.modify',
          'https://www.googleapis.com/auth/gmail.labels',
        ],
      },
      'google-drive': { ... },
      'google-docs': { ... },
      'google-sheets': { ... },
      'google-calendar': { ... },
      // ... 8+ Google services
    },
  },
  microsoft: {
    services: {
      'microsoft-excel': { ... },
      'microsoft-teams': { ... },
      'microsoft-planner': { ... },
      // ... 6+ Microsoft services
    },
  },
  slack: { ... },
  github: { ... },
  linear: { ... },
  notion: { ... },
  airtable: { ... },
  hubspot: { ... },
  salesforce: { ... },
  jira: { ... },
  // ... 20+ more providers
};
```

**Token refresh (`apps/sim/lib/oauth/oauth.ts`):**

```typescript
export async function refreshOAuthToken(
  providerId: string,
  refreshToken: string
): Promise<{ accessToken: string; expiresIn: number; refreshToken?: string } | null> {
  const config = getProviderAuthConfig(providerId);
  if (!config) return null;

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });

  // Provider-specific auth method selection
  const useBasicAuth = ['reddit', 'spotify', ...].includes(providerId);
  const useBodyCredentials = ['hubspot', 'salesforce', ...].includes(providerId);

  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (useBasicAuth) {
    headers['Authorization'] = 'Basic ' + Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
  }

  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers,
    body: params.toString(),
  });

  const data = await response.json();
  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in || 3600,
    refreshToken: data.refresh_token,
  };
}
```

**Runtime token resolution (`apps/sim/app/api/auth/oauth/utils.ts`):**

```typescript
export async function getOAuthToken(userId: string, providerId: string): Promise<string | null> {
  const connections = await db.select({ ... })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, providerId)))
    .orderBy(desc(account.updatedAt))
    .limit(1);

  const credential = connections[0];

  // Auto-refresh expired tokens
  const shouldAttemptRefresh =
    !!credential.refreshToken && (!credential.accessToken || (tokenExpiry && tokenExpiry < now));

  if (shouldAttemptRefresh) {
    const refreshResult = await refreshOAuthToken(providerId, credential.refreshToken!);
    // ... update DB with new tokens
    return refreshResult.accessToken;
  }

  return credential.accessToken;
}
```

**Credential set sharing (team-level):**

```
credentialSet table:
  id, name, description, workspaceId, ownerId, createdAt

credentialSetMember table:
  id, credentialSetId, userId, role, status ('pending' | 'active'), ...

credentialSetInvitation table:
  id, credentialSetId, email, role, status, invitedBy, ...
```

This allows a team to pool OAuth credentials — e.g., 5 Gmail accounts can share a single webhook path, and the system fans out executions across all members' tokens.

**Strengths:**
- Zero external dependencies for OAuth (no Nango/third-party)
- 30+ providers out of the box
- Simple self-hosting: just CLIENT_ID + CLIENT_SECRET env vars
- Credential set sharing enables team-level OAuth pooling
- Concurrent-refresh recovery (re-reads DB if refresh fails, in case another request already succeeded)

**Weaknesses:**
- Access tokens stored in plaintext in DB (no envelope encryption)
- Must maintain token refresh logic for every provider
- Provider-specific quirks handled case-by-case (Basic Auth for Reddit/Spotify, body credentials for HubSpot/Salesforce, Microsoft refresh token expiry tracking)
- Self-hosters must create OAuth apps with each provider they want to use

### 2.4 Key Differences Summary

| Feature | Proliferate | Sim |
|---------|-------------|-----|
| Token storage | Nango (remote) | Own Postgres (local) |
| Token encryption | N/A (not stored locally) | Plaintext |
| Refresh management | Nango automatic | Self-managed per provider |
| Provider breadth | ~5 | 30+ |
| Self-host OAuth infra | Deploy Nango | CLIENT_ID/SECRET env vars |
| Team credential sharing | Org-scoped integrations | credentialSet with invitations |
| User-scoped tokens | Not yet implemented | Per-user via `account` table |

---

## 3. Trigger & Webhook Systems

### 3.1 Architecture Overview

| Aspect | Proliferate | Sim |
|--------|-------------|-----|
| **Trigger architecture** | Dedicated trigger-service (Express) with BullMQ workers | Next.js API routes with in-app processing |
| **Webhook processing** | Fast-ack + async inbox worker (durable) | Synchronous processing in request handler |
| **Polling** | Poll groups with Redis distributed locks | No polling — webhook-only |
| **Scheduled triggers** | BullMQ repeatable jobs (cron expressions) | No built-in cron triggers |
| **Provider adapters** | Class-based registry (GitHub, Linear, Sentry, Gmail) | Provider-specific auth verification functions |
| **Execution handoff** | Transactional outbox → BullMQ → sandbox session | Direct execution via workflow engine |
| **Queue backend** | Redis + BullMQ | No queue — direct execution |

### 3.2 Proliferate's Trigger System

**Architecture: Dedicated service with durable webhook inbox**

Proliferate's trigger system is a standalone Express service (`apps/trigger-service/`) with multiple async workers, designed for reliability via the "fast-ack" pattern.

```
Webhook → trigger-service HTTP → INSERT webhook_inbox → 200 OK (fast path)
                                        ↓
                    BullMQ worker (every 5s) → claim batch → FOR UPDATE SKIP LOCKED
                                        ↓
                    Resolve integration → Find triggers → Parse events → Match
                                        ↓
                    Atomic: INSERT trigger_event + automation_run + outbox
                                        ↓
                    Outbox dispatcher → BullMQ → Worker → Sandbox session
```

**Entry point (`apps/trigger-service/src/index.ts`):**

```typescript
registerDefaultTriggers({
  nangoSecret: env.NANGO_SECRET_KEY,
  nangoGitHubIntegrationId: env.NEXT_PUBLIC_NANGO_GITHUB_INTEGRATION_ID,
  nangoLinearIntegrationId: env.NEXT_PUBLIC_NANGO_LINEAR_INTEGRATION_ID,
  nangoSentryIntegrationId: env.NEXT_PUBLIC_NANGO_SENTRY_INTEGRATION_ID,
  composioApiKey: env.COMPOSIO_API_KEY,
});

const server = createServer();
const pollGroupWorker = startPollGroupWorker();
const scheduledWorker = startScheduledWorker();
const inboxWorker = await startWebhookInboxWorker();
const gcWorker = await startInboxGcWorker();
await scheduleEnabledPollGroups();
await scheduleEnabledScheduledTriggers();
```

**Webhook inbox worker (`apps/trigger-service/src/webhook-inbox/worker.ts`):**

```typescript
async function processInboxRow(row: WebhookInboxRow): Promise<void> {
  const payload = row.payload;

  // 1. Resolve integration identity
  const connectionId = extractConnectionId(payload);
  if (connectionId) {
    // Nango-forwarded webhooks: resolve via connectionId
    const integration = await integrations.findByConnectionIdAndProvider(connectionId, "nango");
    resolvedIntegrationId = integration.id;
  } else {
    // Direct webhooks: require explicit integrationId
    const integrationId = extractIntegrationId(payload);
    const integration = await integrations.findById(integrationId);
    resolvedIntegrationId = integration.id;
  }

  // 2. Find active webhook triggers for this integration
  const triggerRows = await triggerService.findActiveWebhookTriggers(resolvedIntegrationId);

  // 3. Parse using trigger registry
  const triggerDefs = registry.webhooksByProvider(providerKey);
  const mockReq = { body: payload, headers } as Request;

  for (const triggerDef of triggerDefs) {
    const events = await triggerDef.webhook(mockReq);
    for (const triggerRow of triggerRows) {
      if (triggerRow.provider !== triggerDef.provider) continue;
      await processTriggerEvents(triggerDef, triggerRow, events);
    }
  }
}
```

**Trigger event lifecycle:**

```
queued → processing → completed | failed
  └→ skipped (disabled automation, filter mismatch, dedup, run_create_failed)
```

**Poll groups** handle integration-scoped polling (one API call per org+provider+integration group, fan-out to triggers):

```
trigger_poll_groups table:
  id, organizationId, provider, integrationId, cursor, pollingCron

BullMQ repeatable job (per group) → provider.poll(cursor) → fan-out to triggers
Redis distributed lock per group prevents concurrent polls
```

**Strengths:**
- Durable webhook processing (survives crashes)
- Transactional outbox pattern guarantees consistency
- Polling + webhooks + scheduled triggers in one system
- Proper dedup by (trigger_id, dedup_key)
- Trigger event audit trail
- Row-level locking for concurrent worker safety

**Weaknesses:**
- Requires Redis + BullMQ (operational overhead for self-hosters)
- Complex architecture: trigger-service + workers + queue + outbox dispatcher
- Nango dependency for webhook identity resolution
- Dual provider abstraction layers (class-based + target `ProviderTriggers`)

### 3.3 Sim's Webhook System

**Architecture: Direct processing in Next.js API routes**

Sim's webhook system is simpler — webhooks are registered per-workflow and trigger workflow execution directly.

```
Webhook → /api/webhooks/trigger/[path] → Verify auth → Queue execution
                                                            ↓
                                                  Workflow engine runs DAG
```

**Webhook trigger handler (`apps/sim/app/api/webhooks/trigger/[path]/route.ts`):**

```typescript
export async function POST(request: NextRequest, { params }) {
  const { path } = await params;
  const { body, rawBody } = await parseWebhookBody(request, requestId);

  // Handle provider challenges (Microsoft Graph, WhatsApp, etc.)
  const challengeResponse = await handleProviderChallenges(body, request, requestId, path);
  if (challengeResponse) return challengeResponse;

  // Find all webhooks for this path (supports credential set fan-out)
  const webhooksForPath = await findAllWebhooksForPath({ requestId, path });

  for (const { webhook, workflow } of webhooksForPath) {
    // Verify provider-specific auth (signatures, etc.)
    const authError = await verifyProviderAuth(webhook, workflow, request, rawBody, requestId);
    if (authError) continue;

    // Skip event filtering
    if (shouldSkipWebhookEvent(webhook, body, requestId)) continue;

    // Queue workflow execution
    const response = await queueWebhookExecution(webhook, workflow, body, request, { requestId, path });
    responses.push(response);
  }
}
```

**Key features:**
- Credential set fan-out: multiple webhooks can share a path, each representing a different credential
- Provider-specific auth verification (signatures for GitHub, Slack, etc.)
- Provider challenges (Microsoft Graph validation, WhatsApp verification)
- Event filtering before execution

**No polling, no scheduled triggers** — Sim's trigger system is webhook-only.

### 3.4 Key Differences Summary

| Feature | Proliferate | Sim |
|---------|-------------|-----|
| Durability | Durable inbox (survives crashes) | Synchronous (depends on request) |
| Queue | BullMQ + Redis | No queue |
| Polling | Yes (poll groups with cursors) | No |
| Scheduled | Yes (cron via BullMQ repeatables) | No |
| Dedup | Per (trigger_id, dedup_key) | Not documented |
| Audit trail | trigger_events table with lifecycle | No structured audit |
| Fan-out | Per integration → triggers | Per webhook path → credential sets |
| Provider adapters | Class-based registry with parse/match | Per-provider auth verification functions |
| Self-host complexity | Requires Redis + trigger-service + workers | Just Next.js app |

---

## 4. Agent Tool Execution & OpenCode

### 4.1 Architecture Overview

| Aspect | Proliferate | Sim |
|--------|-------------|-----|
| **Agent runtime** | OpenCode (LLM coding agent) in Modal/E2B sandboxes | LLM-powered blocks in DAG workflows |
| **Tool injection** | OpenCode plugin system (ESM tool files) | Registry of 100+ typed tool configs |
| **Tool execution** | Gateway HTTP callback (sandbox → gateway → result) | Direct function calls with OAuth token injection |
| **Sandbox isolation** | Full VM sandbox per session (Modal/E2B) | Shared process (isolated-vm for code, optional E2B) |
| **Token delivery** | Platform resolves tokens, passes as env vars to sandbox | Platform resolves tokens, passes to tool execute() |
| **Custom tools** | OpenCode plugin tools (verify, save_snapshot, etc.) | User-defined "custom tools" (HTTP endpoints) |

### 4.2 Proliferate's OpenCode Integration

**Architecture: Sandbox-hosted agent with Gateway callback tools**

Proliferate runs OpenCode (an LLM coding agent) inside cloud sandboxes. The agent has access to injected tools that call back to the Gateway via HTTP.

```
OpenCode (in sandbox) → tool.execute() → HTTP POST to Gateway
                                              ↓
                                    Gateway processes tool call
                                              ↓
                                    Returns result to sandbox
```

**Tool injection pattern (`packages/shared/src/opencode-tools/index.ts`):**

Tools are ESM files written to the sandbox filesystem. They use a shared HTTP callback helper:

```typescript
// Callback helper injected into every tool
export const TOOL_CALLBACK_HELPER = `
const GATEWAY_URL = process.env.PROLIFERATE_GATEWAY_URL;
const SESSION_ID = process.env.PROLIFERATE_SESSION_ID;
const AUTH_TOKEN = process.env.SANDBOX_MCP_AUTH_TOKEN;

async function callGatewayTool(toolName, toolCallId, args) {
  const url = GATEWAY_URL + "/proliferate/" + SESSION_ID + "/tools/" + toolName;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + AUTH_TOKEN,
        },
        body: JSON.stringify({ tool_call_id: toolCallId, args }),
      });
      return await res.json();
    } catch (err) {
      // Retry on ECONNRESET (Snapshot TCP Drop)
      const isRetryable = err?.cause?.code === "ECONNRESET" || ...;
      if (isRetryable && attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, RETRY_BASE_MS * Math.pow(2, attempt)));
        continue;
      }
      return { success: false, result: "Network error: " + err?.message };
    }
  }
}
`;
```

**Available tools (injected into sandbox):**

| Tool | Purpose |
|------|---------|
| `request_env_variables` | Request env vars/secrets from user via UI |
| `verify` | Upload verification evidence (screenshots, test logs) to S3 |
| `save_snapshot` | Save sandbox filesystem snapshot |
| `save_service_commands` | Configure auto-start commands for future sessions |
| `save_env_files` | Record env file generation spec for session boot |
| `automation.complete` | Mark an automation run as complete |

**Plugin system (`packages/shared/src/sandbox/config.ts`):**

```typescript
// Minimal plugin - all streaming happens via SSE (DO pulls from OpenCode)
export const PLUGIN_MJS = `
export const ProliferatePlugin = async ({ project, directory }) => {
  // Return empty hooks - all events flow via SSE from OpenCode to DO
  return {};
};
`;
```

**Key design: SSE-based event streaming.** The Gateway polls OpenCode's SSE endpoint for events (tokens, tool calls, results) rather than having the sandbox push events. This simplifies the sandbox network topology but means the Gateway must actively poll.

**Integration token delivery to sandbox:**

```
Session creation → resolve org integrations → getToken() per integration
                                                    ↓
                                    Generate env var name: {TYPE}_ACCESS_TOKEN_{shortId}
                                                    ↓
                                    Pass as environment variables to sandbox
```

The sandbox receives tokens as env vars (e.g., `LINEAR_ACCESS_TOKEN_abc12345`). The agent can use these directly in CLI tools or pass them to MCP servers.

### 4.3 Sim's Tool Execution System

**Architecture: DAG workflow executor with inline tool calls**

Sim executes tools directly within workflow blocks. Each tool is a typed configuration with an execution function that receives resolved OAuth tokens.

```
Workflow trigger → DAG Executor → Block handler → Tool execute()
                                                       ↓
                                          OAuth token resolved → API call
                                                       ↓
                                          Result → next block in DAG
```

**Tool execution (`apps/sim/tools/index.ts`, simplified):**

```typescript
export async function executeTool(
  toolId: string,
  params: Record<string, any>,
  context: ExecutionContext
): Promise<ToolResponse> {
  // 1. Resolve tool config
  const tool = await getToolAsync(normalizeToolId(toolId));
  if (!tool) throw new Error(`Unknown tool: ${toolId}`);

  // 2. Resolve OAuth token if needed
  if (tool.oauthConfig) {
    const token = await getOAuthToken(context.userId, tool.oauthConfig.providerId);
    if (!token) throw new Error(`Missing OAuth token for ${tool.oauthConfig.providerId}`);
    params._oauth = { accessToken: token, ...tool.oauthConfig };
  }

  // 3. Execute the tool
  const result = await tool.execute(params);
  return result;
}
```

**Tool definition pattern (example: Gmail send):**

```typescript
export const gmail_send: ToolConfig = {
  id: 'gmail_send',
  name: 'Send Email',
  description: 'Send an email via Gmail',
  oauthConfig: {
    providerId: 'google-email',
    requiredScopes: ['https://www.googleapis.com/auth/gmail.send'],
  },
  parameters: {
    to: { type: 'string', required: true },
    subject: { type: 'string', required: true },
    body: { type: 'string', required: true },
  },
  async execute(params) {
    const { accessToken } = params._oauth;
    const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ raw: encodeEmail(params) }),
    });
    return { success: true, data: await response.json() };
  },
};
```

**Code execution isolation:**

Sim uses **isolated-vm** (V8 isolate worker pool) for running user-defined code blocks:

```typescript
// Worker pool with fair scheduling
const workerPool = new IsolatedVmWorkerPool({
  maxWorkers: 4,
  memoryLimitMb: 128,
  timeoutMs: 30000,
});

// Each execution gets an isolated V8 context
const result = await workerPool.execute({
  code: userCode,
  context: { inputs, env },
});
```

For heavier workloads, Sim also supports **E2B sandboxes** as an optional alternative.

**DAG executor (`apps/sim/executor/execution/executor.ts`):**

```typescript
export class DAGExecutor {
  async execute(workflow: Workflow, inputs: Record<string, any>): Promise<ExecutionResult> {
    const graph = buildDependencyGraph(workflow);
    const readyQueue = getSourceBlocks(graph);

    while (readyQueue.length > 0) {
      const block = readyQueue.shift()!;
      const handler = getHandler(block.type); // agent, function, api, condition, router, ...

      const result = await handler.execute(block, {
        inputs: resolveBlockInputs(block, graph),
        credentials: await resolveCredentials(block),
        ...context,
      });

      markComplete(block, result);
      enqueueReady(graph, readyQueue); // blocks whose deps are now satisfied
    }

    return collectResults(graph);
  }
}
```

**13 block handler types:** agent, function, api, condition, router, evaluator, webhook, knowledge, workflow_executor, table, custom_tool, and more.

### 4.4 Key Differences Summary

| Feature | Proliferate | Sim |
|---------|-------------|-----|
| Execution model | Single LLM agent in isolated sandbox | DAG of typed blocks with tool calls |
| Tool discovery | Agent reads tool descriptions at boot | Block config declares required tools |
| Token delivery | Env vars in sandbox | Injected into tool execute() params |
| Code isolation | Full VM (Modal/E2B) | isolated-vm V8 isolates |
| Tool-platform communication | HTTP callback to Gateway | Direct function call |
| Network model | Sandbox SSE → Gateway polls events | In-process (no network boundary) |
| Snapshot/restore | Full filesystem snapshots | N/A (stateless workflows) |
| User interaction | Tools request info from user via UI | Block inputs defined at design time |

---

## 5. Self-Hosting Trade-offs

### 5.1 Infrastructure Requirements

**Proliferate self-hosting stack:**
- PostgreSQL (metadata, billing)
- Redis + BullMQ (job queues, locks, polling)
- Gateway service (Express, WebSocket)
- Trigger service (Express, BullMQ workers)
- Worker service (BullMQ consumers)
- Web app (Next.js)
- Nango (separate: own DB, workers, dashboard) — for OAuth
- Modal or E2B account (for sandboxes)

**Sim self-hosting stack:**
- PostgreSQL (everything)
- Next.js app (that's it)
- Optional: E2B account (for code execution sandboxes)

### 5.2 OAuth Self-Hosting Comparison

**Proliferate with Nango:**
1. Deploy Nango infrastructure (Docker compose with DB, workers, dashboard)
2. Configure Nango integration IDs for each provider
3. Set `NANGO_SECRET_KEY` in Proliferate
4. Users connect via Nango's hosted connect UI

**Sim without external OAuth service:**
1. Create OAuth apps with each desired provider (Google, GitHub, Slack, etc.)
2. Set `{PROVIDER}_CLIENT_ID` and `{PROVIDER}_CLIENT_SECRET` env vars
3. OAuth flows work through Sim's built-in routes
4. Token refresh handled automatically

**The trade-off:** Sim requires ~25 individual OAuth app registrations for full provider coverage, but each is just two env vars. Proliferate requires deploying an entire Nango instance but gets automatic token refresh and provider management "for free."

### 5.3 Advisor Feedback Context

Our technical advisor identified the Nango dependency as a significant self-hosting burden and recommended:

> **Postgres Credential Vault + MCP Connector Architecture:** For the 3-5 core integrations you *must* have natively (e.g., GitHub, Slack), drop Nango. Use a standard library like Auth.js and store tokens directly in Postgres using AES-256-GCM envelope encryption. For the other 30+ integrations, treat them strictly as MCP servers.

Sim's approach validates this recommendation — they successfully manage 30+ providers without any external OAuth service, though they lack encryption at rest for stored tokens.

---

## 6. Recommendations

### 6.1 What to Learn from Sim

1. **Self-hosted OAuth is achievable at scale.** Sim proves you can support 30+ OAuth providers without Nango. The code is ~1300 lines for provider configs + ~500 lines for token refresh/resolution utilities.

2. **Credential set sharing is a killer feature for teams.** Sim's `credentialSet` + `credentialSetMember` model enables team-level OAuth credential pooling with invitations. Proliferate has nothing equivalent.

3. **Concurrent-refresh recovery pattern.** When a token refresh fails, Sim re-reads the DB to check if another concurrent request already refreshed successfully. This handles the thundering herd problem elegantly.

4. **Provider-specific refresh quirks are manageable.** Sim handles ~4 categories of refresh: Basic Auth (Reddit, Spotify), body credentials (HubSpot, Salesforce), Bearer header (Zoom, Shopify), and standard. This is finite and well-bounded complexity.

### 6.2 What Proliferate Does Better

1. **Durable webhook processing.** Proliferate's fast-ack + inbox worker pattern guarantees no webhook is lost, even across crashes. Sim processes webhooks synchronously in the request handler.

2. **Polling + scheduled triggers.** Proliferate supports poll groups (for providers without webhooks) and cron-based scheduled triggers. Sim is webhook-only.

3. **Trigger event audit trail.** Proliferate tracks the full lifecycle of every trigger event (`queued → processing → completed/failed/skipped`) with structured reasons. This is essential for debugging automation failures.

4. **Transactional outbox.** Proliferate guarantees that trigger events, automation runs, and queue jobs are created atomically. Sim's direct execution doesn't need this but also can't guarantee it.

5. **Integration token isolation.** Proliferate never stores raw OAuth tokens — even if the DB is breached, tokens aren't exposed. Sim stores tokens in plaintext.

### 6.3 Concrete Migration Path: Drop Nango

If Proliferate adopted Sim's self-hosted OAuth approach:

1. **Add AES-256-GCM envelope encryption** to the `integrations` table for stored tokens (Sim doesn't do this — it's a must-have for Proliferate since the repo is public and security-conscious).

2. **Port Sim's provider config pattern** — the `OAUTH_PROVIDERS` map with per-provider scopes, auth URLs, and token URLs. Start with the 5 core providers (GitHub, Linear, Sentry, Jira, Slack) and expand.

3. **Replace Nango connect UI** with Proliferate-native OAuth redirect flows using better-auth's `genericOAuth` (Proliferate already uses better-auth for user auth).

4. **Port `refreshOAuthToken()`** with provider-specific refresh categories.

5. **Add `getToken()` branch** for self-managed tokens that checks expiry and auto-refreshes.

6. **Keep GitHub App path** — it's already self-hosted and provides superior repo-scoped permissions.

7. **Add credential set tables** for team-level OAuth sharing (borrow from Sim's schema).

**Estimated effort:** The core OAuth migration is ~2000-3000 lines of new code, mostly ported from Sim. The Nango dependency and all Nango-specific code can then be removed.

### 6.4 What NOT to Borrow from Sim

1. **Sim's workflow execution model** — Proliferate's sandbox-based agent execution is fundamentally different and more powerful for coding tasks. Sim's DAG executor is great for workflow automation but doesn't apply to interactive coding sessions.

2. **Sim's lack of durability** — Don't downgrade the trigger system's durable inbox pattern. Sim's synchronous webhook processing works for their use case but would be a regression for Proliferate.

3. **Sim's plaintext token storage** — Always encrypt tokens at rest. Use the existing `@proliferate/shared/crypto` AES-256-GCM utilities that are already used for Slack bot tokens.

4. **Sim's isolated-vm approach** — Proliferate's full VM sandboxes provide much stronger isolation and a richer environment for coding agents. isolated-vm is great for running small code snippets but not for full development environments.
