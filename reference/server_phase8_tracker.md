# Server Phase 8 Tracker

Status: pre-Wave-4 coordination tracker.

Scope: documentation only. This tracker owns
`reference/server_phase8_tracker.md`; it does not change server code or the
existing Phase 8 audit plan.

Source note: `reference/server_cleanup_migration_sequence.md` was requested as
an input, but it is not present on current `origin/main`. This tracker uses the
Phase 8 audit docs present on main plus the post-Wave-3 audit context.

## Baseline

- Post-Wave-3 green anchor: `be58fe84dc9eb3a346d30b12014d3e1c4e2a1797`.
- Tracker worktree base: current `origin/main`.
- Server boundary checks pass; no stale server boundary allowlist entries.
- Max-lines check passes with the current allowlist; the files below remain
  production pressure, not newly allowed patterns.

Remaining server boundary debt:

| Rule | Count | Notes |
| --- | ---: | --- |
| `STORE_SESSION_FACTORY_CALL` | 93 | Remaining self-opening store entrypoints. |
| `STORE_COMMIT_ROLLBACK` | 61 | Remaining store-owned transaction boundaries. |
| `STORE_SESSION_FACTORY_IMPORT` | 16 | Remaining store imports of the session factory. |
| `STORE_FORBIDDEN_IMPORT` | 4 | All in the billing store. |
| `SERVICE_ORM_IMPORT` | 5 | Billing, cloud runtime, and cloud workspaces services. |
| `INTEGRATION_PRODUCT_IMPORT` | 1 | Billing Stripe integration. |

Production max-line pressure:

- `server/proliferate/db/store/billing.py`
- `server/proliferate/server/billing/service.py`
- `server/proliferate/server/cloud/workspaces/service.py`
- `server/proliferate/server/cloud/runtime/provision.py`
- `server/proliferate/db/store/cloud_workspaces.py`
- `server/proliferate/db/store/cloud_mobility.py`

## Safe Pre-Wave-4 Follow-Ups

These are safe only while they stay narrow and do not pull forward deferred
Wave 4 semantics.

1. Organizations membership wrapper
   - Target the remaining isolated organization membership transaction wrapper.
   - Preserve current authorization, membership uniqueness, and caller-visible
     behavior.
   - Stop if the change needs billing, cloud workspace, or mobility lifecycle
     behavior.

2. Automations scheduler transaction boundaries
   - Move scheduler batch transaction ownership toward worker/service
     entrypoints where the boundary is already clear.
   - Preserve scheduled-run idempotency and next-run advancement behavior.
   - Stop if the change touches run-claim acquisition, heartbeat, dispatching,
     or cloud workspace creation plus run attachment.

## Wave 4 Deferred-Complex Lane Order

Run these lanes in order unless a later coordination note changes ownership.
Parallelism should stay low because these lanes share durable checkpoints,
external side effects, and retry semantics.

### 1. Billing / Accounting

Owned paths:

- `server/proliferate/server/billing/**`
- `server/proliferate/db/store/billing.py`
- `server/proliferate/integrations/billing/stripe.py`
- `server/proliferate/constants/billing.py` when policy constants move with
  the lane

Invariants:

- Billing subjects and Stripe customers remain unique.
- Stripe price classification preserves Pro, legacy cloud, and unknown-price
  behavior.
- Webhook receipts are claimed and processed idempotently; duplicate Stripe
  events do not repeat side effects.
- Subscription sync preserves periods, items, seats, cancellation, and invoice
  state.
- Grants, seat-proration source refs, accounting cursors, and exports remain
  idempotent accounting units.
- Observe mode never sends meter events; enforce mode sends exports and keeps
  retryable versus terminal Stripe failures distinct.
- Payment holds continue to block and clear workspace actions as today.
- The billing reconciler remains single-pass locked and provider-state safe.

Stop conditions:

- A change requires broad Stripe I/O inside a DB transaction.
- Runtime or workspace billing locks need changes not coordinated with their
  lane owners.
- Price, plan, entitlement, or hold behavior is unclear or untested.
- The store split becomes mechanical before accounting/webhook callers are
  grouped behind explicit service boundaries.

### 2. Runtime Lifecycle

Owned paths:

- `server/proliferate/server/cloud/runtime/**`
- Runtime-touching `server/proliferate/server/cloud/webhooks/**` paths when
  present
- `server/proliferate/db/store/cloud_runtime_environments.py`
- `server/proliferate/db/store/cloud_repo_config.py`
- `server/proliferate/db/store/cloud_worktree_policy.py`

Invariants:

- Runtime generation changes only when process identity changes.
- URL rotation alone does not increment generation.
- Killed or destroyed provider events clear runtime URL, token, active sandbox,
  and increment generation.
- Sandbox reservation preserves billing-subject concurrency limits.
- Credential apply stays serialized per runtime environment.
- Process credential refresh refuses restart when AnyHarness has live sessions.
- Provisioning failure destroys newly allocated sandboxes and marks workspace
  error.
- Webhook dedupe and stale-event precedence remain intact.
- Worktree policy sync happens before runtime exposure or reuse where required.

Stop conditions:

- Provider or AnyHarness operations would be held inside a broad DB
  transaction.
- Runtime generation semantics are ambiguous at a callsite.
- Billing accounting decisions would move into runtime lifecycle modules.
- Workspace setup-run ownership is required before the runtime checkpoint
  boundary is explicit.
- Isolated repo-config or worktree-policy wrappers would be removed before all
  deferred callers are migrated.

### 3. Automation Claim Semantics

Owned paths:

- `server/proliferate/server/automations/**`
- `server/proliferate/db/store/automations.py`
- `server/proliferate/db/store/automation_run_claims.py`
- `server/proliferate/db/store/automation_run_claim_transitions.py`
- `server/proliferate/db/store/automation_run_claim_values.py`
- `server/proliferate/db/store/automation_cloud_workspace_claims.py`

Invariants:

- Claim acquisition uses short locked transactions.
- Claim identity gates every mutation.
- Expired dispatching work fails instead of being reclaimed.
- Heartbeats only extend the current claim.
- Final dispatched or failed states clear claim metadata.
- Local executor claims stay user and repository scoped.
- Cloud executor claims stay global cloud-target claims.
- Scheduled run creation is idempotent.
- Cloud workspace creation plus run attachment stays atomic.

Stop conditions:

- `dispatching` would become reclaimable.
- `claim_id` validation would be removed from a mutation.
- `FOR UPDATE SKIP LOCKED` selection would become read-then-write logic.
- Cloud workspace lifecycle changes are required without the workspace lane.
- External workspace or provider I/O would happen inside a claim transaction.

### 4. Workspace Lifecycle

Owned paths:

- `server/proliferate/server/cloud/workspaces/**`
- `server/proliferate/db/store/cloud_workspaces.py`
- `server/proliferate/db/store/cloud_workspace_setup_runs.py`
- Workspace setup/provision callsites in
  `server/proliferate/server/cloud/runtime/setup_monitor.py` and
  `server/proliferate/server/cloud/runtime/provision.py` by coordination with
  the runtime lane

Invariants:

- Create returns `pending` and does not block on provisioning.
- Repo-limit enforcement remains locked per billing subject.
- Provisioning progress checkpoints remain visible.
- Sandbox reservation preserves billing and concurrency limits.
- Provision finalization updates workspace, sandbox, and runtime metadata
  together.
- Provision failure cleanup remains idempotent.
- Setup-run claims use row locks and skip-locked behavior.
- Setup-run finalization uses active-token protection.
- Stop/delete persists enough state for retry and debug after provider
  failure.

Stop conditions:

- Workspace create would block on provider, GitHub, AnyHarness, or setup work.
- Long external I/O would be held inside a broad DB transaction.
- Setup-run finalization would lose active-token protection.
- Runtime generation or provisioning checkpoints are needed before their
  lifecycle boundary is explicit.
- Billing repo-limit or concurrency semantics cannot be preserved locally.

### 5. MCP Materialization

Owned paths:

- `server/proliferate/server/cloud/mcp_materialization/**`
- `server/proliferate/server/cloud/mcp_connections/**`
- `server/proliferate/server/cloud/mcp_oauth/**`
- `server/proliferate/server/cloud/mcp_catalog/**`
- `server/proliferate/db/store/cloud_mcp/**`
- `server/proliferate/integrations/mcp_oauth/**`
- `server/proliferate/constants/cloud_mcp.py`
- `server/proliferate/constants/mcp_catalog.py`

Invariants:

- Materialization respects the cloud MCP feature flag.
- Only enabled, configured, user-owned connections are materialized.
- Target compatibility is preserved; stdio materialization remains local-only.
- Per-connection failures produce summaries and warnings instead of failing the
  whole batch.
- Materialization concurrency and timeout behavior remain bounded.
- OAuth refresh stays serialized per connection.
- OAuth auth updates remain version-gated; stale refresh races fall back to the
  latest ready token.
- Provider `invalid_grant` continues to mark the connection as needing
  reconnect.
- Integration calls remain behind `integrations/mcp_oauth/**`.

Stop conditions:

- The response wire shape for session MCP bindings, candidates, summaries, or
  warnings would change.
- OAuth provider refresh would happen inside a broad DB transaction.
- Version-gated auth updates would be weakened or removed.
- One failed connector would abort materializing unrelated connections.
- Workspace or runtime materialization semantics are required before their
  lifecycle lanes establish explicit boundaries.
