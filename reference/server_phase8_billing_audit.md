# Server Phase 8: Billing / Stripe Audit

Status: complete audit.

This audit scopes the Phase 8 cleanup for billing, accounting, Stripe, and
usage export behavior. It is intentionally read-only: no code moved, no
transaction boundaries changed, and no Stripe/accounting behavior changed.

Read this before assigning billing implementation work. Billing is a Phase 8
system because it combines money movement, subscription state, usage metering,
Stripe webhooks, org seat counts, quota enforcement, and background
reconciliation.

## Scope

Primary paths:

- `server/proliferate/server/billing/api.py`
- `server/proliferate/server/billing/service.py`
- `server/proliferate/server/billing/stripe_webhooks.py`
- `server/proliferate/server/billing/reconciler.py`
- `server/proliferate/server/billing/accounting.py`
- `server/proliferate/server/billing/policy.py`
- `server/proliferate/server/billing/pricing.py`
- `server/proliferate/server/billing/seats.py`
- `server/proliferate/db/store/billing.py`
- `server/proliferate/db/models/billing.py`
- `server/proliferate/integrations/billing/stripe.py`

Existing focused background audit:

- `docs/server/audits/phase6-billing-reconciler.md`

## Current Responsibilities

### API Surface

`server/proliferate/server/billing/api.py` owns HTTP endpoints for plan reads,
cloud checkout, customer portal, refill checkout, overage settings, and Stripe
webhook intake.

Current gap:

- Handlers translate `BillingServiceError` to `HTTPException` inline.
- Handlers do not receive or thread request DB sessions because much of the
  billing service/store stack still opens isolated sessions internally.
- Auth is user-only at the route layer; organization owner/admin checks happen
  inside service functions.

### Billing Service

`server/proliferate/server/billing/service.py` currently owns several distinct
systems:

- billing snapshot construction and plan response mapping
- sandbox start authorization and decision-event recording
- personal/organization billing owner resolution
- Stripe customer creation, checkout, portal, and refill orchestration
- overage preference updates
- usage accounting pass orchestration
- pending seat adjustment processing
- pending Stripe meter-event export sending

Current gaps:

- It imports auth ORM `User` and billing ORM models directly.
- It calls store functions that self-open sessions and commit.
- It imports organization service helpers for owner resolution.
- It contains pure billing rules that would be easier to test in
  `server/billing/domain/**`.
- It mixes request-driven actions with background accounting/export work.

### Stripe Webhooks

`server/proliferate/server/billing/stripe_webhooks.py` owns signature
verification, event parsing, webhook receipt claiming, Stripe event dispatch,
subscription sync, invoice-paid grant creation, invoice-failed/payment-hold
behavior, and initial organization seat reconciliation.

Current gaps:

- Signature verification is integration-shaped, but lives in the product
  webhook file.
- Webhook parsing helpers and product decisions sit in the same file as the
  event dispatcher.
- The file imports ORM types and store wrappers directly.
- It calls Stripe integration functions while also mutating local billing
  state, which makes retry/idempotency boundaries hard to inspect.

### Billing Store

`server/proliferate/db/store/billing.py` owns persistence for:

- billing subjects
- subscriptions
- holds
- decision events
- grants and grant consumption
- usage cursors
- usage exports
- entitlements
- seat adjustments
- overage remainders
- usage segments
- webhook/sandbox event receipts
- billing reconciler advisory lock

It also performs cross-resource reads against cloud sandbox/workspace/runtime
ORM models and organization membership ORM models.

Current gaps:

- Many functions self-open `db_engine.async_session_factory()`.
- Many functions commit internally.
- The store imports product helpers from `server.billing.accounting`,
  `server.billing.models`, `server.billing.pricing`, and
  `server.billing.seats`.
- The file contains product accounting algorithms, not only persistence.
- Dataclasses are currently useful but still colocated in a god store file.

### Stripe Integration

`server/proliferate/integrations/billing/stripe.py` owns raw Stripe HTTP calls
for customers, checkout sessions, portal sessions, invoice/subscription reads,
meter events, price validation, and subscription item quantity updates.

Current gaps:

- The integration folder is a single-file folder.
- The Stripe adapter imports billing product pricing helpers.
- Price-validation functions contain product-specific expected amounts and
  configured Pro/legacy/overage behavior.

## Boundary Debt

Remaining allowlist entries directly in this system:

| Rule | Path | Count | Meaning |
|---|---:|---:|---|
| `INTEGRATION_PRODUCT_IMPORT` | `server/proliferate/integrations/billing/stripe.py` | 1 | Stripe integration imports billing product helpers. |
| `SERVICE_ORM_IMPORT` | `server/proliferate/server/billing/service.py` | 2 | Service imports auth/billing ORM models. |
| `STORE_COMMIT_ROLLBACK` | `server/proliferate/db/store/billing.py` | 33 | Store owns internal commits. |
| `STORE_FORBIDDEN_IMPORT` | `server/proliferate/db/store/billing.py` | 4 | Store imports product-layer helpers. |
| `STORE_SESSION_FACTORY_CALL` | `server/proliferate/db/store/billing.py` | 34 | Store opens internal sessions. |
| `STORE_SESSION_FACTORY_IMPORT` | `server/proliferate/db/store/billing.py` | 1 | Store imports the session factory. |

Large billing files:

| Path | Lines now | Target concern |
|---|---:|---|
| `server/proliferate/db/store/billing.py` | 2744 | Split by persisted resource and move pure accounting planning out. |
| `server/proliferate/server/billing/service.py` | 1312 | Split request actions, snapshot rules, accounting/export workers. |
| `server/proliferate/server/billing/stripe_webhooks.py` | 586 | Split integration verification/parsing from product event handling. |
| `server/proliferate/integrations/billing/stripe.py` | 427 | Promote or flatten according to integration rules. |
| `server/proliferate/db/models/billing.py` | 353 | Reasonable for now; split only with a billing schema package plan. |
| `server/proliferate/server/billing/reconciler.py` | 307 | Keep as a thin reconciler after service/store cleanup. |

## Invariants That Must Not Break

### Billing Subject Identity

- Personal billing subjects are unique by user.
- Organization billing subjects are unique by organization.
- Stripe customer IDs bind to billing subjects and must not duplicate.
- Stripe customer creation uses stable idempotency keys based on billing
  subject IDs.

### Stripe Price Classification

- Pro price, legacy cloud price, and unknown price classification determine
  whether a subscription is Pro, legacy paid cloud, or ignored.
- In Pro mode, Pro subscriptions carry a base monthly item and managed-cloud
  metered overage item.
- Legacy cloud subscriptions retain unlimited-cloud semantics when explicitly
  configured.
- Existing price validation must keep rejecting misconfigured monthly,
  overage, meter, and refill prices.

### Checkout And Portal Behavior

- Existing paid cloud subjects are sent to the customer portal instead of a
  duplicate checkout.
- Organization checkout requires owner/admin authorization and Pro billing
  enabled.
- Organization checkout seat quantity is derived from active billable seats.
- Refill checkout stays personal-only and disabled in Pro billing mode.

### Stripe Webhook Idempotency

- Stripe webhook receipts are unique by provider/event ID.
- A received event is claimed before dispatch.
- A processed receipt is marked processed after dispatch succeeds.
- Failed dispatch records the error and re-raises.
- Duplicate/already-owned events return an ack without repeating side effects.

### Subscription Sync

- Subscription metadata/customer lookup maps Stripe events back to billing
  subjects.
- Subscription upsert stores status, cancellation flags, periods, monthly and
  metered subscription items, latest invoice state, hosted invoice URL, and
  seat quantity.
- Initial organization seat reconciliation can mutate the Stripe item quantity
  immediately after subscription sync and must remain idempotent.

### Grants And Entitlements

- Grant `source_ref` values are idempotency keys.
- Refill checkout grants 10 hours once per checkout session.
- Pro invoice-paid grants per-seat monthly included managed-cloud hours for
  the Stripe subscription period.
- Seat-proration grants are tied to subscription, membership, and period.
- Unlimited cloud entitlement and legacy paid cloud subscriptions override
  finite accounting for the covered window.

### Seat Adjustments

- Seat adjustment rows use a unique `source_ref`.
- Pending/retryable rows are claimed with row locks and skip-locked behavior.
- Quantity updates to Stripe are idempotent by adjustment ID and target seats.
- Stripe-confirmed adjustments update subscription seat quantity.
- Grant issuance happens after Stripe quantity confirmation.
- Retryable Stripe failures must not become terminal unless the error is a
  non-429 4xx.
- Stale pending adjustments must not sync old quantities over newer seat
  counts.

### Usage Segments And Accounting

- Usage start/stop is idempotent by event receipt.
- Usage segments resolve billing subjects from runtime environments or
  workspaces.
- Accounting uses per-subject advisory locking.
- Usage cursors advance monotonically per usage segment.
- Grant consumption, usage cursor updates, overage remainder updates, and
  usage export row creation are one accounting unit.
- Pro overage exports are capped by per-seat overage settings and record
  writeoff rows when cap is exhausted.
- Observe mode records decisions but must not send Stripe meter events.
- Enforce mode sends pending usage exports.

### Stripe Meter Events

- Usage export rows are claimed with skip-locked behavior.
- Export identifiers are stable (`usage_export:<id>`).
- Stripe meter events cannot be sent more than 35 days in the past or more
  than 5 minutes in the future.
- Missing Stripe customer IDs fail terminally.
- Retryable Stripe export failures remain retryable.
- Successful exports persist the Stripe meter event identifier.

### Payment Holds And Quota Enforcement

- Invoice payment failure and subscription deletion apply a payment hold.
- Invoice paid clears payment-failed holds for the subject.
- Holds map to workspace action block reasons.
- In enforce mode, active spend holds pause active provider sandboxes and
  close usage segments.

### Reconciler Behavior

- Only one billing reconciler pass should run at a time.
- Placeholder repair must open missing usage segments for already-running
  sandboxes.
- Provider terminal states close local usage segments and mark runtime
  environments unavailable.
- Reconciler policy must preserve the current distinction between paused,
  destroyed, and active-spend-hold enforcement.

## Target Ownership Shape

The target is not a single giant "billing rewrite". It should be a staged
move toward this shape:

```text
server/proliferate/server/billing/
  api.py
  service.py                    # request-facing orchestration only
  models.py                     # API schemas and response constructors
  errors.py                     # Billing domain errors
  domain/
    accounting.py               # pure usage/grant/export planner
    plans.py                    # snapshot/plan policy rules
    pricing.py                  # price classification against configured ids
    seats.py                    # seat source refs and proration math
    webhooks.py                 # pure Stripe event extraction/planning
  accounting/
    service.py                  # accounting pass execution
    exports.py                  # usage export execution
  subscriptions/
    service.py                  # subscription sync and checkout/portal orchestration
    models.py                   # internal subscription result types
  webhooks/
    service.py                  # product Stripe event dispatch
    verification.py             # if not moved into integration
  reconciler.py                 # loop lifecycle and one pass call
```

Possible integration shape:

```text
server/proliferate/integrations/stripe/
  __init__.py
  client.py
  models.py
  errors.py
  checkout.py
  subscriptions.py
  webhooks.py
  meter_events.py
```

Do not create all folders in one PR. Let files earn the folder by moving real,
tested responsibilities.

Store target shape:

```text
server/proliferate/db/store/billing/
  subjects.py
  subscriptions.py
  holds.py
  grants.py
  usage_segments.py
  usage_accounting.py
  usage_exports.py
  seat_adjustments.py
  webhook_receipts.py
  decision_events.py
  locks.py
```

This package split should come after the accounting and webhook invariants are
pinned by tests. Store functions should take `db: AsyncSession` and never
commit. Worker/reconciler entry points own their transactions.

## Recommended Migration Sequence

### 1. Pin Behavior With Tests

Before moving code, add or strengthen tests for:

- duplicate Stripe webhook receipt does not repeat side effects
- subscription sync recognizes Pro, legacy cloud, and unknown prices
- invoice paid creates Pro period grants idempotently
- invoice payment failed applies one active payment hold
- payment hold clears on invoice paid
- initial org seat reconciliation is idempotent and retries correctly
- stale pending seat adjustment does not send old Stripe quantity
- accounting cursor/grant/export mutation is atomic for one subject
- observe mode does not send meter events
- enforce mode sends meter events and records terminal/retryable failures
- active-spend hold closes usage and pauses provider sandboxes

Existing coverage is meaningful, especially:

- `server/tests/unit/test_stripe_billing.py`
- `server/tests/unit/test_billing_reconciler.py`
- `server/tests/unit/test_billing_service_policy.py`
- `server/tests/integration/test_stripe_webhooks.py`
- `server/tests/integration/test_billing_api.py`
- `server/tests/integration/test_billing_accounting.py`
- `server/tests/integration/test_billing_accounting_boundaries.py`

### 2. Move Pure Rules First

Move synchronous rules out of `service.py`, `stripe_webhooks.py`, and
`db/store/billing.py` before changing DB sessions:

- subscription health and rollover grace
- unlimited-cloud entitlement/window calculation
- snapshot plan/policy construction
- active hold reason mapping
- grant type ordering and accounting boundaries
- usage export idempotency key construction
- Stripe event object extraction and subscription-line parsing
- terminal meter-event timing validation

These moves should be behavior-preserving and easy to unit test.

### 3. Split Stripe Integration Boundary

Separate raw Stripe transport from product pricing/config rules:

- Keep raw HTTP, headers, request encoding, and Stripe error type in the
  integration.
- Move product expected-price rules into billing domain or a billing service
  validator that calls integration `retrieve_price`.
- Decide whether to flatten `integrations/billing/stripe.py` to
  `integrations/stripe.py` or promote to a real `integrations/stripe/`
  package. Given current size and multiple concerns, a promoted package is
  likely justified.

This should remove the `INTEGRATION_PRODUCT_IMPORT` allowlist entry.

### 4. Introduce Billing Domain Errors

Move `BillingServiceError` out of `models.py` into `server/billing/errors.py`
and align with `server/proliferate/errors.py`.

Then remove repetitive route-level `try/except BillingServiceError` handling
after the global handler supports the billing error shape.

Do this before large service movement so newly split service modules share one
error model.

### 5. Thread Request DB Sessions Through Request-Facing Billing

Convert request-facing paths first:

- plan reads
- cloud plan/overview reads
- checkout/portal/refill setup
- overage settings

Handlers should receive `db: AsyncSession = Depends(get_async_session)`,
services should accept `db`, and stores should take `db`.

Do not mix this with accounting/export worker transactions.

### 6. Extract Subscription And Webhook Services

After domain rules and errors are stable:

- move checkout/portal/customer orchestration into
  `billing/subscriptions/service.py`
- move Stripe event dispatch and subscription sync into
  `billing/webhooks/service.py`
- keep signature verification either in `integrations/stripe/webhooks.py` or
  a narrow billing webhook verification module, but do not leave it mixed with
  product mutation logic

### 7. Split Accounting And Export Execution

Move the accounting pass and pending export sender out of request-facing
`service.py`:

- `billing/accounting/service.py` owns per-subject accounting execution
- `billing/accounting/exports.py` owns Stripe meter-event export sending
- pure accounting planners stay in `billing/domain/accounting.py`

This stage must preserve advisory locks, cursor mutation, grant consumption,
overage remainder math, and usage export idempotency.

### 8. Split Billing Store Package

Only after callers are grouped by concern, split `db/store/billing.py` by
persisted resource. Keep the package public surface minimal and avoid turning
`db/store/billing/__init__.py` into a convenience barrel unless the server DB
guide explicitly permits a store package public API exception.

### 9. Thin The Reconciler

Apply the earlier Phase 6 reconciler audit:

- keep loop lifecycle in `reconciler.py`
- move pass orchestration into billing service/accounting modules
- move provider-state decisions into domain planners
- keep provider calls behind integration boundaries

## Implementation Lanes

These lanes are intentionally ordered. Later lanes should not start until the
earlier lane's tests are merged unless explicitly coordinated.

### Lane A: Behavior Test Pinning

Docs/code ownership:

- tests only

Goal:

- Add missing tests for idempotency, accounting atomicity, and Stripe failure
  classification.

Acceptance:

- No production code movement except minimal test fixtures.
- Billing tests can fail if a later migration changes accounting/Stripe
  behavior.

### Lane B: Pure Domain Extraction

Docs/code ownership:

- `server/proliferate/server/billing/domain/**`
- pure helpers currently in service/webhooks/store

Goal:

- Move pure synchronous rules and planners out of service/store files.

Acceptance:

- No external calls, store calls, or async functions in new domain files.
- Unit tests cover the moved rules.

### Lane C: Stripe Integration Boundary

Docs/code ownership:

- `server/proliferate/integrations/billing/stripe.py`
- possible `server/proliferate/integrations/stripe/**`
- billing price validation caller

Goal:

- Remove product imports from the Stripe integration and give Stripe concerns
  a legal integration shape.

Acceptance:

- `INTEGRATION_PRODUCT_IMPORT` for Stripe is removed.
- Existing Stripe integration tests still pass.

### Lane D: Billing Error Model

Docs/code ownership:

- `server/proliferate/server/billing/errors.py`
- `server/proliferate/server/billing/api.py`
- billing service/webhook callers

Goal:

- Move billing service errors into the shared error model and remove normal
  route-level JSON error formatting.

Acceptance:

- Response shapes remain compatible.
- Billing routes no longer wrap every service call in repeated error
  translation.

### Lane E: Request DB Threading

Docs/code ownership:

- `server/proliferate/server/billing/api.py`
- request-facing billing services
- request-facing billing store reads/writes

Goal:

- Thread request `AsyncSession` through plan, checkout, portal, refill, and
  overage settings paths.

Acceptance:

- No worker/accounting/export transaction changes in this lane.
- Relevant `STORE_SESSION_FACTORY_*` counts shrink.

### Lane F: Webhook Service Split

Docs/code ownership:

- `server/proliferate/server/billing/stripe_webhooks.py`
- `server/proliferate/server/billing/webhooks/**`
- webhook receipt store functions

Goal:

- Split signature/event parsing, product event dispatch, subscription sync,
  grant creation, and payment hold behavior into coherent modules.

Acceptance:

- Webhook idempotency tests remain green.
- Duplicate events do not repeat side effects.

### Lane G: Accounting / Export Split

Docs/code ownership:

- `server/proliferate/server/billing/accounting/**`
- accounting/export store functions

Goal:

- Move accounting pass and Stripe meter-event export execution into dedicated
  modules with explicit transactions.

Acceptance:

- Advisory locks, cursor updates, grant consumption, overage remainders, and
  export rows remain atomic.
- Observe/enforce mode behavior remains unchanged.

### Lane H: Store Package Split

Docs/code ownership:

- `server/proliferate/db/store/billing.py`
- possible `server/proliferate/db/store/billing/**`

Goal:

- Split the store by resource after callers are grouped.

Acceptance:

- Store functions take `db: AsyncSession`.
- No store function opens sessions or commits.
- No product-layer imports from store files.

### Lane I: Reconciler Thinning

Docs/code ownership:

- `server/proliferate/server/billing/reconciler.py`
- billing accounting/reconciler service modules

Goal:

- Make `reconciler.py` a loop lifecycle file that calls one pass function.

Acceptance:

- Phase 6 reconciler audit acceptance is satisfied.
- Provider state policy is tested as pure logic.

## What Not To Do

- Do not rewrite billing in one PR.
- Do not change pricing, grants, quota, payment holds, or usage export
  semantics while moving files.
- Do not thread DB sessions through worker/export/accounting paths in the same
  PR as request-facing billing.
- Do not split `db/store/billing.py` mechanically before callers are grouped.
- Do not introduce a generic worker framework to fix billing.
- Do not promote `billing/worker/` until there are multiple worker-only
  concerns or a real worker process shape.
- Do not remove self-opening store wrappers until every caller's transaction
  boundary is understood.

## Verification For Future Implementation PRs

Minimum targeted checks for billing changes:

```bash
cd server
uv run ruff check proliferate/ tests/
DEBUG=1 uv run --python 3.12 --extra dev python -m pytest -q \
  tests/unit/test_stripe_billing.py \
  tests/unit/test_billing_service_policy.py \
  tests/unit/test_billing_reconciler.py \
  tests/integration/test_stripe_webhooks.py \
  tests/integration/test_billing_api.py \
  tests/integration/test_billing_accounting.py \
  tests/integration/test_billing_accounting_boundaries.py
```

Also run from the repository root:

```bash
/opt/homebrew/bin/python3.12 scripts/check_server_boundaries.py
/opt/homebrew/bin/python3.12 scripts/check_max_lines.py
git diff --check
```

Implementation PR descriptions should name which lane they are in and list
which invariants from this audit they intentionally touched.
