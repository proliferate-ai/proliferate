# Fix: /dashboard/runs Page

> Context doc for whoever picks this up. No prior knowledge of the codebase needed.

## What This Page Is

`/dashboard/runs` is the "Agent Runs" page — a triage inbox where users monitor and act on automation runs that need attention (failed, needs human input, timed out) and pending action approvals waiting for approve/deny.

It is **not** a list of all runs. It only shows items that require human intervention right now.

---

## Current Architecture

### Page Component

```
apps/web/src/app/(command-center)/dashboard/runs/page.tsx
```

The page is a thin shell: tabs + search + grouped items.

```
┌─────────────────────────────────────────┐
│  Agent Runs                             │
│  Monitor and triage your automation runs│
├─────────────────────────────────────────┤
│  [All (3)] [Needs Help (2)] [Approvals (1)]  🔍 Search │
├─────────────────────────────────────────┤
│  NEEDS HELP                             │  ← group header (shown if >1 group)
│  ┌─────────────────────────────────┐    │
│  │ 🔴 my-automation failed         │    │  ← RunItem card
│  │    Error message · 3 hours ago  │    │
│  │                    [View Session]│    │
│  └─────────────────────────────────┘    │
│  ┌─────────────────────────────────┐    │
│  │ 🟡 deploy-bot needs attention   │    │  ← RunItem card
│  │    5 minutes ago                │    │
│  │                    [View Session]│    │
│  └─────────────────────────────────┘    │
│                                         │
│  WAITING FOR APPROVAL                   │  ← group header
│  ┌─────────────────────────────────┐    │
│  │ 🛡 Run `create_issue` on Linear │    │  ← ApprovalItem card
│  │    Session title · expires 2m   │    │
│  │  [Approve] [Deny] [Always Allow]│    │
│  └─────────────────────────────────┘    │
│                                         │
│  You've reached the end · 3 items total │
└─────────────────────────────────────────┘
```

### Data Source: `useAttentionInbox` Hook

The page does **not** fetch runs directly. It uses a composite hook that merges two data sources into a single sorted list:

```
apps/web/src/hooks/use-attention-inbox.ts
```

```ts
function useAttentionInbox(options: {
  wsApprovals: ActionApproval[];  // WS-delivered approvals from current session
  sessionId?: string;              // Current session (for deduplication)
})
```

The runs page calls it with **empty WS approvals** (no active session context):
```ts
const items = useAttentionInbox({ wsApprovals: [] });
```

Inside the hook, two independent API calls are made:

| Data Source | Hook | API | What it returns | Polling |
|---|---|---|---|---|
| **Pending approvals** | `useOrgActions({ status: "pending", limit: 10 })` | `orpc.actions.list` → `actions.listOrgActions(orgId, { status: "pending" })` | Action invocations with status "pending" across the org | 30s refetch |
| **Pending runs** | `useOrgPendingRuns({ limit: 10 })` | `orpc.automations.listOrgPendingRuns` → `runs.listOrgPendingRuns(orgId)` | Automation runs with status `failed \| needs_human \| timed_out` | 30s refetch |

The hook then:
1. Adds WS approvals first (priority — not applicable on runs page since `wsApprovals` is empty)
2. Adds org-polled approvals, deduplicating against WS approvals by `invocationId`
3. Adds pending runs
4. Sorts everything by timestamp (newest first)

Returns: `AttentionItem[]` — a discriminated union:
```ts
type AttentionItem =
  | { type: "approval"; data: ApprovalWithSession; timestamp: number }
  | { type: "run"; data: PendingRunSummary; timestamp: number };
```

### Data Shapes

**PendingRunSummary** (from `packages/shared/src/contracts/automations.ts`):
```ts
{
  id: string                    // UUID
  automation_id: string         // UUID — FK to automations
  automation_name: string       // Human-readable automation name
  status: "failed" | "needs_human" | "timed_out"
  status_reason: string | null  // Why the run ended up in this state
  error_message: string | null  // Error details
  session_id: string | null     // UUID — the session that ran this (nullable)
  queued_at: string             // ISO timestamp
  completed_at: string | null   // ISO timestamp
}
```

**ApprovalWithSession** (from `use-attention-inbox.ts`):
```ts
{
  approval: {
    invocationId: string
    integration: string        // e.g. "linear", "sentry", "github"
    action: string             // e.g. "create_issue", "assign_issue"
    riskLevel: string          // e.g. "medium", "high"
    params: unknown            // action parameters
    expiresAt: string          // ISO timestamp — approvals expire
  }
  sessionId: string            // Session where the action was requested
  sessionTitle?: string | null // For display
}
```

### Item Renderers

Both item types are rendered by `InboxItem` (dispatcher) in:
```
apps/web/src/components/inbox/inbox-item.tsx
```

**RunItem** (line 205–242):
- Status icon (red XCircle for failed, amber Hand for needs_human, orange Timer for timed_out)
- Title: `"{automation_name} failed"` / `"{automation_name} needs attention"` / `"{automation_name} timed out"`
- Subtitle: error_message + time ago
- Action: "View Session" button → links to `/workspace/{session_id}`
- Card style: `rounded-xl border border-border bg-card p-3`

**ApprovalItem** (line 73–186):
- Shield icon (amber)
- Title: `Run {action} on {integration}` with action in a code tag
- Subtitle: session title + time ago
- External link to session
- Actions: **Approve**, **Deny**, **Always Allow** buttons with loading/success micro-interactions
- Approve/Deny calls go through **Gateway HTTP** (not oRPC) — `POST /proliferate/{sessionId}/actions/invocations/{invocationId}/approve|deny`
- "Always Allow" also sets org-level action mode via `orpc.orgs.setActionMode`

### Grouping Logic

The `groupByStatus` function (line 33–55 of `page.tsx`) groups items into at most 2 sections:

1. **"Needs Help"** — all `type: "run"` items with status `failed | needs_human | timed_out`
2. **"Waiting for Approval"** — all `type: "approval"` items

Group headers only show when there are 2+ groups. If everything is runs or everything is approvals, no header.

### Tab Filtering

| Tab | Filter |
|---|---|
| All | No filter |
| Needs Help | `item.type === "run"` |
| Approvals | `item.type === "approval"` |

Each tab shows a count badge.

### Search

Searches across:
- For approvals: `action`, `integration`, `sessionTitle`
- For runs: `automation_name`, `error_message`, `status`

Case-insensitive substring match.

---

## Where Else This Data Appears

The same `useAttentionInbox` hook is used in **4 other places**, creating overlap:

| Location | File | Context | What it shows |
|---|---|---|---|
| **Dashboard home "Needs Attention"** | `components/dashboard/empty-state.tsx:234–292` | Uses `useOrgPendingRuns({ limit: 5 })` directly (NOT `useAttentionInbox`) — **only runs, no approvals** | Up to 5 pending runs as simple rows (different renderer than runs page) |
| **In-session InboxTray** | `components/coding-session/inbox-tray.tsx` | Uses `useAttentionInbox` with WS approvals from active session | Max 3 items as compact cards above chat input, with overflow count. Different card components (`ApprovalCard`, `RunCard`) than the runs page versions |
| **Sidebar badge** | `components/dashboard/sidebar.tsx:571` | Uses `useAttentionInbox({ wsApprovals: [] })` | Just the count — shown as a badge on the "Runs" nav item |
| **Layout bell icon** | `app/(command-center)/layout.tsx:62` | Uses `useAttentionInbox({ wsApprovals: [] })` | Count badge on a bell icon button in the top bar |

### Renderer Duplication

There are **3 different implementations** of run/approval cards:

1. **`InboxItem`** (`components/inbox/inbox-item.tsx`) — used on `/dashboard/runs` page. Full card with rounded-xl border.
2. **`InboxTray` cards** (`components/coding-session/inbox-tray.tsx`) — used inside active workspace sessions. Compact inline cards with different button layout (Deny/Approve/Grant instead of Approve/Deny/Always Allow). Different approve mode: passes `{ mode: "grant", grant: { scope: "session", maxCalls: 10 } }`.
3. **`NeedsAttention` rows** (`components/dashboard/empty-state.tsx:248–288`) — used on dashboard home. Simple link rows in a bordered list (no action buttons, just links). Only shows runs (no approvals).

### Approval Flow Differences

The three renderers handle approvals differently:

| Renderer | Approve action | "Always Allow" / "Grant" behavior |
|---|---|---|
| `InboxItem` (runs page) | Calls approve via Gateway HTTP, no mode | "Always Allow" = approve + set org-level action mode to `allow` |
| `InboxTray` (in-session) | Calls approve with `mode: "once"` | "Grant" = approve with `mode: "grant"`, `scope: "session"`, `maxCalls: 10` |
| `NeedsAttention` (dashboard) | No approve button — just a link to the session/automation | N/A |

---

## Problems / What Needs Fixing

### 1. Pagination / Limits

Both data sources are hard-limited:
- Pending runs: `limit: 10` (in `useAttentionInbox`)
- Pending approvals: `limit: 10` (in `useAttentionInbox`)

The runs page has no pagination and no "load more". If an org has 15 failed runs, the user only sees 10. There's no indication that items are being truncated.

The dashboard home uses `limit: 5` via `useOrgPendingRuns({ limit: 5 })`.

### 2. It's Not Really a "Runs" Page

The page title is "Agent Runs" but it shows a mix of pending automation runs and action approvals. These are fundamentally different things:
- **Runs** = automation executions that failed or need help → user triages by viewing the session
- **Approvals** = action invocations awaiting approve/deny → user acts inline

The page has no history — once a run is resolved or an approval is acted on, it disappears. There's no way to see completed runs, past approvals, or run history. It's purely a real-time triage queue.

### 3. No Link to Automation Detail

Run items link to the session (`/workspace/{session_id}`), but there's no link to the automation itself (`/dashboard/automations/{id}`). Users can't easily navigate to the automation that produced the failed run.

### 4. Three Different Card Components

Run/approval rendering is implemented 3 times with inconsistent UI and behavior (see "Renderer Duplication" above). The in-session InboxTray cards use a different approval flow (grant with session scope) than the runs page cards (always-allow with org scope), which is intentional but not obvious.

### 5. Polling-Only, No Real-Time

Data refreshes on a 30-second polling interval. There's no WebSocket push for new runs or approvals showing up on this page. Users have to wait or manually refresh.

### 6. Empty State

The empty state (`InboxEmpty` in `components/inbox/inbox-empty.tsx`) shows "All clear / Your agents are working quietly in the background" with a checkmark icon. This is fine but doesn't give any context about what would appear here or link to any docs.

---

## Key Files

| File | Role |
|---|---|
| `apps/web/src/app/(command-center)/dashboard/runs/page.tsx` | Runs page — tabs, search, grouping, renders `InboxItem` |
| `apps/web/src/components/inbox/inbox-item.tsx` | `InboxItem` — dispatches to `ApprovalItem` or `RunItem` |
| `apps/web/src/components/inbox/inbox-empty.tsx` | `InboxEmpty` — empty state component |
| `apps/web/src/hooks/use-attention-inbox.ts` | `useAttentionInbox` — merges WS approvals + polled approvals + pending runs into sorted list |
| `apps/web/src/hooks/use-automations.ts` | `useOrgPendingRuns` — fetches pending runs (failed/needs_human/timed_out) |
| `apps/web/src/hooks/use-actions.ts` | `useOrgActions` — fetches pending action invocations; `useApproveAction`/`useDenyAction` — Gateway HTTP mutations |
| `apps/web/src/hooks/use-action-modes.ts` | `useSetActionMode` — sets org-level action mode (used by "Always Allow") |
| `apps/web/src/components/coding-session/inbox-tray.tsx` | `InboxTray` — in-session version of the same data (different card components, different approve flow) |
| `apps/web/src/components/dashboard/empty-state.tsx` | `NeedsAttention` (line 234–292) — dashboard home version (runs only, no approvals, no action buttons) |
| `apps/web/src/components/dashboard/sidebar.tsx` | Sidebar badge count from `useAttentionInbox` |
| `apps/web/src/app/(command-center)/layout.tsx` | Bell icon badge count from `useAttentionInbox` |
| `packages/shared/src/contracts/automations.ts` | `PendingRunSummarySchema`, `AutomationRunSchema` — data shapes |
| `packages/shared/src/index.ts` | `ActionApprovalRequestMessage` — approval payload type |
| `apps/web/src/server/routers/automations.ts` | `listOrgPendingRuns` oRPC handler (line 487) |
| `apps/web/src/server/routers/actions.ts` | `actions.list` oRPC handler — org-level action invocations |
| `docs/specs/automations-runs.md` | System spec for automations/runs subsystem |
| `docs/specs/actions.md` | System spec for actions/approval flow |
