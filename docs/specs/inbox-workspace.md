# Inbox & Workspace — System Spec

## 1. Scope & Purpose

### In Scope
- Attention surfaces that help humans triage work: `/dashboard/inbox`, workspace inbox tray, and sidebar inbox badge.
- Session visibility affordances: origin badges, urgency indicators, and run-aware deep links.
- Workspace investigation mode (`PreviewMode: "investigation"`) and run triage UI in the right panel.
- Org run visibility endpoints: `automations.getRun`, `automations.listRunEvents`, `automations.listOrgRuns`, `automations.listOrgPendingRuns`.
- Billing-blocked rollup endpoint for inbox: `sessions.blockedSummary`.
- My Work page aggregation (claimed runs + active manual sessions + pending approvals).
- Activity page (org-wide paginated run history with status filtering).
- Dashboard navigation and command search entries for My Work and Activity.

### Out of Scope
- Run lifecycle execution/enrichment/finalization — see `automations-runs.md`.
- Trigger ingestion/matching — see `triggers.md`.
- Session lifecycle create/pause/resume/delete internals — see `sessions-gateway.md`.
- Action risk policy and approval semantics — see `actions.md`.
- Billing metering and credit gating logic — see `billing-metering.md`.

This spec intentionally does not duplicate code-level file topology or data model inventory. The codebase is the source of truth for both.

## 2. Mental Models

### Attention is a merged feed, not a single queue
The inbox is a derived union over four sources:
- Session-scoped WebSocket approvals.
- Org-scoped pending approvals (`actions.list`).
- Org-scoped pending runs (`automations.listOrgPendingRuns`, unassigned only).
- Org-scoped billing-blocked session rollups (`sessions.blockedSummary`).

### Different surfaces show different slices of the same attention model
- `/dashboard/inbox` shows approvals, runs, and blocked groups.
- Workspace inbox tray shows approvals and runs, but hides blocked groups.
- Sidebar badge count uses the full merged attention list length.

### Investigation is a panel mode, not a route
Investigation is rendered by the existing workspace right panel system. `runId` comes from URL search params and is passed down as a prop; there is no separate investigation route.

### Runs and sessions are coupled for triage, but queried independently
Run details come from run APIs (`getRun`, `listRunEvents`) and session chrome comes from session APIs. Deep links tie them together via `/workspace/{sessionId}?runId={runId}`.

### My Work is responsibility-focused, not inbox-focused
My Work combines:
- Runs assigned to the current user.
- Active manual sessions created by the current user.
- Pending approvals (currently org-wide, not user-assigned).

### Org boundaries are enforced server-side
Run/session read APIs in this spec are org-scoped procedures and enforce org ownership in service/DB queries.

## 5. Key Invariants

### API and Query Contracts
- `automations.getRun` and `automations.listRunEvents` are org-scoped by `runId`; `automationId` is not required.
- `automations.listOrgRuns` is always time-bounded to the last 90 days in DB queries.
- `automations.listOrgPendingRuns` only returns attention statuses (`failed`, `needs_human`, `timed_out`), with default age bound 7 days and max limit 50.
- `sessions.blockedSummary` returns grouped blocked-session counts with up to three preview sessions per reason.

### Scoping and Filtering Rules
- Unassigned run filtering is server-side (`unassignedOnly -> WHERE assigned_to IS NULL`), not client-side.
- Session filters `excludeAutomation` and `createdBy` are server-side in `sessions.list`.
- Session origin filter (`manual/automation/slack/cli`) is client-side classification from `automationId`, `origin`, and `clientType`.

### Polling and Freshness
- `useRun`, `useRunEvents`, `useOrgRuns`, `useOrgPendingRuns`, and `useOrgActions` poll every 30s.
- My Work uses faster polling for responsibility surfaces: claimed runs (10s) and active sessions (5s).
- Sessions page polls every 5s only when visible rows include live statuses.

### Cache Coherency After Run Mutations
- `assignRun` and `resolveRun` invalidate: specific run, org pending runs, my claimed runs, automation run list, and org run list.
- Investigation panel correctness depends on those invalidations, not optimistic state mirroring.

## 6. Deep Dives (Declarative Invariants)

### 6.1 Attention Feed Composition
- Attention items are typed as exactly one of: `approval`, `run`, or `blocked`.
- WebSocket approvals and org-polled approvals are deduplicated by `invocationId`.
- Pending runs included in attention feed are unassigned runs only.
- Blocked groups are organization-level operational concerns and remain separate from run assignment semantics.

### 6.2 Attention Ordering and Prioritization
- The merged feed is globally sorted descending by each item's derived timestamp.
- Grouped inbox sections preserve semantic priority: blocked groups first, then runs needing help, then approvals waiting for action.
- Sidebar badge semantics reflect total merged attention count, not only run count.

### 6.3 Workspace Investigation Contract
- If `runId` exists in workspace URL params, investigation tab is present in panel tabs.
- Investigation auto-open is one-time per distinct `runId` during a page lifetime.
- If investigation mode is selected without a `runId`, the panel renders a neutral empty state instead of stale run data.
- Investigation data is read-only from polling queries until explicit claim/resolve mutations succeed.

### 6.4 Claim and Resolve Semantics
- Claim is only allowed when a run is unassigned or already assigned to the same user.
- Manual resolve is only legal from `failed`, `needs_human`, or `timed_out`, and target outcome must be `succeeded` or `failed`.
- Resolve writes a `manual_resolution` run event and preserves org + automation ownership checks in transaction scope.

### 6.5 Session Triage Signals
- Urgency indicator on session rows is driven by presence of a pending run mapped to that session ID.
- Origin badge semantics are deterministic: automation first, then Slack, then CLI, else manual.
- Session-level urgency does not alter canonical session status; it is a cross-entity attention overlay.

### 6.6 Work Surface Boundaries
- My Work is user-responsibility scoped for runs/sessions, but approvals remain org-wide.
- Activity is org-wide and paginated; it is an audit/visibility surface, not an ownership queue.
- Inbox is triage-first and includes blocked billing state; it is broader than run assignment.

## 7. Things Agents Get Wrong

- Inbox is not just runs: it also includes approvals and billing-blocked session groups.
- Workspace tray and dashboard inbox are not equivalent views; blocked groups are intentionally hidden in the tray.
- Sidebar inbox badge is not “unassigned runs count”; it counts the entire merged attention feed.
- Investigation is not a modal or route; it is a `PreviewMode` variant in the existing right panel.
- `runId` is propagated via workspace URL search params and component props, not via Zustand global run state.
- Unassigned filtering is server-side in `listOrgPendingRuns`; client filtering is not the source of truth.
- My Work “pending approvals” are currently org-wide; they are not assigned to the current user.
- Sessions origin classification is client-derived from multiple fields; there is no single persisted “origin kind” field.
- Activity page UX pagination does not define backend bounds; backend enforces 90-day scope and max query limits.
- Claim/resolve mutations rely on query invalidation and refetch; optimistic UI is intentionally minimal.
- `listRunEvents` returns `NOT_FOUND` when run/org scope check fails; this is not equivalent to “empty timeline”.
- `blockedSummary` reasons are normalized for display text in services, not exposed as raw DB pause-reason labels.

## 8. Known Limitations

- [ ] Origin filtering on Sessions is client-side and can become expensive with large org session counts.
- [ ] Sessions list has no server-side pagination; high-cardinality orgs will require it.
- [ ] Investigation still requires `runId` in URL; no first-class “open latest run for this session” affordance in workspace.
- [ ] Pending-run overlay on session rows shows one mapped run per session, not a multi-run stack.
- [ ] Activity has fixed backend 90-day horizon and no user-configurable date range.
- [ ] My Work approvals are org-level because per-user approval assignment does not yet exist.
- [ ] Claim/resolve flows are not optimistic and can feel latent on high-latency links.
