# Session Display Redesign — Full Specification

## Problem

Session listings across the UI (sessions page, inbox, my work, activity feed, command palette, dashboard) show infrastructure metadata — status dot, repo name, branch, timestamp — but nothing about what the agent **did**, is **doing**, or **produced**. A manager looking at the sessions list sees "Paused" for 15 sessions and has no idea which ones are sleeping (healthy, will resume), which are stuck on credits (need action), and which the user manually paused. The inbox shows failed automation runs with just an automation name and error — no context about what the task was or whether a PR was created.

Additionally, task context is often missing entirely because **`initialPrompt` is not consistently written for web-created sessions**. The DB column exists, but the web create flow sends the prompt via WebSocket to the gateway — it never persists to PostgreSQL. This must be fixed before prompt snippets can be displayed.

## Canonical Source

This document is the canonical source of truth for the redesign. If any implementation plan/checklist doc diverges (including private planning notes), this spec wins. Before implementation starts, reconcile any plan to match this spec on:
- status mapping (especially `pauseReason = null`)
- regular-session outcome heuristic
- blocked-session rollup behavior
- `latestTask` write cadence

## Design Principles

### 1. Passive capture, not agent-reported

Forcing an AI agent to manage infrastructure state is an anti-pattern:
- **Prompt tax**: Every reporting instruction wastes context window tokens the agent should use for actual work
- **Brittleness**: Agents hallucinate tool calls, drop instructions, or die suddenly (OOM, timeout) without ever reporting
- **Coupling**: Agent prompt changes shouldn't break the dashboard

Instead, **the gateway passively observes data that already flows through it** — SSE events, tool results, git operations — and persists what's useful. The agent never knows this is happening.

### 2. Honest status over infrastructure status

The DB `status` column has 6 known runtime values: `pending`, `starting`, `running`, `paused`, `suspended`, `stopped`. `SessionStatusSchema` defines 5 (`starting`, `running`, `paused`, `suspended`, `stopped`) — `pending` is written by gateway deferred create but missing from that shared enum. Session list rows currently validate `status` as `z.string()`, so this is not a row-drop risk today, but we should still add `pending` in Phase 1 for contract/runtime parity and future safety. `failed` is documented in the sessions-gateway spec but **no current code path writes `status="failed"` to sessions** (the `failed` value in `actions.ts` is an action invocation status, not a session status). `deriveDisplayStatus` handles `failed` defensively as a catch-all fallback. But "paused" conflates fundamentally different situations depending on `pauseReason`:

| Runtime condition | User perception | Should display as |
|---|---|---|
| `inactivity` | Healthy, sleeping, will resume on next prompt | **Idle** (green/dimmed) |
| `manual` | User explicitly paused | **Paused** (yellow) |
| `credit_limit` | Stuck, needs credits | **Blocked** (red) |
| `payment_failed` | Stuck, needs payment fix | **Blocked** (red) |
| `overage_cap` | Stuck, needs cap raised | **Blocked** (red) |
| `suspended` | Account suspended, needs admin | **Blocked** (red) |
| `orphaned` | Gateway failover, auto-recovering | **Reconnecting** (yellow pulsing) |
| `status="stopped" + pauseReason="snapshot_failed"` | Snapshot circuit breaker tripped and session was terminated | **Failed** (red) |

A pure function `deriveDisplayStatus(status, pauseReason)` maps raw DB state to user-facing display statuses. See **Complete Status Matrix** below.

### 3. Three-tier information density

- **Row**: Scannable at a glance — status, title/snippet, one key detail, duration
- **Triage card** (inbox) / **Peek drawer** (sessions): Full context without entering workspace — task, summary, PRs, metrics, CTAs
- **Workspace**: Full interactive session (existing, unchanged)

---

## Complete Status Matrix

All combinations of `status` × `pauseReason` → `DisplayStatus`:

```
deriveDisplayStatus(status, pauseReason) → DisplayStatus

status = "pending"   → "active"       // deferred sandbox creation (gateway session-creator)
status = "starting"  → "active"
status = "running"   → "active"
status = "stopped":
  pauseReason = "snapshot_failed" → "failed"         // circuit breaker killed the session (stopped + snapshot_failed)
  (any other pauseReason or null) → "completed"      // normal completion
status = "failed"    → "failed"         // defensive only — no code currently writes this status to sessions
status = "suspended" → "blocked"      // account-level suspension (in SessionStatusSchema)
status = "paused":
  pauseReason = "inactivity"      → "idle"
  pauseReason = "manual"          → "paused"        // user-initiated pause
  pauseReason = null               → "paused"       // legacy manual pauses; Phase 1 backfills to "manual"
  pauseReason = "credit_limit"    → "blocked"
  pauseReason = "payment_failed"  → "blocked"
  pauseReason = "overage_cap"     → "blocked"
  pauseReason = "suspended"       → "blocked"       // pauseReason can also be "suspended" via org-pause
  pauseReason = "orphaned"        → "recovering"
  (any other value)               → "recovering"    // defensive fallback
(any other status)                → "failed"         // defensive fallback
```

**Type**: `DisplayStatus = "active" | "idle" | "paused" | "blocked" | "recovering" | "completed" | "failed"`

UI copy note:
- Internal status key remains `recovering` for compatibility.
- User-facing label should be **"Reconnecting"** (less alarming than "Recovering").

**Status notes:**
- `"pending"` is set by `session-creator.ts` for deferred sandbox creation but is NOT in `SessionStatusSchema`. Phase 1 must add `pending` to the contract.
- `"failed"` is documented in the sessions-gateway spec but **no current code path writes it to sessions**. Handled defensively as catch-all fallback in `deriveDisplayStatus`. If a future code path writes it, the mapping is ready.
- `"suspended"` exists in `SessionStatusSchema` as a top-level status. Treat as `"blocked"`.
- `"stopped" + pauseReason "snapshot_failed"` is the circuit breaker path (`migration-controller.ts:266`). The session is terminated, not recovering. Treat as `"failed"`.
- User-initiated pause must explicitly write `pauseReason: "manual"` in Phase 1 (`sessions-pause.ts`).
- Historical `status = "paused" + pauseReason = null` rows are currently user-manual pauses in production data. Keep null mapped to `"paused"` for compatibility and run a Phase 1 backfill to set `"manual"` explicitly.

**Blocked reason text** (human-readable, derived from `pauseReason` or `status`):
- `credit_limit` → "Out of credits"
- `payment_failed` → "Payment failed"
- `overage_cap` → "Usage cap reached"
- `suspended` (pauseReason or status) → "Account suspended"

---

## Data Model

### What exists today (used but underexposed)

| Field | In DB | In API | In UI | Notes |
|---|---|---|---|---|
| `status` | Yes | Yes | Yes (dot + label) | But "Paused" is misleading |
| `pauseReason` | Yes | Yes | **No** | Key to honest status, unused by frontend |
| `title` | Yes | Yes | Yes | Often null — user must manually set |
| `initialPrompt` | Yes (column exists) | **No** (mapper drops it) | **No** | **Column exists but web create flow doesn't persist it.** Only populated for setup sessions and some automation paths. Must be fixed in Phase 1. |
| `endedAt` | Yes | **No** (mapper drops it) | **No** | Needed for "created X ago" timestamp |
| `snapshotId` | Yes | Yes | **No** | Non-null = resumable |
| `repo.githubRepoName` | Yes | Yes | Yes | Currently primary subtitle |
| `branchName` | Yes | Yes | Yes | Shown as badge |
| `automationId` + `automation.name` | Yes | Yes | Yes (origin badge) | Links to automation |
| `startedAt` | Yes | Yes | No (only via "time ago") | Wall-clock creation timestamp. NOT reset on resume. |
| `pausedAt` | Yes | Yes | No | NOT cleared on resume — historical. |
| `stopReason` | Yes (column exists) | No | No | **Defined but never written by any code path.** |

`stopReason` relationship to outcome:
- `stopReason` is a better long-term home for explicit stop semantics than overloading `pauseReason` on stopped rows.
- v1 does not depend on `stopReason` because it is currently unwritten.
- Future phase: populate `stopReason` on terminal paths and use it to improve regular-session outcome classification.

### What we add (Phases 1-2)

| Field | Source | When populated | Notes |
|---|---|---|---|
| `promptSnippet` | Sanitized `initialPrompt` (see Sanitization) | Phase 1 (mapper-derived, not a new column) | Requires fixing `initialPrompt` persistence first. |
| `endedAt` | Existing column, newly exposed | Phase 1 (mapper change only) | For "created X ago" / "ended X ago" timestamps. |
| `outcome` | Automations: `automation.complete`. Regular: conservative heuristic. | Phase 2 (new column) | `'succeeded' \| 'failed' \| 'needs_human' \| 'completed'`. For regular sessions, heuristic sets only `failed` or `completed` (never inferred `succeeded`). |
| `summary` | Automations only: `automation.complete` `summary_markdown` | Phase 2 (new column) | **LLM-generated markdown only.** Regular sessions leave this NULL — synthetic display is constructed on the frontend from `metrics`. |
| `prUrls` | Gateway captures from `GitResultMessage.prUrl` | Phase 2 (new column, JSONB) | Array of URL strings. SQL-level append. |
| `metrics` | Gateway counts SSE events in memory, flushes on pause/snapshot/teardown | Phase 2 (new column, JSONB) | `{ toolCalls, messagesExchanged, activeSeconds }`. Includes active compute time. `filesEdited` deferred — see File Edit Counting below. |
| `latestTask` | Gateway reads `tool_metadata.title` from SSE events | Phase 2 (new column) | Truncated to 100 chars. **Set to NULL on session stop/pause** to prevent zombie states. |

### How each piece is derived (no agent involvement)

1. **Display status** → `deriveDisplayStatus(status, pauseReason)` — pure function, see Complete Status Matrix
2. **Prompt snippet** → Mapper sanitizes + truncates existing `initialPrompt` column (after fixing persistence)
3. **Latest task** → Gateway reads `tool_metadata.title` from SSE events; set to NULL on teardown
4. **PR URLs** → Gateway reads `prUrl` from `GitResultMessage` after `git_create_pr`
5. **Metrics** → Gateway counts `tool_start` (tool calls) and `message_complete` (messages) events in memory. `activeSeconds` accumulates while running. Flushed on pause/snapshot/automation-teardown. See File Edit Counting for `filesEdited`.
6. **Outcome** → Automations: `automation.complete`. Regular sessions: conservative heuristic at terminal states (error → "failed", else "completed"). PR presence is shown as evidence, not promoted to "succeeded" for manual sessions.
7. **Summary** → Automations only: `automation.complete` `summary_markdown`. Regular sessions: **NULL in DB**, synthetic display built on frontend from `metrics` (avoids hardcoded English strings in DB)
8. **Active duration** → `metrics.activeSeconds` (gateway accumulates via timestamp delta, not interval timer). On each transition to `running`, store `resumedAt = Date.now()` in memory. On pause/snapshot/teardown, add `Math.floor((Date.now() - resumedAt) / 1000)` to `activeSeconds`. Avoids event loop drift under load. Wall-clock age = `startedAt` to now (for "created X ago" display only).

### Resume/rollover rules

Sessions can be resumed for new work after being paused/idle. On resume:
- `startedAt` is NOT reset (persists as creation timestamp)
- `pausedAt` is NOT cleared (historical)
- `snapshotId` persists (for audit trail)
- `latestTask` → **cleared to NULL** when session transitions out of "running" (no zombie state). Must be explicitly set in ALL pause/stop writers: gateway `markSessionStopped()`, gateway `terminateForAutomation()`, web `sessions-pause.ts` manual pause handler, billing `org-pause.ts` batch pauser, orphan sweeper. Any writer that changes status away from `running`/`starting` must include `latestTask: null`.
- `metrics` → **additive across resumes** (counters accumulate). `activeSeconds` pauses during idle, resumes on thaw. This is intentional — metrics reflect the session's total lifetime work.
- `outcome` → **overwritten** at each session end. Only the final outcome persists. For long-lived sessions this is acceptable — the last state is what matters for display.
- `summary` → **overwritten** by each `automation.complete` call. NULL for regular sessions.
- `prUrls` → **append-only** across resumes. All PRs ever created in the session accumulate. This is correct — you want to see all PRs.

### Prompt snippet sanitization

`initialPrompt` often starts with raw JSON, markdown tables, XML context tags, or automation-injected boilerplate. A naive `substring(0, 150)` will produce ugly, unreadable snippets.

**Sanitization pipeline** (applied in mapper):
0. **Hard pre-slice**: `rawPrompt.substring(0, 2000)` before ANY regex. Users paste 100KB+ log files, minified JS, or base64 blobs — running regex over these will block the Node.js event loop (ReDoS risk).
1. Strip XML/HTML tags (`<context>`, `<file path="...">`, etc.)
2. Strip markdown formatting (`#`, `` ``` ``, `**`, etc.)
3. Strip JSON boilerplate (leading `{`, `[`, common key patterns)
4. Collapse whitespace (replace newlines + multiple spaces with single space)
5. Truncate at nearest word boundary under 150 characters
6. Append `…` if truncated
7. **Hard fallback**: If no space found before index 150 (minified code, base64), do a brutal `.substring(0, 149) + '…'` to prevent breaking the row layout.

If the result after sanitization is empty or under 10 chars, fall back to NULL (don't show garbage).

Performance note:
- In Phase 1 this runs in mappers (`toSession`/`toSessionPartial`) for list responses.
- This is acceptable for initial rollout with the 2000-char pre-slice, but it is a hot-path cost.
- Phase 2 revisit: cache or persist derived `promptSnippet` at write-time if profiling shows list latency regression.

---

## End State by Surface

### Sessions List Page

**Filter tabs** (replace current All / Active / Stopped):
- **In Progress**: `active` + `idle` — your running work, healthy
- **Needs Attention**: `blocked` + `failed` + `recovering` + has pending run
- **Paused**: user-initiated only
- **Completed**: `completed`

`has pending run` is derived via frontend cross-reference (session IDs from `useSessions()` joined with pending runs from `useOrgPendingRuns()`), not from a native session field.

**Row layout:**

```
[status dot]  Title (or prompt snippet fallback)     [branch]  [origin]  duration  [status label]
              Subtitle (context-dependent)
```

Accessibility requirements:
- Always render a text status label (not color-only dots).
- Pair color with a distinct icon/motion state (`animated`, `static`, `pulsing`, `hollow`) and `aria-label` per status.
- Keep contrast-compliant status text in both light and dark themes.

Per display status:
- **Active** → green animated dot · title · subtitle: **latest task** ("Running pytest on auth module") · active duration ticking · branch badge
- **Idle** → dimmed/hollow green dot · title · subtitle: **prompt snippet** ("Fix the auth regression in the login...") · "Idle" label · resumable icon (↻)
- **Paused** → yellow dot · title · "Paused" label
- **Blocked** → red dot · title · subtitle: **reason** ("Out of credits" / "Payment failed" / "Usage cap reached") · red label
- **Reconnecting** (`recovering`) → yellow pulsing dot · title · subtitle: "Reconnecting…" · no user action required
- **Completed** → gray dot · title · subtitle: **outcome badge** (automations: succeeded/failed/needs_human; regular sessions: typically completed) + PR icon if PRs + compact "28 tools · 12 min"
- **Failed** → red dot · title · error context

**Duration display**: Uses `metrics.activeSeconds` when available (Phase 2+). Falls back to wall-clock `startedAt` math in Phase 1. Label distinguishes: "Active 12 min" (compute time) vs "Created 3 days ago" (wall-clock age).

**Key change from today**: The subtitle was "repo · 3 minutes ago". Now it's the most useful per-status context — what the agent is doing (active), what the task was (idle), why it's stuck (blocked), or what it accomplished (completed).

**Click action by phase:**
- **Phase 1**: unchanged. Row click navigates to workspace (`/workspace/:sessionId`).
- **Phase 3**: row click opens Peek Drawer (URL-routable via `?peek=<session_id>`), with "Enter Workspace" CTA.

**Peek Drawer content (Phase 3):**
- Full prompt (fetched on demand via single-session GET, not included in list payload)
- Summary as markdown (for automations). For regular sessions: synthetic display from metrics ("Ran for 12 min, executed 28 tool calls") — constructed on frontend, not stored in DB. File counts added when `filesEdited` metric is available.
- PR links as clickable GitHub buttons
- Timeline: created → active duration → ended/paused/still running
- Block/pause reason with human-readable explanation
- Repo + branch (clickable GitHub link)
- Automation + trigger context (if automation-spawned)
- Metrics breakdown (files, tools, messages, active time)
- CTA: "Enter Workspace" / "Resume" / "Investigate"

### Inbox

The inbox is "things that need a human decision." Currently two item types; we add a third.

#### Item Type 1: Pending Runs

Automation runs that finished with `failed`, `needs_human`, or `timed_out` status.

**Queue row (left panel):**
- Status icon (colored by status) · automation name · status label + time ago
- Phase 1: unchanged (no new fields needed — all enrichment is in the triage card via on-demand session fetch)
- Phase 3: add PR count badge + outcome badge (requires `prUrls`/`outcome` from Phase 2, joined to run via `session_id` — either add to `PendingRunSummary` payload or fan-out from cached session data)

**Triage card (right panel) — today vs end state:**

| Today | End State |
|---|---|
| Status icon + "{automation name} failed" | Same |
| Error message | Same |
| Time ago | Same |
| "View Session" button | Same |
| _(nothing else)_ | **Task**: prompt snippet — what the automation was trying to do |
| | **What happened**: summary as markdown — what the agent actually did |
| | **Pull Requests**: clickable GitHub links — manager reviews code without entering workspace |
| | **Metrics**: "12 min active · 28 tools" |

#### Item Type 2: Pending Approvals

Action invocations awaiting human approve/deny decision.

**Queue row:** unchanged (already good)

**Triage card:** existing approve/deny/always-allow buttons + NEW context line: "The agent was working on: {prompt snippet}" — helps approver understand WHY the agent wants to run this action.

#### Item Type 3: Blocked Sessions (NEW)

Sessions where `deriveDisplayStatus()` returns `"blocked"`.

**Org-wide rollup rule**: Billing blocks (`credit_limit`, `payment_failed`, `overage_cap`, `suspended`) are org-wide events. Do **not** render individual inbox queue rows for these. Always render a single rollup banner per reason: "{N} sessions blocked: {reason}. [CTA]".

Banner is visible to **all users**, with role-specific CTA:
- **Admins/billing**: "{N} sessions blocked: Payment failed." → `[Update Billing]`
- **Standard users**: "{N} sessions blocked: Organization billing issue." → `[Contact Administrator]`

Without this, standard developers see their sessions turn red, check inbox, and find nothing — they'll think the platform is broken.

**Data source**: New oRPC `blockedSummary` procedure (see Phase 1 item 14). Cannot reuse session list endpoint — it's paginated/capped and would produce incorrect counts.

**Queue row (left panel)** (billing causes):
- Banner row only: "{N} sessions blocked: {reason}" with role-specific CTA

**Triage card (right panel):**
- Block reason as prominent header ("Out of credits" / "Payment failed" / "Usage cap reached")
- Affected session preview list (top 1-3 sessions): prompt snippet + created time
- Duration and progress before block
- CTAs: "Add Credits" / "Update Payment" (links to billing settings) + "Enter Workspace"

**Filter dropdown**: add "Blocked Sessions" alongside existing "Approvals" and "Runs".

### My Work

Three sections (unchanged structure, enriched content):

- **Claimed Runs**: + outcome/summary inline, + PR links
- **Active Sessions**: honest display status via `deriveDisplayStatus()` (idle ≠ blocked ≠ active), + `latestTask` for active sessions
- **Pending Approvals**: unchanged

### Activity Feed

Per-row enrichment:
- Outcome badge inline on automation run rows (succeeded/failed/needs_human)
- PR link icon if the run's session has `prUrls`

### Command Palette

Session search results: show `promptSnippet` as subtitle when `title` is null (instead of showing nothing useful).

### Dashboard Home

Surface "Needs Attention" count badge linking to inbox. Show compact active session cards with `latestTask`.

---

## Phased Rollout

### Phase 1: Honest UI + Quick Wins (no DB schema changes)

Recommended split to reduce PR risk:
- **Phase 1a (correctness + session list)**: items 1-12
- **Phase 1b (inbox blocked + triage enrichment)**: items 13-17

1. **Fix `initialPrompt` persistence**: Add `initialPrompt` to `CreateSessionInputSchema` contract. Pass through `sessions-create.ts` to DB. Update dashboard create mutation to send prompt text. **Scope boundary**: This change ensures the prompt is persisted for *display purposes* (snippets, peek drawer). Prompt *execution* remains unchanged — the existing Zustand `pendingPrompt` → WebSocket send flow continues to work as-is. We are not changing how prompts are delivered to the agent, only ensuring the text is available in the DB for the UI to read back. The existing delivery model (best-effort WebSocket send) has worked fine in production; making it transactionally safe is out of scope for this project.
2. **Fix contract/runtime parity**: Add `pending` to `SessionStatusSchema` so deferred sessions are representable in API contracts.
3. **Fix manual pause semantics**: Update `sessions-pause.ts` to always write `pauseReason: "manual"`. Do not rely on `pauseReason = null` to represent user intent.
4. **Backfill legacy manual pauses**: one-time data migration script for existing rows: `UPDATE sessions SET pause_reason = 'manual' WHERE status = 'paused' AND pause_reason IS NULL`.
5. **Add null-pause observability**: emit metric/log when a new `status = paused AND pause_reason IS NULL` row appears after backfill, so regressions are visible.
6. **`deriveDisplayStatus()` utility** using complete status matrix (all 8 pause reasons, `pending`/`suspended` top-level statuses, `stopped + snapshot_failed` circuit breaker).
7. **Prompt snippet sanitization utility** (pre-slice 2000 chars, strip tags/markdown/JSON, word-boundary truncate, hard fallback).
8. **Expose `promptSnippet` + `endedAt` + `initialPrompt`** in mapper/contract. Add all three as optional fields to `SessionSchema` (`z.string().nullable().optional()`). Both `list` and `get` use the same schema — `initialPrompt` is simply not populated by the list mapper (left as `undefined`, omitted from JSON). Only `toSession()` (used by `get`) populates `initialPrompt`. Both `toSession()` and `toSessionPartial()` populate `promptSnippet`. This follows the existing pattern where `repo` and `automation` are optional schema fields only populated in certain responses.
9. **Enrich session list row** (honest status, prompt snippet subtitle, duration, resumable indicator).
10. **Fix filter tabs** (In Progress / Needs Attention / Paused / Completed), including pending-run cross-reference for tab counts.
11. **Define Phase 1 click behavior explicitly**: keep row click navigation to workspace; do not introduce peek drawer until Phase 3.
12. **Add polling policy for list freshness**: on sessions page, use conditional refetch (`refetchInterval: 5000`) only when there are `active|idle|recovering|blocked` sessions visible and page is focused; disable polling otherwise.
13. **Add blocked sessions to inbox** — requires new lightweight aggregate endpoint (see below).
14. **New oRPC `blockedSummary` procedure** (in `apps/web/src/server/routers/sessions.ts`, following existing oRPC conventions): Returns billing-blocked sessions grouped by cause. SQL WHERE clause: `(status = 'paused' AND pause_reason IN ('credit_limit', 'payment_failed', 'overage_cap', 'suspended')) OR (status = 'suspended')`. This explicitly covers both pause-reason billing states AND top-level `status="suspended"`. Unbounded by session list pagination. Response shape: `{ groups: [{ reason: string, count: number, previewSessions: Array<{ id: string; title: string | null; promptSnippet: string | null; startedAt: string | null; pausedAt: string | null }> }] }` with `previewSessions` capped to top 3 by recency. **Always roll up** in queue UI for billing causes, regardless of count. `reason` is the human-readable label ("Out of credits", "Payment failed", etc.), not the raw DB value. Consumed via TanStack Query hook `useBlockedSummary()` in `use-attention-inbox.ts`.
15. **Add prompt context to run/approval triage cards**: Run triage fetches session via existing GET on-demand (single fetch when card opens). Approval triage already has `sessionId` — fetch session similarly. No contract changes needed on run/approval payloads; session data is fetched separately.
16. **Update my-work filter** (idle ≠ blocked ≠ active).
17. **Command palette prompt snippet fallback**.

**Acceptance criteria**: After creating a session from dashboard prompt input, refreshing `/dashboard/sessions` shows the prompt snippet when title is null. Refreshing workspace page still auto-sends the initial prompt (read from DB, not lost). Idle-snapshotted sessions show as "Idle" not "Paused". Credit-limit-paused sessions show as "Blocked" with reason and appear in inbox.

### Phase 2: Passive Gateway Capture (schema + infrastructure)

5 new DB columns (`outcome`, `summary`, `pr_urls`, `metrics`, `latest_task`).

Gateway captures passively:
- **PR URLs** from `GitResultMessage.prUrl` after `git_create_pr`. SQL-level JSONB append. Mitigation for CLI bypass: scan assistant text parts (from `message.part.updated` when text part completes, not token deltas) for GitHub PR URL regex (`https://github.com/<org>/<repo>/pull/<n>`), normalize URL, dedupe against existing `pr_urls`, and append only new values. If a URL appears only as a reference (not newly created), it may still be captured; this is acceptable for v1 best-effort attribution.
- **Metrics** from in-memory SSE event counters (`toolCalls`, `messagesExchanged`, `activeSeconds`). `filesEdited` is explicitly out of Phase 2 scope. Flush on pause, snapshot, **automation teardown** (automation completion bypasses snapshot — must flush before `terminateForAutomation()`), and graceful process shutdown (`SIGTERM`). For idle-snapshot path, flush inside the migration lock immediately before the CAS state write so metrics and lifecycle transitions stay coherent.
- **Known gap: non-hub pause paths**. Web router `sessions-pause.ts` and `sessions-snapshot.ts` call providers directly, bypassing the gateway hub's in-memory state. Metrics accumulated in the hub since last flush will be lost for these paths. Acceptable for v1 — metrics are approximate UX indicators. The gateway hub's own idle-snapshot path (most common pause trigger) does flush. The web router pause path MUST still set `latestTask: null` directly in its DB update to prevent zombie text.
- **Latest task** from `tool_metadata.title`. **Coverage is sparse**: `tool_metadata` is only emitted when the SSE event has `metadata.summary` present (not every tool call). `title` is also not guaranteed on those events. This means `latestTask` will only update for a subset of tool executions — treat it as a best-effort "last known activity" indicator, not a real-time status. When absent, UI shows nothing or falls back to prompt snippet. Debounce-write every **15–30s** to avoid high write churn/MVCC bloat. Dirty check required: `UPDATE ... WHERE latest_task IS DISTINCT FROM $1`. **Set to NULL on session stop/pause** to prevent zombie text.
- **Outcome/summary** from `automation.complete` handler. Heuristic for regular sessions — **only on terminal states** (`stopped`, `failed`), never on pause/idle.
- **Historical backfill** from `automation_runs.completionJson`:
  - `outcome` ← `completion_json->>'outcome'`
  - `summary` ← `completion_json->>'summary_markdown'`
  - `pr_urls` ← filter `completion_json->'side_effect_refs'` for HTTPS URLs. Guard with `CASE WHEN jsonb_typeof(...) = 'array'` since `side_effect_refs` can be scalar null.
  - `WHERE` clause: `ar.completion_json IS NOT NULL AND (s.outcome IS NULL OR s.summary IS NULL OR s.pr_urls IS NULL)` — covers partial fills from interrupted prior runs. Use `COALESCE` on each SET to avoid overwriting non-null values with null: `outcome = COALESCE(s.outcome, ...)`. Safe to run multiple times.

### Phase 3: UI Overhaul (needs Phase 2 data)

- Richer session rows (latest task for active, summary/PR icons/metrics for completed)
- Session peek drawer (URL-routable, full prompt, markdown summary, PR links, metrics, CTAs)
- Full run triage card enrichment (summary, PR links, metrics)
- Blocked session card enrichment (pre-block metrics)
- Activity/my-work enrichment (outcome badges, PR icons, latestTask)
- Dashboard "Needs Attention" badge

---

## File Edit Counting

The spec originally assumed a `file_edit` SSE event type. **This does not exist.** The gateway event processor handles 7 event types: `server.connected`, `server.heartbeat`, `message.updated`, `message.part.updated`, `session.idle`, `session.status`, `session.error`. There is no dedicated file-edit event stream in the gateway.

**Options for `filesEdited`:**
1. **From tool names** — Count `message.part.updated` events where the tool name matches known file-editing tools (`Write`, `Edit`, `MultiEdit`, etc.). Approximate but covers most cases.
2. **From snapshot comparison** — Compare sandbox filesystem against baseline at snapshot time. Note: `save-snapshot` handler currently just triggers a snapshot and returns IDs — it does NOT compute file diffs. This would require new logic.
3. **Defer** — Ship `metrics` with `{ toolCalls, messagesExchanged, activeSeconds }` only. Add `filesEdited` later when a reliable source is identified. UI shows "12 tools · 5 min" instead of "4 files · 12 tools · 5 min".

**Recommendation:** Option 3 (defer). Ship what's reliable, add `filesEdited` when we can count it accurately. Don't ship wrong numbers.

---

## Markdown Summary Sanitization

The `summary` column stores LLM-generated markdown from `automation.complete`. This is **untrusted content** — the agent could include arbitrary markdown, links, or injection attempts.

**Rendering policy:**
- Use AST-based sanitization on the **frontend read path** (e.g., `react-markdown` + `rehype-sanitize` or `DOMPurify` with strict config)
- Do not rely on regex-based sanitization for markdown/HTML safety
- **Allowlist**: headings, paragraphs, bold/italic, code blocks, inline code, lists, blockquotes, horizontal rules
- **Strip**: raw HTML, `<script>`, `<iframe>`, `<img>` (no image loading from arbitrary URLs), `<style>`, event handlers
- **Links**: Render but with `rel="noopener noreferrer" target="_blank"`. Consider restricting to known domains (github.com, linear.app, etc.) or showing the raw URL so users can verify before clicking.
- **Max length**: Truncate rendered summary to ~2000 chars in triage cards. Full summary in peek drawer.

This sanitization applies to all surfaces that render `summary`: inbox triage cards, peek drawer, my-work inline summaries.

---

## Outcome Heuristic Trigger States

The heuristic outcome inference for regular (non-automation) sessions must only run at **terminal states** — not on every pause.

**Trigger states:**
- `status = "stopped"` — session explicitly stopped (user or system)
- `status = "failed"` — session errored out

**NOT triggered by:**
- `status = "paused"` with any `pauseReason` — sessions can resume, outcome would be premature
- Idle snapshot (`pauseReason: "inactivity"`) — session is sleeping, not done
- Billing blocks (`pauseReason: "credit_limit"` etc.) — session may resume after credits added

**Logic:**
```
if (session.automationId) return; // automations manage own outcomes
if (status === "failed") → outcome = "failed"
if (status === "stopped") → outcome = "completed"  // neutral
```

**Hook points** (only terminal transitions):
- Gateway `markSessionStopped()` path (explicit stop)
- Gateway `terminateForAutomation()` (skipped — automations use `automation.complete`)

**NOT a hook point**: Orphan sweeper — marks sessions `paused` with `pauseReason: "orphaned"`, not `stopped`. These are non-terminal (recovering), not eligible for outcome inference. If an orphaned session is later explicitly stopped, the heuristic runs at that point via `markSessionStopped()`.

---

## Known Limitations

1. **PR URL capture from shell paths is best-effort**: Regex scanning of assistant text will catch many CLI-created PR links, but silent shell-only flows may still be missed.

2. **Metrics are approximate**: In-memory counters can still be lost on abrupt pod crashes between flushes. Not billing-grade — purely UX indicators.

3. **`tool_metadata.title` coverage is sparse**: Only emitted for tools that populate the `title` field. Not every tool call will update `latestTask`. When absent, the UI falls back to the last known task or shows nothing.

4. **Duration on long-lived sessions**: `activeSeconds` only accumulates while the gateway is connected. Historical sessions before Phase 2 won't have this metric — fall back to wall-clock age display.

5. **Legacy null pause reasons**: Historical rows may have `status = paused` with `pauseReason = null` from older manual-pause writes. Phase 1 includes a backfill to set these to `manual`; until that completes, UI treats null as paused compatibility state.

---

## Test Gates

### Phase 1: Status mapping matrix
- For each `(status, pauseReason)` combination in the Complete Status Matrix, verify `deriveDisplayStatus()` returns the expected value
- Include edge cases: null pauseReason (`paused`), unknown pauseReason string (`recovering`), null status

### Phase 1: Prompt persistence
- Create session from dashboard with prompt → verify `initialPrompt` column populated in DB
- Refresh sessions page → verify `promptSnippet` displayed
- Create session with JSON/markdown/XML prompt → verify sanitization produces readable snippet
- Create session with empty/very short prompt → verify graceful fallback

### Phase 1: Contract + pause reason correctness
- Deferred-created session with `status = pending` passes contract validation and renders in session list
- Manual pause (`sessions-pause.ts`) writes `pauseReason = manual` (no null for new manual pauses)
- Backfill sets legacy `status = paused AND pauseReason IS NULL` rows to `pauseReason = manual`

### Phase 1: Interaction + accessibility
- Session row click still navigates to `/workspace/:sessionId` (peek drawer not introduced yet)
- Each status renders a text label plus icon/motion state (not color-only)
- Screen reader announces status via `aria-label` and label text is contrast compliant

### Phase 1: Polling behavior
- Sessions page enables 5s refetch only when in-progress/needs-attention sessions are visible and page is focused
- Sessions page disables polling when all visible sessions are completed and page is unfocused

### Phase 1: Inbox blocked sessions
- Trigger credit limit pause → verify blocked session appears in inbox
- Trigger 1 blocked session by billing cause → verify rollup banner (not individual item rows)
- Trigger many blocked sessions by same cause → verify same single rollup banner with updated count
- Verify all users see the billing rollup (admin CTA: "Update Billing", standard user CTA: "Contact Administrator")

### Phase 2: Capture integrity
- Create PR in session via gateway action → verify `pr_urls` populated
- Create PR via `gh` in shell + assistant emits GitHub URL in message text → verify regex capture appends `pr_urls`
- Create PR via silent shell-only flow → verify no hard failure (URL may be missing)
- Run automation to completion → verify `outcome`, `summary`, `pr_urls` populated on session
- Force-stop session → verify heuristic outcome set, `latestTask` set to NULL
- Resume idle session, do more work, stop again → verify metrics additive, outcome reflects final state

### Phase 2: Backfill idempotency
- Run backfill migration twice → verify no duplicates, no errors
- Verify `CASE WHEN jsonb_typeof` guard handles null `side_effect_refs`

### Phase 2: latestTask lifecycle
- Start session → tool executes → verify `latestTask` populated within 30s
- Stop session → verify `latestTask` set to NULL
- Resume session → verify `latestTask` starts fresh (NULL until next tool)

### Phase 3: Resume/reset behavior
- Create session → create PR → idle snapshot → resume → create another PR → stop
- Verify: `prUrls` has both PRs, `metrics` are cumulative, `outcome` reflects final state

### All phases
- `pnpm typecheck`, `pnpm lint`, `pnpm test`

---

## Resolved Questions

1. **Prompt snippet visibility**: **Org-wide.** Sessions are already shared collaborative environments within an org. Managers and teammates need to see the snippet to understand what sessions are doing, approve actions, or review PRs. Masking it defeats the purpose. If privacy is needed, it's an RBAC concern at the session level, not the field level. **Secret-leakage caveat**: Users sometimes paste API keys, tokens, or connection strings into prompts. The sanitization pipeline strips formatting but does NOT redact secrets — that would require a secret-detection heuristic (regex for `sk-`, `ghp_`, `Bearer`, etc.) which is out of scope for v1 but should be considered for v2. For now, prompts are treated the same as session titles — visible to all org members, no special redaction.

2. **`displayStatus` vs `outcome` precedence**: **Complementary, not competing.** `displayStatus` = infrastructure lifecycle ("the car has stopped"). `outcome` = semantic result ("the car reached the destination" vs "the car crashed"). A gray dot (Completed) + red badge (Failed) accurately communicates "agent finished working, spun down, and was unsuccessful." Keep them as separate visual elements.
