# Consumption & Limits v1 — usage visibility, budget limits, sidebar card

Status: implementation-ready. Written 2026-07-07 against commit `c5e9471e3` (branch
`ux/org-settings`, the settings-IA rework) — all UI file references below are verified at that
commit; all server references verified against main (this layer did not change in the IA rework).

Goal: the billing *engine* (grants, metering, Stripe export, enforcement) is built and shipped.
What's missing is the **visibility + limits layer**: nobody — user or admin — can see consumption
over time, per user, or set caps. This spec adds that without touching the engine's write paths.

## 0. Mental model (verified, do not re-derive)

Two fully distinct meters. Keep them distinct.

**Compute (seconds).** E2B webhooks open/close `usage_segment` rows
(`server/proliferate/db/models/billing.py`: `user_id`, `billing_subject_id`, `organization_id`,
`sandbox_id`, `started_at`, `ended_at`, `is_billable`). `billing_subject_id` is who pays and
`organization_id` is the enforcement/attribution scope (§4.2); both are resolved from the owner's
current membership at segment-open time, so an owner acting under an org bills the org subject and
an org-less owner bills personal (see §4.2, matching the LLM track). A
15-min accounting pass drains
`billing_grant.remaining_seconds`; overage exports to a Stripe meter. Enforcement that is LIVE:
the reconciler (`server/proliferate/server/billing/reconciler.py:271-365`) pauses open segments
when `active_spend_hold`. **`authorize_sandbox_start` in
`server/proliferate/server/billing/authorization.py` has ZERO callers on main (orphaned since
#823)** — do not assume start-side gating exists; see §4.3.

**LLM (USD).** Per-user LiteLLM virtual keys (org members each get their own key within the org
team — `server/proliferate/server/cloud/agent_gateway/enrollment.py:130-234`). A worker imports
`/spend/logs` into `agent_llm_usage_event` (per-request rows: `user_id`, `organization_id`,
`billing_subject_id`, `model`, tokens, `cost_usd`, `workspace_id`, `session_id`, `occurred_at`;
time-series indexes on user/org/subject + `occurred_at`). Balance = `sum(llm_credit_grant) −
sum(cost)` via `get_remaining_credit_usd`
(`server/proliferate/db/store/agent_gateway/credits.py:149` — note: store module, NOT
server/cloud). Zero balance → key disabled (`usage_import.py:245-296`); top-up re-mints.

All raw data for every surface below already exists in these two ledgers. This build is:
read APIs + one new table + two enforcement hooks + three UI surfaces.

## 1. Scope

In: LLM balance de-mock; usage read endpoints (timeseries, by-user, per-user, personal summary);
`billing_budget_limit` table + org-admin CRUD; enforcement (LLM key-disable, compute
reconciler-pause); Usage & Limits pane un-parked and wired; sidebar consumption card; SDK client
+ hooks; tests.

Out (phase 2): web app Usage & Limits pane (billing de-mock lands on web for free via shared
surface); rollup/materialized tables (raw scans are fine at current volume — leave a comment at
the query site); usage CSV export; spend alerts/emails; forecasting (keep the disabled Forecast
button); per-workspace/per-model drill-downs (data supports them; UI later).

## 2. New table: `billing_budget_limit`

Alembic migration (autogenerate from model, `cd server && uv run alembic revision --autogenerate
-m "billing budget limits"`; follow the idempotent-guard style of recent migrations, e.g.
`ff9344886948_*.py`). Model in `server/proliferate/db/models/billing.py`:

```
billing_budget_limit
  id                  uuid pk
  organization_id     uuid FK organizations.id, ON DELETE CASCADE, indexed, NOT NULL
  user_id             uuid FK "user".id, ON DELETE CASCADE, nullable   -- NULL = org-wide limit
  kind                text CHECK IN ('compute','llm')
  window              text CHECK IN ('day','month')                     -- calendar buckets, UTC
  cap_value           numeric(12,2) NOT NULL CHECK (cap_value >= 0)
      -- kind='compute': cap in SECONDS; kind='llm': cap in USD
  enabled             boolean NOT NULL default true
  created_at / updated_at
  UNIQUE (organization_id, user_id, kind, window)
```

v1 is org-scoped only (personal subjects' natural limit is their balance). Org-wide row
(`user_id IS NULL`) caps the whole org's window consumption; per-user rows cap individuals.
Both can coexist; enforcement checks both.

## 3. Server: read endpoints

All in `server/proliferate/server/billing/` (router prefix `/billing`,
`server/proliferate/server/billing/api.py`), following its existing thin-route pattern
(deps → store/domain call → `BillingServiceError` → HTTPException). Store aggregates go in
`server/proliferate/db/store/billing.py` as plain async functions, `select(...)` +
`func.date_trunc(<granularity>, col)` + `group_by` (first app-code date_trunc use; model on the
group_by shape in `background/tasks/customerio_sync.py:39-71`). Compute usage from
`usage_segment` (clip open segments at `now`; overlap-window semantics: attribute each segment's
seconds to the bucket of its `started_at` — good enough at these magnitudes, note it in a
comment), LLM from `agent_llm_usage_event.occurred_at`/`cost_usd`.

### 3.1 `GET /billing/usage/summary` — personal, feeds the sidebar card

Deps: `current_product_user` + `current_owner_context` (works in both personal and org scope;
usage rows filtered to `user_id = current user` within the owner's billing subject).

```json
{
  "computeUsedSecondsMtd": 12345.0,
  "computeRemainingSeconds": 50000.0,      // subject-level, from existing snapshot/grant math
  "llmUsedUsdMtd": 3.42,
  "llmRemainingUsd": 6.58,                  // get_remaining_credit_usd (subject-level)
  "computeLimit":  {"window": "month", "capValue": 72000, "usedValue": 12345, "blocked": false} | null,
  "llmLimit":      {"window": "month", "capValue": 10.0,  "usedValue": 3.42,  "blocked": false} | null,
  "canSelfServeTopUp": true                 // false for org members who aren't org admins
}
```

`*Limit` reflects the tightest applicable enabled limit for this user (per-user row wins over
org-wide when both exist and per-user is tighter); `blocked` = used >= cap this window.

### 3.2 `GET /billing/usage/timeseries` — owner-scoped chart data

Deps: `current_owner_context`. Query: `granularity=day|week|month` (default day),
`days=7|30|90|365` (default 30), `kind=compute|llm|all` (default all).

```json
{"buckets": [{"bucketStart": "2026-07-01T00:00:00Z", "computeSeconds": 3600.0, "llmCostUsd": 1.25}, ...]}
```

Zero-fill missing buckets server-side so the chart never gaps.

### 3.3 `GET /organizations/{organization_id}/usage/by-user` — org admin

Nested-router pattern with `current_path_org_admin` (copy the SSO router shape,
`server/proliferate/server/organizations/sso/api.py`). Query: `days=…`. Joins user display info.

```json
{"users": [{"userId": "…", "displayName": "…", "email": "…",
            "computeSeconds": 7200.0, "llmCostUsd": 4.10,
            "computeLimitCapSeconds": 36000.0 | null, "llmLimitCapUsd": 10.0 | null}, ...]}
```

Sorted by combined consumption descending. Include members with zero usage. `computeSeconds` is
summed by `usage_segment.organization_id` (`billing.compute_usage_seconds_by_user_for_org`), not by
the org billing subject, so it aggregates every member's org compute regardless of which subject
each segment is invoiced to — the same scope §4.2 enforces. `llmCostUsd` stays keyed off the org
billing subject because org gateway enrollments are minted against it.

### 3.4 `GET /organizations/{organization_id}/usage/users/{user_id}/timeseries` — org admin

Same params/shape as 3.2, filtered to one user. Feeds the per-user drill-down.

### 3.5 `GET /billing/llm-balance` — real LLM balance for the billing page

Deps: `current_owner_context`. Returns `LlmCreditBalanceRecord` fields:
`{"grantedUsd": 10.0, "usedUsd": 3.42, "remainingUsd": 6.58}`. Lives in billing api.py (it's a
billing surface concern) calling the agent_gateway store function.

### 3.6 Limits CRUD — org admin

On the same nested org router:
- `GET  /organizations/{organization_id}/limits` → `{"limits": [BudgetLimit, ...]}`
- `PUT  /organizations/{organization_id}/limits` — full-replace upsert of the org's limit set
  (body: `{"limits": [{"userId": null|"…", "kind": "…", "window": "…", "capValue": …,
  "enabled": true}, ...]}`). Full-replace keeps the UI trivial (edit list, save). Validate kinds/
  windows/caps; reject userIds not in the org.

BudgetLimit response: `{"id","userId","kind","window","capValue","enabled","updatedAt"}`.

## 4. Server: enforcement

Shared pure helper first: `resolve_effective_limit(limits, *, user_id, kind) ->
EffectiveLimit | None` and `window_bounds(window, now) -> (start, end)` (calendar UTC) in a new
`server/proliferate/server/billing/budget_limits.py` — pure functions, unit-tested without DB
(match `tests/unit/test_billing_domain.py` style).

### 4.1 LLM — via the existing usage-import worker

In the usage-import pass (`server/proliferate/server/cloud/agent_gateway/usage_import.py`), after
events are written: for each org with enabled LLM limits, compute window spend per affected user
(and org-wide), and
- over cap → disable that member's virtual key, set enrollment `budget_status='limit_reached'`
  (new status value, distinct from `'exhausted'` so reactivation logic can't confuse them);
- under cap (window rolled, cap raised, or limit disabled) AND credit balance positive → re-enable,
  reusing the existing reactivation machinery (`topups.py:131-181` pattern).
Org-wide limit breach disables all member keys in that org's team (same loop). Enforcement lag =
one import interval; that matches compute's 15-min reconciler lag and is acceptable.

### 4.2 Compute — via the live reconciler

In `_enforce_or_reconcile_segment` (`reconciler.py`), alongside the existing
`active_spend_hold` check: load the org's enabled compute limits once per pass, compute window
usage for the segment's `user_id` (and org-wide), and pause when over cap, closing the segment
with the existing `USAGE_SEGMENT_CLOSED_BY_QUOTA_ENFORCEMENT` and recording a
`BillingDecisionEvent` with a new decision type `user_limit_pause` (or `org_limit_pause`).
Only when `CLOUD_BILLING_MODE=enforce`, same as today's behavior.

**Attribution.** `usage_segment` carries an `organization_id` column (owner's current membership,
or `None` for an org-less owner), stamped at segment-open time
(`billing_runtime_usage.resolve_organization_id_for_user`). Enforcement resolves the org directly
from `segment.organization_id` and sums window usage by `organization_id`
(`billing.compute_usage_seconds_in_window_for_org`) — so org usage aggregates across every member
regardless of which subject each segment is invoiced to. Before #1028, segments were attributed
only to the personal subject and the enforcement path resolved `organization_id=None`, so
admin-configured compute caps saved in the UI silently never fired.

**Who pays (ruled 2026-07-09).** Compute run under an org bills the org billing subject (org
Stripe customer, org grant pool), matching how LLM usage already attributes to the org. At
segment-open, `billing_runtime_usage.resolve_billing_subject_id_for_user` derives the paying
subject from the same current-membership lookup that produces `organization_id`: a user with a
current membership bills the org subject, an org-less user bills personal. Deriving both from one
lookup means `billing_subject_id` and `organization_id` can never disagree, and it mirrors the LLM
track exactly (an org member's gateway enrollment is minted against the org billing subject in
`ensure_org_enrollment`, an org-less user's against their personal one in `ensure_user_enrollment`,
both keyed off the same membership test). The prior behavior — org compute draining the workspace
owner's personal credits while org compute budgets watched an empty pool — was the "org-subject
segment attribution gap" left open by #1028.

Grant drawdown, overage export, and the Stripe metered events all follow `billing_subject_id`
unchanged (the accounting layer is subject-parametrized), so no accounting code changes; they
simply now target the org subject for org compute. Compute caps sum by `organization_id`, a
separate scope, so there is no double-counting. In-flight segments opened before this change keep
their stamped subject — no retroactive re-attribution — so nothing that was already invoiced to a
personal subject moves.

### 4.3 Compute start-side (live)

`authorize_sandbox_start` stays orphaned (dead since #823 — do not wire it up). The live
start/resume gate is `authorization.assert_cloud_sandbox_resume_allowed`, called first in
`connect_ready_sandbox`. It blocks a wake on an active spend hold or an over-cap compute budget,
raising a structured 402 (`CloudSandboxResumeBlockedError`) the UI can surface. It resolves the
owner's org via membership and sums usage by `organization_id`
(`compute_usage_seconds_in_window_for_org`), mirroring the reconciler's
`_resolve_compute_limit_pause`. The active-spend-hold snapshot reads the paying subject resolved
the same way as segment-open (`resolve_billing_subject_id_for_user`) so that a hold on the org
grant pool blocks an org member's resume, not just the personal pool.

## 5. SDK

After server work: `make cloud-openapi && (cd cloud/sdk && make cloud-client-generate)` — or the
repo's actual invocation (Makefile target `cloud-client-generate` runs `npx openapi-typescript`;
regenerates `cloud/sdk/src/generated/openapi.ts`). Then:
- `cloud/sdk/src/client/billing.ts`: `getUsageSummary`, `getUsageTimeseries`, `getLlmBalance`,
  `getOrgUsageByUser`, `getOrgUserUsageTimeseries`, `getOrgLimits`, `putOrgLimits` — follow the
  existing `ownerQuery(owner)` + typed-paths pattern.
- `cloud/sdk-react/src/hooks/billing.ts`: `useUsageSummary`, `useUsageTimeseries`,
  `useLlmBalance`, `useOrgUsageByUser`, `useOrgUserUsageTimeseries`, `useOrgLimits`,
  `useUpdateOrgLimits` (mutation invalidates limits + by-user + summary keys). New key helpers in
  `cloud/sdk-react/src/lib/query-keys.js`.
- Rebuild SDK dists (`pnpm --filter` the sdk + sdk-react packages) — consumers use built dist.

## 6. UI (desktop-first; all at commit `c5e9471e3` conventions)

Design language: existing settings primitives only — `SettingsSection`/`SettingsRow`/
`SettingsPageHeader` from product-ui, `ProgressBar`/`Badge`/`Select`/`Skeleton`/`Button` from
`@proliferate/ui/primitives`. No new chart library: charts are hand-rolled (precedent: the
budgets pane's inline SVG). For the bar chart, prefer simple flex/div bars over SVG polylines —
bars by bucket, stacked or side-by-side compute vs LLM. Loading states via `Skeleton`; keep
copy terse and unbadged (all "Mocked UI" badges go away).

### 6.1 Billing page de-mock (shared → lands on desktop AND web)

`apps/packages/product-surfaces/src/settings/BillingSettingsSurface.tsx`: delete
`MOCK_LLM_BALANCE`; build the LLM `BillingUnitBalancePresentation` from `useLlmBalance` (granted
→ purchased, remaining → available, used → used, percent from those; top-up wiring unchanged).
Compute balance already derives from `plan.grantAllocations` — leave it. Page keeps the reworked
order: plan card → usage units → auto top-up → portal last. Billing page shows *balances only*;
all time-series/limits UX lives on the Usage & Limits page.

### 6.2 Usage & Limits page (un-park the budgets pane)

Revive `organization-limits` exactly per the parked-pane convention, reversing the "BUDGETS
PARKED" comments:
1. `apps/desktop/src/config/settings.ts` — uncomment/add `"organization-limits"` in both
   `SETTINGS_CONTENT_SECTIONS` and `SETTINGS_SHORTCUT_SECTION_ORDER`.
2. `apps/desktop/src/lib/domain/settings/navigation-presentation.ts` — nav entry (label
   "Usage & limits", `adminOnly: true`, org scope; it may already exist parked — check
   `PARKED_SECTION_SCOPES`).
3. `apps/desktop/src/components/settings/sidebar/SettingsSidebar.tsx` — icon map entry (the
   `satisfies Record<SettingsNavIconId,…>` map makes omission a compile error).
4. `apps/desktop/src/components/settings/screen/render-settings-section.tsx` — uncomment the
   render branch.
5. Rewrite `OrganizationBudgetsPane.tsx` internals against real hooks; delete
   `organization-budgets-presentation.ts` (the mock data file) entirely.

Pane layout (top → bottom):
- **Balance cards row**: org compute (grants) + LLM (real balance) — reuse the existing card
  shapes, real data, no badges.
- **Consumption chart**: bar chart over `useUsageTimeseries`; controls = range Select
  (7d/30d/90d), granularity Select (day/week/month), kind SegmentedControl (All / LLM /
  Compute). Units: PCUs for compute (reuse the `secondsToCredits`/`formatCredits` helpers from
  the billing surface), USD for LLM; "All" shows the two series side by side, not summed (units
  differ — never add seconds to dollars).
- **Per-user table**: `useOrgUsageByUser` rows — name, compute PCUs, LLM $, per-row ProgressBar
  against that user's cap when one exists. Row click → drill-down.
- **Per-user drill-down**: local-state sub-view within the pane (desktop settings has no
  sub-routing) — back button, user header, same chart wired to the per-user timeseries endpoint.
- **Limits section**: edit list backed by GET/PUT limits — org-wide row + add-per-member rows
  (member picker from existing org-members data), kind + window + cap inputs, enabled Switch,
  single Save (full-replace PUT). Show current-window usage next to each cap.

### 6.3 Sidebar consumption card

`apps/desktop/src/components/app/sidebar/SidebarAccountFooter.tsx`: new block inside the popover
between the help-links div and the Settings/Log out div (same `border-t border-border-light
py-1` wrapper). Content: two compact rows — "Compute" and "LLM credits" — each a small
ProgressBar + remaining figure, from `useUsageSummary`. States:
- normal: bars + remaining;
- near limit (>80% of cap or balance): amber accent;
- blocked/exhausted: destructive accent + one CTA — `canSelfServeTopUp` ? "Top up" (navigates
  to /settings billing section) : "Ask your admin".
Keep it two rows + optional CTA; it's a popover, not a dashboard. Replace the existing bare
"Plan" row's trailing label logic only if it collides; otherwise leave it.

### 6.4 Web (this build)

Only the shared billing-surface de-mock (6.1) — verify `apps/web` builds. Web Usage & Limits
pane is phase 2 (web's `cloud-settings.ts` has no adminOnly gate; needs its own in-component
role check — noted for later).

## 7. Testing (gate each stage on these)

- **Unit (pure)**: `budget_limits.py` resolution + window math — `server/tests/unit/`, no DB.
- **Integration (real PG via existing fixtures)**: store aggregates (seed `usage_segment` +
  `agent_llm_usage_event` rows via `db_session`, assert bucket math, zero-fill, user filtering);
  endpoint auth/shape tests via the `client` fixture (member vs admin on org routes — a
  non-admin must 403); limits CRUD round-trip; LLM enforcement (seed spend over cap → import
  pass disables key/sets `limit_reached`; raise cap → re-enables); compute enforcement (open
  segment + over-cap usage → reconciler pauses, decision event recorded). Run:
  `cd server && uv run pytest -q` (plus `--extra dev` if that's how the suite is invoked here).
- **Frontend**: `pnpm` build/typecheck for `@proliferate/product-surfaces`, `product-ui` (if
  touched), sdk, sdk-react, `apps/desktop`, `apps/web`. Shared packages are consumed as built
  dist — rebuild after edits or desktop won't see them.
- **Live smoke (if a dev profile is feasible)**: boot profile `consumption-ui` per
  `specs/developing/local/feature-worktree-auth.md`, curl the four read endpoints with seeded
  rows, eyeball the three surfaces. This branch adds a migration → the profile is owned by this
  branch for its lifetime.

## 8. Decisions log

- Two meters stay fully distinct (compute seconds vs LLM USD); "All" chart view juxtaposes, never
  sums. (Pablo, 2026-07-07)
- Limits are org-scoped v1; windows are calendar day/month UTC; full-replace PUT for the limit
  set. Personal-scope limits deferred.
- Enforcement rides existing machinery only: LiteLLM key-disable for LLM, reconciler pause for
  compute. Start-side compute gating is best-effort (§4.3) because `authorize_sandbox_start` is
  verified dead code.
- No new chart/dep libraries; hand-rolled bars per repo precedent.
- No rollup tables v1; raw-scan aggregates with a comment marking the future rollup seam.
- Sidebar card is personal-scope always (an admin's org view lives in settings, not the popover).
