# LiteLLM Proxy Spec (Proliferate)

File Map
---------
.
├── apps
│   ├── llm-proxy
│   │   ├── Dockerfile
│   │   ├── README.md
│   │   └── litellm
│   │       └── config.yaml
│   ├── web
│   │   └── src
│   │       └── server
│   │           └── routers
│   │               └── sessions-create.ts
│   └── worker
│       └── src
│           └── billing-worker.ts
├── packages
│   ├── services
│   │   └── src
│   │       └── billing
│   │           └── db.ts
│   └── shared
│       └── src
│           ├── llm-proxy.ts
│           ├── sandbox
│           │   └── opencode.ts
│           └── providers
│               ├── e2b.ts
│               └── modal-libmodal.ts
└── docs
    └── llm-proxy-guide.md

## Purpose
Provide a secure LLM API proxy for sandboxed OpenCode sessions. Sandboxes receive virtual, scoped keys while real provider credentials remain server-side. The proxy also meters usage for billing.

## Goals
- Never expose real provider API keys inside sandboxes.
- Attribute spend per org and per session for billing.
- Support long-lived sandboxes without frequent key refresh (configurable TTL).
- Work consistently across sandbox providers (Modal + E2B).

## Non-goals (current)
- Automated key rotation/refresh.
- Multi-provider routing beyond Anthropic (configurable in LiteLLM, but not core flow).

---

## High-Level Architecture

```
Client ──> Web/API ──> Gateway ──> Sandbox (OpenCode)
                             │
                             └──> LiteLLM Proxy ──> Anthropic

LiteLLM Proxy ──spend logs──> LiteLLM_SpendLogs (DB)
Billing Worker ──sync──> billing_events ──> Autumn
```

### Key Principles
- Virtual keys are created via LiteLLM admin endpoints and scoped by `team_id` (org) and `user_id` (session).
- Sandboxes call LiteLLM using the virtual key and a proxy base URL.
- Spend is auto-logged by LiteLLM to `LiteLLM_SpendLogs`.

---

## Repo Structure (Key Paths)

### LLM Proxy Service
- `apps/llm-proxy/Dockerfile`
  - Runs LiteLLM image directly.
- `apps/llm-proxy/litellm/config.yaml`
  - Model mappings and LiteLLM settings (master key, database URL, etc.).
- `apps/llm-proxy/README.md`
  - Service description and environment variables.

### Session Creation / Key Generation
- `packages/shared/src/llm-proxy.ts`
  - `generateSessionAPIKey()`
  - `ensureTeamExists()`
  - `getLLMProxyURL()` + `getLLMProxyBaseURL()`
- `apps/web/src/server/routers/sessions-create.ts`
  - Orchestrates session creation and virtual key generation.

### Sandbox Configuration (OpenCode)
- `packages/shared/src/sandbox/opencode.ts`
  - `getOpencodeConfig()`
- `packages/shared/src/providers/modal-libmodal.ts`
  - Injects LLM proxy env and launches OpenCode in Modal.
- `packages/shared/src/providers/e2b.ts`
  - Injects LLM proxy env and launches OpenCode in E2B.

### Billing / Spend Tracking
- `apps/worker/src/billing-worker.ts`
  - `syncLLMSpend()` reads LiteLLM_SpendLogs and writes billing_events.
- `packages/services/src/billing/db.ts`
  - Billing DB operations.

---

## Configuration

### Core Environment Variables
**LLM Proxy (LiteLLM service)**
- `LITELLM_MASTER_KEY` (required)
- `DATABASE_URL` (required; same DB as app)
- `ANTHROPIC_API_KEY` (required; real provider key)

**Web/API (session creation)**
- `LLM_PROXY_URL` (required to enable proxy)
- `LLM_PROXY_MASTER_KEY` (required to generate virtual keys)
- `LLM_PROXY_KEY_DURATION` (optional; default is long-lived)
- `LLM_PROXY_REQUIRED` (optional; fail if proxy not set)

**Sandbox runtime (OpenCode process)**
- `ANTHROPIC_API_KEY` = virtual key
- `ANTHROPIC_BASE_URL` = `LLM_PROXY_URL` with `/v1`

### Files
- `apps/llm-proxy/litellm/config.yaml`
  - Model mapping and database logging.
- `docs/llm-proxy-guide.md`
  - Operator guide.

---

## Core Flows

### 1) Session Creation + Virtual Key Generation
**Trigger**: User requests a new coding session.

**Flow**:
1. `sessions-create.ts` checks `LLM_PROXY_URL` (and `LLM_PROXY_REQUIRED`).
2. Calls `generateSessionAPIKey(sessionId, orgId)` in `llm-proxy.ts`.
3. `ensureTeamExists(orgId)` calls LiteLLM `/team/info` then `/team/new` if needed.
4. `generateVirtualKey()` calls LiteLLM `/key/generate` with:
   - `team_id = orgId`
   - `user_id = sessionId`
   - `duration = LLM_PROXY_KEY_DURATION` (or long-lived default)
5. The returned key is passed to the sandbox via env (not embedded in repo files).

**Key behavior**:
- Key TTL defaults to `max(30 days, SANDBOX_TIMEOUT_SECONDS)` unless overridden by `LLM_PROXY_KEY_DURATION`.

**Relevant code**:
- `packages/shared/src/llm-proxy.ts`
- `apps/web/src/server/routers/sessions-create.ts`

---

### 2) Sandbox Launch (Modal + E2B)
**Trigger**: Session created, provider spins up sandbox.

**Flow**:
1. Provider reads `LLM_PROXY_URL` using `getLLMProxyBaseURL()`.
2. Provider injects OpenCode env:
   - `ANTHROPIC_API_KEY` (virtual key)
   - `ANTHROPIC_BASE_URL` (proxy base URL)
3. Provider writes `opencode.json` with **baseURL only**, no embedded key.
4. Provider starts OpenCode with env overrides (key only in process env).

**Why**:
- Avoid writing keys into repo files or snapshots.
- Align behavior across Modal and E2B.

**Relevant code**:
- `packages/shared/src/providers/modal-libmodal.ts`
- `packages/shared/src/providers/e2b.ts`
- `packages/shared/src/sandbox/opencode.ts`

---

### 3) LLM Request Flow (Sandbox → LiteLLM → Anthropic)
**Trigger**: OpenCode sends a model request.

**Flow**:
1. OpenCode requests `POST /v1/messages` with `ANTHROPIC_API_KEY` set to the virtual key.
2. LiteLLM validates the virtual key against its DB.
3. LiteLLM forwards to Anthropic using real API key from env.
4. LiteLLM writes spend logs to `LiteLLM_SpendLogs` with:
   - `team_id = orgId`
   - `user = sessionId`
   - cost/tokens/metadata

**Relevant config**:
- `apps/llm-proxy/litellm/config.yaml`

---

### 4) Billing Sync
**Trigger**: Background worker runs on interval.

**Flow**:
1. Worker reads `LiteLLM_SpendLogs` and writes `billing_events`.
2. Outbox worker syncs to Autumn for credit deduction.

**Relevant code**:
- `apps/worker/src/billing-worker.ts`
- `packages/services/src/billing/db.ts`

---

## Security Model

- Sandboxes never see real provider keys.
- Virtual keys are scoped by org + session for attribution.
- Keys are not embedded in repo-level config or snapshots.
- LLM proxy can be configured to hard-fail session creation if not present (`LLM_PROXY_REQUIRED=true`).

---

## Failure Modes & Handling

- **Missing `LLM_PROXY_URL` with `LLM_PROXY_REQUIRED=true`**
  - Session creation fails with explicit error.

- **Key generation fails**
  - Session creation fails; no fallback to real provider keys.

- **Proxy misconfiguration (`/v1` suffix)**
  - `generateSessionAPIKey()` strips `/v1` for admin endpoints, while sandboxes use `/v1` for Anthropic calls.

---

## E2B Hosting Parity Notes

E2B calls consistently use `E2B_DOMAIN` and `E2B_DEBUG` for:
- `connect`
- `list`
- `kill`
- `betaPause`
- `getInfo`

Relevant code:
- `packages/shared/src/providers/e2b.ts`

---

## Appendix: Quick Reference

**Key generation entrypoint:**
- `packages/shared/src/llm-proxy.ts` → `generateSessionAPIKey()`

**OpenCode config generator:**
- `packages/shared/src/sandbox/opencode.ts` → `getOpencodeConfig()`

**LiteLLM config:**
- `apps/llm-proxy/litellm/config.yaml`

**Session creation:**
- `apps/web/src/server/routers/sessions-create.ts`
