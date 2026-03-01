# LLM Proxy Architecture (V1)

## Goal
Define a stable, production-safe LLM proxy architecture for V1 that matches the existing Proliferate LiteLLM pattern:
- short-lived virtual keys for sandbox traffic
- server-side control-plane key management
- durable spend ingestion into billing events
- model routing alignment with OpenCode/runtime config

This spec intentionally follows the old/current architecture rather than inventing a new proxy stack.

## Scope
In scope:
- Session virtual key generation/revocation flow
- Team/org mapping in proxy
- Sandbox URL/key injection contract
- Spend sync contract and cursor semantics
- Model routing contract (canonical model -> proxy model mapping)
- Self-host deployment expectations for proxy

Out of scope:
- Pricing strategy and credit policy details (see `07-cloud-billing.md`)
- Session lifecycle orchestration beyond env/key contract
- Secret storage internals outside referenced services

## High-level architecture (existing pattern)

```text
Sandbox/OpenCode --(virtual key + base URL)--> LiteLLM Proxy --> Provider APIs
       ^                                              |
       |                                              v
Gateway/Services --(master key admin APIs)--> key/team mgmt + spend logs
```

Control-plane plane:
- Uses proxy admin endpoints with master key
- Creates team if needed
- Mints short-lived session key
- Reads spend logs for billing sync

Sandbox data plane:
- Uses only session virtual key
- Never receives proxy master key
- Sends model requests through proxy base URL

## File tree and ownership

```text
apps/llm-proxy/
  litellm/config.yaml                # model/provider routing config
  Dockerfile                         # proxy image build
  README.md                          # runtime/deploy notes

packages/shared/src/
  llm-proxy.ts                       # key generation, team ensure, URL helpers, revoke

packages/services/src/sessions/
  sandbox-env.ts                     # sandbox env assembly, proxy key injection

packages/services/src/billing/
  litellm-api.ts                     # spend/logs REST client
  db.ts                              # llm spend cursor persistence

apps/worker/src/jobs/billing/
  llm-sync-dispatcher.job.ts         # org fanout
  llm-sync-org.job.ts                # per-org spend ingestion
```

## Core data models

| Model | Purpose | File |
|---|---|---|
| `llm_spend_cursors` | Per-org incremental spend cursor | `packages/db/src/schema/billing.ts` |
| `billing_events` | Durable billable usage entries | `packages/db/src/schema/billing.ts` |
| `sessions` | Session identity for key scoping/audit linkage | `packages/db/src/schema/sessions.ts` |
| `organization` | Team/org identity and billing state | `packages/db/src/schema/schema.ts` |

## Runtime contract

### 1) Session key generation
When runtime boots or resumes:
1. Ensure proxy team exists for org (`team_id = organizationId`)
2. Generate fresh short-lived virtual key (`user_id = sessionId`, alias bound to session)
3. Inject proxy base URL + virtual key into sandbox runtime env
4. Attach synchronous budget/rate limits to virtual key (org/session policy)

Rules:
- Duration defaults from `LLM_PROXY_KEY_DURATION` (or sensible default)
- Replace/revoke prior alias key for same session when regenerating (boot or resume)
- Fail fast if proxy is required and key generation fails
- Key-level budget/rate limits must be set at issuance time for real-time enforcement (not only async billing)
- Expired virtual keys must never be revived from persisted snapshot/env state.

### 2) Sandbox env injection
Preferred secure mode:
- `sandbox-daemon` receives session virtual key in daemon-only secret context.
- Daemon exposes local loopback proxy endpoint (for example `127.0.0.1:<port>`) for harness model traffic.
- Harness points `ANTHROPIC_BASE_URL` at local daemon proxy endpoint.
- Harness uses non-sensitive placeholder api key value; real virtual key is attached by daemon when forwarding to LiteLLM.

Direct env mode (simple, less hardened):
- Sandbox process receives `ANTHROPIC_API_KEY` (virtual key) and `ANTHROPIC_BASE_URL` directly.
- Allowed for controlled environments, but not preferred for hardened environments.

Sandbox must not receive:
- `LLM_PROXY_MASTER_KEY`
- raw provider long-lived keys when proxy mode is enabled

### 3) Revocation behavior
On pause/termination/enforcement:
- revoke session alias key best-effort
- revocation failure should not block lifecycle transitions

Resume behavior:
- On resume, runtime must request a newly valid session virtual key before first model call.
- `401/invalid_key` from proxy should trigger one controlled refresh path before surfacing hard failure.

### 4) Spend ingestion
Worker pipeline:
1. Dispatcher enqueues org sync jobs
2. Per-org job calls proxy spend logs API (bounded window)
3. Convert rows to idempotent billing events
4. Advance org cursor deterministically

Idempotency:
- use provider request identifiers for dedupe keying (`llm:{request_id}` pattern)
- cursor progression alone is not the sole dedupe guarantee

Billing source-of-truth rule:
- LiteLLM spend ingestion is the sole source-of-truth for billable LLM token usage.
- Gateway runtime stream telemetry may provide realtime usage hints for UX, but must not be used as authoritative token billing.

Real-time budget enforcement rule:
- Async spend ingestion is ledger truth, but budget blocking must occur synchronously in proxy/key enforcement path.
- When key budget is exhausted, proxy rejects requests immediately (for example 429/policy denial).
- Runtime must treat budget-denied responses as terminal or pause-worthy policy events, not transient transport errors.

## URL and environment contract

Required env:
- `LLM_PROXY_URL`
- `LLM_PROXY_MASTER_KEY`

Optional env:
- `LLM_PROXY_PUBLIC_URL` (sandbox-facing URL override)
- `LLM_PROXY_ADMIN_URL` (admin API override)
- `LLM_PROXY_KEY_DURATION`
- `LLM_PROXY_REQUIRED`

URL rules:
- admin calls use admin URL role
- sandbox base URL uses public URL role
- normalize base URL to single `/v1` suffix for consistent SDK/runtime behavior

## Model routing contract

Three surfaces must stay aligned:
1. Canonical model IDs in shared model catalog
2. OpenCode/provider config generated for sandbox runtime
3. LiteLLM model mapping in `apps/llm-proxy/litellm/config.yaml`

Any model add/change must update all three surfaces in one change.

## Security invariants

- Master key is server-side only.
- Sandbox uses short-lived virtual keys only, preferably via daemon-local proxy indirection.
- Proxy key generation and spend reads are audited and attributable to org/session context.
- No browser client can call proxy admin endpoints directly.
- Budget/rate policy must be enforced at proxy ingress for each virtual key.

## Self-hosting expectations

For self-host customers:
- proxy can run as a separate service/container
- operator supplies provider API keys and proxy master key
- app services use configured proxy admin/public URLs
- billing worker can reach spend logs endpoint

This keeps cloud and self-host behavior aligned with one architecture.

## Definition of done checklist

- [ ] Session startup mints short-lived proxy key and injects sandbox env correctly
- [ ] Proxy master key is never exposed to sandbox/runtime logs
- [ ] Spend sync writes idempotent `billing_events` and advances per-org cursor
- [ ] URL roles (admin/public) are respected and `/v1` normalization is consistent
- [ ] Model routing remains aligned across shared catalog, runtime config, and LiteLLM config
- [ ] Self-host operator has clear required env and deploy contract
