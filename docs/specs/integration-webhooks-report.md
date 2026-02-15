# Replacing Nango: Full Integration Architecture Report

> Decision report — February 2026

## Why This Report Exists

Proliferate uses **Nango** (ELv2-licensed, not MIT-compatible) as an OAuth broker for Sentry, Linear, and optionally GitHub. Nango handles OAuth flows, token storage/refresh, and webhook forwarding. We need to replace it because:

1. **License**: ELv2 is not MIT/Apache/BSD-compatible. Proliferate is MIT.
2. **Self-hosting**: Nango's free self-hosted tier covers auth + proxy only. Webhook forwarding is paid. Self-hosted customers can't use trigger-based integrations without paying Nango.
3. **Scale**: We'll need many integrations over time. Nango charges per-connection at scale.

This report covers the **full integration architecture** — not just event ingestion, but the complete picture of how external services connect to Proliferate: OAuth, token management, agent tool access (actions + MCP connectors), triggers/automations, and how the gateway orchestrates it all.

---

## Part 1: Current Architecture (How It All Fits Together)

### The Two Integration Models

Proliferate has two parallel models for connecting to external services:

```
Model A: OAuth Integrations (static adapters)
  User connects Sentry/Linear/GitHub/Slack via OAuth
  → Token stored (Nango or direct)
  → Agent calls actions via hand-written adapters
  → Triggers listen for events (webhooks/polling)

Model B: MCP Connectors (dynamic discovery)
  Admin adds an MCP server URL in Settings → Tools
  → Auth via org secret (API key)
  → Agent discovers tools at runtime via MCP protocol
  → Tools flow through same risk/approval pipeline as Model A
```

Both models converge at the **gateway Actions pipeline**, which is the single entry point for all agent-initiated external operations.

### How the Gateway Merges Both Models

The gateway's `GET /:sessionId/actions/available` route merges both sources into one list for the agent:

```
Gateway: GET /available
    │
    ├── Static Adapters (OAuth)
    │   session → session_connections → integrations table
    │   → filter to active + has adapter (linear, sentry, slack)
    │   → return { integration: "linear", actions: [...] }
    │
    └── MCP Connectors (org-scoped)
        session → org → org_connectors table
        → for each enabled connector: MCP tools/list (cached 5min)
        → return { integration: "connector:<uuid>", actions: [...] }
    │
    ▼
    Merged response: { integrations: [...all of the above...] }
```

**Source:** `apps/gateway/src/api/proliferate/http/actions.ts`

### How Tokens Flow (Today)

```
Agent calls: proliferate actions run --integration linear --action create_issue

Gateway POST /invoke
    │
    ├── Static adapter path:
    │   session_connections → integration row → getToken()
    │       ├── provider=github-app → generate JWT → installation token (cached 50min)
    │       └── provider=nango → nango.getConnection(connectionId) → access_token
    │   adapter.execute(action, params, token)
    │
    └── Connector path:
        session → org → org_connectors → connector row
        secrets.resolveSecretValue(orgId, secretKey) → decrypted API key
        MCP tools/call(toolName, args) with secret in auth header
```

**Source:** `packages/services/src/integrations/tokens.ts`, `apps/gateway/src/api/proliferate/http/actions.ts`

### How Triggers Flow (Today)

```
Event ingestion (three paths):

1. Nango-forwarded webhooks (Sentry, Linear, GitHub via Nango):
   Provider → Nango → POST /webhooks/nango → parse envelope → find triggers → create run

2. Direct webhooks (GitHub App, PostHog, Custom):
   Provider → POST /api/webhooks/{type}/{id} → verify signature → find triggers → create run

3. Polling (Linear, Gmail):
   BullMQ cron → poll provider API with cursor → find new items → create run

All three converge at:
   processTriggerEvents() → filter → dedup → createRunFromTriggerEvent()
   → transactional outbox → automation run pipeline
```

**Source:** `apps/trigger-service/`, `apps/web/src/app/api/webhooks/`, `packages/triggers/`

### What Nango Actually Touches

| Subsystem | Nango's Role | Can Be Replaced? |
|-----------|-------------|-----------------|
| **OAuth flow** (Sentry, Linear) | Hosts OAuth UI, handles handshake | Yes — use Arctic (MIT) for OAuth, store tokens ourselves |
| **Token storage + refresh** | Stores tokens, auto-refreshes | Yes — encrypted Postgres table + BullMQ refresh job |
| **Token resolution** | `nango.getConnection()` → access_token | Yes — read directly from our own token table |
| **Webhook forwarding** (triggers) | Receives provider webhooks, forwards to us | Yes — polling (default) + direct webhooks (optional) |
| **Webhook verification** | Nango HMAC-SHA256 on forwarded payload | Replaced by provider-native signatures or polling |

What Nango does NOT touch:
- MCP connectors (entirely separate, org secrets)
- GitHub App (separate OAuth flow, direct webhooks)
- Slack (separate OAuth flow, encrypted bot tokens)
- Actions pipeline (risk/approval/grants)
- Custom/PostHog/automation webhooks

---

## Part 2: The Target Architecture

### 2.1 OAuth Model (Replacing Nango)

Replace Nango with a thin first-party OAuth layer using **Arctic** (MIT, 50+ provider presets, lightweight).

```
Today:
  User → "Connect Sentry" → Nango UI → Nango's OAuth app →
    Nango stores token → Proliferate stores connection_id only →
    getToken() calls nango.getConnection()

Target:
  User → "Connect Sentry" → Proliferate's own OAuth app →
    Proliferate stores encrypted token in Postgres →
    getToken() reads from own DB
```

**What changes:**

| Component | Today | Target |
|-----------|-------|--------|
| OAuth handshake | Nango SDK `createConnectSession()` | Arctic per-provider OAuth flow |
| Token storage | Nango's database (opaque) | New `oauth_tokens` table in Postgres, encrypted at rest |
| Token refresh | Nango auto-refreshes internally | BullMQ job checks `expires_at`, refreshes proactively |
| `getToken()` | Calls `nango.getConnection()` | Reads from own DB (same interface, different impl) |
| `integrations` table | `provider='nango'`, `connection_id` = Nango's ID | `provider='oauth'`, `connection_id` = our own ID |

**What stays the same:**
- `IntegrationForToken` interface — unchanged, just a new `provider` value
- `resolveTokens()` — unchanged, still calls `getToken()` per integration
- `getEnvVarName()` — unchanged
- All downstream consumers (gateway, worker, trigger-service) — unchanged
- GitHub App flow — already first-party, no change
- Slack flow — already first-party, no change

**Self-hosting story:** Self-hosters register their own OAuth apps with each provider (e.g., create a Sentry Internal Integration, set client ID/secret as env vars). Same pattern as GitHub App today.

**Key library:** [Arctic](https://arcticjs.dev/) (MIT) — handles authorization URLs, callback handling, code-for-token exchange for 50+ providers. ~50 lines per provider config.

### 2.2 MCP Connectors (Already Built — Expand)

The org-scoped MCP connector catalog already works and is the right model for shallow/API-key integrations.

```
Settings → Tools UI
    │
    ├── Preset: Context7, PostHog, Firecrawl, Neon, Stripe, Playwright
    └── Custom: any remote HTTP MCP server
        │
        ▼
    org_connectors table (org-scoped)
        │
    Gateway loads at session runtime → MCP tools/list → merged into /available
        │
    Agent calls tool → POST /invoke → risk/approval pipeline → MCP tools/call
```

**Source:** `packages/shared/src/connectors.ts`, `packages/services/src/connectors/`, `packages/services/src/actions/connectors/client.ts`

**What exists today:**
- `org_connectors` table with CRUD
- Settings → Tools UI with quick-setup presets + advanced form
- MCP client (`@modelcontextprotocol/sdk`, MIT) — stateless, per-call
- Risk derivation from MCP tool annotations (`readOnlyHint` → read, `destructiveHint` → danger)
- Secret resolution via `secrets.resolveSecretValue()`
- In-memory tool cache (5min TTL per session)
- Full risk/approval/grant/audit pipeline

**Where MCP connectors fit in the bigger picture:**

MCP connectors are **the scaling path for agent tool access**. As vendors ship remote MCP servers (Sentry, Atlassian, Stripe already have them), each one becomes a zero-code integration — the user adds the URL and API key in Settings → Tools, and the agent immediately discovers the tools.

MCP connectors do NOT solve:
- **Triggers/event ingestion** — MCP is request-response. No push/subscribe model. You still need polling or webhooks to know "a new Sentry issue appeared."
- **Deep OAuth flows** — MCP servers typically authenticate via API key, not OAuth. For integrations that require OAuth (user-specific scoped access), you still need the OAuth layer.

**The relationship between OAuth integrations and MCP connectors:**

| Need | OAuth Integration | MCP Connector |
|------|-------------------|---------------|
| Agent reads/writes data | Static adapter (Linear/Sentry/Slack) | MCP tools/call |
| User-specific OAuth scope | Required | Not supported (API key = org-level) |
| Triggers (event ingestion) | Required (token for polling, webhook verification) | Not supported |
| Token refresh | Required | Not needed (API keys don't expire) |
| Setup effort per provider | ~200 lines (OAuth config + adapter) | Zero code (user-configured URL) |
| Self-hosting setup | Register OAuth app per provider | Provide API key |

**Decision:** Both models coexist. OAuth integrations for deep integrations that need triggers + user-scoped access. MCP connectors for tool access where an API key suffices. Over time, as MCP ecosystem matures, some integrations may shift from OAuth → MCP (e.g., if Sentry's MCP server becomes feature-complete, you might not need the hand-written Sentry adapter).

### 2.3 Actions (Agent Tool Access)

The Actions pipeline is unchanged by replacing Nango. It already supports both models:

```
Agent: proliferate actions run --integration <x> --action <y> --params '{...}'
                                │
                ┌───────────────┴───────────────┐
                ▼                               ▼
        Static Adapter                  Connector (MCP)
        (linear, sentry, slack)         (connector:<uuid>)
                │                               │
        Token via getToken()            Secret via resolveSecretValue()
                │                               │
        adapter.execute()               MCP tools/call
                │                               │
                └───────────────┬───────────────┘
                                ▼
                    Same risk/approval/grant pipeline
                    Same invocation lifecycle
                    Same result redaction + truncation
                    Same WebSocket broadcast to UI
```

**What Nango replacement changes for Actions:** Only the `getToken()` implementation. The Nango branch:

```typescript
// packages/services/src/integrations/tokens.ts (line 76-89)
if (integration.provider === "nango" && integration.connectionId) {
  const nango = getNango();
  const connection = await nango.getConnection(...);
  return credentials.access_token;
}
```

Becomes:

```typescript
if (integration.provider === "oauth" && integration.connectionId) {
  return getTokenFromDb(integration.connectionId); // reads encrypted token from our DB
}
```

Everything downstream — adapters, gateway invoke, approve, deny, grants — is unaffected.

**Scaling to new adapters vs. using MCP:**

For a new provider (e.g., Jira), you have two paths:

| Path | What you build | When to use |
|------|---------------|-------------|
| **Add as MCP connector** | Nothing (user configures in Settings → Tools) | Provider has a good MCP server; only need tool access, no triggers |
| **Add as OAuth integration** | OAuth config (~50 lines) + polling adapter (~150 lines) + optional action adapter (~200 lines) | Need triggers, OR need user-scoped OAuth access, OR provider has no MCP server |

Most new providers will start as MCP connectors (zero code) and only get promoted to full OAuth integrations if triggers or deep access is needed.

### 2.4 Triggers (Event Ingestion)

This is where the Nango replacement has the most impact. The recommendation is **polling as default, direct webhooks as optional**.

#### Why Polling as Default

1. **Best self-hosting story.** Polling = outbound HTTP only. No inbound connectivity required. A self-hosted Proliferate behind a corporate firewall just works — no tunneling, no public DNS, no firewall exceptions.

2. **Best UX.** Zero configuration after OAuth connect. User creates trigger, polling starts automatically. No "go to Sentry → Settings → Webhooks → paste this URL."

3. **Latency is acceptable.** Proliferate triggers drive automations — issue triage, code fixes, notifications. A 30-60 second delay is imperceptible. These are not real-time alerting flows.

4. **Already proven.** Linear polling works today. The BullMQ worker, Redis cursor, processing pipeline are all stable.

#### Current Webhook/Polling Architecture

```
                            ┌─────────────────────────────────────────┐
                            │           Trigger Service               │
                            │                                         │
  Inbound webhooks ────────►│  POST /webhooks/nango  (Nango envelope) │ ◄── REMOVE
                            │  POST /webhooks/:provider (reserved)    │
                            │                                         │
  Polling ─────────────────►│  polling/worker.ts (BullMQ POLLING)     │ ◄── EXPAND
                            │    ├── Redis cursor state               │
                            │    ├── Provider poll() calls            │
                            │    └── processTriggerEvents()           │
                            └────────────────┬────────────────────────┘
                                             │
                            ┌────────────────▼────────────────────────┐
                            │         Web App Webhook Routes          │
                            │                                         │
                            │  /api/webhooks/github-app  (direct)     │ ◄── KEEP
                            │  /api/webhooks/custom/{id} (direct)     │ ◄── KEEP
                            │  /api/webhooks/posthog/{id} (direct)    │ ◄── KEEP
                            │  /api/webhooks/automation/{id} (direct) │ ◄── KEEP
                            │  /api/webhooks/nango (duplicate)        │ ◄── REMOVE
                            │  /api/webhooks/sentry/{id} (new)        │ ◄── ADD (optional)
                            │  /api/webhooks/linear/{id} (new)        │ ◄── ADD (optional)
                            └────────────────┬────────────────────────┘
                                             │
                                             ▼
                            processTriggerEvents() → filter → dedup →
                            createRunFromTriggerEvent() → outbox → automation run
```

#### Target Trigger Flow

```
Default (polling):
  BullMQ POLLING queue (60s interval per trigger)
      │
      ├── SentryPollingTrigger.poll(token, config, cursor)
      │     GET /api/0/organizations/{org}/issues/?query=is:unresolved&sort=date&cursor=...
      │
      ├── LinearPollingTrigger.poll(token, config, cursor)
      │     POST https://api.linear.app/graphql (issues query with cursor)
      │
      └── Future providers: JiraPollingTrigger, PagerDutyPollingTrigger, etc.
      │
      ▼
  processTriggerEvents() → filter → dedup → create run

Optional (direct webhooks, user-configured):
  Provider → POST /api/webhooks/{provider}/{triggerId}
      │
      ├── Verify provider-native signature (Sentry-Hook-Signature, Linear-Signature, etc.)
      │   (verification logic already exists in packages/triggers/src/{provider}.ts)
      │
      └── Parse raw payload via existing TriggerProvider.parseWebhook()
      │
      ▼
  processTriggerEvents() → filter → dedup → create run
```

#### Rate Limit Budget for Polling

| Provider | Rate Limit | 1 poll/min budget | 10 triggers/org | Safe? |
|----------|-----------|-------------------|-----------------|-------|
| Sentry | 40 req/s per org token | 0.017 req/s | 0.17 req/s | Trivially safe |
| Linear | 1500 req/hr complexity | 0.017 req/s | 0.17 req/s | Trivially safe |
| GitHub | 5000 req/hr per install | 0.017 req/s | 0.17 req/s | Trivially safe |
| Jira | 10 req/s per user | 0.017 req/s | 0.17 req/s | Trivially safe |

Rate limiting only matters at ~100+ active triggers per org per provider, which is an unrealistic scenario. For safety: configurable poll interval (default 60s, min 30s), exponential backoff on 429s, per-org concurrency limit.

#### What the Trigger Adapter Code Looks Like (Existing vs. New)

**Today** — Sentry webhook via Nango (`sentry-nango.ts`):
```typescript
// Unwrap Nango envelope, verify Nango signature, delegate to SentryProvider
async webhook(req: Request): Promise<TriggerEvent[]> {
  const rawBody = getRawBody(req);
  const signature = req.headers["x-nango-hmac-sha256"];
  if (!verifyNangoSignature(rawBody, signature, this.nangoSecret)) throw new Error("Invalid signature");

  const forward = parseNangoForwardWebhook(req);  // Nango-specific envelope parsing
  if (!forward) return [];

  const items = SentryProvider.parseWebhook(forward.payload);  // ← reused
  return items.map(item => this.toEvent(item, forward.connectionId));
}
```

**Target** — Sentry polling (new `SentryPollingTrigger`):
```typescript
// Call Sentry REST API directly with our own OAuth token
async poll(connection: OAuthConnection, config: SentryConfig, cursor: string | null): Promise<PollResult> {
  const url = `https://sentry.io/api/0/organizations/${config.orgSlug}/issues/?query=is:unresolved&sort=date`;
  const resp = await fetch(cursor ? `${url}&cursor=${cursor}` : url, {
    headers: { Authorization: `Bearer ${connection.accessToken}` },
  });
  const issues = await resp.json();
  const newCursor = parseLinkHeader(resp.headers.get("Link")); // Sentry uses Link header pagination

  const events = issues.map(issue => SentryProvider.parseWebhook({ data: { issue } })).flat();  // ← reused
  return { events: events.map(item => this.toEvent(item)), cursor: newCursor };
}
```

The `SentryProvider` parsing, filtering, dedup, and context extraction logic is fully reused — only the ingestion mechanism changes.

---

## Part 3: Full System Diagram (Target State)

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                            INTEGRATION LAYER                                     │
│                                                                                  │
│  ┌─────────────────────────────────┐  ┌─────────────────────────────────────┐    │
│  │  First-Party OAuth Core         │  │  MCP Connector Catalog              │    │
│  │  (replaces Nango)               │  │  (already built)                    │    │
│  │                                 │  │                                     │    │
│  │  Providers:                     │  │  Settings → Tools UI                │    │
│  │  • GitHub App (existing)        │  │  org_connectors table               │    │
│  │  • Sentry OAuth (Arctic)        │  │  Presets: Context7, PostHog,        │    │
│  │  • Linear OAuth (Arctic)        │  │           Firecrawl, Neon, Stripe   │    │
│  │  • Slack OAuth (existing)       │  │  + Custom MCP servers               │    │
│  │  • Jira, PagerDuty, etc.       │  │                                     │    │
│  │                                 │  │  Auth: org secret (API key)         │    │
│  │  Token store: encrypted PG     │  │  via secrets.resolveSecretValue()   │    │
│  │  Token refresh: BullMQ job     │  │                                     │    │
│  │  Self-host: register own apps  │  │  Self-host: provide own API keys    │    │
│  └────────────┬────────────────────┘  └──────────────┬──────────────────────┘    │
│               │                                      │                           │
│  ┌────────────▼──────────────────────────────────────▼──────────────────────┐    │
│  │                    Unified Token Resolution                              │    │
│  │                    getToken() — same interface as today                  │    │
│  │                                                                         │    │
│  │  provider=github-app → JWT → installation token (cached 50min)          │    │
│  │  provider=oauth      → read encrypted token from PG (NEW)               │    │
│  │  provider=nango      → nango.getConnection() (REMOVED)                  │    │
│  │  connector:<uuid>    → secrets.resolveSecretValue() (existing)          │    │
│  └────────────┬──────────────────────────────────────┬──────────────────────┘    │
│               │                                      │                           │
│  ┌────────────▼──────────────────┐  ┌────────────────▼──────────────────────┐    │
│  │  TRIGGERS                     │  │  ACTIONS (Agent Tool Access)          │    │
│  │  (event ingestion)            │  │                                       │    │
│  │                               │  │  Static Adapters:                     │    │
│  │  Default: Polling             │  │  • linear (5 actions)                 │    │
│  │  • SentryPollingTrigger       │  │  • sentry (5 actions)                 │    │
│  │  • LinearPollingTrigger       │  │  • slack (1 action)                   │    │
│  │  • JiraPollingTrigger (new)   │  │  • future: jira, pagerduty, etc.     │    │
│  │  • BullMQ + Redis cursors     │  │  → Token via getToken()              │    │
│  │                               │  │                                       │    │
│  │  Optional: Direct Webhooks    │  │  MCP Connector Actions:              │    │
│  │  • /api/webhooks/sentry/{id}  │  │  • Any org_connector's tools         │    │
│  │  • /api/webhooks/linear/{id}  │  │  • Discovered via MCP tools/list     │    │
│  │  • /api/webhooks/github-app   │  │  → Secret via resolveSecretValue()   │    │
│  │  • /api/webhooks/custom/{id}  │  │                                       │    │
│  │  • /api/webhooks/posthog/{id} │  │  Both share:                         │    │
│  │                               │  │  • Risk classification (read/write/  │    │
│  │  All converge at:             │  │    danger)                            │    │
│  │  processTriggerEvents()       │  │  • Grant system (CAS)                │    │
│  │  → filter → dedup →           │  │  • Approval pipeline                 │    │
│  │  createRunFromTriggerEvent()  │  │  • Result redaction + audit          │    │
│  │  → outbox → automation run    │  │  • WebSocket broadcast               │    │
│  └───────────────────────────────┘  └───────────────────────────────────────┘    │
│                                                                                  │
│  All orchestrated by the GATEWAY:                                                │
│  apps/gateway/src/api/proliferate/http/actions.ts                                │
│  • GET  /available     — merges adapters + connectors                            │
│  • POST /invoke        — risk eval → execute (adapter or MCP)                    │
│  • POST /approve|deny  — human-in-the-loop                                      │
│  • GET  /grants        — reusable permissions                                    │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## Part 4: Adding a New Provider (End-to-End Example)

### Example: Adding Jira

**Step 1: Is there an MCP server?**

Atlassian ships a remote MCP server. If the user only needs agent tool access (read/create issues), they add it as a connector in Settings → Tools. Zero code needed.

**Step 2: Do we need triggers?**

Yes — "when a new Jira issue is created, run an automation." MCP can't push events, so we need a polling trigger.

**Step 3: Do we need OAuth?**

Yes — Jira's API requires OAuth 2.0 (3LO) for user-scoped access. API keys are limited to Jira Data Center, not Cloud.

**What to build:**

| Component | Effort | Files |
|-----------|--------|-------|
| OAuth provider config (Arctic) | ~50 lines | `packages/services/src/integrations/providers/jira.ts` |
| Polling trigger adapter | ~150 lines | `packages/triggers/src/service/adapters/jira.ts` |
| Action adapter (optional) | ~200 lines | `packages/services/src/actions/adapters/jira.ts` |
| Direct webhook route (optional) | ~100 lines | `apps/web/src/app/api/webhooks/jira/[triggerId]/route.ts` |
| **Total** | **~500 lines** | |

**What's free:**
- Token storage/refresh (shared OAuth infrastructure)
- Polling infrastructure (BullMQ worker, Redis cursors)
- Trigger processing pipeline (filter, dedup, outbox)
- Risk/approval/grant pipeline (if adding action adapter)
- UI for trigger configuration (generic trigger form)

---

## Part 5: Decisions Summary

| Question | Decision | Rationale |
|----------|----------|-----------|
| **Replace Nango OAuth?** | Yes — Arctic (MIT) + encrypted PG token store | License-compatible, self-hostable, no vendor dependency |
| **Replace Nango webhook forwarding?** | Yes — polling (default) + direct webhooks (optional) | Self-hosting works behind firewalls, zero config UX |
| **Keep MCP connectors?** | Yes — expand as the scaling path for tool access | Zero-code integrations, growing vendor ecosystem |
| **Keep static action adapters?** | Yes — for deep integrations needing OAuth tokens | Linear/Sentry/Slack need user-scoped API access |
| **How to add new providers?** | MCP connector first (zero code). Promote to OAuth + polling only if triggers or deep access needed | Fastest path to value, incremental investment |
| **Primary event ingestion** | Polling (cursor-based, 60s interval) | Self-hostable, zero config, proven infrastructure |
| **Secondary event ingestion** | Direct webhooks (opt-in, user configures in provider) | Real-time for power users with public URLs |
| **Self-hosting token management** | Self-hosters register their own OAuth apps | Same pattern as GitHub App today |

---

## Part 6: Migration Path

### Phase 1: First-Party OAuth Core (~2 weeks)

1. Build token storage table (`oauth_tokens`) with encryption at rest
2. Build token refresh BullMQ job
3. Add Arctic-based OAuth flows for Sentry, Linear
4. Update `getToken()` to read from own DB for `provider='oauth'`
5. New integrations use first-party flow. Existing Nango integrations keep working.

### Phase 2: Polling Triggers (~1 week)

1. `SentryPollingTrigger` — polls Sentry REST API with cursor pagination
2. `LinearPollingTrigger` — wraps existing `LinearProvider.poll()` logic
3. Update `registerDefaultTriggers()` to register polling adapters
4. Default new triggers to polling mode in UI

### Phase 3: Optional Direct Webhooks (~1 week, per provider)

1. `POST /api/webhooks/sentry/{triggerId}` — verify `Sentry-Hook-Signature`
2. `POST /api/webhooks/linear/{triggerId}` — verify `Linear-Signature`
3. UI: "Real-time (webhook)" mode shows URL to configure

### Phase 4: Remove Nango (~1 week)

1. Remove `packages/triggers/src/service/adapters/*-nango.ts`
2. Remove `packages/triggers/src/service/adapters/nango.ts`
3. Remove `apps/trigger-service/src/api/webhooks.ts` (Nango route)
4. Remove `apps/web/src/app/api/webhooks/nango/route.ts`
5. Remove `apps/web/src/lib/nango.ts` and `@nangohq/node` dependency
6. Remove `NANGO_SECRET_KEY`, `NEXT_PUBLIC_NANGO_*` env vars
7. Migration guide for existing Nango users to re-authorize via first-party OAuth

### What Stays Unchanged

- GitHub App OAuth + webhooks (already first-party)
- Slack OAuth + encrypted bot tokens (already first-party)
- Custom/PostHog/automation webhook routes (already direct)
- MCP connector catalog (independent of Nango)
- Actions pipeline — risk, approval, grants, audit (provider-agnostic)
- Gateway routing — `GET /available`, `POST /invoke`, etc.
- Trigger processing — `processTriggerEvents()`, dedup, outbox handoff
- Provider parsing — `SentryProvider`, `LinearProvider`, `GitHubProvider` (reused as-is)
