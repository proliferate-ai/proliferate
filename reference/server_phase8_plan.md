# Server Phase 8 Plan

Status: implementation coordination reference.

Phase 8 is the server cleanup phase for systems whose remaining debt is tied
to transaction timing, lifecycle checkpoints, external side effects, locking,
retry behavior, or idempotency. It is not a general file-organization pass.

Inputs:

- `reference/server_phase7_remainder_audit.md`
- `reference/server_phase8_automation_workers_audit.md`
- `reference/server_phase8_cloud_mobility_audit.md`
- `reference/server_phase8_cloud_workspaces_audit.md`
- `reference/server_phase8_cloud_runtime_audit.md`
- `reference/server_phase8_billing_audit.md`

## Operating Rules

Work Phase 8 wave by wave. Do not start a later wave until the earlier wave's
PRs are merged and `main` is green.

Within a wave, parallelize only lanes that do not share core files or
transaction boundaries. Prefer smaller PRs with explicit invariants over broad
file moves.

Every Phase 8 implementation PR must:

- name its wave and lane in the PR description
- list the invariants it touches
- preserve public API shapes unless explicitly called out
- run `scripts/check_server_boundaries.py`
- run `scripts/check_max_lines.py`
- run targeted tests named by the owning audit
- update `scripts/server_boundaries_allowlist.txt` only when a violation count
  actually drops

Do not collapse long-running provider, AnyHarness, Stripe, GitHub, or worker
operations into one DB transaction. Stores should eventually become injected
DB primitives, but lifecycle entrypoints and worker services may still own
short explicit transactions around durable checkpoints.

## System Lanes

### Lane A: Automation Worker Claims

Primary audit:

- `reference/server_phase8_automation_workers_audit.md`

Owns:

- `server/proliferate/server/automations/**`
- `server/proliferate/db/store/automation_run_claims.py`
- `server/proliferate/db/store/automation_cloud_workspace_claims.py`
- `server/proliferate/db/store/automations.py`

Primary invariants:

- claim acquisition uses short locked transactions
- claim identity gates every mutation
- expired dispatching work fails instead of being reclaimed
- heartbeats only extend the current claim
- final dispatched/failed states clear claim metadata
- local executor claims are user/repo scoped
- cloud executor claims are global cloud-target claims
- scheduled run creation is idempotent
- workspace creation plus run attachment stays atomic

Allowlist targets:

- automation claim/store session factory rows
- automation claim/store commit rows

### Lane B: Cloud Mobility

Primary audit:

- `reference/server_phase8_cloud_mobility_audit.md`

Owns:

- `server/proliferate/server/cloud/mobility/**`
- `server/proliferate/db/store/cloud_mobility.py`

Primary invariants:

- one active handoff per mobility workspace
- one active handoff per user
- local-to-cloud start creates a durable handoff before provisioning
- provisioning failure after handoff creation marks handoff failed
- finalize flips visible owner before cleanup completes
- cleanup completion clears the active handoff
- stale expiry distinguishes pre-finalization failure from cleanup failure
- `cleanup_failed` remains active unless product behavior changes

Allowlist targets:

- `cloud_mobility.py` store session factory rows
- `cloud_mobility.py` store commit rows

### Lane C: Cloud Workspace Lifecycle

Primary audit:

- `reference/server_phase8_cloud_workspaces_audit.md`

Owns:

- `server/proliferate/server/cloud/workspaces/**`
- `server/proliferate/db/store/cloud_workspaces.py`
- `server/proliferate/db/store/cloud_workspace_setup_runs.py`

Primary invariants:

- create returns `pending` and does not block on provisioning
- repo-limit enforcement remains locked per billing subject
- provisioning progress checkpoints remain visible
- sandbox reservation preserves billing/concurrency limits
- provision finalization updates workspace/sandbox/runtime metadata together
- provision failure cleanup remains idempotent
- setup-run claims use row locks and skip-locked behavior
- setup-run finalization uses active-token protection
- stop/delete persists enough state for retry/debug after provider failure

Allowlist targets:

- `cloud/workspaces/service.py` ORM import rows
- `cloud_workspaces.py` store session factory and commit rows
- `cloud_workspace_setup_runs.py` store session factory and commit rows

### Lane D: Cloud Runtime Lifecycle

Primary audit:

- `reference/server_phase8_cloud_runtime_audit.md`

Owns:

- `server/proliferate/server/cloud/runtime/**`
- runtime-touching `server/proliferate/server/cloud/webhooks/**`
- `server/proliferate/db/store/cloud_runtime_environments.py`
- `server/proliferate/db/store/cloud_repo_config.py`
- `server/proliferate/db/store/cloud_worktree_policy.py`

Primary invariants:

- runtime generation changes only when process identity changes
- URL rotation alone does not increment generation
- killed/destroyed provider events clear runtime URL/token/active sandbox and
  increment generation
- sandbox reservation preserves billing-subject concurrency limits
- credential apply stays serialized per runtime environment
- process credential refresh refuses restart when AnyHarness has live sessions
- provisioning failure destroys newly allocated sandboxes and marks workspace
  error
- webhook dedupe and stale-event precedence remain intact
- worktree policy sync happens before runtime exposure/reuse where required

Allowlist targets:

- `cloud/runtime/service.py` ORM import rows
- `cloud_runtime_environments.py` store session factory and commit rows
- `cloud_repo_config.py` isolated runtime/workspace reads
- `cloud_worktree_policy.py` isolated runtime policy reads

### Lane E: Billing / Stripe

Primary audit:

- `reference/server_phase8_billing_audit.md`

Owns:

- `server/proliferate/server/billing/**`
- `server/proliferate/db/store/billing.py`
- `server/proliferate/integrations/billing/stripe.py`

Primary invariants:

- billing subjects and Stripe customers remain unique
- Stripe price classification preserves Pro, legacy cloud, and unknown-price
  behavior
- webhook receipts are claimed and processed idempotently
- duplicate Stripe events do not repeat side effects
- subscription sync preserves periods, items, seats, cancellation, and invoice
  state
- grants and seat-proration source refs remain idempotency keys
- accounting cursor/grant/export mutations remain one accounting unit
- observe mode never sends meter events
- enforce mode sends exports and handles retryable/terminal Stripe failures
- payment holds block/clear workspace actions as today
- billing reconciler remains single-pass locked and provider-state safe

Allowlist targets:

- Stripe integration product import row
- billing service ORM import rows
- billing store session factory, commit, and forbidden-import rows

## Wave Order

### Wave 0: Synthesis Plan

Owner count: one.

Goal:

- merge this plan before implementation agents start
- use this file as the coordination reference for Wave 1+

### Wave 1: Test Pinning

Can run in parallel across lanes.

Goal:

- add or strengthen characterization tests only
- make later behavior-preserving refactors fail if they break current
  invariants

Parallel assignments:

- **1A Automation claim tests**: claim/reclaim/dispatching/heartbeat/stale
  claim/local-scope/cloud-scope/scheduler duplicate behavior.
- **1B Mobility lifecycle tests**: preflight blockers, durable handoff start,
  failure marking, finalize/cleanup, stale expiry, retry ensure.
- **1C Workspace lifecycle tests**: status transitions, create/start behavior,
  setup-run claim/finalize/stale-token behavior, repo limits.
- **1D Runtime checkpoint tests**: generation semantics, URL rotation,
  provider killed clearing, credential apply/restart rules, sandbox
  reservation limits.
- **1E Billing behavior tests**: webhook idempotency, subscription sync,
  grant/payment-hold behavior, accounting atomicity, meter export failure
  classification.

Acceptance:

- no broad production code movement
- all new tests pass on current behavior
- every later lane has named tests to protect it

### Wave 2: Pure Domain Extraction

Can run in parallel after Wave 1 merges.

Goal:

- move synchronous product rules out of services/stores
- keep DB/session and external-call ownership unchanged

Parallel assignments:

- **2A Automation domain**: claim lifecycle status sets, transition predicates,
  claim error mapping.
- **2B Mobility domain**: active/final phase classification, retryability,
  stale-expiry outcome, owner/direction compatibility.
- **2C Workspace domain**: status transition map, post-ready phase rules,
  setup active-token decisions.
- **2D Runtime domain**: runtime generation/status rules, reconnect policy,
  credential revision decisions.
- **2E Billing domain**: pricing classification, entitlement/hold rules,
  grant/accounting planners, webhook extraction/planning.

Acceptance:

- new domain files are synchronous and I/O-free
- no store, integration, FastAPI, SQLAlchemy, or config imports in domain
  modules unless the relevant server guide explicitly allows it
- behavior tests from Wave 1 still pass

### Wave 3: Low-Risk DB Threading

Can run in parallel with tighter file ownership.

Goal:

- thread request DB sessions through simple HTTP/request paths
- add injected store primitives where safe
- avoid lifecycle checkpoint rewrites

Parallel assignments:

- **3A Automation local executor DB threading**: local executor API/service
  claim mutations, one HTTP request per transaction.
- **3B Mobility simple endpoint DB threading**: detail, heartbeat, phase,
  finalize, cleanup, fail. Do not convert list/backfill or start handoff yet.
- **3C Workspace simple HTTP DB threading**: list, detail, branch/display
  update, credential sync detail reload. Do not touch provisioning/setup
  monitor/stop/delete.
- **3D Billing request DB threading**: plan reads, checkout/portal/refill
  setup, overage settings. Do not touch accounting/export/reconciler.

Do not run runtime DB threading as an independent broad Wave 3 lane. Runtime
store wrappers are mostly lifecycle checkpoints and belong in later waves.

Acceptance:

- stores called by owned request paths accept `db: AsyncSession`
- request handlers own FastAPI `get_async_session` injection
- no long external operation is held inside a request transaction
- allowlist counts shrink only for migrated paths

### Wave 4: Transaction Boundary Services

Parallelism: low. Run at most two lanes at a time.

Goal:

- replace self-opening store wrappers with explicit lifecycle or worker
  service entrypoints
- preserve durable checkpoint semantics

Suggested order:

1. **4A Automation worker transaction service**: scheduler tick, cloud claim
   operations, heartbeat/fail/dispatch transitions.
2. **4B Mobility checkpoint service**: handoff start/failure checkpoint,
   stale expiry/backfill decision point.
3. **4C Runtime checkpoint foundation**: named runtime checkpoint service,
   runtime advisory lock primitive, sandbox reservation boundary.
4. **4D Workspace lifecycle entrypoints**: setup-run monitor transaction
   entrypoint, provisioning task entrypoint, stop/delete checkpoint shape.

Acceptance:

- transaction entrypoints are named by lifecycle intent
- stores below them are injected primitives
- no worker loop absorbs DB/query logic
- no provider/AnyHarness/GitHub/Stripe I/O occurs inside broad DB
  transactions

### Wave 5: Runtime / Workspace Split

Parallelism: coordinated, mostly sequential.

Goal:

- split the tightly-coupled runtime and workspace lifecycle after the
  checkpoint foundations exist

Suggested order:

1. **5A Workspace create/materialization split**: request create returns after
   record creation and schedules materialization through a narrow lifecycle
   interface.
2. **5B Runtime provisioning checkpoint migration**: replace low-risk
   `save_runtime_environment_state` callers with named checkpoints.
3. **5C Credential freshness split**: use runtime lock/checkpoint deps and
   pure credential rules.
4. **5D Reconnect split**: preserve URL rotation versus relaunch generation
   semantics.
5. **5E Setup-run conversion**: move setup monitor to injected store
   primitives.
6. **5F Stop/delete conversion**: separate provider side effects from
   persistence checkpoints.
7. **5G Repo config and worktree policy read threading**: remove isolated reads
   only after runtime/workspace entrypoints have explicit DB ownership.

Acceptance:

- workspace and runtime audits remain consistent after each PR
- setup-run, provisioning, credential, and reconnect tests protect generation
  and checkpoint behavior
- workspace/runtime store wrappers shrink without hiding sessions elsewhere

### Wave 6: Webhooks, Reconciler, Billing

Parallelism: careful and mostly sequential.

Goal:

- clean the remaining external-event and accounting systems after runtime
  checkpoints are explicit

Suggested order:

1. **6A Runtime webhook checkpoint conversion**: provider webhooks call named
   runtime checkpoints; dedupe and stale-event behavior unchanged.
2. **6B Billing reconciler runtime checkpoint conversion**: billing reconciler
   calls runtime lifecycle checkpoints for runtime state changes.
3. **6C Stripe integration boundary**: raw Stripe transport separate from
   product pricing/config validation.
4. **6D Billing error model**: move billing errors into shared product error
   shape and remove repeated route translation.
5. **6E Billing webhook service split**: receipt claim, event parsing,
   product dispatch, subscription sync, grants, and holds.
6. **6F Billing accounting/export split**: dedicated accounting and meter
   export execution modules with explicit transactions.
7. **6G Billing store package split**: split by persisted resource after
   callers are grouped.
8. **6H Billing reconciler thinning**: loop lifecycle only, pass logic behind
   service/domain modules.

Acceptance:

- Stripe webhook idempotency and billing accounting tests pass
- runtime generation/state tests pass after reconciler/webhook changes
- billing store no longer imports product helpers
- Stripe integration product import allowlist row is removed

### Wave 7: Wrapper Deletion And Allowlist Ratchet

Can run in parallel by system after implementation lanes land.

Goal:

- delete compatibility wrappers whose final callers have migrated
- shrink `scripts/server_boundaries_allowlist.txt`
- update `reference/server_phase7_remainder_audit.md`

Assignments:

- **7A Automation allowlist cleanup**
- **7B Mobility allowlist cleanup**
- **7C Workspace/setup-run allowlist cleanup**
- **7D Runtime/repo-config/worktree-policy allowlist cleanup**
- **7E Billing/Stripe allowlist cleanup**

Acceptance:

- server boundary checker passes with lower counts
- max-lines checker passes
- every remaining allowlist row is still represented in
  `reference/server_phase7_remainder_audit.md`
- no stale "small follow-up" rows remain for already-fixed files

## Cross-Lane Dependencies

- Automation worker workspace creation overlaps with cloud workspace lifecycle.
  Do not rewrite the atomic "lock current claim, create cloud workspace row,
  attach workspace ID to run" boundary independently in both lanes.
- Cloud workspace lifecycle overlaps with cloud runtime provisioning, setup
  monitor, repo config apply, and sandbox state. Coordinate Waves 4 and 5 for
  these lanes.
- Cloud runtime lifecycle overlaps with billing through active spend holds,
  sandbox usage, provider webhooks, and billing reconciler runtime checkpoints.
  Runtime checkpoint foundations should land before billing reconciler cleanup.
- Cloud mobility depends on cloud workspace and runtime identity, but its
  simple endpoint and pure lifecycle work can proceed earlier.
- Billing is last because it touches money, Stripe idempotency, runtime
  checkpointing, provider sandbox state, and accounting/export invariants.

## Recommended Immediate Next Step

After this plan merges, start Wave 1 with five parallel test-only PRs:

1. automation claim tests
2. cloud mobility lifecycle tests
3. cloud workspace lifecycle/setup-run tests
4. cloud runtime checkpoint tests
5. billing/Stripe behavior tests

Each PR should be scoped to tests and minimal test seams only. Do not begin
domain extraction or DB threading until all Wave 1 PRs are merged.
