# LLM Proxy — System Spec

## 1. Scope & Purpose

### In Scope
- Virtual key generation: per-session, per-org temporary keys via LiteLLM admin API
- Key scoping model: team = org, user = session for cost isolation
- Key duration and lifecycle
- LiteLLM API integration contract (endpoints called, auth model)
- Spend tracking via LiteLLM's `LiteLLM_SpendLogs` table
- LLM spend cursors (DB sync state for billing reconciliation)
- Environment configuration (`LLM_PROXY_URL`, `LLM_PROXY_MASTER_KEY`, `LLM_PROXY_KEY_DURATION`, etc.)
- How providers (Modal, E2B) pass the virtual key to sandboxes

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
- **LLM spend cursor** — a single-row DB table tracking the sync position when reading spend logs from LiteLLM's `LiteLLM_SpendLogs` table.

**Key invariants:**
- Virtual keys are always scoped: `team_id = orgId`, `user_id = sessionId`.
- When `LLM_PROXY_URL` is not set, sandboxes fall back to a direct `ANTHROPIC_API_KEY` (no proxy, no spend tracking).
- When `LLM_PROXY_REQUIRED=true` and `LLM_PROXY_URL` is unset, session creation fails hard.
- The spend sync is eventually consistent — logs appear in LiteLLM's table and are polled every 30 seconds by the billing worker.

---

## 2. Core Concepts

### LiteLLM Virtual Keys
LiteLLM's virtual key system (free tier) generates temporary API keys that the proxy validates on each request. Each key carries `team_id` and `user_id` metadata, which LiteLLM uses to attribute spend in its `LiteLLM_SpendLogs` table.
- Key detail agents get wrong: we use virtual keys (free tier), NOT JWT auth (enterprise tier). The master key is only used for admin API calls, never passed to sandboxes.
- Reference: [LiteLLM virtual keys docs](https://docs.litellm.ai/docs/proxy/virtual_keys)

### Admin URL vs Public URL
Two separate URLs exist for the proxy: the **admin URL** for key generation and team management (requires master key, may be internal-only), and the **public URL** for sandbox LLM requests (accepts virtual keys, must be reachable from sandboxes).
- Key detail agents get wrong: `LLM_PROXY_ADMIN_URL` is optional — if unset, `LLM_PROXY_URL` is used for both admin calls and public access. `LLM_PROXY_PUBLIC_URL` controls what base URL sandboxes see.
- Reference: `packages/shared/src/llm-proxy.ts:generateVirtualKey`, `packages/shared/src/llm-proxy.ts:getLLMProxyBaseURL`

### Model Routing Configuration
The LiteLLM config (`apps/llm-proxy/litellm/config.yaml`) maps OpenCode model IDs (without date suffixes, e.g., `anthropic/claude-sonnet-4-5`) to actual Anthropic API model IDs (with date suffixes, e.g., `anthropic/claude-sonnet-4-5-20250929`). The proxy also accepts short aliases (e.g., `claude-sonnet-4-5`).
- Key detail agents get wrong: model routing is configured in `config.yaml`, not in our TypeScript code. Adding a new model requires editing the YAML config and redeploying the proxy container.
- Reference: `apps/llm-proxy/litellm/config.yaml`

### Spend Sync Architecture
LiteLLM writes spend data to its own `LiteLLM_SpendLogs` table in a shared PostgreSQL database. Our billing worker reads from this table using cursor-based pagination and converts spend logs into billing events. The two systems share a database but use different schemas.
- Key detail agents get wrong: we read from LiteLLM's schema (`litellm.LiteLLM_SpendLogs` by default) via raw SQL, not via Drizzle ORM. The schema name is configurable via `LITELLM_DB_SCHEMA`.
- Reference: `packages/services/src/billing/db.ts:LITELLM_SPEND_LOGS_REF`

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
    └── db.ts                           # LLM spend cursor CRUD, raw SQL reads from LiteLLM_SpendLogs

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
llm_spend_cursors
├── id              TEXT PRIMARY KEY DEFAULT 'global'  -- singleton row
├── last_start_time TIMESTAMPTZ NOT NULL               -- cursor position in LiteLLM_SpendLogs
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

// packages/services/src/billing/db.ts
interface LLMSpendLog {
  request_id: string;
  team_id: string | null;  // our orgId
  user: string | null;     // our sessionId
  spend: number;           // cost in USD
  model: string;
  model_group: string | null;
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  startTime?: Date | string;
}

interface LLMSpendCursor {
  lastStartTime: Date;
  lastRequestId: string | null;
  recordsProcessed: number;
  syncedAt: Date;
}
```

---

## 5. Conventions & Patterns

### Do
- Always call `ensureTeamExists(orgId)` before generating a virtual key — `generateSessionAPIKey` does this automatically (`packages/shared/src/llm-proxy.ts:generateSessionAPIKey`)
- Use `buildSandboxEnvVars()` from `packages/services/src/sessions/sandbox-env.ts` to generate all sandbox env vars, including the virtual key — it handles the proxy/direct key decision centrally
- Strip trailing slashes and `/v1` before appending paths to admin URLs — `generateVirtualKey` does this (`adminUrl` normalization at line 69)

### Don't
- Don't pass `LLM_PROXY_MASTER_KEY` to sandboxes — only virtual keys go to sandboxes
- Don't read `LiteLLM_SpendLogs` via Drizzle ORM — the table is managed by LiteLLM, use raw SQL via `packages/services/src/billing/db.ts`
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
- Spend sync uses cursor-based pagination with deterministic ordering (`startTime ASC, request_id ASC`) to avoid duplicates (`packages/services/src/billing/db.ts:getLLMSpendLogsByCursor`)
- Lookback sweep catches late-arriving logs; idempotency keys prevent double-billing (`apps/worker/src/billing/worker.ts:syncLLMSpend`)

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
4. Then calls `generateVirtualKey(sessionId, orgId)` — `POST /key/generate` with `team_id=orgId`, `user_id=sessionId`, `duration` from env (`packages/shared/src/llm-proxy.ts:generateVirtualKey`)
5. Returns the `key` string. The caller stores it as `envVars.LLM_PROXY_API_KEY`

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
5. The same env vars are set again when starting the OpenCode server process (`setupEssentialDependencies`)

**Edge cases:**
- No proxy configured → `ANTHROPIC_API_KEY` is set to the direct key, `ANTHROPIC_BASE_URL` is not set
- E2B snapshot resume → env vars are re-injected after resume since E2B doesn't persist env across pause/resume (`packages/shared/src/providers/e2b.ts`, line ~181)

**Files touched:** `packages/shared/src/providers/modal-libmodal.ts:createSandbox`, `packages/shared/src/providers/e2b.ts:createSandbox`, `packages/shared/src/llm-proxy.ts:getLLMProxyBaseURL`

**Status:** Implemented

### 6.3 LLM Spend Sync

**What it does:** Periodically reads LLM spend logs from LiteLLM's database and converts them into billing events for Proliferate's billing system.

**Happy path:**
1. Billing worker calls `syncLLMSpend()` every 30 seconds, guarded by `NEXT_PUBLIC_BILLING_ENABLED` (`apps/worker/src/billing/worker.ts`)
2. Reads current cursor from `llm_spend_cursors` table — `getLLMSpendCursor()` (`packages/services/src/billing/db.ts`)
3. Queries `litellm.LiteLLM_SpendLogs` via raw SQL, ordered by `startTime ASC, request_id ASC`, batched at `llmSyncBatchSize` (`packages/services/src/billing/db.ts:getLLMSpendLogsByCursor`)
4. For each log with a valid `team_id` and positive `spend`, calls `billing.deductShadowBalance()` with `eventType: "llm"` and `idempotencyKey: "llm:{request_id}"` — this atomically deducts credits and creates a billing event (see `billing-metering.md` for shadow balance details)
5. Updates cursor position after each batch (`packages/services/src/billing/db.ts:updateLLMSpendCursor`)
6. After cursor-based sweep, runs a lookback sweep for late-arriving logs (`getLLMSpendLogsLookback`)

**Edge cases:**
- First run (no cursor) with `LLM_SYNC_BOOTSTRAP_MODE=full` → seeds cursor from earliest log in `LiteLLM_SpendLogs`
- First run with `LLM_SYNC_BOOTSTRAP_MODE=recent` (default) → starts from 5-minute lookback window
- Duplicate logs → `deductShadowBalance` uses unique `idempotencyKey` (`llm:{request_id}`), duplicates are silently skipped
- Max batches exceeded → logs warning but does not fail; remaining logs are picked up next cycle

**Files touched:** `apps/worker/src/billing/worker.ts:syncLLMSpend`, `packages/services/src/billing/db.ts`

**Status:** Implemented

### 6.4 Environment Configuration

**What it does:** Six env vars control the LLM proxy integration.

| Env Var | Required | Default | Purpose |
|---------|----------|---------|---------|
| `LLM_PROXY_URL` | No | — | Base URL of the LiteLLM proxy. When set, enables proxy mode. |
| `LLM_PROXY_ADMIN_URL` | No | `LLM_PROXY_URL` | Separate admin URL for key/team management. Falls back to `LLM_PROXY_URL`. |
| `LLM_PROXY_PUBLIC_URL` | No | `LLM_PROXY_URL` | Public-facing URL that sandboxes use. Falls back to `LLM_PROXY_URL`. |
| `LLM_PROXY_MASTER_KEY` | When proxy is enabled | — | Master key for LiteLLM admin API (key generation, team management). |
| `LLM_PROXY_KEY_DURATION` | No | `"24h"` | Default virtual key validity duration. Supports LiteLLM duration strings. |
| `LLM_PROXY_REQUIRED` | No | `false` | When `true`, session creation fails if proxy is not configured. |

Additional env vars used by the spend sync (read via raw `process.env`, not in the typed schema):
- `LITELLM_DB_SCHEMA` — PostgreSQL schema containing `LiteLLM_SpendLogs` (default: `"litellm"`) (`packages/services/src/billing/db.ts`)
- `LLM_SYNC_BOOTSTRAP_MODE` — `"recent"` (default) or `"full"` for first-run backfill behavior (`apps/worker/src/billing/worker.ts`)
- `LLM_SYNC_MAX_BATCHES` — max batches per sync cycle (default: 100, or 20 on bootstrap) (`apps/worker/src/billing/worker.ts`)

**Files touched:** `packages/environment/src/schema.ts` (LLM_PROXY_* vars), `packages/shared/src/llm-proxy.ts`, `packages/services/src/billing/db.ts`, `apps/worker/src/billing/worker.ts`

**Status:** Implemented

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| Sandbox Providers | Providers → This | `getLLMProxyBaseURL()`, reads `envVars.LLM_PROXY_API_KEY` | Both Modal and E2B inject the virtual key and base URL at sandbox boot. See `sandbox-providers.md` §6. |
| Sessions | Sessions → This | `buildSandboxEnvVars()` → `generateSessionAPIKey()` | Session creation triggers key generation. See `sessions-gateway.md` §6. |
| Billing & Metering | Billing → This | `syncLLMSpend()` reads `LiteLLM_SpendLogs`, writes `billing_events` | Billing worker polls spend data. Charging policy owned by `billing-metering.md`. |
| Environment | This → Environment | `env.LLM_PROXY_*` | All proxy config read from env schema. See `packages/environment/src/schema.ts`. |

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

- [ ] **No key revocation on session end** — virtual keys remain valid until their duration expires, even after a session is terminated. Impact: minimal (keys are short-lived and sandboxes are destroyed), but a revocation call on session delete would be cleaner. Expected fix: call `POST /key/delete` on session terminate.
- [ ] **Shared database coupling** — the spend sync reads directly from LiteLLM's PostgreSQL schema, coupling our billing worker to LiteLLM's internal table format. Impact: LiteLLM schema changes could break the sync. Expected fix: use LiteLLM's HTTP spend API instead of raw SQL if one becomes available.
- [ ] **Single global cursor** — the `llm_spend_cursors` table uses a singleton row (`id = 'global'`). This means only one billing worker instance can sync spend logs at a time. Impact: acceptable at current scale. Expected fix: per-org cursors or distributed lock if needed.
- [ ] **No budget enforcement on virtual keys** — `maxBudget` is passed through to LiteLLM but not actively used in session creation. Budget enforcement is handled by Proliferate's billing system, not the proxy. Impact: none currently, as billing gating is separate.
