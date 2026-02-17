# Fix: Dashboard Sessions UI

> Context doc for whoever picks this up. No prior knowledge of the codebase needed.
> Read `docs/design-system.md` before writing any UI code.

## Problem Statement

The dashboard home page (`/dashboard`) shows sessions below the prompt input. Three issues:

1. **Duplication.** Running sessions appear in both "Active Sessions" and "Recent Sessions" because "Recent" doesn't exclude active ones.
2. **Ugly rows.** Plain text rows with tiny status dots, no branch info, no visual hierarchy — feels low-effort compared to the rest of the product.
3. **Sidebar clutter.** The sidebar injects a dynamic "Recents" list of recent sessions into what should be a clean, static SaaS navigation. Makes it look like a ChatGPT wrapper.

---

## Current State (What Exists Today)

### Dashboard home layout

Rendered by `EmptyDashboard` in `apps/web/src/components/dashboard/empty-state.tsx`:

```
┌─────────────────────────────────────────┐
│  "Good morning, Pablo"                  │
│  [ PromptInput (repo picker + model) ]  │
├─────────────────────────────────────────┤
│  Needs Attention (pending automation    │
│  runs needing human input — separate    │
│  data source, not sessions)             │
├─────────────────────────────────────────┤
│  Active Sessions (≤5)                   │  ← running/starting/paused
│  → "All Sessions" link                  │
├─────────────────────────────────────────┤
│  Recent Sessions (≤5)                   │  ← ALL non-setup/CLI sessions by recency
│  → "All Sessions" link                  │
└─────────────────────────────────────────┘
```

### The duplication bug

**`ActiveSessions`** (line 298–329) filters:
```ts
s.sessionType !== "setup" && s.origin !== "cli" &&
(s.status === "running" || s.status === "starting" || s.status === "paused")
```

**`RecentSessions`** (line 335–361) filters:
```ts
s.sessionType !== "setup" && s.origin !== "cli"
// No status filter — takes first 5 by recency
```

Active sessions are also recent, so they appear in both lists.

### Session row components (3 different ones)

| Component | File | Used in | Features |
|---|---|---|---|
| `SessionRow` | `empty-state.tsx:367–414` | Dashboard home | StatusDot + title + repo · timeAgo + text status label |
| `SessionListRow` | `components/sessions/session-card.tsx` | All Sessions page | StatusDot + title + branch icon + repo · timeAgo + badge-style status pill |
| Custom button | `sidebar.tsx:636–652` | Sidebar "Recents" | Chat bubble icon + title only |

`SessionRow` and `SessionListRow` render the same data entity with different implementations. `SessionListRow` is strictly better (has branch info, status badge).

### Sidebar "Recents" section

`sidebar.tsx:574–661` — Fetches top 5 sessions (same query, same filter as dashboard), renders them as nav items with chat bubble icons. Duplicates what the dashboard home and `/dashboard/sessions` already show.

### Data flow

```
useSessions() hook (no params — fetches ALL sessions)
  → orpc.sessions.list (GET /api/sessions)
    → sessions.listSessions(orgId)
      → sessionsDb.listByOrganization(orgId)
        → drizzle findMany, no limit, ordered by startedAt DESC
```

All callers use `useSessions()` without params. No server-side limit or status filter. Every session the org has ever created is fetched, then sliced client-side. TanStack Query deduplicates concurrent requests via shared query key.

### Sort order caveat

The DB sorts by `startedAt DESC`. A session started 3 days ago that's still running will appear **below** a stopped session from 1 hour ago. If the intent is "running sessions first," the sort order needs to change.

### Session data shape

From `packages/shared/src/contracts/sessions.ts`:

```ts
{
  id: string              // UUID
  repoId: string | null
  organizationId: string
  createdBy: string | null
  sessionType: string | null   // "setup" | "coding" | null
  status: string | null        // "starting" | "running" | "paused" | "suspended" | "stopped"
  sandboxId: string | null
  snapshotId: string | null
  prebuildId: string | null
  branchName: string | null
  parentSessionId: string | null
  title: string | null         // Often null until agent generates one
  startedAt: string | null     // ISO timestamp
  lastActivityAt: string | null
  pausedAt: string | null
  pauseReason: string | null
  origin: string | null        // "web" | "cli"
  clientType: string | null
  repo?: {                     // Joined from repos table
    id, githubRepoName, defaultBranch, ...
  }
}
```

---

## What To Build

### Target layout

```
┌─────────────────────────────────────────────────────────┐
│  Good morning, Pablo                                    │
│  [ PromptInput (repo picker + model)                  ] │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Needs Attention                                        │
│  Agent runs requiring your input                        │
│  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  │
│  ⚠ Stale PR Reviewer needs approval              [→]   │
│                                                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Recent Activity                        View All →      │
│  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  │
│  ● Fix memory leak       ⎇ main   api-server · 2m  [Running]  │
│  ○ Investigate E4012      ⎇ feat   api-server · 1h  Stopped    │
│  ○ Add Redis cache                 core-lib   · 2d  Stopped    │
│  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

- Single **"Recent Activity"** section replaces both "Active Sessions" and "Recent Sessions"
- Max 5 items, fetched server-side with limit
- Active sessions (running/starting/paused) get the badge-style status pill; stopped ones get muted text
- Uses `SessionListRow` — the same component as the All Sessions page
- "View All" links to `/dashboard/sessions`

### Sidebar (static nav only)

```
Home
─────────
Monitor
  Runs
─────────
Configure
  Automations
  Repos
  Integrations
─────────
Settings
```

No dynamic "Recents" list. Users access sessions via Home or the Sessions page.

---

## Action Items

### 1. Add `limit` + exclusion filters to the sessions API

**Files:**
- `packages/shared/src/contracts/sessions.ts` — add `limit`, `excludeTypes`, `excludeOrigins` to the list query schema
- `packages/services/src/sessions/db.ts` (`listByOrganization`) — apply `limit`, type/origin exclusion in the Drizzle query
- `packages/services/src/sessions/service.ts` (`listSessions`) — pass new params through
- `apps/web/src/server/routers/sessions.ts` — pass new params from oRPC input to service

The DB query must apply exclusion filters **before** the limit. If the API returns 5 rows and 2 are `setup` type, you'd only get 3 visible items. Push the filters into SQL so `limit: 5` means 5 displayable rows.

Also update the sort order to `ORDER BY status_priority, lastActivityAt DESC` so active sessions sort above stopped ones regardless of start time. This can be a SQL `CASE` expression on the status column.

**Important:** The All Sessions page (`/dashboard/sessions`) and other callers still use `useSessions()` without limit — don't break them. The limit param must be optional.

### 2. Update `useSessions` hook

**File:** `apps/web/src/hooks/use-sessions.ts`

Add `limit`, `excludeTypes`, `excludeOrigins` to the params type. Dashboard home calls:
```ts
useSessions({ limit: 5, excludeTypes: ["setup"], excludeOrigins: ["cli"] })
```

This produces a different TanStack Query key from the parameterless `useSessions()`, so caches stay separate.

### 3. Merge "Active" + "Recent" into single "Recent Activity" section

**File:** `apps/web/src/components/dashboard/empty-state.tsx`

- Delete `ActiveSessions` component
- Delete `RecentSessions` component
- Delete `SessionRow` component (and its helpers: `getStatusLabel`, `getRepoShortName`)
- Create a single `RecentActivity` component that calls `useSessions({ limit: 5, excludeTypes: ["setup"], excludeOrigins: ["cli"] })` and renders using `SessionListRow`
- Section header: "Recent Activity", subtitle: omit or keep minimal, action: "View All" → `/dashboard/sessions`

### 4. Delete sidebar "Recents"

**File:** `apps/web/src/components/dashboard/sidebar.tsx`

Delete lines 574–661 (the `Recents` section in `DashboardNav`):
- The `useSessions()` call
- The `recentSessions` memo
- The entire "Recents" `<div>` block including the "View all" button
- Remove unused imports (`useSessions` from the hook, `ChatBubbleIcon` if only used there)

The sidebar keeps: Home, Monitor (Runs), Configure (Automations, Repos, Integrations), Settings.

### 5. Ensure `SessionListRow` works in both contexts

**File:** `apps/web/src/components/sessions/session-card.tsx`

Verify `SessionListRow` follows `docs/design-system.md` data table row patterns:
- Clean row dividers with semantic tokens (no heavy borders)
- Status shown as badge-style pill for active statuses, muted text for stopped
- Branch icon + name when available
- Repo short name + relative timestamp

It already does most of this. May need minor tweaks to match the design system strictly.

---

## Key Files

| File | What to do |
|---|---|
| `apps/web/src/components/dashboard/empty-state.tsx` | Delete `ActiveSessions`, `RecentSessions`, `SessionRow`. Add `RecentActivity` using `SessionListRow` |
| `apps/web/src/components/sessions/session-card.tsx` | Verify/adjust `SessionListRow` for design system compliance |
| `apps/web/src/components/dashboard/sidebar.tsx` | Delete "Recents" section (lines 574–661) |
| `apps/web/src/hooks/use-sessions.ts` | Add `limit`, `excludeTypes`, `excludeOrigins` params |
| `apps/web/src/server/routers/sessions.ts` | Pass new list params through to service |
| `packages/shared/src/contracts/sessions.ts` | Add `limit`, `excludeTypes`, `excludeOrigins` to list query schema |
| `packages/services/src/sessions/service.ts` | Pass new params to DB layer |
| `packages/services/src/sessions/db.ts` | Apply limit + exclusion filters in Drizzle query, update sort order |
| `apps/web/src/app/(command-center)/dashboard/sessions/page.tsx` | No changes needed (uses parameterless `useSessions`) |
| `docs/design-system.md` | Read before any UI work |
