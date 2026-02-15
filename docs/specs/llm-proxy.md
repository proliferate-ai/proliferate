# LLM Proxy — System Spec

## 1. Scope & Purpose

### In Scope
- Virtual key generation: per-session, per-org temporary keys via LiteLLM admin API
- Key scoping model: team = org, user = session for cost isolation
- Key duration and lifecycle
- LiteLLM API integration contract (endpoints called, auth model)
- Spend tracking via LiteLLM's Admin REST API (`GET /spend/logs/v2`)
- LLM spend cursors (per-org DB sync state for billing reconciliation)
- Environment configuration (`LLM_PROXY_URL`, `LLM_PROXY_MASTER_KEY`, `LLM_PROXY_KEY_DURATION`, etc.)
- How providers (Modal, E2B) pass the virtual key to sandboxes

### Feature Status

| Feature | Status | Evidence |
|---------|--------|----------|
| Virtual key generation | Implemented | `packages/shared/src/llm-proxy.ts:generateVirtualKey` |
| Key scoping (team/user) | Implemented | `packages/shared/src/llm-proxy.ts:generateVirtualKey` — `team_id=orgId`, `user_id=sessionId` |
| Key duration config | Implemented | `packages/environment/src/schema.ts:LLM_PROXY_KEY_DURATION` |
| Team (org) provisioning | Implemented | `packages/shared/src/llm-proxy.ts:ensureTeamExists` |
| Sandbox key injection (Modal) | Implemented | `packages/shared/src/providers/modal-libmodal.ts:createSandbox` |
| Sandbox key injection (E2B) | Implemented | `packages/shared/src/providers/e2b.ts:createSandbox` |
| Spend sync (per-org REST API) | Implemented | `apps/worker/src/billing/worker.ts:syncLLMSpend`, `packages/services/src/billing/litellm-api.ts:fetchSpendLogs` |
| LLM spend cursors (per-org) | Implemented | `packages/db/src/schema/billing.ts:llmSpendCursors` (keyed by `organization_id`) |
| Model routing config | Implemented | `apps/llm-proxy/litellm/config.yaml` |
| Key revocation on session end | Implemented | `packages/shared/src/llm-proxy.ts:revokeVirtualKey`, called from `sessions-pause.ts`, `org-pause.ts` |
| Dynamic max budget from shadow balance | Implemented | `packages/services/src/sessions/sandbox-env.ts:buildSandboxEnvVars` |
| Key alias (sessionId) | Implemented | `packages/shared/src/llm-proxy.ts:generateVirtualKey` — `key_alias=sessionId` |

### Out of Scope
- LiteLLM service internals (model routing config, caching, rate limiting) — external dependency, not our code
- Billing policy, credit gating, charging — see `billing-metering.md`
- Sandbox boot mechanics — see `sandbox-providers.md`
- Session lifecycle (create/pause/resume/delete) — see `sessions-gateway.md`
- Secret decryption and injection — see `secrets-environment.md`

### Mental Model

The LLM proxy is an **external LiteLLM service** that Proliferate routes sandbox LLM requests through. This spec documents our **integration contract** with it — the API calls we make, the keys we generate, and the spend data we read back — not the service itself.

The integration solves two problems: (1) **security** — sandboxes never see real API keys; they get short-lived virtual keys scoped to a single session, and (2) **cost isolation** — every LLM request is attributed to an org (team) and session (user) in LiteLLM's spend tracking, enabling per-org billing.

The flow is: session creation → generate virtual key → pass key + proxy base URL to sandbox → sandbox makes LLM calls through proxy → LiteLLM logs spend → billing worker syncs spend logs into billing events.

**Core entities:**
- **Virtual key** — a temporary LiteLLM API key (e.g., `sk-xxx`) scoped to one session and one org. Generated via LiteLLM's `/key/generate` admin endpoint.
- **Team** — LiteLLM's grouping for cost tracking. Maps 1:1 to a Proliferate org. Created via `/team/new` if it doesn't exist.
- **LLM spend cursor** — a per-org DB table tracking the sync position when reading spend logs from LiteLLM's REST API.

**Key invariants:**
- Virtual keys are always scoped: `team_id = orgId`, `user_id = sessionId`.
- When `LLM_PROXY_URL` is not set, sandboxes fall back to a direct `ANTHROPIC_API_KEY` (no proxy, no spend tracking).
- When `LLM_PROXY_REQUIRED=true` and `LLM_PROXY_URL` is unset, session creation fails hard.
- The spend sync is eventually consistent — logs appear in LiteLLM's table and are polled every 30 seconds by the billing worker.

---

## 2. Core Concepts

### LiteLLM Virtual Keys
LiteLLM's virtual key system (free tier) generates temporary API keys that the proxy validates on each request. Each key carries `team_id` and `user_id` metadata, which LiteLLM uses to attribute spend.
- Key detail agents get wrong: we use virtual keys (free tier), NOT JWT auth (enterprise tier). The master key is only used for admin API calls, never passed to sandboxes.
- Reference: [LiteLLM virtual keys docs](https://docs.litellm.ai/docs/proxy/virtual_keys)

### Admin URL vs Public URL
Two separate URLs exist for the proxy: the **admin URL** for key generation and team management (requires master key, may be internal-only), and the **public URL** for sandbox LLM requests (accepts virtual keys, must be reachable from sandboxes).
- Key detail agents get wrong: `LLM_PROXY_ADMIN_URL` is optional — if unset, `LLM_PROXY_URL` is used for both admin calls and public access. `LLM_PROXY_PUBLIC_URL` controls what base URL sandboxes see.
- Reference: `packages/shared/src/llm-proxy.ts:generateVirtualKey`, `packages/shared/src/llm-proxy.ts:getLLMProxyBaseURL`

### Model Routing Configuration
The LiteLLM config (`apps/llm-proxy/litellm/config.yaml`) maps OpenCode model IDs (e.g., `anthropic/claude-sonnet-4-5`) to actual Anthropic API model IDs (often with date suffixes, e.g., `anthropic/claude-sonnet-4-5-20250929`, though some like `anthropic/claude-opus-4-6` map without a suffix). The proxy also accepts short aliases (e.g., `claude-sonnet-4-5`).
- Key detail agents get wrong: model routing is configured in `config.yaml`, not in our TypeScript code. Adding a new model requires editing the YAML config and redeploying the proxy container.
- Reference: `apps/llm-proxy/litellm/config.yaml`

### Spend Sync Architecture
Our billing worker reads spend data from LiteLLM's Admin REST API (`GET /spend/logs/v2`) per org and converts logs into billing events via bulk ledger deduction. Cursors are tracked per-org in the `llm_spend_cursors` table.
- Key detail agents get wrong: we use the REST API, not cross-schema SQL. The old `LITELLM_DB_SCHEMA` env var is no longer used.
- Reference: `packages/services/src/billing/litellm-api.ts:fetchSpendLogs`

---

## 3. File Tree

```
apps/llm-proxy/
├── Dockerfile                          # LiteLLM container image (ghcr.io/berriai/litellm)
├── README.md                           # Deployment docs, architecture diagram
└── litellm/
    └── config.yaml                     # Model routing, master key, DB URL, retry settings

packages/shared/src/
├── llm-proxy.ts                        # Virtual key generation, team management, URL helpers

packages/services/src/
├── sessions/
│   └── sandbox-env.ts                  # Calls generateSessionAPIKey during session creation
└── billing/
    ├── db.ts                           # LLM spend cursor CRUD (per-org)
    └── litellm-api.ts                  # LiteLLM Admin REST API client (GET /spend/logs/v2)

packages/environment/src/
└── schema.ts                           # LLM_PROXY_* env var definitions

packages/db/src/schema/
└── billing.ts                          # llmSpendCursors table definition

apps/worker/src/billing/
└── worker.ts                           # syncLLMSpend() — polling loop that reads spend logs

packages/shared/src/providers/
├── modal-libmodal.ts                   # Passes LLM_PROXY_API_KEY + ANTHROPIC_BASE_URL to sandbox
└── e2b.ts                             # Same key/URL injection pattern as Modal
```

---

## 4. Data Models & Schemas

### Database Tables

```sql
llm_spend_cursors (per-org)
├── organization_id TEXT PRIMARY KEY FK → organization.id (CASCADE)
├── last_start_time TIMESTAMPTZ NOT NULL               -- cursor position for REST API pagination
├── last_request_id TEXT                               -- tie-breaker for deterministic ordering
├── records_processed INTEGER DEFAULT 0                -- total records synced (monotonic)
└── synced_at       TIMESTAMPTZ DEFAULT NOW()          -- last sync timestamp
```

### Core TypeScript Types

```typescript
// packages/shared/src/llm-proxy.ts
interface VirtualKeyOptions {
  duration?: string;       // e.g., "15m", "1h", "24h"
  maxBudget?: number;      // max spend in USD
  metadata?: Record<string, unknown>;
}

interface VirtualKeyResponse {
  key: string;             // "sk-xxx" — the virtual key
  expires: string;         // ISO timestamp
  team_id: string;         // orgId
  user_id: string;         // sessionId
}

// packages/services/src/billing/litellm-api.ts
interface LiteLLMSpendLog {
  request_id: string;
  team_id: string | null;  // our orgId
  end_user: string | null; // our sessionId
  spend: number;           // cost in USD
  model: string;
  model_group: string | null;
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  startTime?: string;
}

// packages/services/src/billing/db.ts
interface LLMSpendCursor {
  organizationId: string;
  lastStartTime: Date;
  lastRequestId: string | null;
  recordsProcessed: number;
  syncedAt: Date;
}
```

### Key Indexes & Query Patterns
- `llm_spend_cursors` — primary key lookup by `organization_id`. One row per active org.
- Spend logs are now fetched via LiteLLM's REST API (`GET /spend/logs/v2?team_id=...&start_date=...`), not raw SQL.

---

## 5. Conventions & Patterns

### Do
- Always call `ensureTeamExists(orgId)` before generating a virtual key — `generateSessionAPIKey` does this automatically (`packages/shared/src/llm-proxy.ts:generateSessionAPIKey`)
- Use `buildSandboxEnvVars()` from `packages/services/src/sessions/sandbox-env.ts` to generate all sandbox env vars, including the virtual key — it handles the proxy/direct key decision centrally
- Strip trailing slashes and `/v1` before appending paths to admin URLs — `generateVirtualKey` does this (`adminUrl` normalization at line 69)

### Don't
- Don't pass `LLM_PROXY_MASTER_KEY` to sandboxes — only virtual keys go to sandboxes
- Don't query LiteLLM's database directly — use the REST API client (`packages/services/src/billing/litellm-api.ts:fetchSpendLogs`)
- Don't assume `LLM_PROXY_URL` is always set — graceful fallback to direct API key is required unless `LLM_PROXY_REQUIRED=true`

### Error Handling

```typescript
// Key generation failure is fatal when proxy is configured
if (!proxyUrl) {
  if (requireProxy) {
    throw new Error("LLM proxy is required but LLM_PROXY_URL is not set");
  }
  envVars.ANTHROPIC_API_KEY = directApiKey ?? "";
} else {
  try {
    const apiKey = await generateSessionAPIKey(sessionId, orgId);
    envVars.LLM_PROXY_API_KEY = apiKey;
  } catch (err) {
    throw new Error(`LLM proxy enabled but failed to generate session key: ${message}`);
  }
}
```
_Source: `packages/services/src/sessions/sandbox-env.ts:buildSandboxEnvVars`_

### Reliability
- Team creation is idempotent — `ensureTeamExists` checks via `GET /team/info` first, handles "already exists" errors from `POST /team/new` (`packages/shared/src/llm-proxy.ts:ensureTeamExists`)
- Spend sync uses per-org cursors with `start_date` filtering via the REST API to avoid reprocessing (`packages/services/src/billing/db.ts:getLLMSpendCursor`)
- Idempotency keys (`llm:{request_id}`) on billing events prevent double-billing even if the same logs are fetched twice (`packages/services/src/billing/shadow-balance.ts:bulkDeductShadowBalance`)

### Testing Conventions
- No dedicated tests exist for the LLM proxy integration. Key generation and spend sync are verified via manual testing and production observability.
- To test locally, run LiteLLM via Docker Compose (`docker compose up -d llm-proxy`) and set `LLM_PROXY_URL=http://localhost:4000`.

---

## 6. Subsystem Deep Dives

### 6.1 Virtual Key Generation

**What it does:** Generates a short-lived LiteLLM virtual key for a sandbox session, scoped to an org for spend tracking.

**Happy path:**
1. `buildSandboxEnvVars()` is called during session creation (`packages/services/src/sessions/sandbox-env.ts`)
2. It checks if `LLM_PROXY_URL` is set. If yes, calls `generateSessionAPIKey(sessionId, orgId)` (`packages/shared/src/llm-proxy.ts:generateSessionAPIKey`)
3. `generateSessionAPIKey` first calls `ensureTeamExists(orgId)` — `GET /team/info?team_id={orgId}` to check, then `POST /team/new` if needed (`packages/shared/src/llm-proxy.ts:ensureTeamExists`)
4. When billing is enabled, fetches org's `shadow_balance` via `getBillingInfoV2`, computes `maxBudget = Math.max(0, shadow_balance * 0.01)` (`packages/services/src/sessions/sandbox-env.ts:buildSandboxEnvVars`)
5. Calls `generateVirtualKey(sessionId, orgId, { maxBudget })` — `POST /key/generate` with `team_id=orgId`, `user_id=sessionId`, `key_alias=sessionId`, `max_budget`, `duration` from env (`packages/shared/src/llm-proxy.ts:generateVirtualKey`)
6. Returns the `key` string. The caller stores it as `envVars.LLM_PROXY_API_KEY`

**Edge cases:**
- `LLM_PROXY_URL` unset + `LLM_PROXY_REQUIRED=false` → falls back to direct `ANTHROPIC_API_KEY`
- `LLM_PROXY_URL` unset + `LLM_PROXY_REQUIRED=true` → throws, blocking session creation
- Team creation race condition → `ensureTeamExists` tolerates "already exists" / "duplicate" errors
- Key generation failure → throws, blocking session creation (no silent fallback when proxy is configured)

**Files touched:** `packages/shared/src/llm-proxy.ts`, `packages/services/src/sessions/sandbox-env.ts`

**Status:** Implemented

### 6.2 Sandbox Key Injection

**What it does:** Passes the virtual key and proxy base URL to the sandbox so OpenCode routes LLM requests through the proxy.

**Happy path:**
1. Provider reads `opts.envVars.LLM_PROXY_API_KEY` (set by `buildSandboxEnvVars`) and calls `getLLMProxyBaseURL()` (`packages/shared/src/llm-proxy.ts:getLLMProxyBaseURL`)
2. `getLLMProxyBaseURL()` returns `LLM_PROXY_PUBLIC_URL || LLM_PROXY_URL` normalized with `/v1` suffix
3. Provider sets two env vars on the sandbox: `ANTHROPIC_API_KEY = virtualKey`, `ANTHROPIC_BASE_URL = proxyBaseUrl`
4. OpenCode inside the sandbox uses these standard env vars to route all Anthropic API calls through the proxy
5. The same env vars are set again as process-level env when launching the OpenCode server (after `setupEssentialDependencies` writes config files)

**Edge cases:**
- No proxy configured → `ANTHROPIC_API_KEY` is set to the direct key, `ANTHROPIC_BASE_URL` is not set
- E2B snapshot resume → proxy vars (`ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`) are **excluded** from the shell profile re-injection and only passed as process-level env vars to the OpenCode server process via `envs: opencodeEnv`. Other env vars are re-exported to the shell. (`packages/shared/src/providers/e2b.ts:createSandbox`, lines ~182-189 and ~646-659)

**Files touched:** `packages/shared/src/providers/modal-libmodal.ts:createSandbox`, `packages/shared/src/providers/e2b.ts:createSandbox`, `packages/shared/src/llm-proxy.ts:getLLMProxyBaseURL`

**Status:** Implemented

### 6.3 LLM Spend Sync

**What it does:** Periodically reads LLM spend logs from LiteLLM's REST API and converts them into billing events for Proliferate's billing system via bulk ledger deduction.

**Happy path:**
1. Billing worker calls `syncLLMSpend()` every 30 seconds, guarded by `NEXT_PUBLIC_BILLING_ENABLED` and `LLM_PROXY_ADMIN_URL` (`apps/worker/src/billing/worker.ts`)
2. Lists all billable orgs (billing state in `active`, `trial`, or `grace`) via `billing.listBillableOrgIds()` (`packages/services/src/billing/db.ts`)
3. For each org:
   a. Reads per-org cursor — `billing.getLLMSpendCursor(orgId)` (`packages/services/src/billing/db.ts`)
   b. Fetches spend logs via REST API — `billing.fetchSpendLogs(orgId, startDate)` (`packages/services/src/billing/litellm-api.ts`)
   c. Filters logs with positive `spend`, converts to `BulkDeductEvent[]` using `calculateLLMCredits(spend)` with idempotency key `llm:{request_id}`
   d. Calls `billing.bulkDeductShadowBalance(orgId, events)` — single transaction: locks org row, bulk inserts billing events, deducts total from shadow balance (`packages/services/src/billing/shadow-balance.ts`)
   e. Updates cursor to latest log's `startTime` — `billing.updateLLMSpendCursor()` (`packages/services/src/billing/db.ts`)
4. Handles state transitions: if `shouldTerminateSessions`, calls `billing.handleCreditsExhaustedV2(orgId, providers)`

**Edge cases:**
- First run for an org (no cursor) → starts from 5-minute lookback window (`now - 5min`)
- No logs returned → cursor is not advanced (no-op for that org)
- Duplicate logs → `bulkDeductShadowBalance` uses `ON CONFLICT (idempotency_key) DO NOTHING`, duplicates are silently skipped
- REST API failure for one org → logged and skipped; other orgs continue; retried next cycle
- `LLM_PROXY_ADMIN_URL` not set → entire sync is skipped (no proxy configured)

**Files touched:** `apps/worker/src/billing/worker.ts:syncLLMSpend`, `packages/services/src/billing/db.ts`, `packages/services/src/billing/litellm-api.ts`, `packages/services/src/billing/shadow-balance.ts`

**Status:** Implemented

### 6.4 Synchronous Key Revocation

**What it does:** Revokes a session's virtual key when the session is terminated, paused, or exhausted.

**Happy path:**
1. A session ends (user pause, billing termination, or credit exhaustion)
2. The caller invokes `revokeVirtualKey(sessionId)` as fire-and-forget after `provider.terminate()` (`packages/shared/src/llm-proxy.ts:revokeVirtualKey`)
3. `revokeVirtualKey` calls `POST /key/delete` with `{ key_aliases: [sessionId] }` — the alias was set during key generation via `key_alias: sessionId`
4. 404 responses are treated as success (key already deleted or expired)

**Edge cases:**
- Proxy not configured (`LLM_PROXY_URL` unset) → returns immediately, no-op
- Master key missing → returns immediately, no-op
- Network failure → error is caught and logged at debug level by callers; does not block session termination

**Call sites:**
- `apps/web/src/server/routers/sessions-pause.ts:pauseSessionHandler` — after snapshot + terminate
- `packages/services/src/billing/org-pause.ts:handleCreditsExhaustedV2` — per-session during exhaustion enforcement
- `packages/services/src/billing/org-pause.ts:terminateAllOrgSessions` — per-session during bulk termination

**Files touched:** `packages/shared/src/llm-proxy.ts:revokeVirtualKey`, `apps/web/src/server/routers/sessions-pause.ts`, `packages/services/src/billing/org-pause.ts`

**Status:** Implemented

### 6.5 Environment Configuration

**What it does:** Six env vars control the LLM proxy integration.

| Env Var | Required | Default | Purpose |
|---------|----------|---------|---------|
| `LLM_PROXY_URL` | No | — | Base URL of the LiteLLM proxy. When set, enables proxy mode. |
| `LLM_PROXY_ADMIN_URL` | No | `LLM_PROXY_URL` | Separate admin URL for key/team management and REST API spend queries. Falls back to `LLM_PROXY_URL`. |
| `LLM_PROXY_PUBLIC_URL` | No | `LLM_PROXY_URL` | Public-facing URL that sandboxes use. Falls back to `LLM_PROXY_URL`. |
| `LLM_PROXY_MASTER_KEY` | When proxy is enabled | — | Master key for LiteLLM admin API (key generation, team management, spend queries). |
| `LLM_PROXY_KEY_DURATION` | No | `"24h"` | Default virtual key validity duration. Supports LiteLLM duration strings. |
| `LLM_PROXY_REQUIRED` | No | `false` | When `true`, session creation fails if proxy is not configured. |

The spend sync uses `LLM_PROXY_ADMIN_URL` and `LLM_PROXY_MASTER_KEY` (same vars as key generation) to call `GET /spend/logs/v2`. No additional env vars are required.

**Files touched:** `packages/environment/src/schema.ts` (LLM_PROXY_* vars), `packages/shared/src/llm-proxy.ts`, `packages/services/src/billing/litellm-api.ts`

**Status:** Implemented

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| Sandbox Providers | Providers → This | `getLLMProxyBaseURL()`, reads `envVars.LLM_PROXY_API_KEY` | Both Modal and E2B inject the virtual key and base URL at sandbox boot. See `sandbox-providers.md` §6. |
| Sessions | Sessions → This | `buildSandboxEnvVars()` → `generateSessionAPIKey()` | Session creation triggers key generation. See `sessions-gateway.md` §6. |
| Billing & Metering | Billing → This | `syncLLMSpend()` calls `fetchSpendLogs()` REST API, writes `billing_events` via `bulkDeductShadowBalance()` | Billing worker polls spend data per org. Charging policy owned by `billing-metering.md`. |
| Environment | This → Environment | `env.LLM_PROXY_*` | Typed `LLM_PROXY_*` vars read from env schema (`packages/environment/src/schema.ts`). |

### Security & Auth
- The master key (`LLM_PROXY_MASTER_KEY`) is never exposed to sandboxes — it stays server-side for admin API calls only.
- Virtual keys are the only credential sandboxes receive. They are short-lived (default 24h) and scoped to a single session.
- The master key authenticates all admin API calls via `Authorization: Bearer {masterKey}` header.
- Sandbox env vars filter out `LLM_PROXY_API_KEY`, `ANTHROPIC_API_KEY`, and `ANTHROPIC_BASE_URL` from the pass-through env loop to prevent double-setting or leaking the real key when proxy is active (`packages/shared/src/providers/modal-libmodal.ts:createSandbox`, `packages/shared/src/providers/e2b.ts:createSandbox`).

### Observability
- Key generation latency is logged at debug level: `"Generated LLM proxy session key"` with `durationMs` (`packages/services/src/sessions/sandbox-env.ts`)
- Spend sync logs totals: `"Synced LLM spend logs"` with `totalProcessed` and `batchCount` (`apps/worker/src/billing/worker.ts`)
- Key generation failures log at error level before throwing (`packages/services/src/sessions/sandbox-env.ts`)

---

## 8. Acceptance Gates

- [ ] Typecheck passes
- [ ] Relevant tests pass
- [ ] This spec is updated (file tree, data models, deep dives)
- [ ] LLM proxy env vars documented in environment schema if added/changed
- [ ] Virtual key duration and scoping unchanged unless explicitly approved

---

## 9. Known Limitations & Tech Debt

- [x] ~~**No key revocation on session end**~~ — Resolved. `revokeVirtualKey(sessionId)` is called fire-and-forget on session pause, exhaustion, and bulk termination.
- [x] ~~**Shared database coupling**~~ — resolved. Spend sync now uses LiteLLM's REST API (`GET /spend/logs/v2`) via `litellm-api.ts` instead of cross-schema SQL.
- [x] ~~**Single global cursor**~~ — resolved. Cursors are now per-org (`llm_spend_cursors` table keyed by `organization_id`). The old global cursor table has been archived as `llm_spend_cursors_global`.
- [x] ~~**No budget enforcement on virtual keys**~~ — Resolved. `buildSandboxEnvVars` fetches `shadow_balance` when billing is enabled and passes `maxBudget = Math.max(0, shadow_balance * 0.01)` to `generateVirtualKey`.
