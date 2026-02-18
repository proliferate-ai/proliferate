# Inbox & Workspace — System Spec

## 1. Scope & Purpose

### In Scope
- Session list enhancements: origin badges, urgency indicators, origin filtering
- `automationId` and `automation` name surfaced on session API responses
- Investigation panel: context-aware right panel in workspace for run triage
- `getRun`, `listRunEvents`, `listOrgRuns` endpoints and corresponding hooks
- My Work page: personal dashboard of claimed runs, active sessions, pending approvals
- Activity page: org-wide paginated run history with status filtering
- Inbox modifications: unassigned-item filtering (runs where `assigned_to` is null)
- Sidebar navigation restructure: Home, Work section (My Work, Inbox, Activity), Configure section
- Command search additions: My Work and Activity quick navigation items
- `PreviewMode` union extension: `"investigation"` mode in Zustand preview panel store
- Shared utilities: `getRunStatusDisplay()`, `filterUnassignedItems()`, `countUnassignedItems()`

### Out of Scope
- Run lifecycle state machine, enrichment, execution, finalization — see `automations-runs.md`
- Run claiming and assignment DB operations (`assignRunToUser`, `unassignRun`) — see `automations-runs.md` section 6.11
- Run resolution (`resolveRun`) — see `automations-runs.md` section 6.11
- Session lifecycle (create/pause/resume/delete) — see `sessions-gateway.md`
- Trigger event ingestion and matching — see `triggers.md`
- Attention inbox core merge logic (`useAttentionInbox`) — see `automations-runs.md` section 6.10

### Mental Model

This spec covers the **triage and visibility layer** that sits on top of the run and session systems. When an automation run fails or needs human attention, users need to find it, understand what happened, and resolve it. This spec owns the navigation surfaces (sidebar, My Work, Activity, Inbox), the session list enrichments (origin badges, urgency indicators), and the investigation panel that provides run context directly within the workspace.

The flow is: a run reaches a terminal state -> it appears in the Inbox (if unassigned) or My Work (if claimed) -> the user clicks "View Session" which navigates to `/workspace/{sessionId}?runId={runId}` -> the investigation panel auto-opens in the right panel showing run status, error details, trigger context, timeline, and resolution controls.

**Core concepts:**
- **Origin badge** — visual indicator on session cards showing how the session was created (Automation, Slack, CLI, or none for manual/web).
- **Urgency indicator** — a destructive AlertTriangle icon shown on session cards when the session has a pending run in an attention-requiring status.
- **Investigation panel** — a right-panel tab in the workspace that displays run details, error context, timeline events, and a resolution form.
- **My Work** — a personal dashboard aggregating claimed runs, active manual sessions, and pending approvals for the current user.
- **Activity** — an org-wide feed of all automation runs across all automations, paginated with status filtering.

**Key invariants:**
- The inbox shows only unassigned items (runs where `assigned_to` is null, plus all pending approvals).
- The investigation panel auto-opens exactly once per workspace page load when `runId` is present in URL search params.
- The Activity page time-bounds queries to 90 days for performance.
- Session list origin filtering is client-side; the `excludeAutomation` filter is server-side.

---

## 2. Core Concepts

### Origin Classification
Sessions are classified by origin using a priority chain: if `automationId` is set, the origin is "automation"; else if `origin` or `clientType` is "slack", it is "slack"; else if "cli", it is "cli"; otherwise "manual". This classification drives both the `OriginBadge` component on session cards and the client-side origin filter dropdown on the sessions page.
- Key detail agents get wrong: origin classification is computed client-side from multiple fields (`automationId`, `origin`, `clientType`), not stored as a single derived field.
- Reference: `apps/web/src/app/(command-center)/dashboard/sessions/page.tsx:getSessionOrigin`

### Investigation Panel Lifecycle
The investigation panel is a `PreviewMode` variant (`{ type: "investigation" }`) in the Zustand preview panel store. When the workspace page receives a `runId` search param, it passes it as a prop to `CodingSession`, which auto-opens the investigation panel via a one-time `useEffect` guarded by a ref (`investigationOpened`). The panel fetches run data and events via `useRun(runId)` and `useRunEvents(runId)`.
- Key detail agents get wrong: the investigation panel does not create its own route or modal — it reuses the existing right-panel system. The `runId` flows as a prop, not through the store.
- Reference: `apps/web/src/components/coding-session/coding-session.tsx`, `apps/web/src/stores/preview-panel.ts`

### Unassigned Item Filtering
The inbox filters attention items to show only those without an owner. For runs, this means `assigned_to` is null. Approvals are always shown (they do not have a per-user assignment yet). The sidebar badge count is the length of the filtered items.
- Key detail agents get wrong: the filtering is **server-side** via the `unassignedOnly` parameter on `listOrgPendingRuns`, not client-side. The `useAttentionInbox` hook passes `unassignedOnly: true` to the DB query, which adds `WHERE assigned_to IS NULL`. Legacy helpers `filterUnassignedItems()` and `countUnassignedItems()` still exist but are no longer the primary filter path.
- Reference: `packages/services/src/runs/db.ts:listOrgPendingRuns`, `apps/web/src/hooks/use-attention-inbox.ts`

---

## 3. File Tree

```
packages/services/src/
├── runs/
│   ├── db.ts                                # findRunForDisplay(), listRunEvents(), listOrgRuns()
│   └── service.ts                           # Service wrappers for new DB functions
├── sessions/
│   ├── db.ts                                # excludeAutomation filter, automation relation join
│   ├── mapper.ts                            # automationId + automation name mapping
│   └── service.ts                           # excludeAutomation passthrough
└── types/
    └── sessions.ts                          # excludeAutomation field on ListSessionsFilters

packages/shared/src/contracts/
├── sessions.ts                              # automationId, automation object on SessionSchema
└── automations.ts                           # AutomationRunEventSchema, assigned_to on PendingRunSummarySchema

apps/web/src/server/routers/
├── automations.ts                           # getRun, listRunEvents, listOrgRuns endpoints
└── sessions.ts                              # excludeAutomation filter passthrough

apps/web/src/hooks/
├── use-automations.ts                       # useRun(), useRunEvents(), useResolveRun(), useOrgRuns()
├── use-my-work.ts                           # useMyWork() composite hook
├── use-org-activity.ts                      # useOrgActivity() wrapper
├── use-attention-inbox.ts                   # filterUnassignedItems(), countUnassignedItems()
└── use-sessions.ts                          # excludeAutomation param

apps/web/src/lib/
└── run-status.ts                            # getRunStatusDisplay() shared utility

apps/web/src/stores/
└── preview-panel.ts                         # "investigation" in PreviewMode union

apps/web/src/app/(command-center)/dashboard/
├── my-work/page.tsx                         # My Work page
├── activity/page.tsx                        # Activity page
├── inbox/page.tsx                           # Inbox with unassigned filtering
└── sessions/page.tsx                        # Origin badges, urgency indicators, origin filter

apps/web/src/app/(workspace)/workspace/
└── [id]/page.tsx                            # runId search param -> CodingSession prop

apps/web/src/components/
├── coding-session/
│   ├── investigation-panel.tsx              # Investigation panel component
│   ├── right-panel.tsx                      # investigation mode case
│   └── coding-session.tsx                   # runId prop, auto-open logic
├── dashboard/
│   ├── sidebar.tsx                          # New nav structure (Home, Work, Configure)
│   ├── command-search.tsx                   # My Work + Activity quick nav
│   └── page-empty-state.tsx                 # ActivityIllustration, MyWorkIllustration
├── sessions/
│   └── session-card.tsx                     # OriginBadge, urgency AlertTriangle, pendingRun prop
└── inbox/
    └── inbox-item.tsx                       # runId in "View Session" link
```

---

## 4. Data Flow

### Session List with Origin and Urgency

```
sessions.listByOrganization(orgId, { excludeAutomation? })
    │  joins: sessions → automation (columns: id, name)
    ▼
mapper.toSession(row)
    │  maps: row.automationId, row.automation → API response
    ▼
SessionSchema (contract)
    │  fields: automationId, automation: { id, name }
    ▼
useSessions() → session cards
    │
    ├── OriginBadge(session): automationId? → Automation / slack? → Slack / cli? → CLI
    │
    └── useOrgPendingRuns() → pendingRunsBySession map
        │  Map<sessionId, PendingRunSummary>
        ▼
        SessionListRow({ session, pendingRun }): AlertTriangle if pendingRun exists
```

### Investigation Panel Flow

```
Inbox "View Session" link or session card click
    │  href: /workspace/{sessionId}?runId={runId}
    ▼
workspace/[id]/page.tsx
    │  extracts: runId = searchParams.get("runId")
    ▼
CodingSession({ sessionId, runId })
    │  useEffect: auto-open investigation panel (once via ref guard + mode check)
    │  prepends "Investigate" tab to panel tabs when runId is present
    ▼
RightPanel({ runId }) → mode.type === "investigation"
    ▼
InvestigationPanel({ runId })
    ├── useRun(runId)         → run status, error, assignee, trigger context
    ├── useRunEvents(runId)   → timeline of status transitions (30s poll)
    ├── useAssignRun()        → "Claim" button (shown when unassigned + attention status)
    └── useResolveRun()       → mutation to mark run as succeeded/failed
```

### My Work Aggregation

```
useMyWork()
    ├── useMyClaimedRuns()    → automations.myClaimedRuns (runs assigned to current user)
    ├── useSessions({ excludeSetup, excludeCli, excludeAutomation, createdBy: userId })
    │   → server-side: WHERE created_by = userId
    │   → client-side: status in (running, starting, paused)
    └── useOrgActions({ status: "pending" })
        → pendingApprovals
    ▼
MyWorkPage: sections for Claimed Runs, Active Sessions, Pending Approvals
```

### Activity Feed

```
useOrgActivity({ status?, limit?, offset? })
    ▼
useOrgRuns(options) → automations.listOrgRuns
    ▼
runs.listOrgRuns(orgId, { status?, limit?, offset? })
    │  time-bound: 90-day cutoff
    │  joins: automationRuns → triggerEvent, trigger, session, assignee
    │  pagination: limit (max 100) + offset
    ▼
ActivityPage: status filter pills, paginated run list
```

### Inbox Unassigned Filtering

```
useAttentionInbox({ wsApprovals })
    │  calls: useOrgPendingRuns({ limit: 50, unassignedOnly: true })
    │  DB query: WHERE assigned_to IS NULL (server-side)
    │  returns: AttentionItem[] (unassigned runs + approvals, sorted by timestamp)
    ▼
InboxContent: items displayed directly (no client-side filter needed)
Sidebar: items.length → badge count
```

---

## 5. Key Invariants

### API Endpoints

| Endpoint | Scoping | Input | Output |
|----------|---------|-------|--------|
| `automations.getRun` | `orgProcedure` | `{ runId: UUID }` | `{ run: AutomationRunSchema }` |
| `automations.listRunEvents` | `orgProcedure` | `{ runId: UUID }` | `{ events: AutomationRunEventSchema[] }` |
| `automations.listOrgRuns` | `orgProcedure` | `{ status?, limit?, offset? }` | `{ runs: AutomationRunSchema[], total: number }` |

### Defense-in-Depth Patterns
- `listRunEvents` first verifies the run belongs to the org before fetching events. Returns `NOT_FOUND` (not empty array) if the run does not exist or belongs to another org. Source: `packages/services/src/runs/db.ts:listRunEvents`
- `findRunForDisplay` scopes query by both `runId` and `orgId`. Source: `packages/services/src/runs/db.ts:findRunForDisplay`
- `listOrgRuns` always applies a 90-day time cutoff to prevent unbounded queries. Source: `packages/services/src/runs/db.ts:listOrgRuns`

### Client-Side Filtering vs Server-Side
- **Server-side**: `excludeAutomation` filter on `sessions.listByOrganization` adds `WHERE automation_id IS NULL`. Source: `packages/services/src/sessions/db.ts`
- **Server-side**: `createdBy` filter on `sessions.listByOrganization` adds `WHERE created_by = ?`. Used by My Work to scope sessions to the current user. Source: `packages/services/src/sessions/db.ts`
- **Server-side**: `unassignedOnly` filter on `listOrgPendingRuns` adds `WHERE assigned_to IS NULL`. Used by inbox and sidebar badge. Source: `packages/services/src/runs/db.ts`
- **Client-side**: Origin filter dropdown (manual/automation/slack/cli) and urgency indicator cross-referencing are computed in the browser. Source: `apps/web/src/app/(command-center)/dashboard/sessions/page.tsx`

### Polling Intervals
- `useRun(runId)`: 30s refetch interval. Source: `apps/web/src/hooks/use-automations.ts:useRun`
- `useRunEvents(runId)`: 30s refetch interval. Source: `apps/web/src/hooks/use-automations.ts:useRunEvents`
- `useOrgRuns()`: 30s refetch interval. Source: `apps/web/src/hooks/use-automations.ts:useOrgRuns`
- `useOrgPendingRuns()`: 30s refetch interval (inherited from existing hook).

### Cache Invalidation
`useResolveRun()` invalidates five query keys on success: `getRun` (specific run), `listOrgPendingRuns`, `myClaimedRuns`, `listRuns` (automation-scoped), and `listOrgRuns`. Source: `apps/web/src/hooks/use-automations.ts:useResolveRun`

---

## 6. Known Limitations

- [ ] **Origin filter is client-side** — The origin filter dropdown on the sessions page computes origin from `automationId`, `origin`, and `clientType` fields in the browser. For large session lists, a server-side filter would be more efficient. The only server-side filter is `excludeAutomation` (used by My Work to hide automation-spawned sessions).
- [ ] **No server-side pagination on sessions** — The sessions list loads all sessions for the org and filters client-side. This works at current scale but will need server-side pagination as session counts grow.
- [ ] **Investigation panel requires runId in URL** — The investigation panel only opens when `runId` is present as a search param. There is no way to open it from within the workspace for a session that has an associated run without navigating through the inbox or session card link.
- [ ] **Pending run map uses last-wins** — The urgency indicator on session cards maps sessionId to the most recent pending run. If a session has multiple runs in attention states, only the last one in the array is shown. Source: `apps/web/src/app/(command-center)/dashboard/sessions/page.tsx`
- [ ] **Activity page has no date range picker** — The 90-day time bound is hardcoded in the DB query. Users cannot adjust the time window.
- [ ] **Sessions removed from sidebar** — The Sessions page is still accessible via direct URL (`/dashboard/sessions`) but is no longer in the sidebar navigation. It is accessible via command search.
- [ ] **My Work shows all org approvals** — Pending approvals in My Work are org-wide, not filtered to the current user, because per-user approval assignment does not exist yet. Source: `apps/web/src/hooks/use-my-work.ts`
- [ ] **Investigation panel claim does not optimistically update** — The "Claim" button in the investigation panel calls `assignRun` and waits for the mutation to complete. There is no optimistic update, so the button stays visible until the refetch completes.
