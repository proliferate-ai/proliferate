# LLM Proxy - System Spec

## 1. Scope & Purpose

### In Scope
- **Strict key lifecycle:** per-session virtual key generation with dynamic `max_budget` enforcement and best-effort synchronous revocation on session termination.
- Key scoping model: team = org, user = session.
- LiteLLM admin API integration contract (endpoints called, auth model, URL rules).
- Spend tracking ingestion via LiteLLM Admin REST API (see `billing-metering.md` for metering policy).
- Environment configuration (`LLM_PROXY_URL`, `LLM_PROXY_MASTER_KEY`, `LLM_PROXY_KEY_DURATION`, etc.).
- How providers (Modal, E2B) pass the virtual key to sandboxes.

### Out of Scope
- LiteLLM service internals (model routing config, caching, rate limiting) - external dependency.
- Billing policy and credit gating - see `billing-metering.md`.
- Sandbox boot mechanics - see `sandbox-providers.md`.
- Session lifecycle policy - see `sessions-gateway.md`.
- Any raw cross-schema reads into LiteLLM's internal database schema (deprecated and removed).

### Mental Model

The LLM proxy is an external LiteLLM service. Proliferate integrates with it to achieve:
- **Security:** sandboxes never receive real provider API keys; they receive per-session virtual keys.
- **Cost isolation:** every LLM request is attributed to an org (team) + session (user) in LiteLLM spend logs.
- **Financial circuit breaking:** keys are minted with a `max_budget` ceiling so LiteLLM can reject spend even between spend-sync cycles.
- **Post-session containment:** when a session ends, its key is revoked immediately (best-effort) to reduce key exfiltration windows.

---

## 2. Core Concepts

### Virtual Keys (LiteLLM)
We use LiteLLM virtual keys (free tier), not enterprise JWT auth. The master key is only used server-side for admin calls and never enters the sandbox.

### Key Alias = Session ID
Keys are created with `key_alias = sessionId`, so we can revoke keys by alias without storing raw key material.

### Dynamic Max Budget
When billing is enabled, session creation converts the org's current shadow balance to USD and passes it as `max_budget` when generating the virtual key:
- `budgetUsd = max(0, shadow_balance * 0.01)`

This acts as a circuit breaker against runaway spend between spend-sync cycles.

### Admin URL vs Public URL
- Admin calls use `LLM_PROXY_ADMIN_URL || LLM_PROXY_URL` (normalized: trim trailing `/` and optional `/v1`).
- Sandboxes receive `LLM_PROXY_PUBLIC_URL || LLM_PROXY_URL` as their `ANTHROPIC_BASE_URL`.

---

## 3. File Tree

```text
packages/shared/src/
`-- llm-proxy.ts                        # generateVirtualKey(), revokeVirtualKey(), ensureTeamExists()

packages/services/src/sessions/
`-- sandbox-env.ts                      # computes maxBudget + injects LLM key

packages/services/src/billing/
`-- litellm-api.ts                      # LiteLLM Admin REST wrapper (/spend/logs/v2)

apps/worker/src/billing/
`-- worker.ts                           # BullMQ LLM spend sync jobs (per-org fan-out)

packages/shared/src/providers/
|-- modal-libmodal.ts                   # passes proxy env vars to sandbox
`-- e2b.ts                              # passes proxy env vars to sandbox
```

---

## 4. Subsystem Deep Dives

### 4.1 Virtual Key Generation & Budgeting
**Flow:**
1. `buildSandboxEnvVars()` determines whether proxy mode is enabled (`LLM_PROXY_URL`).
2. If proxy mode is enabled, it computes `maxBudget` when billing is enabled:
- reads org shadow balance
- converts credits -> USD (`credits * 0.01`)
3. Calls `generateSessionAPIKey(sessionId, orgId, { maxBudget })`.
4. `generateSessionAPIKey()` ensures the LiteLLM team exists (`ensureTeamExists(orgId)`), then calls `POST /key/generate` with:
- `team_id = orgId`
- `user_id = sessionId`
- `key_alias = sessionId`
- `duration = LLM_PROXY_KEY_DURATION` (default `24h`)
- `max_budget = maxBudget` (when present)

### 4.2 Synchronous Revocation (Best-Effort)
**Goal:** if a key is exfiltrated from a sandbox, it should be unusable after the session ends.

**Implementation:**
- `revokeVirtualKey(sessionId)` calls `POST /key/delete` with `{ key_aliases: [sessionId] }`.
- 404 is treated as success (already deleted).
- Revocation is wired best-effort into session termination paths (pause/finalize/enforcement/migration).

### 4.3 Spend Logs
Spend ingestion is done via the LiteLLM Admin REST API (`/spend/logs/v2`) and processed by the billing worker. See `billing-metering.md` section 5.3 for ingestion and cursor semantics.

---

## 5. Security & Auth Constraints

- **Master key isolation:** `LLM_PROXY_MASTER_KEY` is only used for backend admin calls; it must never be passed to sandboxes.
- **Circuit breaker:** `max_budget` is the zero-trust safeguard against runaway spend inside the sandbox.

---

## 6. Environment Configuration

| Env Var | Required | Purpose |
| --- | --- | --- |
| `LLM_PROXY_URL` | No | Public base URL of the proxy. Enables proxy mode if set. |
| `LLM_PROXY_PUBLIC_URL` | No | Optional override for the URL sandboxes should use. |
| `LLM_PROXY_ADMIN_URL` | No | Optional admin URL for key/team/spend endpoints. |
| `LLM_PROXY_MASTER_KEY` | If proxy on (server admin) | Bearer token for LiteLLM admin API. |
| `LLM_PROXY_KEY_DURATION` | No | Fallback TTL (default `24h`). Keys are revoked earlier on session end. |
| `LLM_PROXY_REQUIRED` | No | If true, session creation fails when proxy is unset. |

---

## 7. Acceptance Gates

- [x] Per-session virtual keys include `key_alias=sessionId` and `max_budget` when billing is enabled.
- [x] Best-effort `POST /key/delete` is invoked during session termination paths.
- [x] Spend log ingestion uses LiteLLM Admin REST API (no raw SQL reads into LiteLLM DB schema).

---

## 8. Known Limitations

- Revocation is best-effort and currently lives in a few termination code paths (not a single centralized "session ended" hook). If a new termination path is added, it must also revoke the key.
- `max_budget` is set at session start from shadow balance. It is not updated mid-session.
