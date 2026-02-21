# LLM Proxy - System Spec

## 1. Scope & Purpose

### In Scope
- LiteLLM integration contract for Proliferate services and sandboxes.
- Virtual key lifecycle (team provisioning, key generation, key revocation).
- URL contract (`LLM_PROXY_URL`, `LLM_PROXY_ADMIN_URL`, `LLM_PROXY_PUBLIC_URL`) and sandbox-facing base URL rules.
- Spend ingestion from LiteLLM Admin REST API (`GET /spend/logs/v2`) into billing events.
- Per-org cursor semantics for LLM spend sync.
- Model routing contract between canonical model IDs, OpenCode provider config, and LiteLLM YAML routing.
- Environment configuration for proxy and provider credentials.
- Non-sandbox server-side proxy usage that is part of current runtime behavior.

### Out of Scope
- Billing policy, plan economics, and credit state machine behavior (see `billing-metering.md`).
- Session lifecycle orchestration (see `sessions-gateway.md`).
- Sandbox boot mechanics beyond LLM credential/base URL contract (see `sandbox-providers.md`).
- Secret storage and encryption lifecycle (see `secrets-environment.md`).
- LiteLLM internals that are not part of Proliferate-owned integration code.

### Feature Status

| Feature | Status | Evidence |
|---|---|---|
| Per-session virtual key generation | Implemented | `packages/shared/src/llm-proxy.ts:generateVirtualKey` |
| Team provisioning before key generation | Implemented | `packages/shared/src/llm-proxy.ts:ensureTeamExists`, `packages/shared/src/llm-proxy.ts:generateSessionAPIKey` |
| Key scoping (`team_id=org`, `user_id=session`) | Implemented | `packages/shared/src/llm-proxy.ts:generateVirtualKey` |
| Budget cap on key generation (`max_budget`) | Implemented | `packages/services/src/sessions/sandbox-env.ts:buildSandboxEnvVars`, `packages/shared/src/llm-proxy.ts:generateVirtualKey` |
| Public/admin URL split and `/v1` normalization | Implemented | `packages/shared/src/llm-proxy.ts:getLLMProxyBaseURL`, `packages/shared/src/llm-proxy.ts:generateVirtualKey` |
| Sandbox injection (Modal + E2B) | Implemented | `packages/shared/src/providers/modal-libmodal.ts:createSandbox`, `packages/shared/src/providers/e2b.ts:createSandbox` |
| LLM spend sync dispatcher + per-org workers | Implemented | `apps/worker/src/jobs/billing/llm-sync-dispatcher.job.ts`, `apps/worker/src/jobs/billing/llm-sync-org.job.ts` |
| Per-org spend cursor | Implemented | `packages/services/src/billing/db.ts:getLLMSpendCursor`, `packages/services/src/billing/db.ts:updateLLMSpendCursor` |
| Spend REST client (`/spend/logs/v2`) | Implemented | `packages/services/src/billing/litellm-api.ts:fetchSpendLogs` |
| Key revocation on pause/exhaustion paths | Implemented | `apps/web/src/server/routers/sessions-pause.ts:pauseSessionHandler`, `packages/services/src/billing/org-pause.ts:pauseSessionWithSnapshot`, `packages/shared/src/llm-proxy.ts:revokeVirtualKey` |
| Model routing in LiteLLM YAML | Implemented | `apps/llm-proxy/litellm/config.yaml` |
| Server-side proxy usage outside sandboxes | Implemented | `apps/worker/src/automation/configuration-selector.ts:callLLM` |

### Mental Models

The LLM proxy is an external LiteLLM service and this spec is the Proliferate-side contract for using it. The code here defines identity boundaries, billing attribution boundaries, and integration rules. It does not define LiteLLM internals.

Treat the proxy as two planes with different auth models:
- Control plane: server-side admin/API calls with `LLM_PROXY_MASTER_KEY` for team management, key generation, spend reads, and selected worker-side LLM calls.
- Data plane: sandbox LLM traffic authenticated with short-lived virtual keys that never expose real provider credentials.

Spend ingestion is eventually consistent. Billing correctness depends on idempotent event insertion, not on perfect cursor monotonicity from LiteLLM.

Model routing is a three-surface contract:
- Canonical model IDs in Proliferate (`packages/shared/src/agents.ts`).
- OpenCode provider config generated in sandbox (`packages/shared/src/sandbox/opencode.ts`).
- LiteLLM model mapping and aliases in YAML (`apps/llm-proxy/litellm/config.yaml`).

### Things agents get wrong

- The proxy is optional unless `LLM_PROXY_REQUIRED=true`; otherwise sessions can fall back to direct `ANTHROPIC_API_KEY` (`packages/services/src/sessions/sandbox-env.ts:buildSandboxEnvVars`).
- `LLM_PROXY_API_KEY` is a staging env var between services and providers. The sandbox runtime actually consumes `ANTHROPIC_API_KEY` and `ANTHROPIC_BASE_URL` (`packages/shared/src/providers/modal-libmodal.ts:createSandbox`, `packages/shared/src/providers/e2b.ts:createSandbox`).
- Key generation is replace-by-alias, not append-only. Existing key aliases are revoked before generating a new key for the same session (`packages/shared/src/llm-proxy.ts:generateVirtualKey`).
- Team creation is not a separate operational step for callers. `generateSessionAPIKey` always enforces team existence (`packages/shared/src/llm-proxy.ts:generateSessionAPIKey`).
- `LLM_PROXY_PUBLIC_URL` controls sandbox-facing URL, not admin traffic (`packages/shared/src/llm-proxy.ts:getLLMProxyBaseURL`).
- E2B snapshot resume intentionally strips proxy credentials from shell profile re-export and only passes them to the OpenCode process env (`packages/shared/src/providers/e2b.ts:createSandbox`).
- Spend sync is no longer a single `syncLLMSpend` loop. It is a dispatcher queue plus per-org jobs (`apps/worker/src/billing/worker.ts`, `apps/worker/src/jobs/billing/llm-sync-dispatcher.job.ts`, `apps/worker/src/jobs/billing/llm-sync-org.job.ts`).
- LiteLLM spend API auth/header format differs from key-generation auth. Spend reads use `api-key`, key/team management uses `Authorization: Bearer` (`packages/services/src/billing/litellm-api.ts:fetchSpendLogs`, `packages/shared/src/llm-proxy.ts:generateVirtualKey`).
- LiteLLM spend API date format is not ISO8601 in this integration; it requires `YYYY-MM-DD HH:MM:SS` UTC (`packages/services/src/billing/litellm-api.ts:formatDateForLiteLLM`).
- Spend log ordering is not assumed stable. Client-side sorting by `startTime` + `request_id` is required before cursor advancement (`apps/worker/src/jobs/billing/llm-sync-org.job.ts:processLLMSyncOrgJob`).
- Cursor progression alone is not the dedup guarantee. Billing idempotency keying (`llm:{request_id}`) and `billing_event_keys` are the dedup authority (`apps/worker/src/jobs/billing/llm-sync-org.job.ts:processLLMSyncOrgJob`, `packages/services/src/billing/shadow-balance.ts:bulkDeductShadowBalance`).
- Not all proxy usage is sandbox virtual-key traffic. Worker configuration selection calls `/v1/chat/completions` server-side with master key and explicit `team_id` metadata (`apps/worker/src/automation/configuration-selector.ts:callLLM`).

---

## 2. Core Concepts

### Virtual Keys
LiteLLM virtual keys are short-lived credentials for sandbox data-plane requests. Proliferate mints them per session and org, with `key_alias=sessionId` for deterministic revocation and replacement (`packages/shared/src/llm-proxy.ts:generateVirtualKey`).

### Team Mapping
LiteLLM `team_id` is the organization ID. Team creation is idempotent with read-before-create plus duplicate-tolerant create handling (`packages/shared/src/llm-proxy.ts:ensureTeamExists`).

### URL Roles
- `LLM_PROXY_ADMIN_URL` (or fallback `LLM_PROXY_URL`) is used for admin and spend REST calls.
- `LLM_PROXY_PUBLIC_URL` (or fallback `LLM_PROXY_URL`) is what sandboxes should see.
- Sandbox SDK-facing URL is normalized to exactly one `/v1` suffix (`packages/shared/src/llm-proxy.ts:getLLMProxyBaseURL`).

### Spend Ingestion Contract
Billing workers read spend logs from LiteLLM REST API per org and convert positive-spend rows into bulk ledger deductions (`packages/services/src/billing/litellm-api.ts:fetchSpendLogs`, `apps/worker/src/jobs/billing/llm-sync-org.job.ts:processLLMSyncOrgJob`).

### Model Routing Contract
Canonical IDs map to OpenCode IDs in `packages/shared/src/agents.ts:toOpencodeModelId`, then resolve to provider-specific models in `apps/llm-proxy/litellm/config.yaml`. Non-Anthropic models use the `litellm` OpenCode provider block and still route through the same proxy base URL (`packages/shared/src/sandbox/opencode.ts:getOpencodeConfig`).

---

## 5. Conventions & Patterns

### Do
- Use `buildSandboxEnvVars()` as the single entry point for session sandbox LLM env resolution (`packages/services/src/sessions/sandbox-env.ts:buildSandboxEnvVars`).
- Use `generateSessionAPIKey()` for session keys instead of calling `generateVirtualKey()` directly (`packages/shared/src/llm-proxy.ts:generateSessionAPIKey`).
- Derive `maxBudget` from shadow balance only in the sandbox env builder where billing context exists (`packages/services/src/sessions/sandbox-env.ts:buildSandboxEnvVars`).
- Keep spend ingestion per-org and idempotent by using `llm:{request_id}` keys and bulk deduction (`apps/worker/src/jobs/billing/llm-sync-org.job.ts:processLLMSyncOrgJob`).

### Don't
- Do not pass `LLM_PROXY_MASTER_KEY` into sandbox env.
- Do not assume `LLM_PROXY_API_KEY` is directly consumed by OpenCode. Providers must map it to `ANTHROPIC_API_KEY` and set `ANTHROPIC_BASE_URL` when proxy mode is active.
- Do not query LiteLLM tables directly from app code. Use the REST client (`packages/services/src/billing/litellm-api.ts`).
- Do not assume REST response ordering from `/spend/logs/v2`.

### Error Handling
- If proxy is required and `LLM_PROXY_URL` is missing, sandbox env build fails hard (`packages/services/src/sessions/sandbox-env.ts:buildSandboxEnvVars`).
- If proxy is enabled and key generation fails, session creation fails hard; there is no silent fallback.
- Revocation is best-effort by design and must not block pause/termination flows (`packages/shared/src/llm-proxy.ts:revokeVirtualKey`, call sites in pause/enforcement paths).

### Reliability
- Key alias pre-revocation avoids uniqueness conflicts on resume/recreate (`packages/shared/src/llm-proxy.ts:generateVirtualKey`).
- Per-org LLM sync jobs are retried by BullMQ and fanned out per org (`llm-sync:${orgId}` naming), limiting failure blast radius to the affected org path (`packages/queue/src/index.ts`, `apps/worker/src/jobs/billing/llm-sync-dispatcher.job.ts`).
- Cursor advancement happens even when all fetched rows are skipped for zero/negative spend, preventing endless re-fetch loops (`apps/worker/src/jobs/billing/llm-sync-org.job.ts:processLLMSyncOrgJob`).

### Testing Conventions
- There are currently no dedicated automated tests for this integration slice (virtual key lifecycle + spend sync).
- Validation is primarily runtime behavior plus worker logs and billing ledger outcomes.

---

## 6. Subsystem Deep Dives (Invariants and Rules)

### 6.1 Key Lifecycle Invariants
- Every session-scoped key must carry `team_id=orgId`, `user_id=sessionId`, and `key_alias=sessionId`.
- Team existence must be ensured before key generation.
- Key generation for an existing session alias must revoke prior alias-bound keys before minting a new key.
- Default key TTL is `LLM_PROXY_KEY_DURATION` or `24h` when unset.
- When billing context is available, `max_budget` must be derived from shadow balance dollars (`credits * 0.01`, clamped at `>= 0`).
- If proxy mode is active, inability to mint a key is a terminal session startup error.

### 6.2 Sandbox Injection and Routing Invariants
- Sandboxes must receive only virtual-key credentials (or direct key in fallback mode), never the master key.
- Proxy mode requires both `ANTHROPIC_API_KEY=<virtual-key>` and `ANTHROPIC_BASE_URL=<proxy-v1-url>` in runtime env.
- Providers must filter `ANTHROPIC_API_KEY`, `LLM_PROXY_API_KEY`, and `ANTHROPIC_BASE_URL` from generic pass-through env loops to avoid leaks and duplicate sources.
- E2B resume path must not persist proxy credentials in shell profile exports; credentials are process-scoped when launching OpenCode.
- If proxy mode is unavailable and not required, direct key fallback must remain functional.

### 6.3 Spend Sync Invariants
- LLM spend sync is a two-stage queue system: repeatable dispatcher (30s) plus per-org worker jobs.
- Only billable org states (`active`, `trial`, `grace`) are dispatched for sync.
- First sync for an org must start from a bounded lookback window (5 minutes) when no cursor exists.
- Spend API calls must include org scoping (`team_id`) and bounded time range (`start_date`, `end_date`).
- Log processing order must be deterministic (`startTime` asc, then `request_id` asc).
- Rows with `spend <= 0` are non-billable; rows with `total_tokens > 0 && spend <= 0` must raise anomaly logging.
- Billing event idempotency key is always `llm:{request_id}`.
- Cursor must advance to the latest processed log position even when no billable events are inserted.
- Enforcement decisions after deduction must follow billing service outputs (`shouldPauseSessions`, `shouldBlockNewSessions`) and preserve trial auto-activation and auto-top-up checks.

### 6.4 Revocation Invariants
- Revocation target is session alias, not raw key value.
- Revocation 404 responses are treated as success.
- Revocation is best-effort and non-blocking in pause/enforcement paths.
- Missing proxy URL or master key makes revocation a no-op, not a fatal error.

### 6.5 Model Routing Invariants
- Canonical model IDs must map deterministically to OpenCode provider IDs.
- LiteLLM YAML is the source of truth for final model/provider routing and aliases.
- Adding a user-selectable model requires synchronized updates across model catalog surfaces, not a one-file change.
- Non-Anthropic models must continue using the custom `litellm` provider configuration in OpenCode and route through the same proxy endpoint.

### 6.6 Server-Side Proxy Usage Invariants
- Server-side worker calls that use the proxy directly must authenticate with master key and must attach org attribution metadata when available.
- Server-side direct proxy calls are control-plane usage and must not be treated as sandbox virtual-key traffic.

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| Sessions | Sessions -> LLM Proxy | `sessions.buildSandboxEnvVars()` | Session creation/resume chooses proxy vs direct key path and computes key budget input. |
| Sandbox Providers | Providers -> LLM Proxy | `getLLMProxyBaseURL()`, `envVars.LLM_PROXY_API_KEY` | Providers translate staging vars into OpenCode-consumable env and enforce filtering rules. |
| Billing | Billing -> LLM Proxy | `fetchSpendLogs()`, cursor CRUD, `bulkDeductShadowBalance()` | Billing owns charging policy; this integration owns spend ingestion contract and attribution fields. |
| Worker Queue | Worker -> LLM Proxy | Dispatch + per-org LLM sync jobs | Queue topology and retry behavior shape eventual consistency and failure isolation. |
| Agent Model Catalog | Shared -> LLM Proxy | `toOpencodeModelId()`, `getOpencodeConfig()`, LiteLLM YAML | Model IDs are stable only when shared model transforms and YAML routing stay aligned. |
| Automation Selector | Worker -> LLM Proxy | `configuration-selector.callLLM()` | Server-side LLM call path that uses proxy master key with org metadata, outside sandbox flow. |
| Environment Schema | Env -> LLM Proxy | `LLM_PROXY_*`, provider API key vars | Typed env schema is the contract surface for deployment configuration. |

### Security & Auth
- Master key scope is server-side only.
- Sandbox credentials are scoped virtual keys (or direct key in non-proxy fallback mode).
- Key/team admin endpoints use `Authorization: Bearer <masterKey>`.
- Spend REST endpoint uses `api-key: <masterKey>`.
- Provider env assembly explicitly strips proxy-sensitive keys from generic env forwarding paths.

### Observability
- Key generation success includes duration and optional max budget (`"Generated LLM proxy session key"` in `sandbox-env.ts`).
- Key generation failure is logged at error level before rethrow (`"Failed to generate LLM proxy session key"`).
- LLM sync dispatch emits org fan-out visibility (`"Dispatching LLM sync jobs"`).
- Per-org spend sync logs fetched/inserted totals and credit deductions (`"Synced LLM spend"`).
- Spend anomalies are explicitly logged for tokenized zero-spend rows.

---

## 8. Acceptance Gates

- [ ] Typecheck passes for touched TypeScript surfaces (if code changes are included with spec updates).
- [ ] `docs/specs/llm-proxy.md` reflects current worker job topology (dispatcher + per-org), not legacy `syncLLMSpend` wording.
- [ ] Section 6 remains invariant/rule based and avoids imperative step-by-step execution scripts.
- [ ] Section 3 and Section 4 are intentionally omitted; code is the source of truth for file tree and data models.
- [ ] Any newly introduced or changed `LLM_PROXY_*` env vars are reflected in `packages/environment/src/schema.ts`.

---

## 9. Known Limitations & Tech Debt

- No dedicated automated tests currently validate virtual-key lifecycle behavior end-to-end or spend-sync idempotency edge cases.
- Admin URL normalization is inconsistent across call paths: key/team management strips `/v1`, spend REST client does not. Misconfigured URLs can therefore behave differently between features.
- LLM sync dispatcher schedules every billable org every 30 seconds, even when an org has no recent spend, which can create avoidable control-plane traffic at scale.
- Worker-side configuration selection has a hardcoded model identifier (`claude-haiku-4-5-20251001`) and bypasses the shared model transform/YAML routing abstraction used by sandbox sessions.
