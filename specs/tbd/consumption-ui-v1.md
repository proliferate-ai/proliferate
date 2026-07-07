# Consumption & Credits UI v1

Status: draft (2026-07-05). Owner: Pablo. Mode: design-first.

## Problem

We bill two separate things and the client can see only one of them.

- **Compute** (sandbox hours): fully surfaced via `GET /v1/billing/overview`
  (`server/proliferate/server/billing/models.py:170`). Desktop polls it via
  `useCloudBilling()` and renders blocked state.
- **LLM credits** (agent gateway, USD): the server *computes* the balance
  (`get_remaining_credit_usd`, `server/proliferate/db/store/agent_gateway/credits.py:149`)
  but **no API exposes it**. The enrollment endpoint even strips `budget_status`
  out of its response (`agent_gateway/models.py:347`). So today a user's LLM
  credits hit $0, the gateway virtual key is disabled, and the client
  experiences an undifferentiated 401 with no balance, no warning, no card, and
  — because reactivation *rotates* the key — a stale desktop stays broken even
  after a refill until it refetches auth state.

This is mostly a **backend exposure problem**, not a UI problem. The mocked
`OrganizationBudgetsPane.tsx` already shows the shape we want; it just has no
real data behind it.

## Locked decisions

1. **Sidebar indicator is universal.** Personal consumption for everyone;
   admins additionally get an org-totals view. Basic users are exactly the ones
   who hit $0 mid-session today — they need it most.
2. **Real units, not a unified "credit".** Compute in hours, LLM in USD. Maps
   1:1 to the DB and the Stripe invoice. Two numbers, not one abstract number.
3. **v1 scope = sidebar + cards only.** Per-member org table (de-mocking
   `OrganizationBudgetsPane`) is deferred. Admins get **org totals** in the
   sidebar; per-member breakdown is a later PR.
4. **Drive everything off billing-overview polling, not the 401 and not SSE.**
   The gateway 401 is indistinguishable from other auth failures and the client
   may not be mid-request when credits die. SSE `billing_patch` (billing.md
   §5.5) is unimplemented — do not couple v1 to it.

## Mental model (for the comprehension gate — fill in during review)

> _Pablo to restate here, in his own words:_ where the LLM balance is computed,
> what disables the key on exhaustion, why the client can't currently know, and
> the compute path from "sandbox running" → "cents on a Stripe invoice".

## Design

### A. Server — expose LLM credits (the load-bearing change)

**A1. Add LLM credit fields to `BillingOverview`**
(`server/proliferate/server/billing/models.py:170`, built in
`server/proliferate/server/billing/overview.py:82`):

```
llmCreditsEnabled: bool          # agent_gateway_enabled
llmCreditsGrantedUsd: float | None
llmCreditsUsedUsd: float | None
llmCreditsRemainingUsd: float | None
llmBudgetStatus: str | None      # "ok" | "exhausted" | null when gateway off
```

Source: `get_remaining_credit_usd(db, billing_subject_id)` +
`agent_gateway_enrollment.budget_status`. The snapshot builders
(`snapshots.py:191/198`) already run inside a session, so add the balance query
into `state_with_overage_usage` (or a sibling) and carry it on
`BillingSnapshot`. Round USD to cents (2dp). When
`settings.agent_gateway_enabled` is false, all four are null / `llmCreditsEnabled=false`
so the UI hides the LLM row entirely.

**A2. Mirror into desktop `BillingPlanInfo`**
(`apps/desktop/src/lib/domain/cloud/billing.ts:6`) and the shared
`BillingPlanView` (`apps/packages/product-ui/src/billing/billing-types.ts`) —
new optional fields, same camelCase names.

**A3. (Deferred, not v1)** `GET /v1/organizations/{id}/usage` returning
per-member `{userId, computeSeconds, llmUsedUsd}` for the current period.
`agent_llm_usage_event` and `usage_segment` both carry `user_id`, so this
aggregates cleanly. Auth via the existing `current_path_org_admin` dependency
(`organizations/api.py:119`). For v1, org **totals** come from the org-context
billing overview (owner scope = organization); only the per-member split waits.

### B. Sidebar consumption indicator (universal)

New compact element in the desktop sidebar, above `SidebarAccountFooter`
(`apps/desktop/src/components/workspace/shell/sidebar/`). Data from the existing
`useCloudBilling()` poll — no new fetch.

- **Everyone:** two small meters — compute (`remainingHours` / `includedHours`,
  or overage-used when on overage) and LLM (`llmCreditsRemainingUsd`). Hidden
  rows when a system is not applicable (LLM row hidden if `llmCreditsEnabled=false`).
- **Admins:** a scope toggle (personal ↔ org) reusing the existing
  `CloudOwnerSelection` (`billing.ts:1`). Org scope shows org totals from the
  org-context overview.
- **Free plan:** the element becomes an **upgrade card** variant — reuse the
  existing upgrade action from `BillingOwnerCard.tsx:82`, just placed in the
  sidebar.
- **State colors:** normal / warning (<10–20% remaining) / exhausted, driven off
  the overview fields — not off request failures.

### C. Exhaustion & warning cards

- **LLM credits exhausted** (`llmBudgetStatus === "exhausted"`): a card in the
  workspace surface + sidebar, with a refill/upgrade action. Mirror the existing
  compute treatment in
  `apps/desktop/src/lib/domain/workspaces/cloud/cloud-workspace-status-presentation.ts:46`
  (`CREDITS_EXHAUSTED_DESCRIPTION`). Distinct copy for LLM vs compute.
- **After refill, force an auth-state refetch** — because reactivation rotates
  the virtual key, the desktop must re-pull
  `GET /v1/cloud/agent-gateway/state?surface=local` and push the new key to the
  runtime. Verified in the local session: without the refetch the old key stays
  401 even though `budget_status` is back to `ok`. This is the one non-obvious
  correctness requirement in the whole spec.
- **Warning card** at low balance (both systems) — soft prompt, not a block.

### D. De-mock `OrganizationBudgetsPane` — DEFERRED to v2

Wire it to `GET /v1/organizations/{id}/usage` (A3). Out of v1 scope; noted so the
mocked pane isn't mistaken for shipped.

## Test plan (on the live `billing` profile)

We proved in the setup session we can force every state. Reuse that:

1. **LLM fields populate:** hit `/v1/billing/overview`, assert the four new
   fields match `select sum(amount_usd) - sum(cost_usd)` on the profile DB.
2. **Sidebar renders both meters** at healthy balance; LLM row hidden when
   `AGENT_GATEWAY` off.
3. **Exhaustion card:** shrink `llm_credit_grant.amount_usd` below spend, wait
   for the usage-import tick → `budget_status=exhausted` → overview reflects it →
   card appears. (Compute equivalent: drain grants + disable overage →
   `startBlocked`.)
4. **Refill recovery:** restore the grant, run reactivation, assert the desktop
   refetches auth state and the *new* key succeeds — the rotation gotcha.
5. **Free-plan upgrade card:** point at a subject with no subscription.
6. **Admin org toggle:** switch owner scope, assert org totals differ from
   personal.

## Open questions

- Warning threshold %: single value for both, or per-system?
- Does the sidebar element collapse/expand, or fixed compact?
- LLM "remaining" when gateway budget is uncapped (overage-enabled org, budget
  `None`) — show "unlimited" or hide the meter?

## Files this touches

Server: `billing/models.py`, `billing/overview.py`, `billing/snapshots.py`,
`db/store/agent_gateway/credits.py` (reuse). Desktop: `lib/domain/cloud/billing.ts`,
sidebar components, `cloud-workspace-status-presentation.ts`, agent-gateway
state refetch. Shared: `product-ui/src/billing/billing-types.ts` (+ card
components). Deferred: `OrganizationBudgetsPane.tsx`, new org usage endpoint.
