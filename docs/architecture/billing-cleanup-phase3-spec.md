# Billing Cleanup Phase 3 Spec

Status: implemented and verified in `codex/billing-cleanup-phase3-spec`
Date: 2026-05-24
Branch: codex/billing-cleanup-phase3-spec
Scope: Full org billing cleanup, account free allocations, production LiteLLM
and BYOK validation, and end-to-end billing UX hardening.

## Executive Summary

Phase 1 and Phase 2 are treated as landed.

Phase 1 established the product model that a user may have zero or one active
organization, organizations are created by Team billing, and product-facing
billing is organization billing only.

Phase 2 established the agent gateway foundation: Proliferate-provided free
LLM credits, plan-derived managed credit budget plumbing, BYOK route-isolation
gates, LiteLLM provisioning helpers, gateway hot-path fail-closed checks, SDK
hooks, and Web Home free-credit launch preparation.

Phase 3 finishes the billing product and operational story:

- Remove "personal billing" from product UX and app-owned flows.
- Keep free account allocations for users who do not have an organization.
- Make Team billing the only purchase path for the product.
- Make Stripe subscription, seat, overage, cancellation, and webhook behavior
  deterministic and fully tested.
- Make billing state first-class in workspace launch/readiness flows on Web and
  Desktop.
- Turn LiteLLM/BYOK from "code exists behind gates" into a proven production
  capability or an explicitly disabled one.
- Add live-provider test lanes for Stripe, LiteLLM, Bedrock, gateway runtime
  grants, Web, and Desktop.
- Add production infrastructure checks so deploy-time config cannot silently
  diverge from product flags.

The target end state is simple for users:

```text
New user
  gets account free cloud/LLM credits
  can run personal cloud work until credits are exhausted
  sees no personal paid billing surface
  can start a Team plan to create an organization

Team owner/admin
  manages seats, invoices, payment method, overage cap, shared sandbox,
  shared auth, managed LLM credits, and any enabled BYOK gateway credentials
  from Team billing/admin settings

Team member
  gets team functionality by joining the org
  never has to understand separate personal billing
```

## Implementation Verification Addendum

This worktree implements the Phase 3 backend, SDK, Web, Desktop, operational
checks, and tests described below. The final verification pass on 2026-05-24
covered:

- Stripe test-mode resource setup via `make stripe-setup-test`.
- `make dev PROFILE=billing-p3-stripe-smoke AGENT_GATEWAY=1 STRIPE=1` with
  Account credits and managed LLM credit env enabled.
- Live local API smoke against that profile:
  - account credits load and `POST /v1/billing/account-credits/ensure`
    creates the free allocation;
  - `GET /v1/billing/team` reports that a no-org user can create a Team;
  - `POST /v1/billing/team/checkout` creates a pending organization checkout
    intent and a real Stripe test-mode Checkout session;
  - Stripe confirms the Checkout session is `livemode=false`,
    `mode=subscription`, and includes the Team seat price plus managed-cloud
    overage price;
  - pre-activation `PATCH /v1/billing/team/overage` fails with `team_not_found`,
    which is expected until checkout completion activates the Team.
- Browser smoke:
  - Desktop Billing settings render the Account credits plus Team billing
    product model with no personal paid billing surface;
  - Desktop Organization settings show signed-out/permission-safe states;
  - Stripe Checkout opens from the generated test session and displays the
    Team subscription line items;
  - the dev Stripe success/cancel return URLs now target
    `/settings/billing?checkout=...`.
  - Web Billing was clicked through with a real dev token, local GitHub grant,
    Account credits ensure action, Team creation form, Stripe Checkout redirect,
    and cancel-return back to Billing.
  - Pending Team checkout UI now has a single lane: Billing shows Continue
    checkout actions and zero Start Team actions, while Organization shows only
    Continue/Cancel and hides the duplicate create-team form.
  - Desktop renderer Billing was loaded against the restarted profile and
    renders the shared plan ladder plus Account credits / Team billing empty
    states without exposing a personal paid billing path.
- BYOK/gateway readiness smoke:
  - default readiness check passes with BYOK disabled;
  - synthetic signed proof artifact passes when BYOK/isolation env is complete;
  - missing live-validation/proof env fails closed;
  - `agent-gateway-live-proof.py all` skips absent local live providers;
  - `agent-gateway-live-proof.py all --require-live` fails absent live endpoints
    and provider credentials.
- Automated verification:
  - focused server billing/gateway suite;
  - product-model billing/environment suite;
  - product-ui billing tests and typecheck;
  - Web tests and production build;
  - Desktop test suite;
  - script syntax checks and `git diff --check`.

The only manual path intentionally not completed in the browser was the final
Stripe payment submission for the test-mode subscription. That action would
create a Stripe test subscription through the browser; webhook activation is
covered by integration tests and can be live-clicked with explicit confirmation
when needed.

## Docs, Code, And Infra Reviewed

Docs read before writing this spec:

- `docs/README.md`
- `docs/server/README.md`
- `docs/frontend/README.md`
- `docs/sdk/README.md`
- `docs/ci-cd/README.md`
- `docs/current/specs/09-billing.md`
- `docs/architecture/org-membership-cleanup-spec.md`
- `docs/architecture/agent-llm-auth-gateway-spec.md`
- `docs/server/audits/phase6-billing-reconciler.md`
- `docs/reference/env-vars.yaml`
- `docs/reference/deployment-self-hosting.md`
- `docs/notes/agent-gateway-phase0-compatibility.md`

Representative code paths reviewed:

- `server/proliferate/db/models/billing.py`
- `server/proliferate/db/store/billing.py`
- `server/proliferate/server/billing/api.py`
- `server/proliferate/server/billing/service.py`
- `server/proliferate/server/billing/stripe_webhooks.py`
- `server/proliferate/server/billing/reconciler.py`
- `server/proliferate/server/billing/domain/*`
- `server/proliferate/server/cloud/agent_auth/service.py`
- `server/proliferate/server/cloud/agent_auth/domain/byok_policy.py`
- `server/proliferate/server/agent_gateway/service.py`
- `server/proliferate/integrations/litellm/*`
- `web/src/components/settings/screen/BillingSettingsSection.tsx`
- `web/src/components/home/screen/HomeScreen.tsx`
- `desktop/src/hooks/access/cloud/use-cloud-billing.ts`
- `packages/product-ui/src/billing/BillingSettingsPane.tsx`
- `packages/product-ui/src/billing/billing-plan-ladder.ts`
- `cloud/sdk/src/client/billing.ts`
- `cloud/sdk-react/src/hooks/billing.ts`
- `server/tests/integration/test_billing_*.py`
- `server/tests/integration/test_stripe_webhooks.py`
- `server/tests/integration/test_cloud_agent_auth_api.py`
- `server/tests/integration/test_agent_gateway_api.py`
- `server/tests/unit/test_billing_*.py`
- `server/tests/unit/test_stripe_billing.py`
- `scripts/stripe-setup-test-mode.mjs`
- `scripts/agent-gateway-phase0-probe.py`
- `Makefile`
- `server/infra/self-hosted-aws/template.yaml`
- `server/deploy/*`

External/current references checked:

- LiteLLM official virtual key docs:
  `https://docs.litellm.ai/docs/proxy/virtual_keys`
- LiteLLM official team budget docs:
  `https://docs.litellm.ai/docs/proxy/team_budgets`
- LiteLLM official per-team/project credential routing docs:
  `https://docs.litellm.ai/docs/proxy/credential_routing`
- LiteLLM official AWS Bedrock provider docs:
  `https://docs.litellm.ai/docs/providers/bedrock`
- Stripe official webhook docs:
  `https://docs.stripe.com/webhooks`
- Stripe official event type docs:
  `https://docs.stripe.com/api/events/types`
- Stripe official subscription object docs:
  `https://docs.stripe.com/api/subscriptions/object`

Local infrastructure inventory was checked with AWS CLI without printing secret
values. The inventory is intentionally not treated as canonical in this public
architecture spec because ECS service names and task revisions drift quickly.
The important conclusions were:

- Production/staging task definitions inspected during this pass did not yet
  prove the newly merged `AGENT_GATEWAY_*` env surface is deployed.
- Earlier LiteLLM/proxy infrastructure exists and at least one observed proxy
  entry point was public. Phase 3 must either retire that path or prove it is
  unrelated to the new gateway before enabling BYOK.
- The target architecture requires LiteLLM to be private whenever BYOK is
  enabled.

Note: `~/litellm` was not present on this machine during this pass. This spec
therefore uses official LiteLLM docs plus the current Proliferate integration
code as its source for LiteLLM behavior.

## Product Definitions

### Terminology

Allowed customer-facing terms:

- `Account credits`: free managed cloud and free managed LLM allocation attached
  to a user account.
- `Free credits`: short label for Account credits.
- `Personal Cloud`: a workspace/sandbox target owned by the user. This is not a
  billing product.
- `Team billing`: the paid organization subscription path.
- `Team`: the product-facing name for an organization in billing copy.

Forbidden customer-facing terms in new Phase 3 UI:

- `personal billing`
- `personal paid plan`
- `personal overage`
- `refill`
- `Pro` as plan copy, unless retained only as an internal constant or Stripe
  price identifier
- `org billing`, unless the UI context is developer/admin diagnostic copy

### Account Credits

Free usage attached to a Proliferate user account. This includes:

- Free managed cloud compute.
- Free Proliferate-provided LLM credits.

Account credits are not personal billing. The user does not enter a credit card
for this path and does not have a paid personal subscription.

Implementation can continue to use personal `billing_subject` rows internally
for ledger compatibility, but UI and SDK product language should call this
"Account credits" or "Free credits."

### Team Billing

The only paid product billing model.

Team billing belongs to exactly one organization. A Team subscription owns:

- Seats.
- Shared/team feature entitlement.
- Managed cloud included hours.
- Managed cloud overage policy and cap.
- Team managed LLM credits.
- Billing portal, invoices, payment state, and cancellation state.

### Managed Cloud Overage

Team-owned compute overage, capped by organization policy.

Overage is not a personal purchase. In Phase 3 the main overage controls should
be org-only. Legacy personal overage endpoints may remain temporarily for old
subjects, but they should be hidden from new product flows and marked
deprecated.

### Managed LLM Credits

Proliferate-funded LLM budget enforced through LiteLLM.

There are two subtypes:

- Account free LLM credits for onboarding.
- Team included LLM credits for organizations.

V1 has no managed LLM overage. When a managed LLM budget is exhausted, gateway
launch and request paths fail closed.

### BYOK Gateway

Customer-owned provider credentials stored server-side and routed through
Proliferate Gateway and LiteLLM.

BYOK must remain gated unless the deployed LiteLLM topology proves customer
secret isolation. The current code correctly has route-isolation gates; Phase 3
must add live validation and production readiness checks that justify turning
those flags on.

## Current State After Phase 1 And Phase 2

### Already Good Enough To Build On

- `free_cloud_allocation` exists and is keyed by GitHub provider identity plus
  allocation kind and period key.
- Account free LLM credits are provisioned through
  `ensure_free_managed_credits_for_user`.
- Free LLM credit entitlement is idempotent and terminal states are preserved.
- Org managed credit budget amount is derived from billing state and
  `AGENT_GATEWAY_MANAGED_BUDGET_*_USD`.
- BYOK creation and launch use shared policy gates from
  `server/cloud/agent_auth/domain/byok_policy.py`.
- The gateway hot path re-checks BYOK availability instead of trusting a stale
  runtime grant.
- LiteLLM budget errors mark managed budgets and free-credit entitlements as
  exhausted.
- Web Home calls `ensureFreeCredits` before cloud workspace creation.
- Workspace responses already have a `WorkspaceBillingSummary` shape in the
  generated SDK.
- Web Settings has a Billing section.
- Desktop has existing billing hooks and shared product-ui billing components.
- Team checkout exists and creates pending org checkout intents.
- Seat adjustments and org membership cleanup have already started.

### Remaining Product And Technical Gaps

1. **Personal billing language still leaks.**

   Current APIs and UI still include `ownerScope: "personal"` and actions such
   as cloud checkout/refill for personal subjects. Internally this may be
   acceptable short term, but product-facing copy must not present a paid
   personal plan.

2. **Team billing is not the only obvious paid path.**

   The account/free state should route to "Start Team" rather than "Upgrade
   personal cloud." Any legacy personal paid subscriptions should be handled as
   grandfathered objects, not advertised.

3. **Billing API shape is transitional.**

   `GET /v1/billing/cloud-plan` and `/overview` accept an owner selection. That
   is useful internally, but Web and Desktop should consume clearer
   account-credit and team-billing facades so product flows stop reintroducing
   "personal billing."

4. **Stripe cancellation semantics need refinement.**

   `customer.subscription.deleted` currently applies a payment hold broadly.
   Clean cancellations at period end should not be treated as payment failure.

5. **Stripe webhook coverage is incomplete.**

   `invoice.upcoming` and `customer.subscription.trial_will_end` are still not
   productized. More importantly, seat quantity, cancellation, portal, and
   webhook idempotency need end-to-end tests against Stripe test mode, not only
   unit payload tests.

6. **Billing reconciler remains a broad transitional file.**

   The audit already says not to rewrite it all at once. Phase 3 should add
   targeted planner/store seams only where needed for billing correctness and
   testability.

7. **LiteLLM/BYOK has strong fake-client coverage but not enough live proof.**

   The current tests verify policy gates, idempotency, provisioning shapes, and
   gateway forwarding with fakes. Phase 3 must prove the deployed LiteLLM
   topology can isolate tenant credentials and enforce budgets with real
   LiteLLM and Bedrock/OpenAI/Anthropic provider paths before BYOK flags can be
   enabled.

8. **Production infrastructure is not aligned with the new gateway env surface.**

   Local AWS inspection showed earlier LiteLLM/proxy/gateway infrastructure
   exists, while the merged FastAPI server owns `/agent-gateway/*` routes.
   Phase 3 needs a deliberate target:
   either public gateway routes on the API service plus private LiteLLM, or a
   separate new gateway service running the same current code. Avoid keeping two
   unrelated gateway concepts alive.

## Target UX

### New User Without A Team

Settings shows:

- Account identity.
- Account credits.
- Repositories/environments.
- Agent auth.
- Plugins.

Billing copy:

```text
Account credits
Free cloud and LLM credits included with your account.
```

Primary actions:

- Use credits.
- Connect GitHub if credits require GitHub identity.
- Start a Team plan.

No "personal billing", "personal overage", or "personal paid plan" language.

### User Starts A Team

User clicks "Start Team" from Billing or Organization settings.

Flow:

1. Enter team name.
2. Optional invite emails.
3. Server creates pending organization + checkout intent.
4. Stripe Checkout starts a subscription for the Team monthly seat price.
5. On `checkout.session.completed` and/or subscription activation webhooks:
   - server validates Stripe customer, metadata, Team price item, seat
     quantity, period data, and overage item before activation;
   - organization becomes active;
   - owner membership is active;
   - organization billing subject is bound to Stripe customer/subscription;
   - shared sandbox profile is ensured;
   - initial seat quantity is reconciled;
   - included compute grant is issued;
   - managed LLM budget reconcile is queued or run;
   - staged invites are sent.
6. User returns to Web/Desktop Billing, which shows Team billing state.

### Team Billing Page

For owners/admins:

- Current plan.
- Seat count and active members.
- Next invoice / latest invoice status if available.
- Payment state.
- Managed cloud included hours.
- Managed cloud used/remaining.
- Overage toggle and cap.
- Managed LLM included credits and status.
- Billing portal action.
- Cancellation/past-due warnings.

For non-admin members:

- Read-only team billing summary.
- Copy that billing is managed by owners/admins.
- No portal or overage mutation actions.

### Workspace Launch Readiness

Every launch surface uses the same billing semantics:

- Web Home.
- Web workspace view.
- Desktop composer/new cloud workspace.
- Desktop workspace sidebar/status.
- Automations.
- Slack-created work.
- Future mobile.

The launch path must pass the same billing owner context through preflight,
workspace creation, target-config materialization, command launch, and UI
presentation:

```text
ownerScope: "personal" | "organization"
organizationId: uuid | null
targetKind: "personal_cloud" | "team_cloud" | "local" | "ssh"
requiredAgentKind: "claude" | "codex" | "opencode" | ...
requiredManagedResources: ["compute", "llm", "gateway"]
```

Web Home must stop assuming every launch is personal once a Team target is
selected. Desktop command actions and sidebar/status presentation must use the
same preflight envelope as Web.

Owner resolution:

```text
personal_cloud -> ownerScope personal, organizationId null
team_cloud -> ownerScope organization, current/selected organizationId
local -> no cloud billing preflight unless cloud accessibility is being enabled
ssh -> ownerScope depends on target ownership; team targets use Team billing
```

Add a generated launch preflight contract so Web, Desktop, automations, Slack,
and future mobile do not reimplement billing readiness:

```text
POST /v1/cloud/workspaces/launch-preflight
```

Request:

```json
{
  "ownerScope": "organization",
  "organizationId": "uuid",
  "targetKind": "team_cloud",
  "requiredAgentKind": "claude",
  "requiredManagedResources": ["compute", "llm", "gateway"]
}
```

Response:

```json
{
  "launchAllowed": false,
  "blockedReason": "llm_credits_exhausted",
  "blockedResource": "llm",
  "accountCredits": null,
  "teamBilling": { "organizationId": "uuid", "canManageBilling": false }
}
```

If account credits or Team billing blocks launch, UI surfaces show a precise
reason:

- `compute_credits_exhausted`
- `llm_credits_exhausted`
- `overage_disabled`
- `cap_exhausted`
- `payment_failed`
- `admin_hold`
- `external_billing_hold`
- `subscription_required_for_team`
- `subject_not_allowed_for_cloud`
- `concurrency_limit`
- `agent_gateway_disabled`
- `managed_credit_agent_not_configured`
- `free_credits_github_allocation_unavailable`

The generated server schema should expose both:

```text
BillingBlockReason
blockedResource: "compute" | "llm" | "gateway" | "billing" | "seat" | null
```

Do not reuse one `credits_exhausted` value for compute and LLM exhaustion. The
copy layer must have stable presentation tests for every normalized reason.

### BYOK UX

In Phase 3, BYOK remains feature-gated by topology and the Billing page does
not own credential creation.

When disabled:

- Billing UI can show read-only gateway readiness as an Enterprise/coming-soon
  or admin-only status.
- Billing UI can deep-link to Agent Auth or Shared Sandbox when those surfaces
  own the relevant configuration.
- Add forms remain hidden or disabled in Agent Auth/Shared Sandbox.
- Existing disabled/invalid BYOK rows can be shown for admins with exact
  readiness reason.

When enabled after live proof:

- Organization BYOK credential forms live in Shared Sandbox/admin auth
  surfaces.
- Personal BYOK credential forms, if enabled, live in Agent Auth.
- Provider-specific forms in those surfaces validate:
  - Anthropic API key.
  - OpenAI API key.
  - Bedrock AssumeRole with server-generated external id.
  - OpenAI-compatible base URL + API key.
- UI states distinguish:
  - stored but unvalidated;
  - validation failed;
  - LiteLLM provisioning failed;
  - ready;
  - disabled by current deployment flags;
  - route-isolation unverified.

## Target Server API Shape

Phase 3 should not break existing SDK consumers abruptly, but it should add a
clean product-level facade and start migrating Web/Desktop to it.

### Keep Existing Endpoints Temporarily

Keep for compatibility:

```text
GET  /v1/billing/plan
GET  /v1/billing/cloud-plan
GET  /v1/billing/overview
POST /v1/billing/cloud-checkout
POST /v1/billing/customer-portal
POST /v1/billing/refill-checkout
POST /v1/billing/overage-settings
POST /v1/billing/team-checkout
GET  /v1/billing/team-checkout/current
POST /v1/billing/team-checkout/{intent_id}/cancel
```

But:

- Personal paid checkout/refill should be hidden from new UI flows.
- Personal paid checkout can be disabled in hosted product unless a legacy
  subject has a grandfathered subscription.
- Organization owner selection remains valid.

### Add Product-Facing Facade Endpoints

Add:

```text
GET  /v1/billing/account-credits
POST /v1/billing/account-credits/ensure
GET  /v1/billing/team
POST /v1/billing/team/checkout
POST /v1/billing/team/customer-portal
PATCH /v1/billing/team/overage
GET  /v1/billing/team/events
```

Add the shared launch readiness endpoint in the workspace/cloud domain:

```text
POST /v1/cloud/workspaces/launch-preflight
```

This endpoint owns target/agent-specific billing blocking. Billing overview
endpoints stay summary/readiness surfaces and should not be stretched into
workspace-launch policy.

`GET /v1/billing/account-credits` is read-only. It must not mint grants,
create free-credit entitlements, or mutate account state. Mutation happens
through `POST /v1/billing/account-credits/ensure` so Web Home and future launch
preflights can make eligibility failures explicit.

`GET /v1/billing/account-credits` returns:

```json
{
  "billingSubjectId": "uuid",
  "freeCloud": {
    "includedHours": 10,
    "usedHours": 1.25,
    "remainingHours": 8.75,
    "status": "available"
  },
  "freeLlm": {
    "enabled": true,
    "status": "active",
    "includedBudgetUsd": "5",
    "periodKey": "registration",
    "launchEnabled": true,
    "readyAgentModels": [
      { "agentKind": "claude", "modelId": "us.anthropic.claude-sonnet-4-6" }
    ],
    "lastErrorCode": null,
    "lastErrorMessage": null
  },
  "githubRequired": false,
  "freeAllocationStatus": "available",
  "startBlocked": false,
  "startBlockReason": null,
  "blockedResource": null
}
```

`freeAllocationStatus` is read-only current state, for example `available`,
`requires_github`, `already_allocated_elsewhere`, `disabled`, or `exhausted`.

`POST /v1/billing/account-credits/ensure` returns the same account-credit
overview plus mutation outcome fields:

```json
{
  "accountCredits": {
    "billingSubjectId": "uuid",
    "freeAllocationStatus": "available"
  },
  "freeAllocationOutcome": "created",
  "freeAllocationBlockedReason": null
}
```

`freeAllocationOutcome` values for the ensure mutation:

```text
created
existing_same_subject
missing_github_identity
github_identity_already_allocated
disabled_by_deployment
not_applicable
```

The store/service layer must return a typed outcome/dataclass for free
allocation attempts. Do not collapse missing GitHub identity and
already-allocated GitHub identity into the same boolean.

`GET /v1/billing/team` returns null team state if the user has no org:

```json
{
  "team": null,
  "canCreateTeam": true,
  "pendingCheckout": null
}
```

For a team member/admin:

```json
{
  "team": {
    "organizationId": "uuid",
    "name": "Acme",
    "role": "owner",
    "canManageBilling": true,
    "plan": "team",
    "subscriptionStatus": "active",
    "paymentHealthy": true,
    "seatQuantity": 3,
    "activeMemberCount": 3,
    "currentPeriodStart": "2026-05-01T00:00:00Z",
    "currentPeriodEnd": "2026-06-01T00:00:00Z",
    "hostedInvoiceUrl": "https://...",
    "managedCloud": {
      "includedHours": 60,
      "usedHours": 8.5,
      "remainingHours": 51.5,
      "overageEnabled": false,
      "overageCapCents": 9000,
      "overageUsedCents": 0
    },
    "managedLlm": {
      "includedBudgetUsd": "30",
      "status": "ready",
      "periodKey": "stripe:sub_...:2026-05-01T00:00:00Z",
      "litellmSyncStatus": "synced",
      "lastErrorCode": null
    },
    "startBlocked": false,
    "startBlockReason": null,
    "blockedResource": null
  },
  "canCreateTeam": false,
  "pendingCheckout": null
}
```

`GET /v1/billing/team/events` returns normalized recent billing events for UI
and support:

```json
{
  "events": [
    {
      "id": "uuid",
      "kind": "invoice_paid",
      "severity": "info",
      "occurredAt": "2026-05-24T12:00:00Z",
      "recordedAt": "2026-05-24T12:00:03Z",
      "summary": "Invoice paid",
      "stripeObjectId": "in_..."
    }
  ]
}
```

Billing-sensitive fields are admin-only:

- `hostedInvoiceUrl`, portal URLs, Stripe object ids, invoice amounts, and
  detailed billing events are returned only when `canManageBilling=true`.
- Non-admin Team members receive member-safe summaries with those fields null,
  redacted, or omitted.
- Overage mutations and portal creation must be authorized server-side even if
  UI hides the controls.

This can initially project from existing `billing_decision_event`,
`billing_subscription`, `billing_hold`, and webhook receipts only for legacy
history. New Phase 3 informational and lifecycle events must be written to the
required `billing_notification_event` table below. Do not overload
`billing_decision_event`; that table remains for quota/hold decisions.

## Data Model And Migration Plan

### Keep

Keep these existing tables:

- `billing_subject`
- `billing_subscription`
- `billing_grant`
- `billing_grant_consumption`
- `billing_hold`
- `billing_usage_export`
- `billing_decision_event`
- `free_cloud_allocation`
- `agent_gateway_budget_subject`
- `agent_free_credit_entitlement`
- `agent_gateway_policy`
- `agent_gateway_provider_credential`

### Reframe

`billing_subject.kind = 'personal'` remains an internal account-credit ledger.

Rules:

- New UI must not call it personal billing.
- New paid checkout must not target personal subjects unless a legacy flag or
  legacy subject path is explicitly invoked.
- Account-credit APIs may return the internal `billingSubjectId` for debugging,
  but label it as account credits in SDK naming and UI copy.

### Add Required Billing Notification Events

Add `billing_notification_event`. Projection from existing tables is not
reliable enough for invoice lifecycle events, trial warnings, amount due,
severity, or support timelines.

Required shape:

```text
billing_notification_event
  id uuid pk
  billing_subject_id uuid not null
  organization_id uuid null
  user_id uuid null
  kind text not null
  severity text not null
  source text not null
  external_ref text null
  idempotency_key text not null
  payload_json jsonb not null default '{}'
  occurred_at timestamptz not null
  created_at timestamptz not null
  updated_at timestamptz not null
  UNIQUE (idempotency_key)
  INDEX (billing_subject_id, occurred_at desc)
  INDEX (organization_id, occurred_at desc)
  INDEX (source, external_ref)
```

`idempotency_key` must be non-null so Stripe events with missing/nullable
external refs cannot duplicate. Store functions return frozen dataclasses and
own JSONB serialization. Pydantic response builders must not accept ORM
objects.

Use check constraints or enums for `kind`, `severity`, and `source`. Initial
kinds should cover invoice paid/payment failed/upcoming, trial ending,
subscription updated/deleted, checkout activated/failed, seat adjustment
confirmed/failed, and managed LLM budget exhausted/synced.

Notification idempotency keys must be deterministic for the logical event, not
just the Stripe Event id:

```text
stripe:{event_type}:{data.object.id}
stripe:invoice.upcoming:{customer_id}:{subscription_id}:{period_start}:{period_end}
stripe:customer.subscription.trial_will_end:{subscription_id}:{trial_end}
seat_adjustment:{adjustment_id}:confirmed
seat_adjustment:{adjustment_id}:failed
agent_gateway_budget:{budget_subject_id}:{period_key}:exhausted
```

`occurred_at` is the Stripe event/object time or the domain event time.
`created_at`/`updated_at` are DB record times. Event APIs sort by
`occurred_at desc` and may include `recordedAt` for support diagnostics.

Do not add a plan entitlement table in Phase 3. Plan policy remains code-based
until product pricing is stable and migration value is clear.

### Migration Safety

Phase 3 migrations must:

- Be additive or guarded.
- Preserve legacy paid personal subjects.
- Preserve historical usage and invoices.
- Not delete or rewrite existing Stripe IDs.
- Preserve terminal free-credit states.
- Preserve `free_cloud_allocation` uniqueness by GitHub provider identity.
- Include upgrade and downgrade assertions in
  `server/tests/integration/schema_migration_assertions.py`.

## Billing Policy Decisions

### Paid Plan

The product paid plan is Team.

Code currently uses names such as `pro_policy`, `BILLING_PLAN_PRO`, and
`STRIPE_PRO_MONTHLY_PRICE_ID`. Phase 3 can keep internal names to reduce churn,
but UI copy should say "Team".

Do not hard-code a new public price in UI while Stripe/config is the source of
truth. Current code has historical `$20/user/month` assumptions in product UI
and server constants. If product pricing is `$30/user/month`, update all
customer-facing price surfaces, Stripe validation constants/config, and Stripe
setup scripts together:

- `scripts/stripe-setup-test-mode.mjs`
- `packages/product-ui/src/billing/billing-plan-ladder.ts`
- server billing price validation/constants
- `docs/reference/env-vars.yaml`
- Any tests asserting old plan copy.

Do not hard-code the price in more places. Prefer deriving from product config
or keeping the display copy generic where possible. Team checkout activation
must validate against configured Stripe price IDs, not display copy.

### Account Free Compute

Account free compute:

- Does not require a paid subscription.
- Is keyed against GitHub provider identity where abuse resistance matters.
- Can be exhausted.
- Can block personal cloud launches when billing mode is `enforce`.

### Account Free LLM Credits

Account free LLM credits:

- Require `AGENT_GATEWAY_ENABLED=true`.
- Require `AGENT_GATEWAY_USER_FREE_CREDIT_ENABLED=true`.
- Require a positive `AGENT_GATEWAY_USER_FREE_CREDIT_USD`.
- Require a GitHub-backed free allocation.
- Are not recreated after terminal states.
- Auto-select only when the user has no existing selection for that harness.

Phase 3 should add account-credit UI visibility for this state, not bury it only
inside Web Home launch behavior.

### Team Managed Compute

Team managed compute uses active org membership count as seat count. The floor
is one for active paid subscriptions.

The active member count, Stripe subscription item quantity, and billing snapshot
must converge idempotently under:

- Owner creates team.
- Owner invites members before activation.
- Member accepts invite after activation.
- Member is removed.
- Owner/admin changes roles.
- Stripe webhook retries.
- Seat adjustment processing retries.

### Team Managed LLM Credits

Team managed LLM credits:

- Are derived from team plan and deploy env budget settings.
- Use one LiteLLM team/budget subject per organization for managed credits.
- Are hard capped by LiteLLM.
- Have no overage in Phase 3.
- Are shown in Team billing/admin readiness.
- Reset on Stripe subscription period boundaries, not on a free-running
  LiteLLM `30d` window.

The period key should be derived from the Stripe subscription id plus
`current_period_start`/`current_period_end`. On `invoice.paid` for a new
period, Phase 3 reconciles a fresh LiteLLM managed budget and clears
Proliferate-side managed-budget exhaustion for that period. On plan upgrade or
seat-count change, Phase 3 updates the current period budget upward without
double-issuing the previous period budget. On cancellation at period end, the
current period remains usable until entitlement expiry, then no new team
managed LLM budget is issued.

### BYOK

BYOK has no default dollar cap in Phase 3. It is customer spend against
customer-owned credentials.

However:

- It still requires Proliferate Gateway runtime grants.
- It still requires provider credential validation.
- It still requires route-isolation proof.
- It still requires audit events.
- It still requires operational abuse protection and rate-limiting follow-ups
  if live testing shows an issue.

## Server Implementation Plan

### 1. Billing Facade Models

Add Pydantic response models in `server/proliferate/server/billing/models.py`:

- `AccountCreditsOverview`
- `AccountFreeCloudCredits`
- `AccountFreeLlmCredits`
- `TeamBillingOverview`
- `TeamBillingEnvelope`
- `TeamManagedCloudBilling`
- `TeamManagedLlmBilling`
- `BillingEventSummary`

Add service/domain dataclasses such as:

- `AccountCreditsOverviewRecord`
- `AccountCreditsEnsureRecord`
- `TeamBillingEnvelopeRecord`
- `BillingEventSummaryRecord`
- `LaunchPreflightRecord`

Service functions return these records, not Pydantic models. API handlers call
response builders such as `account_credits_overview_response(record)` and
`team_billing_envelope_response(record)` in `models.py`. Builder functions must
take dataclass/store records or existing snapshot objects, not ORM objects.

### 2. Billing Facade Service

Add API-facing service functions in
`server/proliferate/server/billing/service.py`:

```python
async def get_account_credits_overview(db: AsyncSession, user: User) -> AccountCreditsOverviewRecord
async def ensure_account_credits(db: AsyncSession, user: User) -> AccountCreditsEnsureRecord
async def get_team_billing_overview(db: AsyncSession, user: User) -> TeamBillingEnvelopeRecord
async def create_team_billing_portal_session(db: AsyncSession, user: User) -> BillingUrlResponse
async def update_team_overage_settings(...) -> OverageSettingsResponse
```

These should internally reuse existing billing snapshot and agent-auth
functions, but expose product-correct concepts.

Do not add a sibling `facade.py` as an escape hatch. If `service.py` becomes
unmanageable, extract pure synchronous projection/policy helpers into
`server/proliferate/server/billing/domain/` or promote a real subdomain with
its own `api.py`, `service.py`, and `models.py`.

### 3. API Endpoints

Add routes in `server/proliferate/server/billing/api.py`:

```text
GET  /v1/billing/account-credits
POST /v1/billing/account-credits/ensure
GET  /v1/billing/team
POST /v1/billing/team/checkout
POST /v1/billing/team/customer-portal
PATCH /v1/billing/team/overage
GET  /v1/billing/team/events
```

Existing `/v1/billing/team-checkout` can delegate to the new implementation.

### 4. Disable New Personal Paid Checkout In Hosted Product

Update `create_cloud_checkout_session` and `create_refill_checkout_session`
policy:

- Add `BILLING_LEGACY_PERSONAL_PAID_CHECKOUT_ENABLED=false` by default in
  hosted production and document it in `docs/reference/env-vars.yaml` and
  `server/.env.example`.
- Add an explicit hosted/product-mode setting if one does not already exist;
  do not infer hosted behavior from unrelated env such as Sentry environment.
- If `owner_scope == "personal"` and hosted product mode is true:
  - allow only if the subject has an active legacy subscription or a legacy
    `BILLING_LEGACY_PERSONAL_PAID_CHECKOUT_ENABLED` is enabled;
  - otherwise return `personal_paid_billing_unavailable`.
- If `owner_scope == "organization"`, use the Team flow.

This is a product behavior change and must have explicit tests.

### 5. Validate Team Checkout Activation Before Org Activation

Before activating a pending organization from Checkout or subscription
webhooks, validate the fetched Stripe subscription:

- subscription metadata points at the expected pending checkout intent;
- customer id matches the billing subject/customer expected by the intent;
- subscription status is allowed for activation (`active` or `trialing`, if
  trials are supported);
- at least one subscription item uses the configured Team monthly seat price;
- seat quantity is at least one;
- overage item/meter is present when overage is enabled by checkout/config;
- current period start/end are present and sane;
- subscription/customer metadata cannot activate a different organization.

Wrong price, missing overage item, wrong customer, wrong metadata, and missing
period data must fail activation before the org becomes usable.

These are non-retryable business-state failures. They should mark the pending
checkout intent `failed_business_state` or `failed_billing_state`, write
`billing_notification_event(kind='checkout_failed')`, mark the webhook receipt
processed, and acknowledge Stripe. Only transient Stripe API, network, or DB
errors should leave the receipt failed/retryable for Stripe redelivery.

### 6. Refine Stripe Subscription Deleted

Update `server/proliferate/server/billing/stripe_webhooks.py`.

Current behavior:

```text
customer.subscription.deleted -> sync subscription -> apply payment_failed hold
```

Target:

```text
if previous status was active/trialing and cancellation was planned:
  sync subscription
  do not apply payment_failed hold
  stop future period grant issuance
  keep already-issued period grant until it expires

if previous/current status is past_due/unpaid or deletion reason is failed payment:
  sync subscription
  apply payment_failed hold

if immediate admin cancellation removes entitlement now:
  sync subscription
  apply non-payment cancellation state if needed
  do not mislabel as payment_failed unless Stripe indicates payment failure
```

The code should inspect:

- existing local `BillingSubscription` before upsert;
- Stripe `status`;
- `cancel_at_period_end`;
- `canceled_at`;
- `cancellation_details.reason` if present.

### 7. Add Stripe Informational Events

Handle:

- `invoice.upcoming`
- `customer.subscription.trial_will_end`

Minimum behavior:

- claim webhook idempotently;
- resolve billing subject;
- record a normalized `billing_notification_event`;
- publish/invalidate billing state if live cache/SSE exists;
- never block launches.

Staging and production Stripe webhook endpoints must subscribe to this minimum
event set:

```text
checkout.session.completed
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
customer.subscription.trial_will_end
invoice.paid
invoice.payment_failed
invoice.upcoming
```

Local Stripe testing should use the same set via `stripe listen --events` or
the Phase 3 test-mode helper script. Update the Makefile `STRIPE_SNAPSHOT_EVENTS`
default so `make dev PROFILE=... STRIPE=1` listens to the same required set.

### 8. Seat Reconciliation Hardening

Audit and tighten:

- `maybe_create_org_seat_adjustment`
- `prepare_initial_org_seat_reconcile`
- `process_pending_seat_adjustments`
- invite acceptance seat adjustment path
- membership removal seat adjustment path

Invariants:

- Active members are the billable seat source.
- Seat quantity is at least one for active paid Team subscriptions.
- Pending checkout owner counts as one.
- Staged invites do not count until accepted.
- Removed members stop counting.
- Stripe update idempotency keys include adjustment id and target quantity.
- Failed retryable Stripe updates remain retryable.
- Terminal Stripe errors mark adjustment terminal and visible to admin/support.

Webhook handlers must not synchronously make Stripe seat mutations inside the
same transaction that records subscription/webhook state. They should enqueue
or reuse a seat adjustment row and let the worker process it with stable
idempotency keys. Duplicate webhooks after a Stripe failure must reuse the same
adjustment rather than creating duplicate seat mutations.

### 9. Billing Snapshot Reasons

Normalize start-block reasons across all launch paths.

Server constants already include:

- `billing_quota`
- `overage_disabled`
- `cap_exhausted`
- `external_billing_hold`
- `concurrency_limit`

Phase 3 should produce a single generated reason enum for workspace billing
summaries, account credits, team billing, and launch preflight. Facade
boundaries should map broad internal `billing_quota` decisions to specific
`compute_credits_exhausted` or `llm_credits_exhausted` reasons with
`blockedResource`.

### 10. Billing SSE/Invalidation

There is no proven billing-specific SSE patch in the current repo. Phase 3
should either add and test a `billing_patch`/live invalidation event, or state
that freshness is query invalidation plus manual refresh for this phase.

If adding SSE, wire all Phase 3 mutation paths to publish it:

- Stripe subscription sync.
- Invoice paid.
- Invoice payment failed.
- Subscription deleted.
- Overage setting update.
- Seat adjustment processed.
- Billing hold inserted/resolved.
- LiteLLM budget exhausted.
- Free LLM credits ensured/exhausted.

If SSE patching is incomplete, at minimum invalidate React Query caches after
mutations and include a server-side follow-up ticket in this spec's acceptance
notes. Do not claim real-time billing freshness unless tested.

## LiteLLM And BYOK Implementation Plan

### 1. Keep The Current Fail-Closed Gates

Do not weaken:

- `AGENT_GATEWAY_BYOK_ENABLED`
- `AGENT_GATEWAY_PERSONAL_BYOK_ENABLED`
- `AGENT_GATEWAY_PROVIDER_LIVE_VALIDATION_ENABLED`
- provider flags
- `AGENT_GATEWAY_LITELLM_TOPOLOGY`
- `AGENT_GATEWAY_LITELLM_CUSTOMER_SECRET_ISOLATION_VERIFIED`

Current pure policy is correct in spirit:

```text
BYOK allowed only when:
  gateway BYOK enabled
  personal flag enabled if personal_byok
  topology is enterprise_shared or isolated_router
  customer secret isolation is verified
```

Phase 3 adds evidence and operational checks for those flags.

`AGENT_GATEWAY_LITELLM_CUSTOMER_SECRET_ISOLATION_VERIFIED=true` must be backed
by a proof artifact tied to the exact deployed LiteLLM version/image digest,
deployment topology, and config. Readiness fails closed if the artifact is
missing, stale, or produced against a different image/task definition.
Production BYOK also requires
`AGENT_GATEWAY_PROVIDER_LIVE_VALIDATION_ENABLED=true`, so OpenAI, Anthropic,
and OpenAI-compatible keys are checked against the provider models endpoint
before they can become ready. Bedrock remains proof-runner-gated because the
server deployment's STS permission model is environment-specific.

### 2. BYOK Proof Artifact Contract

Add `AGENT_GATEWAY_LITELLM_ISOLATION_PROOF_REF` to the canonical env/config
surface. The value points at a read-only artifact URI or signed artifact id
created by the live proof lane.

Required artifact fields:

```text
environment
generatedAt
expiresAt
litellmImageDigest
litellmVersion
topology
taskDefinitionArn or service identity
litellmConfigFingerprint
credentialRoutingConfigFlags
proofScriptSha
testMatrixResults
signer
approver
```

For `enterprise_shared`, `credentialRoutingConfigFlags` must include
`LITELLM_ENABLE_MODEL_CONFIG_CREDENTIAL_OVERRIDES=true`. The readiness script
must fail if the artifact is missing, expired, unsigned/unapproved, or
mismatched against the deployed LiteLLM image digest, task definition/service,
topology, or config fingerprint.

### 3. Add A Live LiteLLM Readiness Probe

Add a script:

```text
scripts/agent-gateway-live-proof.py
```

It should support:

```bash
python3 scripts/agent-gateway-live-proof.py managed-credits
python3 scripts/agent-gateway-live-proof.py route-isolation
python3 scripts/agent-gateway-live-proof.py byok-anthropic
python3 scripts/agent-gateway-live-proof.py byok-openai
python3 scripts/agent-gateway-live-proof.py byok-bedrock
python3 scripts/agent-gateway-live-proof.py all --require-live \
  --proof-artifact-out runbook/proofs/litellm-team-isolation-staging.json \
  --environment staging \
  --litellm-image ghcr.io/berriai/litellm@sha256:<digest> \
  --litellm-config-fingerprint <fingerprint> \
  --task-definition-arn <task-definition> \
  --approver <security-reviewer>
```

Inputs:

```text
PROLIFERATE_API_BASE_URL
PROLIFERATE_TEST_USER_TOKEN
PROLIFERATE_TEST_ADMIN_TOKEN
LITELLM_PROXY_URL
LITELLM_MASTER_KEY
PHASE3_GATEWAY_BASE_URL
PHASE3_ANTHROPIC_API_KEY
PHASE3_OPENAI_API_KEY
PHASE3_BEDROCK_ROLE_ARN
PHASE3_BEDROCK_REGION
PHASE3_BEDROCK_EXTERNAL_ID
PHASE3_BEDROCK_WRONG_EXTERNAL_ID
PHASE3_REQUIRE_LIVE
```

The script must redact all secrets in logs.

Local gateway proof prerequisites:

```bash
export AGENT_GATEWAY_USER_FREE_CREDIT_ENABLED=true
export AGENT_GATEWAY_USER_FREE_CREDIT_USD=0.01
export AGENT_GATEWAY_MANAGED_BUDGET_PRO_USD=0.01
export AGENT_GATEWAY_MANAGED_CREDIT_AGENT_KINDS=claude
# Also provide an explicit managed provider credential path, such as
# Proliferate Bedrock pool credentials, to local LiteLLM. If provider
# credentials are absent, the live proof must fail fast with setup_required.
make dev PROFILE=billing-p3 AGENT_GATEWAY=1
```

The script should either create short-lived dev test tokens itself through an
existing dev-auth helper or document exact token setup. Do not require humans
to infer API base URL/profile ports from terminal output.

### 4. Prove Managed Credits On OSS Shared LiteLLM

Managed credits can use global model deployments because provider credentials
are Proliferate-owned.

Live proof:

1. Start or reach LiteLLM.
2. Create/update a managed-credit team with tiny budget.
3. Create global model deployment for
   `us.anthropic.claude-sonnet-4-6` backed by Proliferate Bedrock pool.
4. Generate virtual key for that team.
5. Make a successful tiny request through Proliferate Gateway.
6. Make or simulate budget exhaustion.
7. Assert:
   - LiteLLM returns budget/credit error;
   - Proliferate maps to `llm_credits_exhausted`;
   - `agent_gateway_budget_subject.status` becomes `exhausted`;
   - account free entitlement becomes `exhausted` for personal free credits;
   - subsequent gateway auth fails before provider call.

Gateway error mapping must inspect the authorized policy/budget subject. Only
Proliferate-managed policies may map LiteLLM budget errors to
`llm_credits_exhausted` or mark Proliferate budgets exhausted. BYOK provider
quota/credit failures must map to provider-specific outcomes such as
`provider_quota_exhausted` or `provider_rate_limited` and must not mutate
managed-credit state.

### 5. Prove BYOK Route Isolation Before Enabling

There are two acceptable topologies.

#### Enterprise Shared

Use LiteLLM credential routing or team-scoped deployment features to route the
same public model name to different provider credentials by team.

The official LiteLLM docs currently describe per-team/project credential
routing through:

- a credentials table;
- `team.metadata.model_config`;
- `LITELLM_ENABLE_MODEL_CONFIG_CREDENTIAL_OVERRIDES=true`;
- API-key team identity.

Phase 3 adds `LiteLLMAdminClient` support for:

```python
create_credential(...)
update_team_metadata_model_config(...)
delete_or_disable_stale_credential(...)
reconcile_model_config(...)
```

Then prove:

```text
Team A key + model X -> provider credential A
Team B key + model X -> provider credential B
Team A cannot reach Team B credential by model name, header, metadata, or
request body.
Runtime virtual keys cannot call /team/*, /model/*, /key/*, or
credential-routing admin APIs.
```

If using `/model/new` with `model_info.team_id` remains the implementation,
the proof must explicitly show duplicate public names are isolated by team and
do not leak across virtual keys. If this cannot be proven in the deployed
LiteLLM edition, keep `enterprise_shared` disabled.

The integration owner is `server/proliferate/integrations/litellm/client.py`
or a promoted `server/proliferate/integrations/litellm/` module with explicit
client/model ownership. Phase 3 must add idempotent update/delete/reconcile
behavior for credentials, team metadata, and model rows so repeated live proofs
do not accumulate duplicate LiteLLM config.

#### Isolated Router

Run one LiteLLM instance or isolated routing pool per policy/budget subject.

The current gateway runtime client uses the global LiteLLM base URL. Therefore
`isolated_router` is not acceptable merely by setting the topology flag. It
requires schema/config that records router identity, base URL, and secret
reference per policy or budget subject, and gateway hot-path routing that
selects that router. Readiness must fail closed if topology is
`isolated_router` while runtime requests still use only the global LiteLLM URL.

Proof:

```text
Policy A Gateway -> LiteLLM A -> provider credential A
Policy B Gateway -> LiteLLM B -> provider credential B
No shared LiteLLM model table contains both customer credentials.
```

This is operationally heavier but acceptable when Enterprise team credential
routing is unavailable.

### 6. Bedrock BYOK Validation

Provider payload:

```json
{
  "roleArn": "arn:aws:iam::<customer-account>:role/<role>",
  "region": "us-east-1"
}
```

Validation steps:

1. Check role ARN syntax.
2. Generate a high-entropy immutable external id server-side. The client never
   chooses it.
3. Call STS AssumeRole with the external id.
4. Retry STS AssumeRole with a wrong external id and require denial, proving
   the trust policy is not vulnerable to a confused-deputy setup.
5. Call STS GetCallerIdentity with the assumed role credentials and require
   the expected account/role.
6. Call Bedrock runtime with a tiny model request, or call a lower-cost model
   listing/readiness probe when available.
7. Store:
   - validated account id;
   - region;
   - provider model ids proven;
   - validation timestamp.
8. Do not store temporary STS credentials.
9. Do not log role session credentials.

AWS live proof can query CloudTrail as an async audit aid, but CloudTrail is not
the gating proof. Require least-privilege customer policies for approved
regions/model ids and only `bedrock:InvokeModel`/streaming invocation actions
needed by the agent path.

### 7. Provider Validation For API Key BYOK

Anthropic:

- Use the same Anthropic-compatible path as the gateway.
- Validate with a low-token `/messages` call or provider model listing if
  available.
- Ensure bad key results in `provider_auth_failed`, not ready state.

OpenAI:

- Validate with `/v1/models` or a low-token chat/responses call.
- Ensure model id used by Codex path is actually supported or keep Codex BYOK
  disabled.

OpenAI-compatible:

- Validate base URL is HTTPS in production.
- Permit `http://127.0.0.1` or `http://localhost` only when `DEBUG=true` and
  the deployment is local/dev.
- Reject userinfo, query strings, and fragments in the configured base URL.
- Resolve DNS and block private, link-local, loopback, multicast, reserved, and
  metadata-service ranges in production.
- Disable redirects for validation and runtime requests, or re-validate the
  resolved redirect target before following.
- Revalidate DNS/egress on reconcile and before runtime use, or enforce network
  egress controls that make DNS rebinding harmless.
- Ensure LiteLLM cannot reach AWS/ECS metadata endpoints or private VPC
  addresses when calling customer OpenAI-compatible base URLs.
- Validate the endpoint supports the configured model.
- Validate streaming if the agent path needs streaming.
- Store redacted base URL and model proof.

### 8. LiteLLM Image Pinning

`LITELLM_IMAGE=ghcr.io/berriai/litellm:main-stable` is convenient but too
loose for production BYOK.

Phase 3 should:

- Pin production LiteLLM image by digest.
- Record tested LiteLLM version/digest in docs or deployment config.
- Add a deployment check that refuses to enable BYOK on an unpinned image.
- Keep self-hosted defaults flexible, but warn if BYOK is enabled with a
  floating tag.

### 9. LiteLLM Privacy And Logging

Before BYOK enablement:

- Confirm LiteLLM does not log request/response bodies by default in production.
- Disable verbose debug logging.
- Verify Proliferate `_safe_error_message` and LiteLLM client redaction cover
  API keys, virtual keys, tokens, external IDs, role ARNs, camelCase sensitive
  keys, base URLs where sensitive, Authorization headers, and LiteLLM error
  bodies.
- Minimize or hash LiteLLM request metadata. If raw target/profile/policy/user
  or org ids are sent to LiteLLM, prove LiteLLM does not log or forward that
  metadata to providers.
- Add regression tests that provider secrets do not appear in:
  - API responses;
  - audit metadata;
  - logs;
  - worker commands;
  - gateway request logs;
  - LiteLLM error propagation.

## Infrastructure Plan

### 1. Decide Gateway Deployment Shape

Current FastAPI includes `/agent-gateway/health`, `/anthropic/v1/*`, and
`/openai/v1/*` routes. Production/staging infrastructure also appears to have
older gateway/proxy services that must be classified as legacy, migrated, or
retired.

Pick one target:

Option A, preferred near term:

```text
Public API service
  serves control plane and gateway facade routes

Private LiteLLM ECS service
  no public ALB
  reachable only from API service security group
```

Option B:

```text
Public API service
  control plane, billing, provisioning, LiteLLM admin client

Public Gateway runtime service
  runtime inference facade only
  no LiteLLM admin/provisioning routes
  no LiteLLM master key
  no Stripe secrets
  only the minimal DB/runtime-grant access needed for request authorization

Private LiteLLM ECS service
  no public ALB
```

Do not keep an unrelated old gateway service and a new FastAPI gateway facade
with overlapping public URLs.

### 2. Production Env Readiness

Production API/control-plane task definitions must include:

```text
CLOUD_BILLING_MODE
PRO_BILLING_ENABLED
PROLIFERATE_PRODUCT_MODE
BILLING_LEGACY_PERSONAL_PAID_CHECKOUT_ENABLED
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_PRO_MONTHLY_PRICE_ID
STRIPE_MANAGED_CLOUD_OVERAGE_PRICE_ID
STRIPE_MANAGED_CLOUD_OVERAGE_METER_ID
STRIPE_MANAGED_CLOUD_OVERAGE_METER_EVENT_NAME
SANDBOX_PROVIDER
E2B_API_KEY
AGENT_GATEWAY_ENABLED
AGENT_GATEWAY_LITELLM_BASE_URL
AGENT_GATEWAY_LITELLM_MASTER_KEY
AGENT_GATEWAY_PUBLIC_BASE_URL
AGENT_GATEWAY_MAX_REQUEST_BYTES
AGENT_GATEWAY_REQUEST_TIMEOUT_SECONDS
AGENT_GATEWAY_MANAGED_BUDGET_FREE_USD
AGENT_GATEWAY_MANAGED_BUDGET_PRO_USD
AGENT_GATEWAY_MANAGED_BUDGET_UNLIMITED_USD
AGENT_GATEWAY_USER_FREE_CREDIT_ENABLED
AGENT_GATEWAY_USER_FREE_CREDIT_USD
AGENT_GATEWAY_USER_FREE_CREDIT_PERIOD
AGENT_GATEWAY_MANAGED_CREDIT_AGENT_KINDS
AGENT_GATEWAY_BYOK_ENABLED
AGENT_GATEWAY_PERSONAL_BYOK_ENABLED
AGENT_GATEWAY_PROVIDER_LIVE_VALIDATION_ENABLED
AGENT_GATEWAY_LITELLM_TOPOLOGY
AGENT_GATEWAY_LITELLM_CONFIG_FINGERPRINT
AGENT_GATEWAY_RUNTIME_SUPPORTS_ISOLATED_ROUTER
AGENT_GATEWAY_LITELLM_CUSTOMER_SECRET_ISOLATION_VERIFIED
AGENT_GATEWAY_LITELLM_ISOLATION_PROOF_REF
AGENT_GATEWAY_ANTHROPIC_BYOK_ENABLED
AGENT_GATEWAY_OPENAI_BYOK_ENABLED
AGENT_GATEWAY_BEDROCK_BYOK_ENABLED
AGENT_GATEWAY_OPENAI_COMPATIBLE_BYOK_ENABLED
AGENT_GATEWAY_OPENCODE_ENABLED
AGENT_GATEWAY_RECONCILER_ENABLED
AGENT_GATEWAY_RECONCILER_INTERVAL_SECONDS
AGENT_GATEWAY_RECONCILER_BATCH_SIZE
```

Production split gateway-runtime task definitions, if Option B is chosen, may
include only runtime-safe env:

```text
AGENT_GATEWAY_ENABLED
AGENT_GATEWAY_LITELLM_BASE_URL
AGENT_GATEWAY_PUBLIC_BASE_URL
AGENT_GATEWAY_MAX_REQUEST_BYTES
AGENT_GATEWAY_REQUEST_TIMEOUT_SECONDS
AGENT_GATEWAY_BYOK_ENABLED
AGENT_GATEWAY_LITELLM_TOPOLOGY
```

Gateway-runtime tasks must not receive `AGENT_GATEWAY_LITELLM_MASTER_KEY`,
Stripe secrets, LiteLLM admin/provisioning env, or credential-provisioning
permissions.

Production LiteLLM task definitions must include:

```text
LITELLM_POSTGRES_PASSWORD
LITELLM_MASTER_KEY
LITELLM_ENABLE_MODEL_CONFIG_CREDENTIAL_OVERRIDES=true  # enterprise_shared only
```

Secrets must come from Secrets Manager or equivalent:

```text
AGENT_GATEWAY_LITELLM_MASTER_KEY
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
LITELLM_POSTGRES_PASSWORD
provider pool secrets, if used
```

### 3. Private LiteLLM

Production LiteLLM should be:

- ECS/Fargate or equivalent service.
- Private security group ingress from API/gateway only.
- PostgreSQL-backed.
- Health checked internally.
- Not reachable from sandboxes or the public internet.

If a public ALB is temporarily retained for testing, BYOK must remain disabled.

### 4. Bedrock AWS Setup

For Proliferate-managed Bedrock pool:

- Use a Proliferate-owned IAM role/policy with least privilege for Bedrock
  runtime invocation in approved regions.
- Ensure ECS task role has no broader permissions than needed.
- Store provider config as secret references, not static values in task
  definitions.

For customer Bedrock BYOK:

- Generate unique external IDs.
- Provide trust-policy copy in UI/docs.
- Validate AssumeRole.
- Store only role ARN, external id, region, and validation metadata.
- Never store customer temporary credentials.

### 5. AWS Readiness Check Script

Add:

```text
scripts/check-production-billing-gateway-readiness.mjs
```

It should inspect AWS metadata only and fail if:

- BYOK enabled but LiteLLM target is public.
- BYOK enabled but LiteLLM image is unpinned.
- BYOK enabled but route-isolation flag is false.
- BYOK enabled but the digest-tied proof artifact is absent/stale or does not
  include the required LiteLLM credential-routing config such as
  `LITELLM_ENABLE_MODEL_CONFIG_CREDENTIAL_OVERRIDES=true` for
  `enterprise_shared`.
- BYOK enabled but topology is `oss_shared`.
- Gateway enabled but `AGENT_GATEWAY_PUBLIC_BASE_URL` is absent.
- API/control-plane provisioning is enabled but the API task lacks the LiteLLM
  master key secret.
- Split public gateway-runtime task has `AGENT_GATEWAY_LITELLM_MASTER_KEY`,
  Stripe secrets, or LiteLLM admin/provisioning permissions.
- Managed free credits enabled but budget is zero.
- Team managed credits enabled but Team budget env is zero.
- Stripe billing enabled but Stripe price/meter env is missing.
- Stripe billing enabled but the staging/prod webhook endpoint is not
  subscribed to the required event set.
- OpenAI-compatible BYOK is enabled with any production non-HTTPS base URL.
- OpenAI-compatible BYOK can reach private/link-local/loopback/reserved IPs,
  metadata endpoints, or follows redirects without revalidation.
- `isolated_router` topology is enabled but gateway runtime config still points
  every request at the global LiteLLM URL.

Do not print secret values.

### 6. CI/CD And Deploy Gates

The repo's current server CI builds and publishes server images on tag-driven
release paths; it does not own final ECS rollout. Phase 3 readiness automation
must not claim to deploy production ECS.

Add or update:

- `.github/workflows/billing-gateway-readiness.yml` as a `workflow_dispatch`
  readiness workflow only.
- `server/infra/main.tf` and `server/infra/self-hosted-aws/template.yaml` only
  for config surface/readiness support owned by this repo.
- `server/deploy/**` env examples/runbooks.
- `server/.env.example`.
- `docs/reference/env-vars.yaml`.
- deployment/self-hosted docs that still mention stale gateway budget envs.
- `.github/workflows/ci.yml` so shared frontend CI runs
  `pnpm --filter @proliferate/product-ui test`.
- `.github/workflows/ci.yml` or a dedicated frontend-tests job so targeted
  Phase 3 Desktop billing/settings/launch-reason Vitest files run in CI.
- If Web Vitest support is added, CI runs the new Web tests; otherwise Web
  remains typecheck/build plus manual smoke.

The readiness workflow should inspect env names, image digests, task/service
metadata, and public/private LiteLLM exposure. It should produce a pass/fail
artifact for the rollout issue and never print secret values.

## Frontend And SDK Plan

### SDK

Add typed client methods in `cloud/sdk/src/client/billing.ts`:

- `getAccountCredits()`
- `ensureAccountCredits()`
- `getTeamBilling()`
- `createTeamCheckout()`
- `createTeamBillingPortal()`
- `updateTeamOverageSettings()`
- `getTeamBillingEvents()`

Add launch readiness access in the owning cloud workspace client module:

- `getCloudWorkspaceLaunchPreflight()`

Add React hooks in `cloud/sdk-react/src/hooks/billing.ts`:

- `useAccountCredits()`
- `useAccountCreditsActions()` or `useEnsureAccountCredits()`
- `useTeamBilling()`
- `useTeamBillingActions()`
- `useTeamBillingEvents()`

Add a generic launch preflight query/mutation hook in the owning
`cloud/sdk-react` workspace hooks. The account-credit ensure mutation must
invalidate the account-credits query.

Keep existing hooks but mark app usage deprecated through comments and migrate
Web/Desktop.

Regenerate OpenAPI after server schema changes with `make cloud-client-generate`.
All new and existing billing facade types should alias generated OpenAPI
schemas. Remove current `(client as any)` debt for team checkout once generated
paths exist. `cloud-sdk-react` hooks remain generic TanStack Query wrappers
only: no product branching, no toasts, no navigation, no telemetry, no Tauri,
and no platform-specific browser-opening behavior.

### Product Model

Add shared pure billing presentation/model helpers under
`packages/product-model/src/billing/`:

```text
model.ts
presentation.ts
billing.test.ts
presentation.test.ts
```

Product-model owns:

- `AccountCreditsPanelView`
- `TeamBillingPanelView`
- `BillingBlockPresentation`
- `BillingEventView`
- `ManagedLlmCreditsView`
- `GatewayReadinessView`
- block-reason copy/tone/icon intent
- allowed/forbidden billing terminology checks where practical
- plan-ladder/product copy mapping that is not app-specific

Update `packages/product-model/package.json` exports if needed. Product-ui
renders these view models; it does not build product policy from raw API
responses.

### Product UI

Update `packages/product-ui/src/billing/`:

- Split account credits and team billing panels.
- Remove personal paid-plan terminology.
- Keep dense operational billing UI, not marketing cards.
- Make non-admin state read-only.
- Show managed LLM credit readiness.
- Show BYOK availability as a read-only Team/Enterprise readiness summary and
  optional deep link, not as credential forms.

Product-ui billing components accept data/callback props only. They must not
import SDK hooks, app stores, `window`, Tauri, telemetry clients, or raw cloud
clients.

Expected components:

```text
AccountCreditsPanel
TeamBillingPanel
TeamCheckoutPanel
PendingTeamCheckoutPanel
TeamBillingStatusBanner
TeamOverageControl
ManagedLlmCreditsSummary
BillingEventsList
```

### Web

Update `web/src/components/settings/screen/BillingSettingsSection.tsx`:

- Top section: Account credits.
- If no org: Team creation CTA.
- If org: Team billing summary.
- Admins see portal/overage actions.
- Members see read-only state.
- Checkout return query still refreshes Team billing state.
- Web controller owns navigation, checkout return handling, toasts, telemetry,
  and current-org refresh. Product-ui remains presentational.

Update Web Home:

- Call `POST /v1/billing/account-credits/ensure` before first personal launch
  when account free credits are needed.
- Also read account-credit readiness so launch errors are preflighted before
  workspace creation where possible.
- If user is in a Team and chooses a team target, use Team billing and team
  managed/auth settings.
- Thread `ownerScope`, `organizationId`, target kind, and required agent kind
  into pending prompt dispatch and workspace/session materialization.

### Desktop

Update Desktop Billing settings:

- Same shared product-ui panels.
- Desktop can show account credits and Team billing, but Team billing admin is
  canonical in Web if a flow needs a browser.
- Remove personal paid checkout CTA for new hosted users.
- Preserve legacy deep links and Stripe return handling.
- Desktop controller owns Tauri/browser opening, desktop-specific telemetry,
  and platform affordances.
- When touching billing access hooks, move them out of transitional flat files
  into a resource folder such as
  `desktop/src/hooks/access/cloud/billing/use-cloud-billing.ts`,
  `use-cloud-billing-mutations.ts`, and `query-keys.ts`. Keep browser/Tauri
  behavior in Desktop facade/controller hooks, not generic access hooks.

Update Desktop workspace launch/readiness:

- Consume the normalized billing reason presentation.
- Do not show "personal billing" in blocked launch copy.
- Thread the same billing owner context into command-palette launches,
  composer launches, and sidebar/status readiness.

## Observability And Support

Add structured events/logs for:

- Team checkout created.
- Team checkout activated.
- Team checkout activation failed.
- Stripe webhook processed/ignored/failed.
- Seat adjustment created/confirmed/failed.
- Overage enabled/disabled/cap changed.
- Billing hold inserted/resolved.
- Account free credits created/exhausted.
- Team managed LLM budget synced/exhausted.
- BYOK credential validation failed/succeeded.
- BYOK route-isolation check failed.
- Gateway request mapped to credits exhausted/provider auth/rate limit.

Privacy rules:

- No provider secrets.
- No LiteLLM virtual keys.
- No gateway runtime grant token.
- No raw request/response bodies.
- Hash user/org/credential IDs in high-volume gateway logs.

## Test Plan

This is intentionally broad. Phase 3 is not done until these are either passing
or explicitly deferred with product sign-off.

### Product Policy Unit Tests

Files:

- `server/tests/unit/test_billing_domain.py`
- `server/tests/unit/test_billing_service_policy.py`
- New `server/tests/unit/test_billing_phase3_policy.py`

Cases:

- Free account credits snapshot does not imply paid personal billing.
- Account-credit ensure returns typed outcomes for created, existing same
  subject, missing GitHub identity, already allocated GitHub identity, and
  deployment disabled.
- Team plan policy derives limits from active seat count.
- Team plan seat floor is one.
- Team price validation uses configured Stripe price id, not UI copy.
- Removed members do not count.
- Staged invites do not count.
- Legacy personal paid subjects are recognized but not advertised.
- Hosted personal paid checkout is disabled by default.
- Active legacy personal subscriptions and
  `BILLING_LEGACY_PERSONAL_PAID_CHECKOUT_ENABLED=true` allow only legacy
  personal checkout paths.
- Organization/Team checkout is unaffected by the legacy personal checkout
  flag.
- `customer.subscription.deleted` clean cancellation does not map to
  `payment_failed`.
- `customer.subscription.deleted` after `past_due` maps to `payment_failed`.
- Overage disabled produces `overage_disabled`.
- Overage cap exhausted produces `cap_exhausted`.
- Payment hold wins over quota warning.
- Concurrency limit reason is stable.
- Compute and LLM exhaustion map to different generated block reasons and
  different `blockedResource` values.
- Free LLM entitlement terminal states remain terminal.
- Team managed LLM exhaustion resets on new Stripe subscription period.
- Team managed LLM budget increases on upgrade without duplicating the period.
- BYOK route isolation verdict covers all flag/topology combinations.
- BYOK provider enablement is independent per provider.

### Billing Store And Migration Integration Tests

Files:

- `server/tests/integration/test_billing_store_invariants.py`
- `server/tests/integration/test_billing_free_trial_allocation.py`
- `server/tests/integration/test_schema_migrations.py`

Cases:

- Personal and organization billing subjects remain unique.
- `free_cloud_allocation` uniqueness is per allocation kind, GitHub provider
  id, and period key.
- Free compute and free LLM allocation kinds do not collide.
- GitHub identity is required for abuse-protected free allocations.
- Existing allocation on same subject is idempotent.
- Existing allocation on different subject denies grant.
- Monthly free LLM period creates distinct period keys only when configured.
- Migration upgrade creates `billing_notification_event` with JSONB payload,
  `occurred_at`, `updated_at`, unique non-null idempotency key, and subject/org
  `occurred_at desc` indexes.
- Migration downgrade removes only Phase 3 additions.
- Notification-event store returns frozen dataclasses, not ORM objects.
- Duplicate Stripe idempotency key upserts/update paths do not create duplicate
  events even when `external_ref` is null.
- Legacy rows without org billing remain readable.
- Legacy personal paid subscription rows remain readable.

### Stripe Webhook Integration Tests

File:

- `server/tests/integration/test_stripe_webhooks.py`

Add cases:

- Checkout/session activation refuses wrong Stripe price id.
- Checkout/session activation refuses missing Team seat item.
- Checkout/session activation refuses wrong Stripe customer id.
- Checkout/session activation refuses wrong subscription/customer metadata.
- Checkout/session activation refuses missing/suspicious subscription period.
- Non-retryable checkout validation failures leave the org inactive, persist
  checkout failure state, write `checkout_failed`, mark webhook receipt
  processed, and do not dispatch twice on duplicate delivery.
- `invoice.upcoming` records informational billing event and does not block.
- `invoice.upcoming` with null invoice id uses the deterministic
  customer/subscription/period idempotency key.
- `customer.subscription.trial_will_end` records informational event.
- `customer.subscription.deleted` clean period-end cancellation syncs
  subscription and does not create payment hold.
- `customer.subscription.deleted` after `past_due` creates payment hold.
- `invoice.payment_failed` creates payment hold idempotently.
- `invoice.paid` clears payment hold idempotently.
- `invoice.paid` issues exactly one Pro period grant per subscription period.
- `invoice.paid` with expanded and non-expanded line shapes both work.
- Unknown customer webhook is processed as no-op.
- Duplicate processed webhook does not dispatch twice.
- Out-of-order Stripe delivery sorts event timelines by `occurred_at`.
- Two Stripe Event ids for the same logical invoice/subscription object produce
  one billing notification event.
- Failed webhook can be reclaimed.
- Webhook enqueues/reuses a seat adjustment and does not synchronously update
  Stripe seat quantity inside the webhook transaction.
- Duplicate webhook after Stripe seat failure reuses the adjustment row and
  stable idempotency key.
- Seat adjustment failure marks retryable/terminal correctly.
- Managed LLM budget reconcile is called after subscription tier changes.
- Managed LLM budget reconcile resets exhausted state on a new subscription
  period.

### Stripe Live/Test-Mode End-To-End Tests

Manual or nightly lane, never against production charges.

Prereqs:

```bash
stripe login
make stripe-setup-test
make dev PROFILE=billing-p3 STRIPE=1 AGENT_GATEWAY=1
# The dev target should use this event set:
stripe listen \
  --events checkout.session.completed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,customer.subscription.trial_will_end,invoice.paid,invoice.payment_failed,invoice.upcoming \
  --forward-to "$STRIPE_FORWARD_TO"
```

Cases:

1. Create test user.
2. Start Team checkout.
3. Complete Stripe Checkout with test card.
4. Assert organization activates.
5. Assert owner membership active.
6. Assert Stripe customer/subscription IDs stored on org billing subject.
7. Assert first Pro period grant issued.
8. Assert shared sandbox profile ensured.
9. Invite member, accept invite, process seat adjustment.
10. Assert Stripe subscription quantity changes.
11. Remove member, process seat adjustment.
12. Assert quantity decreases but floors at one.
13. Toggle overage on/off.
14. Assert billing snapshot updates.
15. Simulate `invoice.payment_failed`.
16. Assert launch blocked in enforce mode.
17. Simulate `invoice.paid`.
18. Assert payment hold clears.
19. Cancel at period end.
20. Assert no payment-failed hold.

### Billing Accounting Integration Tests

Files:

- `server/tests/integration/test_billing_accounting.py`
- `server/tests/integration/test_billing_accounting_boundaries.py`

Add or confirm cases:

- Team Pro included grants are consumed before overage.
- Free account grants are consumed for non-team personal cloud.
- Free account grants do not refill when GitHub allocation already used.
- Overage exports cents at the configured rate.
- Cap snapshots prevent retry overspend.
- Observe mode writes observed exports but does not send to Stripe.
- Enforce mode sends pending meter exports.
- Terminal Stripe export failures stop retry.
- Retryable Stripe export failures remain retryable.
- Rollover period starts do not double-charge unaccounted segments.
- Running segment crossing period boundary is split correctly.

### Billing Reconciler Tests

Files:

- `server/tests/unit/test_billing_reconciler.py`
- New integration test if provider fakes need DB state.

Cases:

- Reconciler does not run when billing mode is off.
- Reconciler records active spend hold decision once per subject per pass.
- Reconciler pauses active sandbox when enforce mode and active spend hold.
- Reconciler closes open usage segment when provider state is paused/stopped.
- Reconciler marks destroyed provider state correctly.
- Reconciler repair of placeholders does not create duplicate open segments.
- Reconciler errors are captured and loop continues.

### Agent Gateway And LiteLLM Fake Integration Tests

Files:

- `server/tests/integration/test_cloud_agent_auth_api.py`
- `server/tests/integration/test_agent_gateway_api.py`
- `server/tests/integration/test_cloud_capabilities_api.py`

Already covered and should remain:

- BYOK disabled by default.
- Provider flag must be enabled.
- Personal BYOK requires personal flag.
- BYOK route isolation fail-closed after grant issue.
- Provider disabled after grant issue fails closed.
- Missing provider credential fails closed.
- Free managed credits are idempotent.
- Free managed credits do not overwrite existing selection.
- Exhausted free credits remain exhausted.
- Managed credit global deployment path does not use team model deployment.
- BYOK reconciler repairs valid failed policy.
- BYOK reconciler does not repair when gates disabled.
- Gateway maps LiteLLM budget errors to `llm_credits_exhausted`.
- Gateway maps LiteLLM budget errors to `llm_credits_exhausted` only for
  Proliferate-managed policies.
- BYOK provider quota/credit failures map to provider-specific reasons and do
  not mark Proliferate managed budgets exhausted.
- Gateway logs do not include LiteLLM keys.
- Worker materialization commands do not include LiteLLM keys except the
  intended runtime grant materialization.

Add cases:

- `org_byok` policy/grant path works independently from `personal_byok`.
- Every provider flag branch fails closed when disabled.
- Unknown provider kind fails closed.
- Provider auth 401/403 maps to provider auth failure, not budget exhaustion.
- Non-budget 429 maps to provider/rate-limit failure, not managed credit
  exhaustion.
- `create_gateway_credential` with `bedrock_assume_role` validates and stores
  redacted summary only.
- Bedrock external id is generated server-side, immutable, and redacted in
  errors/logs.
- Bedrock validation requires wrong-external-id denial.
- OpenAI-compatible HTTPS requirement in production.
- OpenAI-compatible non-HTTPS allowed only for localhost in `DEBUG=true`
  local/dev mode.
- OpenAI-compatible BYOK rejects userinfo/query/fragment URLs, private IPs,
  link-local/metadata targets, loopback/multicast/reserved ranges, redirects
  without revalidation, and DNS rebinding-sensitive changes.
- Anthropic bad key produces invalid credential and unvalidated provider status.
- OpenAI bad key produces invalid credential and unvalidated provider status.
- Reconciler updates existing BYOK policy when provider payload revision changes.
- Reconciler rotates LiteLLM virtual key only when fingerprint changes.
- Gateway rejects request body attempting clientside credential override.
- Gateway strips or blocks provider credential fields in request body if
  LiteLLM would honor them.
- Gateway metadata sent to LiteLLM is minimized/hashed or proven not to be
  logged/forwarded by LiteLLM.

### Live LiteLLM Tests

Manual or nightly lane.

Local:

```bash
export AGENT_GATEWAY_USER_FREE_CREDIT_ENABLED=true
export AGENT_GATEWAY_USER_FREE_CREDIT_USD=0.01
export AGENT_GATEWAY_MANAGED_BUDGET_PRO_USD=0.01
export AGENT_GATEWAY_MANAGED_CREDIT_AGENT_KINDS=claude
make dev PROFILE=billing-p3 AGENT_GATEWAY=1
# In a second shell:
. "$HOME/.proliferate-local/dev/profiles/billing-p3/launch.env"
export PROLIFERATE_API_BASE_URL="http://127.0.0.1:$PROLIFERATE_API_PORT"
AGENT_GATEWAY_LITELLM_MASTER_KEY=sk-local-dev-agent-gateway \
LITELLM_PROXY_URL=http://127.0.0.1:4000 \
LITELLM_MASTER_KEY=sk-local-dev-agent-gateway \
python3 scripts/agent-gateway-live-proof.py managed-credits --require-live
```

Production/staging:

```bash
PROLIFERATE_API_BASE_URL=https://api.staging.proliferate.ai \
PHASE3_GATEWAY_BASE_URL=https://api.staging.proliferate.ai \
python3 scripts/agent-gateway-live-proof.py all --require-live
```

Managed credits cases:

- Team creation/update succeeds.
- Virtual key generation succeeds.
- Global model deployment succeeds.
- `/v1/models` with team key lists expected model only.
- Anthropic-compatible gateway path streams.
- Budget exhaustion maps to Proliferate `llm_credits_exhausted`.
- Reconcile pass repairs drift.
- Reconcile pass is idempotent.

BYOK route-isolation cases:

- Same public model name routes to distinct provider credentials by team.
- Distinguishable credentials prove routing: Team A valid / Team B invalid,
  then inverted, with the same public model name.
- Team A key cannot access Team B credential.
- Team B key cannot access Team A credential.
- Runtime virtual keys cannot call LiteLLM admin endpoints such as `/team/*`,
  `/model/*`, `/key/*`, or credential-routing APIs.
- Request body/header/metadata override attempts for `api_key`, `api_base`,
  `aws_*`, `litellm_params`, and credential ids are ignored/rejected through
  both Anthropic and OpenAI facades.
- Disabled model config override makes proof fail.
- `oss_shared` topology refuses BYOK even if LiteLLM technically accepts
  model creation.
- `enterprise_shared` topology is allowed only after proof passes.
- `isolated_router` topology proves isolation by distinct LiteLLM base URL or
  router identity.

### Live Bedrock Tests

Use AWS test/staging resources. Do not print secrets.

Discovery:

```bash
aws sts get-caller-identity
aws bedrock list-foundation-models --region us-east-1
aws secretsmanager list-secrets --query 'SecretList[?contains(Name, `proliferate`)]'
```

Managed Bedrock pool:

- Confirm ECS task role or configured provider credential can invoke the chosen
  Bedrock model.
- Make tiny request through LiteLLM.
- Make tiny request through Proliferate Gateway.
- Assert response succeeds and spend is tracked.

Bedrock BYOK:

- Create customer-style test role with trust policy requiring external id.
- Add org BYOK Bedrock credential through API.
- Validation succeeds.
- Request through gateway succeeds.
- Wrong external id fails validation.
- AssumeRole succeeds only with the server-generated external id.
- STS GetCallerIdentity with assumed credentials returns expected account/role.
- Removing trust policy makes reconciler/validation fail safely.
- Disabling `AGENT_GATEWAY_BEDROCK_BYOK_ENABLED` makes existing grant fail at
  Proliferate gateway before provider call.
- CloudTrail or STS proof confirms expected assumed role.

### Production Infrastructure Tests

Add a script or CI manual job that checks:

- Production API/control-plane and optional gateway-runtime tasks have only
  their allowed env names; split gateway-runtime has no LiteLLM master key or
  Stripe secrets.
- Production LiteLLM service is private before BYOK flags are true.
- LiteLLM image is pinned for BYOK.
- Secrets exist by name but values are never printed.
- `AGENT_GATEWAY_PUBLIC_BASE_URL` resolves to intended public gateway.
- Health check:
  - `/health`
  - `/agent-gateway/health`
  - private LiteLLM health from inside VPC or ECS exec.
- `CLOUD_BILLING_MODE=enforce` has E2B API key configured.
- Stripe env surface has Team monthly price and managed cloud overage meter.
- Stripe webhook endpoint is subscribed to the exact required event set,
  including `invoice.upcoming` and
  `customer.subscription.trial_will_end`.
- Billing Slack webhooks are configured only in production if desired.
- Readiness artifact exists and matches the exact LiteLLM image digest/task
  definition when BYOK isolation flags are enabled.
- Production BYOK fails readiness if any OpenAI-compatible base URL is
  non-HTTPS.
- `isolated_router` fails readiness unless per-router runtime routing config is
  present.

### Web Tests

Web exposes a package `test` script for controller-adjacent invariants. This
pass adds direct coverage for pending Home prompt owner-context persistence,
which protects the personal-vs-Team launch handoff. Broader UI behavior remains
covered in `product-ui`/domain tests plus `pnpm web:typecheck`,
`pnpm web:build`, and manual smoke.

Add tests around `BillingSettingsSection` and Web Home when the harness exists:

- No-org user sees Account credits and Start Team.
- No-org user does not see personal paid billing copy.
- User with pending checkout sees checkout recovery/cancel state.
- Team owner sees Team billing actions.
- Team admin sees Team billing actions if policy allows.
- Team member sees read-only Team billing.
- Overage toggle calls Team endpoint.
- Checkout return query refreshes Team billing and current org.
- Billing API error renders retry.
- Free LLM credits disabled renders account credits fallback.
- GitHub-required free credits render connect-GitHub action/copy.
- Web Home blocks before workspace creation when account credits are exhausted.
- Web Home blocks before workspace creation when Team billing is blocked.
- Web Home uses selected configured cloud environment and required agent kind.
- Web Home calls generated launch preflight with owner scope, org id, target
  kind, required agent kind, and required managed resources before create.
- Pending home prompt dispatch supports organization-owned target
  materialization.

### Desktop Tests

Add tests around settings and launch presentation:

- Desktop Billing settings uses Account credits/Team billing copy.
- Desktop does not show personal paid checkout for hosted new users.
- Legacy checkout deep links still route to billing settings.
- Non-admin team member sees read-only Team billing.
- Owner/admin portal action opens browser.
- Overage toggle calls Team endpoint.
- Workspace status maps billing reasons to stable copy.
- Cloud launch command actions block with normalized billing reason.
- Desktop cloud launch paths call generated launch preflight with the same
  owner/target/agent/resource envelope as Web.
- Agent Auth BYOK form stays hidden/disabled when route isolation unverified.
- Agent Auth BYOK readiness shows provider-specific disabled state.

### Product UI Tests

- `packages/product-model` builds normalized Account/Team/Gateway billing view
  models from raw facade responses.
- `packages/product-model` maps every normalized billing block reason to stable
  copy, tone, and action intent.
- `packages/product-ui` renders Account credits for no-org users.
- Team owner/admin/member states render the correct actions/read-only copy.
- Managed LLM credit readiness renders active, exhausted, and sync-failed
  states.
- BYOK readiness renders as read-only status/deep link, not credential forms.
- Forbidden copy does not appear: personal billing, personal paid plan,
  personal overage, refill, customer-facing Pro.
- Every normalized billing block reason has stable presentation copy,
  including compute-vs-LLM exhaustion.

### SDK Tests

- New billing types alias generated OpenAPI schemas.
- Query keys separate account credits, team billing, team events, and legacy
  owner-scoped billing.
- Mutations invalidate the right caches.
- Account-credit ensure mutation invalidates account-credit overview.
- Launch preflight SDK/react helpers pass owner scope, org id, target kind,
  required agent kind, and required managed resources without app-specific
  product logic.
- Existing exported methods remain backward compatible.
- `cloud-sdk-react` billing hook tests cover account/team/team-events query
  keys and invalidation without app-specific product behavior.
- `cloud/sdk/src/client/billing.ts` has no `(client as any)` billing paths
  after OpenAPI regeneration.

### Security Tests

- Provider API keys redacted in API responses.
- Provider API keys redacted in LiteLLM integration errors.
- Provider API keys redacted in audit metadata.
- LiteLLM integration errors redact virtual keys, external IDs, role ARNs,
  Authorization headers, sensitive base URLs, camelCase sensitive keys, and
  provider error bodies.
- Runtime grants hashed in DB.
- LiteLLM virtual keys encrypted in DB.
- Worker commands do not include provider BYOK secrets.
- Gateway logs hash user/org/policy IDs.
- Request body size limit enforced before DB authorization.
- Gateway rejects unsupported protocol path.
- Gateway rejects stale profile revision.
- Gateway rejects stale target/slot generation.
- Gateway rejects unavailable model.
- Client-supplied credentials in request body cannot override server-side
  routing.
- OpenAI-compatible BYOK cannot be used for SSRF against metadata services,
  private VPC services, loopback, link-local, reserved ranges, or redirect
  targets that bypass validation.

## Manual End-To-End Acceptance Script

Run after implementation in a fresh worktree/profile:

```bash
make dev-init PROFILE=billing-p3
make stripe-setup-test
make dev PROFILE=billing-p3 STRIPE=1 AGENT_GATEWAY=1
```

Web:

1. Open hosted web profile URL.
2. Sign in as new GitHub-linked user.
3. Confirm Settings -> Billing shows Account credits and no personal paid
   billing.
4. Launch a personal cloud workspace using free credits.
5. Confirm free LLM credits are ensured and selected.
6. Create Team checkout.
7. Complete Stripe Checkout in test mode.
8. Confirm Team appears active.
9. Confirm Settings -> Billing shows Team billing.
10. Invite second user.
11. Accept invite as second user.
12. Confirm seat quantity reconciles.
13. Toggle overage.
14. Run the Phase 3 Stripe test-mode E2E helper for payment failure once it
    exists; do not rely on generic `stripe trigger` events because they may not
    match the configured subscription line items.
15. Confirm launch blocked with payment copy.
16. Run the same helper for invoice paid/recovery.
17. Confirm launch unblocked.

Desktop:

1. Open same profile desktop app.
2. Confirm Billing settings matches Web concepts.
3. Confirm Team billing portal action opens browser.
4. Confirm launch blocked/unblocked state matches Web.
5. Confirm Agent Auth BYOK controls reflect deployment gates.

Gateway:

1. Run managed live proof.
2. Run BYOK disabled proof.
3. If staging flags allow, run Anthropic/OpenAI/Bedrock BYOK live proofs.
4. Confirm no secrets in server logs.

AWS:

1. Run production readiness script in dry-run mode.
2. Confirm LiteLLM is private before enabling BYOK.
3. Confirm ECS task env names match `docs/reference/env-vars.yaml`.
4. Confirm Secrets Manager contains required secret containers.

## Verification Commands

Minimum local verification for implementation PR:

```bash
node scripts/validate-agent-catalog.mjs
pnpm install --frozen-lockfile
pnpm -C server/artifact-runtime build
make server-db-ready
cd server
DEBUG=1 uv run --extra dev ruff check proliferate/ tests/
DEBUG=1 uv run --extra dev ruff format --check proliferate/ tests/
DEBUG=1 uv run --extra dev pytest -q \
  tests/unit/test_billing_domain.py \
  tests/unit/test_billing_service_policy.py \
  tests/unit/test_billing_phase3_policy.py \
  tests/unit/test_billing_reconciler.py \
  tests/unit/test_stripe_billing.py \
  tests/integration/test_billing_store_invariants.py \
  tests/integration/test_billing_free_trial_allocation.py \
  tests/integration/test_billing_api.py \
  tests/integration/test_billing_accounting.py \
  tests/integration/test_billing_accounting_boundaries.py \
  tests/integration/test_stripe_webhooks.py \
  tests/integration/test_cloud_agent_auth_api.py \
  tests/integration/test_agent_gateway_api.py \
  tests/integration/test_schema_migrations.py
cd ..
```

Extended server gate when touching typed service boundaries:

```bash
cd server && .venv/bin/mypy proliferate/
```

Frontend/SDK:

```bash
make cloud-client-generate
pnpm --filter @proliferate/cloud-sdk build
pnpm --filter @proliferate/cloud-sdk-react build
pnpm --filter @proliferate/product-model test
pnpm --filter @proliferate/product-ui typecheck
pnpm --filter @proliferate/product-ui test
pnpm web:typecheck
pnpm web:build
cd desktop && pnpm test -- \
  src/lib/domain/workspaces/cloud/cloud-workspace-status.test.ts \
  src/lib/domain/agent-auth/agent-auth-gateway-form.test.ts \
  src/lib/domain/agent-auth/agent-auth-presentation.test.ts
```

Repo shape:

```bash
cd server && uv run python ../scripts/check_server_boundaries.py
cd ..
python3 scripts/check_max_lines.py
git diff --check
```

Live/manual:

```bash
make dev PROFILE=billing-p3 STRIPE=1 AGENT_GATEWAY=1
# In a second shell:
. "$HOME/.proliferate-local/dev/profiles/billing-p3/launch.env"
export PROLIFERATE_API_BASE_URL="http://127.0.0.1:$PROLIFERATE_API_PORT"
python3 scripts/agent-gateway-live-proof.py managed-credits --require-live
python3 scripts/check-production-billing-gateway-readiness.mjs --dry-run
```

## Rollout Plan

### Stage 0: Spec And Audit

- Land this spec.
- Create a short implementation checklist issue/PR stack.
- Decide Team display price and copy.
- Decide gateway deployment shape.
- Decide whether BYOK target is Enterprise shared or isolated router.

Suggested PR stack:

1. Billing notification table, generated facade schemas, and SDK contract.
2. Stripe activation/deletion semantics and seat adjustment transaction
   cleanup.
3. Free allocation typed outcomes and account-credit ensure/read split.
4. Launch preflight contract and Web/Desktop owner/target threading.
5. Team managed LLM period reset and budget reconciliation.
6. Product-model/product-ui/Web/Desktop billing migration.
7. LiteLLM/BYOK live proof scripts and infra readiness gates.

Avoid one giant implementation PR. The billing reconciler and Stripe paths are
transitional systems; keep changes staged and invariant-pinned.

### Stage 1: Product Billing Facade And Event Table

- Add account credits/team billing APIs.
- Add workspace launch preflight API.
- Add required `billing_notification_event` table and store methods.
- Add SDK/react hooks.
- Update Web/Desktop to consume new facades.
- Hide personal paid billing from new hosted-product UI.

### Stage 2: Stripe Hardening

- Refine subscription deletion.
- Validate Stripe subscription price/items before Team activation.
- Add informational webhook events.
- Harden seat reconciliation.
- Add billing notification event recording.
- Add Stripe test-mode e2e script.

### Stage 3: LiteLLM/BYOK Proof

- Add live proof script.
- Add LiteLLM credential-routing admin client support if using Enterprise
  shared topology.
- Add Bedrock AssumeRole validation.
- Pin LiteLLM production image for BYOK.
- Keep BYOK flags off until live proof passes and produces a digest-tied proof
  artifact.

### Stage 4: Infrastructure Alignment

- Wire production/staging env names.
- Make LiteLLM private.
- Remove or deprecate old gateway service if not used.
- Add AWS readiness script.
- Add deployment docs.

### Stage 5: Staging Flag Enablement And Full E2E

- Enable managed free LLM credits in staging.
- Enable Team managed LLM credits in staging.
- Run Web/Desktop/Stripe/Gateway/AWS smoke.
- Run live managed-credit proof.
- Run BYOK disabled proof.
- If BYOK is in scope, enable BYOK in staging only after readiness passes and
  then run Anthropic/OpenAI/Bedrock live proof.
- Capture runbook.

### Stage 6: Production Enablement

- Enable managed free LLM credits only after staging proof and rollback plan.
- Enable Team managed LLM credits only after staging proof and rollback plan.
- Enable BYOK only after explicit proof sign-off, digest-tied readiness
  artifact, and security review sign-off.

## Acceptance Criteria

Phase 3 is complete when:

- A new user sees account credits, not personal billing.
- New paid checkout creates a Team/org subscription, not a personal paid plan.
- A user can belong to zero or one org and Team billing respects that.
- Team owner/admin can manage portal and overage.
- Team member gets read-only billing state.
- Billing facade services return dataclass records; Pydantic builders take
  records, not ORM objects.
- `billing_notification_event` exists and powers Team billing event timelines.
- Team activation validates Stripe customer, subscription metadata, seat item,
  price id, period, and overage item before org activation.
- Stripe webhook retries are idempotent.
- Clean cancellation does not create payment-failed hold.
- Failed payment blocks managed cloud launch in enforce mode.
- Invoice paid clears payment hold.
- Seat count converges to active member count.
- Web/Desktop launch paths share the generated launch-preflight contract for
  owner/target/agent/resource-specific billing readiness.
- Account free LLM credits work end to end in Web without Desktop.
- Team managed LLM budget syncs to LiteLLM and resets on Stripe subscription
  period boundaries.
- LiteLLM budget exhaustion maps to Proliferate billing/gateway state.
- BYOK remains disabled unless live route-isolation proof passes.
- If BYOK is enabled, Bedrock/Anthropic/OpenAI live proofs pass.
- LiteLLM is private or BYOK is disabled.
- BYOK isolation proof is tied to the exact deployed LiteLLM image digest and
  topology.
- Secrets are not logged, returned, or materialized into sandboxes.
- Web and Desktop billing settings share the same product concepts.
- The full verification command set above passes or each deferral is documented
  with owner and follow-up.

## Open Questions

1. Is the Team price definitely `$30/user/month`, or should UI avoid price copy
   until Stripe price metadata is the source of truth?
2. Should legacy personal paid cloud subscriptions remain manageable in UI for
   existing customers, or only through support/portal links?
3. Is BYOK Phase 3 expected to ship to all Team customers, or only Enterprise?
4. Do we have a LiteLLM Enterprise license for staging/prod, or should isolated
   router be the concrete BYOK topology?
5. Which Bedrock regions and model ids are approved for Proliferate-managed
   credits?
6. Should account free LLM credits be one-time registration only or monthly?
7. Should the billing event timeline expose invoice amounts immediately, or
   keep amounts support-only until price copy is finalized?

## Explicit Non-Goals

- Multi-organization membership.
- Personal paid subscriptions for new users.
- Managed LLM overage.
- Per-request Proliferate LLM cost ledger beyond LiteLLM spend tracking.
- Mobile-specific billing UI beyond API compatibility.
- A full billing reconciler rewrite.
- A plan entitlement DB table.
- Turning on BYOK without live proof.
