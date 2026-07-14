# Billing

Status: current

Billing owns the shared accounting, authorization, and product contracts for
managed compute and managed LLM usage. It combines plan and subscription state,
grants or credit balances, billing holds, two independent usage ledgers, and
optional organization budget limits. Billing is reused by several product
systems; it does not own their navigation or workflow-specific presentation.

## Mental Model

```text
personal or organization owner / billing subject
  ├── plan, subscription, grants or credit balances, and holds
  ├── compute usage: seconds in usage_segment
  ├── managed LLM usage: USD in agent_llm_usage_event
  └── optional organization budget limits
        organization-wide and/or per-user
        compute | llm
        day | month (calendar UTC)
                 |
        enforcement + APIs/SDK + UI
```

Compute seconds and LLM dollars are separate meters. They can be displayed
beside one another, but they are never added into one usage number.

## Durable State And Ownership

`billing_subject_id` identifies who pays. An organization member's
organization-scoped compute and managed LLM usage is attributed to that
organization through `organization_id` and paid by the organization billing
subject. An owner without an organization uses the personal billing subject.
The subject's plan, subscription, grants or credit balances, and holds continue
to govern access independently of organization budget limits.

`free_cloud_allocation` is the anti-abuse reservation for personal compute
trials and managed-LLM free credits. Allocation kind, linked GitHub provider
identity, and period identify the reservation, preventing another account from
claiming the same free allocation. The reservation and grant flow is owned by
[`billing_subjects.py`](../../../../server/proliferate/db/store/billing_subjects.py).

Compute is recorded in seconds in `usage_segment`. Managed LLM usage is
recorded in USD in `agent_llm_usage_event`. Current usage reads aggregate these
raw ledgers; there is no rollup or materialized usage table.
Provider create/resume events open compute segments; pause, timeout, and kill
events close them. The provider-event boundary is documented by
[`sandbox-provisioning.md`](sandbox-provisioning.md#provider-webhooks).

Organizations may add the following limits over the existing Billing rules:

```text
billing_budget_limit
  organization_id
  user_id             null = organization-wide; set = per-user
  kind                compute | llm
  window              day | month, calendar UTC
  cap_value           nonnegative seconds or USD according to kind
  enabled
```

Organization-wide and per-user limits may coexist. Enforcement evaluates every
applicable enabled row independently. For display, the usage summary returns
one applicable row with the lowest raw `cap_value`; day and month caps are not
equivalent rates, and this projection is not the enforcement decision.
Personal usage has no personal `billing_budget_limit` row and remains governed
by its existing balances and entitlements. The durable models live in
[`server/proliferate/db/models/billing.py`](../../../../server/proliferate/db/models/billing.py).
The full-replacement administration API accepts at most one row per user
scope, kind, and window. That is an API validation rule, not a stronger claim
about nullable database uniqueness.

## Enforcement

In enforce mode, the compute authorization path rejects create or resume with
a structured HTTP 402 when the applicable billing subject is held or an
applicable compute budget is exhausted. The billing reconciler also pauses
open over-limit compute. The current owners are
[`billing/authorization.py`](../../../../server/proliferate/server/billing/authorization.py)
and
[`billing/reconciler.py`](../../../../server/proliferate/server/billing/reconciler.py).

Managed LLM usage import evaluates every applicable LLM limit. When a limit is
exhausted it disables the affected virtual keys with
`budget_status = limit_reached`. Only the limit reconciliation path clears
`limit_reached`, and only after all applicable limits pass and positive credit
remains. Purchasing or adding credit does not bypass an active budget limit.
This path is owned by
[`usage_import.py`](../../../../server/proliferate/server/cloud/agent_gateway/usage_import.py).

## Interfaces And Product Surfaces

The owner-scoped reads default to the personal owner and use an organization
only when it is selected and authorized:

```text
GET /billing/usage/summary
GET /billing/usage/timeseries
GET /billing/llm-balance
```

The usage summary is the current user's usage inside the selected owner and
billing subject. It is not aggregate organization usage. Organization
aggregation and administration use the organization-admin routes:

```text
GET /organizations/{organization_id}/usage/by-user
GET /organizations/{organization_id}/usage/users/{user_id}/timeseries
GET /organizations/{organization_id}/limits
PUT /organizations/{organization_id}/limits   full replacement
```

The personal and owner-scoped endpoints are implemented by
[`billing/api.py`](../../../../server/proliferate/server/billing/api.py); the
organization aggregation and limit endpoints are implemented by
[`organizations/usage/api.py`](../../../../server/proliferate/server/organizations/usage/api.py).
The Cloud SDK
[`billing client`](../../../../cloud/sdk/src/client/billing.ts) and React SDK
[`billing hooks`](../../../../cloud/sdk-react/src/hooks/billing.ts) expose the
matching client contracts.

Desktop and Web both reuse the same
[`BillingSettingsSurface`](../../../../apps/packages/product-surfaces/src/settings/BillingSettingsSurface.tsx).
That shared surface does not make their organization navigation identical.
Mobile has a smaller personal
[`Billing section`](../../../../apps/mobile/src/components/settings/MobileSettingsScreen.tsx)
that shows plan and usage state and exposes the available portal, checkout, or
refill actions; it does not reuse the Desktop/Web settings surface.
Desktop additionally registers and renders the organization-admin **Usage &
Limits** pane using real usage and limit hooks. It shows separate compute and
LLM balances and timeseries, organization-member usage and drill-down, and an
editor for organization-wide or per-member limits for either meter and either
UTC window. Its principal owners are
[`OrganizationBudgetsPane.tsx`](../../../../apps/desktop/src/components/settings/panes/OrganizationBudgetsPane.tsx)
and
[`OrganizationLimitsEditor.tsx`](../../../../apps/desktop/src/components/settings/panes/OrganizationLimitsEditor.tsx).

When usage metering is enabled and a usage summary exists, the compact
[`SidebarConsumptionCard`](../../../../apps/desktop/src/components/app/sidebar/SidebarConsumptionCard.tsx)
renders above the account footer. It is not part of an account popover.

## Known Gaps

- Web and Mobile do not expose the organization **Usage & Limits** pane.
- Usage reads aggregate the raw ledgers; no rollup or materialized usage table
  exists.
