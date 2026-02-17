# Fix: Inbox Page (Rename from Runs, Rebuild Layout)

> Context doc for whoever picks this up. No prior knowledge of the codebase needed.
> Read `docs/design-system.md` before writing any UI code.

## Problem Statement

The current `/dashboard/runs` page has five problems:

1. **Identity crisis.** It's called "Agent Runs" but it's not a run history page — it's a real-time triage queue of things needing human intervention (failed runs + pending approvals). It has no history, no pagination, no completed items.
2. **Stacked card layout is unscannable.** Items are full-width cards stacked vertically. With 15+ items you're scrolling endlessly with no way to quickly scan titles.
3. **Three separate card components** render the same data entity (approvals/runs) with different UIs, different action buttons, and different approval scopes — confusing and hard to maintain.
4. **Silent data truncation.** Both data sources are hardcoded to `limit: 10`. If item #11 is a production-critical approval, the user never sees it.
5. **30-second polling lag.** The page only refreshes every 30 seconds. An agent waiting for approval sits blocked while the user stares at stale data.
6. **Bell icon in the header** links to `/dashboard/actions` (a different page entirely from `/dashboard/runs`), creating a confusing navigation split.

---

## Current State (What Exists Today)

### Pages and their roles

| Route | File | What it shows |
|---|---|---|
| `/dashboard/runs` | `app/(command-center)/dashboard/runs/page.tsx` | Triage queue — pending runs + pending approvals, tabs, search, grouped cards |
| `/dashboard/actions` | `app/(command-center)/dashboard/actions/page.tsx` | Action invocation log — all statuses (pending/completed/denied/failed/expired), paginated table, 20 per page |

The bell icon in the header (layout.tsx:170–183) links to `/dashboard/actions`. The sidebar "Runs" nav item links to `/dashboard/runs`. Two different pages, same badge count, confusing.

### Runs page layout

Rendered by `RunsPage` in `app/(command-center)/dashboard/runs/page.tsx`:

```
┌─────────────────────────────────────────────────────────┐
│  Agent Runs                                             │
│  Monitor and triage your automation runs                │
├─────────────────────────────────────────────────────────┤
│  [All (7)] [Needs Help (3)] [Approvals (4)]   🔍 Search│
├─────────────────────────────────────────────────────────┤
│  NEEDS HELP                                             │
│  ┌─────────────────────────────────────────────────┐    │
│  │ ✕ api-server deploy failed                      │    │
│  │   Error: OOM killed · 2m ago    [View Session]  │    │
│  └─────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────┐    │
│  │ ✋ PR reviewer needs attention                   │    │
│  │   Timeout after 300s · 5m ago   [View Session]  │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  WAITING FOR APPROVAL                                   │
│  ┌─────────────────────────────────────────────────┐    │
│  │ 🛡 Run `create_issue` on Linear                 │    │
│  │   Session title · expires in 3m                  │    │
│  │   [✓ Approve] [✕ Deny] [🛡 Always Allow]        │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  You've reached the end · 7 items total                 │
└─────────────────────────────────────────────────────────┘
```

### The three card components

| Component | File | Used in | Approval scope |
|---|---|---|---|
| **`InboxItem`** (dispatches to `ApprovalItem` / `RunItem`) | `components/inbox/inbox-item.tsx` | `/dashboard/runs` page | "Always Allow" = org-level `setActionMode` |
| **`InboxTray`** (contains `ApprovalCard` / `RunCard`) | `components/coding-session/inbox-tray.tsx` | Floating above chat input in workspace | "Grant" = session-level grant (10 uses) |
| **`NeedsAttention`** | `components/dashboard/empty-state.tsx:234–292` | Dashboard home | Read-only links, no action buttons |

All three fetch from the same `useAttentionInbox` hook but render differently:
- `InboxItem.ApprovalItem`: Approve / Deny / Always Allow (org-wide mode set)
- `InboxTray.ApprovalCard`: Deny / Approve (once) / Grant (session, 10 uses) — plus role check, expiry countdown, params preview
- `NeedsAttention`: No approval actions, just links to workspace/automation

### Notification entry points

| Location | File | Badge source | Links to |
|---|---|---|---|
| **Sidebar "Runs" nav** | `sidebar.tsx:600–607` | `useAttentionInbox` count | `/dashboard/runs` |
| **Sidebar collapsed icon** | `sidebar.tsx:166–181` | Same | `/dashboard/runs` |
| **Header bell icon** | `layout.tsx:170–183` | Same | `/dashboard/actions` (!) |

The bell links to `/dashboard/actions`, not `/dashboard/runs`. Navigation is inconsistent.

### Data flow

```
useAttentionInbox({ wsApprovals, sessionId? })
  ├─ wsApprovals (passed in — only InboxTray passes real ones)
  ├─ useOrgActions({ status: "pending", limit: 10 })  ← 30s polling
  └─ useOrgPendingRuns({ limit: 10 })                 ← 30s polling

  Merges all three → dedupes approvals by invocationId → sorts by timestamp DESC
```

**RunsPage passes `wsApprovals: []`** (line 58) — it never receives live WebSocket approvals. Only the `InboxTray` inside an active workspace session passes real WS approvals.

### Data limits

- `useOrgActions`: `limit: 10` (hardcoded in `use-attention-inbox.ts:34`)
- `useOrgPendingRuns`: `limit: 10` (hardcoded in `use-attention-inbox.ts:35`)
- Dashboard "Needs Attention": `limit: 5` (separate call in `empty-state.tsx:235`)
- `InboxTray`: shows max 3 cards (client-side slice), rest shown as "+N more"

If there are 15 pending approvals, only 10 are fetched. The other 5 are invisible.

### Approval data shape

```ts
// From useAttentionInbox
type AttentionItem =
  | { type: "approval"; data: ApprovalWithSession; timestamp: number }
  | { type: "run"; data: PendingRunSummary; timestamp: number }

interface ApprovalWithSession {
  approval: {
    invocationId: string
    integration: string      // e.g. "linear", "sentry"
    action: string           // e.g. "create_issue", "drop_table"
    riskLevel: string        // e.g. "low", "medium", "high", "critical"
    params: unknown          // action-specific payload
    expiresAt: string        // ISO timestamp
  }
  sessionId: string
  sessionTitle?: string | null
}

interface PendingRunSummary {
  id: string
  automation_id: string
  automation_name: string
  status: "failed" | "needs_human" | "timed_out"
  status_reason?: string
  error_message?: string
  completed_at?: string
  queued_at: string
  session_id?: string
}
```

### Permission model

- Approve/Deny requires `admin` role or higher (checked in `InboxTray`, **not checked** in `InboxItem` on the runs page)
- `useApproveAction` calls Gateway HTTP: `POST /proliferate/{sessionId}/actions/invocations/{id}/approve`
- `useDenyAction` calls Gateway HTTP: `POST /proliferate/{sessionId}/actions/invocations/{id}/deny`
- `useSetActionMode` calls oRPC: `orgs.setActionMode({ key, mode })` — org-level permanent setting

---

## What To Build

### 1. Rename route to `/dashboard/inbox`

"Runs" implies a historical CI/CD log. This page is an airlock — a triage queue where the goal is inbox zero.

```
/dashboard/runs      →  /dashboard/inbox
Sidebar label: Runs  →  Inbox
Page title: Agent Runs → Inbox
```

Run history belongs inside automation detail pages (`/dashboard/automations/[id]`), not here.

### 2. Master-detail split-pane layout

Replace the stacked cards with a two-column layout (Linear/Superhuman/Mail style):

```
┌────────────────────────────────────────────────────────────────────┐
│  Inbox                                          All clear ✓ / N   │
├──────────────────────────┬─────────────────────────────────────────┤
│  🔍 Search...            │                                         │
├──────────────────────────┤  [🟡 Waiting for Approval]              │
│  NEEDS HELP (1)          │                                         │
│  🔴 api-server deploy    │  Run `create_issue` on Linear           │
│     2 mins ago           │  ↳ From: Stale PR Reviewer              │
│                          │  ↳ Automation: Stale PR Reviewer ↗      │
│  APPROVALS (2)           │                                         │
│  🟡 create_issue ←       │  TL;DR                                  │
│     Linear · 5m ago      │  Agent found a NullPointerException     │
│  🟡 drop table           │  and drafted a Linear ticket.           │
│     users_temp · 12m ago │                                         │
│                          │  Parameters                             │
│                          │  title: NPE in auth service             │
│                          │  priority: high                         │
│                          │                                         │
│                          │  [✓ Approve] [✕ Deny]                   │
│                          │  [🛡 Always Allow (Org-Wide)]            │
│                          │  [🙋 Open in Workspace]                  │
└──────────────────────────┴─────────────────────────────────────────┘
```

**Left column (queue):** Narrow, highly scannable. Shows only: status icon, title (action name or automation name), source (integration or repo), time ago. No action buttons. Grouped by type: "Needs Help" then "Approvals". Clicking selects an item.

The left column must be **filterable** beyond just search text. Filters should be compact (dropdown or pill-style toggles) below the search bar:

- **Type**: All / Approvals / Runs (replaces the current tab system)
- **Integration**: All / Linear / Sentry / GitHub / etc. (derived from `approval.integration` on approvals — for runs, could derive from the automation's connected integration if available)
- **Risk level**: All / Critical / High / Medium / Low (approvals only — hide this filter when "Runs" type is selected)
- **Automation**: All / dropdown of automation names (useful when one noisy automation floods the inbox)

Filters are client-side (the full dataset is already fetched). Persist selected filters in URL query params so deep-links and browser back/forward work:
```
/dashboard/inbox?type=approval&integration=linear&risk=high
```

**Right column (triage card):** Full detail view of selected item. For approvals: action name, integration, risk level badge, session title with link, parent automation link, params, expiry countdown, action buttons. For runs: automation name, status, error message, session link, automation link.

### 3. Kill the bell icon

Delete the bell icon from the header bar (`layout.tsx:170–183`). Notification count belongs in exactly two places:
- Sidebar: `Inbox [3]` badge
- Workspace: the "← Dashboard" escape hatch (already exists)

### 4. Kill the floating `InboxTray`

The `InboxTray` renders approval cards floating above the chat input in the workspace. This detaches approvals from the conversational flow.

Replace it with inline chat cards rendered within the message stream. The approval request should appear as a message in the chat, not a floating overlay.

**Note:** This is a larger change that touches the workspace message rendering. If it's too much for this PR, defer it — but stop rendering the floating tray and instead show a dismissible banner linking to `/dashboard/inbox`.

### 5. Dumb down Dashboard Home "Needs Attention"

The `NeedsAttention` component in `empty-state.tsx` is already read-only (no action buttons), which is correct. But it should deep-link to the inbox with the item pre-selected:

```
/dashboard/inbox?id={runId or invocationId}
```

So clicking a row takes you to the inbox with that item's triage card open in the right pane.

### 6. Fix data limits

Remove the hardcoded `limit: 10` from `useAttentionInbox`. The inbox must show all pending items. If pagination is too heavy for this PR, bump to `limit: 50` and show a warning at the bottom: "Showing 50 oldest pending items."

Update the API endpoints (`actions.list`, `automations.listOrgPendingRuns`) to support higher limits or remove the default.

### 7. Add real-time updates

The runs page currently polls every 30 seconds with no WebSocket connection. When an agent hits a wall and requests approval, the user doesn't see it for up to 30 seconds.

Wire the inbox page to listen for org-level WebSocket events. We already have the WS infrastructure for in-session approvals (`ActionApprovalRequestMessage`). The inbox needs a similar listener at the org level.

If org-level WS is too much for this PR, at minimum reduce the polling interval to 5 seconds on the inbox page (only when it's the active route).

### 8. Add automation breadcrumb

Both run items and approval items should link back to the parent automation:

```
↳ Automation: Stale PR Reviewer ↗  →  /dashboard/automations/{automation_id}
```

For approvals, this requires the API to include `automationId` and `automationName` in the action invocation data. Check if this is already available or needs to be added.

---

## Action Items

### 1. Rename route: `/dashboard/runs` → `/dashboard/inbox`

**Files:**
- `apps/web/src/app/(command-center)/dashboard/runs/page.tsx` → move to `inbox/page.tsx`
- `apps/web/src/app/(command-center)/layout.tsx` — update `PAGE_TITLES` map
- `apps/web/src/components/dashboard/sidebar.tsx` — change nav label from "Runs" to "Inbox", update href
- `apps/web/src/components/dashboard/empty-state.tsx` — update "All Runs" link in `NeedsAttention` to `/dashboard/inbox`

### 2. Rebuild page as master-detail split-pane

**File:** `apps/web/src/app/(command-center)/dashboard/inbox/page.tsx` (new location)

- Left column: scannable list, grouped by status, search bar, filters (type/integration/risk/automation), click to select
- Right column: triage card with full detail, action buttons, automation link
- URL state: selected item ID + active filters in query params (`?id=...&type=approval&integration=linear`) for deep-linking and browser navigation
- Filters are client-side (full dataset already fetched), derived from available data (integration names, risk levels, automation names)
- Empty state: "All clear" when inbox is empty (reuse `InboxEmpty`), filtered empty state: "No matching items"

### 3. Unify card components

**Delete or gut:**
- `components/coding-session/inbox-tray.tsx` — delete the floating tray. Replace with either inline chat cards or a banner linking to `/dashboard/inbox` (see item 4 notes above)
- `components/inbox/inbox-item.tsx` — refactor into queue row + detail card

**Create:**
- Queue row component (left column) — minimal: icon, title, source, time
- Triage card component (right column) — full detail: all metadata, params, action buttons

**Keep consistent:**
- Action button labels must state scope: "Approve" (once), "Always Allow (Org-Wide)", "Grant for Session"
- Role check (`admin` required) must be enforced in both the inbox page and any workspace approval UI
- `useButtonState` micro-interaction pattern is good — reuse it

### 4. Delete bell icon from header

**File:** `apps/web/src/app/(command-center)/layout.tsx`

Delete lines 170–183 (the `<Button>` with `<Bell>` icon). Remove the `useAttentionInbox` call from the layout (line 62) if no other code in the layout needs it. Clean up unused imports (`Bell` from lucide).

### 5. Update sidebar badge

**File:** `apps/web/src/components/dashboard/sidebar.tsx`

- Change "Runs" label to "Inbox"
- Change href from `/dashboard/runs` to `/dashboard/inbox`
- Badge count stays the same (from `useAttentionInbox`)

### 6. Fix data limits

**File:** `apps/web/src/hooks/use-attention-inbox.ts`

- Change `useOrgActions({ status: "pending", limit: 10 })` → `limit: 50` (or remove limit if API supports it)
- Change `useOrgPendingRuns({ limit: 10 })` → `limit: 50` (or remove limit)
- Show warning in UI if results are at the limit boundary

**Backend files (if limit removal needed):**
- Check `apps/web/src/server/routers/actions.ts` and `automations.ts` for server-side max limits
- Ensure the DB queries can handle higher limits without performance issues

### 7. Improve polling (quick win) or add WebSocket (ideal)

**Quick win** — reduce polling interval on the inbox page:
- `use-attention-inbox.ts`: Accept a `refetchInterval` override param
- Inbox page: pass `refetchInterval: 5_000` (5 seconds)
- Other callers (sidebar, layout) keep the default 30 seconds

**Ideal** — org-level WebSocket listener:
- Subscribe to org-level approval/run events via existing WS infrastructure
- Instantly update the inbox when new items arrive
- This is a larger change — can be a follow-up PR

### 8. Deep-link from Dashboard Home

**File:** `apps/web/src/components/dashboard/empty-state.tsx`

Update `NeedsAttention` links from:
```
/workspace/${run.session_id}
/dashboard/automations/${run.automation_id}/events?runId=${run.id}
```
to:
```
/dashboard/inbox?id=${run.id}
```

So clicking takes the user to the inbox with that item pre-selected in the triage card.

---

## Key Files

| File | What to do |
|---|---|
| `apps/web/src/app/(command-center)/dashboard/runs/page.tsx` | Move to `inbox/page.tsx`, rebuild as split-pane |
| `apps/web/src/app/(command-center)/layout.tsx` | Delete bell icon (lines 170–183), update PAGE_TITLES |
| `apps/web/src/components/inbox/inbox-item.tsx` | Refactor into queue row + triage card |
| `apps/web/src/components/inbox/inbox-empty.tsx` | Keep (used for empty state) |
| `apps/web/src/components/coding-session/inbox-tray.tsx` | Delete floating tray, replace with inline chat cards or banner |
| `apps/web/src/components/dashboard/sidebar.tsx` | Rename "Runs" → "Inbox", update href |
| `apps/web/src/components/dashboard/empty-state.tsx` | Update NeedsAttention links to `/dashboard/inbox?id=` |
| `apps/web/src/hooks/use-attention-inbox.ts` | Bump limits, add refetchInterval param |
| `apps/web/src/hooks/use-actions.ts` | Approve/deny mutations — no changes needed |
| `apps/web/src/hooks/use-automations.ts` | `useOrgPendingRuns` — may need limit increase |
| `apps/web/src/hooks/use-action-modes.ts` | `useSetActionMode` — no changes needed |
| `apps/web/src/app/(command-center)/dashboard/actions/page.tsx` | **Keep as-is** — this is the historical action log, separate purpose |
| `docs/design-system.md` | Read before any UI work |

## Relationship to Other Specs

- **Sessions UI fix** (`todos/fix-dashboard-sessions-ui.md`): That spec deletes sidebar "Recents" and merges session lists. This spec renames sidebar "Runs" → "Inbox" and deletes the bell. Both modify `sidebar.tsx` and `layout.tsx` — coordinate to avoid merge conflicts.
- The `InboxTray` deletion here affects the workspace layout (`components/coding-session/thread.tsx`). Read the workspace spec before removing it to understand how in-session approvals should render instead.
