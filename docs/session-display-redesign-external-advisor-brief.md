# Session Display Redesign — External Technical Advisor Brief

Prepared: February 19, 2026
Audience: External technical advisor with no access to repo or prior discussion
Scope: Full context for reviewing the session/inbox display redesign

---

## 1) Why This Document Exists

The product currently shows session infrastructure state (`running`, `paused`, `stopped`) but not meaningful work context (what task was asked, what happened, what output was produced, what needs human action). This creates triage failures across:

- `Sessions` list
- `Inbox`
- `My Work`
- `Activity`
- `Dashboard` summary
- command palette session search

A key blocking bug is also present:

- For **web-created sessions**, the prompt used to start work is not persisted in the web create contract path.
- Result: prompt context is often missing from durable metadata and cannot reliably power list/inbox context.

This brief captures current behavior, target behavior, derivation logic, constraints, risks, and open questions.

---

## 2) System and Boundary Context (Important)

High-level architecture:

```text
Client ──WebSocket──► Gateway ◄──SSE/HTTP── Sandbox (OpenCode in Modal/E2B)
                         │
          Next.js API/oRPC: lifecycle + metadata only
          PostgreSQL: metadata persistence (not streaming transcript path)
```

Key boundary rule:

- Session streaming is **not** `web API route -> client`.
- Real-time path is **Client ↔ Gateway ↔ Sandbox**.
- API/oRPC is used for lifecycle and metadata reads/writes.

Implication for redesign:

- Durable display context should come from persisted metadata.
- Real-time derived context can be captured passively in gateway, then flushed to DB.

---

## 3) Current UI (What Users Actually See Today)

### 3.1 Sessions page (`/dashboard/sessions`)

Current filter tabs:

- `All`
- `Active` (`running|starting|paused`)
- `Stopped`

Current row composition:

- leading status icon + label
- title (or fallback `repo (branch)`)
- optional branch badge
- origin badge (automation/slack/cli)
- trailing metadata (`repoShortName · timeAgo`)

Current click behavior:

- click row -> opens workspace `/workspace/:sessionId`

Current issue:

- `paused` conflates:
  - idle snapshot (healthy, resumable)
  - manual pause
  - billing/payment blocks
  - orphan recovery

So users cannot distinguish healthy sleeping sessions vs blocked sessions without deeper inspection.

### 3.2 Inbox (`/dashboard/inbox`)

Current structure:

- Left queue list
- Right detail card

Current item types:

- Pending automation runs (`failed|needs_human|timed_out`)
- Pending action approvals

Current pending run queue row:

- automation name
- status label
- relative time

Current pending run detail card:

- `"<automation> failed/needs attention"`
- error message
- time
- `View Session`

Current approval detail card:

- action/integration/risk
- approve/deny/always-allow buttons
- optional session link

Current issue:

- Runs are not triage-rich: no task prompt, no summary, no PR links, no progress snapshot.
- Inbox has no blocked session item type yet.

### 3.3 My Work (`/dashboard/my-work`)

Current sections:

- Claimed Runs
- Active Sessions
- Pending Approvals

Current issue:

- Active sessions reuse same ambiguous session row semantics.
- Claimed runs do not expose outcome context beyond status.

### 3.4 Activity (`/dashboard/activity`)

Current row:

- automation run label
- status badge/icon
- trigger provider
- time
- link to workspace/events

Current issue:

- no inline run outcome context beyond status
- no PR signal

### 3.5 Command palette session search

Current:

- title + repo/branch/time + status icon

Current issue:

- if title is null, fallback quality is weak (no prompt snippet context)

---

## 4) User Clarifications Captured During Design Review

These were explicitly emphasized and are now treated as requirements:

1. The prompt shown in display surfaces should be the one used to create/start session work (not synthetic filler).
2. The redesign doc must explain concretely what each UI section looks like after changes.
3. The redesign must explain exactly how these are generated:
   - `what happened summary`
   - `progress before block`
4. No implementation was requested during this pass; this pass is spec/context quality.

---

## 5) Current Data Reality (Code-Verified)

### 5.1 Session DB has more fields than frontend receives

Persisted in sessions table (selected examples):

- `status`, `pauseReason`, `title`, `initialPrompt`, `snapshotId`, `startedAt`, `pausedAt`, `endedAt`, `stopReason`, etc.

But frontend `SessionSchema` currently exposes a reduced shape.

Notable gaps in current API contract/mapper:

- `initialPrompt` is dropped
- `endedAt` is dropped
- `stopReason` dropped (and not currently written)

### 5.2 Web create contract does not include `initialPrompt`

Current web oRPC create input excludes `initialPrompt`.

Consequence:

- Web create path cannot persist initial prompt through that API path.
- Prompt delivery relies on ephemeral client/runtime flow (in-memory `pendingPrompt` + WebSocket send), not a durable create-time contract field.

### 5.3 Status value mismatch between runtime and schema

Observed runtime/session writes include: `pending`, `starting`, `running`, `paused`, `stopped`.

`SessionStatusSchema` enum currently includes:

- `starting`, `running`, `paused`, `suspended`, `stopped`

Mismatch:

- `pending` is used by deferred create paths but absent from status enum.

### 5.4 No current session writer sets `status="failed"`

`failed` exists in docs/other domains, but in session codepaths reviewed here there is no active writer setting session rows to `failed`.

Important nuance:

- `status: "failed"` appears in action invocation payloads, not session status transitions.

### 5.5 `stopReason` exists but appears unwritten

- Column exists in schema.
- Read in one HTTP status response.
- No active session write path found setting it.

### 5.6 Manual pause currently does not set `pauseReason="manual"`

Manual pause route sets session to paused with timestamps/snapshot handling, but does not populate `pauseReason`.

Implication:

- `pauseReason === null` is currently the practical signal for manual user pause.

### 5.7 File edit metrics assumption was incorrect

Important correction:

- Shared message types define `file_edit`, but current gateway SSE processor handles only:
  - `server.connected`
  - `server.heartbeat`
  - `message.updated`
  - `message.part.updated`
  - `session.idle`
  - `session.status`
  - `session.error`
- No current gateway emission path was found for `file_edit` from live OpenCode SSE stream.

Implication:

- `filesEdited` cannot be treated as reliable in Phase 2 without additional instrumentation.

---

## 6) What Data Exists Today for Richer UX (Without New Agent Burden)

### 6.1 Already available and durable

- Session lifecycle metadata (`status`, `pauseReason`, timestamps)
- Automation run terminal data (`completionJson` with outcome/summary fields)

### 6.2 Already observable in gateway but not durably persisted for session list UX

- PR URL from git create PR result path
- Tool start/end events (countable)
- Message completion events (countable)
- Tool metadata/title (best-effort)

### 6.3 Existing durable source for high-quality summary

Automation runs already persist completion payloads including `summary_markdown` and outcome semantics.

---

## 7) How New Fields Are Intended to Be Generated

This section answers the key mental-model questions directly.

### 7.1 Prompt snippet (`promptSnippet`)

Source:

- `sessions.initialPrompt` (after fixing web prompt persistence)

Generation:

- sanitize + normalize + truncate for row display

Purpose:

- fallback title/subtitle context when explicit title is absent

### 7.2 “What happened summary”

For automation sessions:

- Source: `automation.complete` payload (`completionJson.summary_markdown`)
- Store in session-level `summary` (Phase 2) or fetch/join from run as intermediate strategy

For non-automation sessions:

- No trusted LLM summary source exists today.
- Proposed approach: synthetic summary from captured metrics (e.g., active time + tool count + PR signals), not pretend semantic summary.

### 7.3 “Progress before block”

Source:

- session metrics snapshot at/near pause/block transition (`activeSeconds`, `toolCalls`, `messagesExchanged`)
- plus any known outputs (e.g., `prUrls`)

Display examples:

- `"Blocked after 12 min active, 28 tool calls"`
- `"Blocked after 8 min active; 1 PR opened"`

### 7.4 Latest task (`latestTask`)

Source:

- `tool_metadata.title` from tool events

Caveat:

- sparse coverage (only present when metadata summary/title exists)
- must be treated as best-effort, not guaranteed real-time truth

### 7.5 Outcome (`outcome`)

Automation sessions:

- source of truth is automation completion outcome

Regular sessions:

- heuristic at terminal states only:
  - explicit error/failed terminal -> `failed`
  - stopped + has PR URLs -> `succeeded`
  - stopped + no stronger signal -> `completed`

### 7.6 PR URLs (`prUrls`)

Source:

- gateway git operation result (`prUrl`) when using gateway-mediated PR creation

Known limitation:

- PRs created purely in shell (`gh pr create`) are not reliably captured in this approach.

---

## 8) Target Display Semantics (Status)

Core proposal is to derive UI display status from raw runtime status + pause reason.

Display statuses:

- `active`
- `idle`
- `paused`
- `blocked`
- `recovering`
- `completed`
- `failed`

Key mappings:

- `running|starting|pending` -> `active`
- `paused + inactivity` -> `idle`
- `paused + null/manual` -> `paused`
- `paused + credit_limit/payment_failed/overage_cap/suspended` -> `blocked`
- `paused + orphaned` -> `recovering`
- `stopped + snapshot_failed` -> `failed`
- `stopped + otherwise` -> `completed`

Important practical nuance:

- Manual pause currently often means `pauseReason=null` (not literal `manual`).

---

## 9) What Each Surface Should Look Like After Changes

This is the explicit UI walkthrough requested.

### 9.1 Sessions page

List columns (conceptual):

- `Status`
- `Session` (title or prompt snippet)
- `Context` (status-dependent subtitle)
- `Branch`
- `Origin`
- `Duration/Time`
- `State badge`

Row behavior by status:

- Active: shows live/latest task + active duration
- Idle: shows original task snippet + idle indicator/resumable cue
- Blocked: shows block reason (credits/payment/etc.)
- Completed/Failed: shows outcome signal + compact metrics + PR indicator

On clicking row:

- Opens a right-side **peek drawer** (routable)
- Drawer shows:
  - full prompt (on-demand single-session fetch)
  - summary (`what happened`) if available
  - PR links
  - timeline and metrics
  - block reason details (if blocked)
  - primary CTA (`Enter Workspace` / `Resume` / `Investigate`)

### 9.2 Inbox page

Left queue remains triage-oriented list.
Right panel becomes actionable context card.

Item categories:

1. Pending runs
2. Pending approvals
3. Blocked sessions (new)

Pending run right card should include:

- automation + terminal status
- task prompt snippet (what it was trying to do)
- summary markdown (what happened)
- PR links
- progress metrics
- `View Session` CTA

Pending approval right card should include:

- current controls (approve/deny/always allow)
- plus session task context line (`what agent is working on`)

Blocked session right card should include:

- prominent reason header (`Out of credits`, `Payment failed`, etc.)
- what task was being worked on (prompt snippet)
- progress before block
- role-appropriate CTA:
  - admin/billing roles: billing fix actions
  - non-admin: contact admin guidance

Rollup behavior for org-wide billing blocks:

- if 1-3 sessions blocked for same billing cause: show individual items
- if 4+ blocked for same cause: show single rollup banner

### 9.3 My Work

Structure can stay the same, but content is richer:

- Claimed runs: include summary/outcome/PR hints
- Active sessions: use derived display status (idle vs blocked vs active)
- Pending approvals: include clearer session task context

### 9.4 Activity

Each run row should show, compactly:

- outcome badge semantics
- PR indicator when available
- avoids requiring workspace open for basic triage

### 9.5 Command palette

Session subtitle fallback should use prompt snippet when title is empty.

### 9.6 Dashboard home

- needs-attention count remains, but includes blocked context path
- compact active cards can show latest task (best-effort)

---

## 10) Proposed Rollout Strategy

### Phase 1: Correctness + Immediate UX Wins (no new DB columns)

- Fix web create contract to accept/persist `initialPrompt`
- Add derived display status utility
- Add prompt snippet sanitizer
- Expose `endedAt` and prompt snippet in session API response shape (with selective population)
- Update session list filtering semantics to meaningful categories
- Add blocked sessions to inbox via dedicated aggregate source (not paginated session list)
- Add prompt context into triage cards using on-demand session fetch

### Phase 2: Passive capture persistence

Add session-level metadata columns for:

- `outcome`
- `summary`
- `prUrls`
- `metrics`
- `latestTask`

Capture strategy:

- gateway passively observes existing traffic; agent behavior unchanged

### Phase 3: Full UI overhaul

- implement richer row density + peek drawer + full inbox card enrichment across surfaces

---

## 11) Major Risks and Constraints

1. Prompt durability risk (current bug): web create path missing `initialPrompt` means context can be lost.
2. Metrics reliability risk: gateway in-memory counters are approximate and can be lost on restarts or non-hub pause paths.
3. Latest-task sparsity: `tool_metadata.title` is not guaranteed for every tool execution.
4. PR completeness risk: shell-created PRs are not captured by gateway PR interception.
5. Security risk for markdown summary rendering: must sanitize untrusted markdown aggressively.
6. Status truth risk: raw `paused` has multiple meanings; UI must always use derived status.
7. Contract drift risk: `pending` exists in runtime states but status schema does not reflect it cleanly.

---

## 12) Advisor Decision Checklist (What We Need Reviewed)

Please provide recommendations on:

1. Data model shape
   - Are session-level `outcome/summary/prUrls/metrics/latestTask` the right durable fields?
2. Semantics
   - Is display-status derivation correct and future-proof enough?
3. Heuristics
   - Is regular-session outcome inference acceptable, or should it remain neutral-only without stronger signals?
4. Inbox design
   - Is blocked-session rollup threshold and role-based CTA strategy appropriate?
5. Capture strategy
   - Is passive gateway capture + no new agent tool burden the right tradeoff?
6. Risk controls
   - What minimum observability and fallback behavior should be required before rollout?
7. Security
   - Is markdown sanitization policy sufficient for summary rendering?

---

## 13) Appendix: Key Implementation Anchors (for Follow-Up Work)

Representative files reviewed for this brief:

- `packages/shared/src/contracts/sessions.ts`
- `packages/services/src/sessions/mapper.ts`
- `apps/web/src/server/routers/sessions.ts`
- `apps/web/src/server/routers/sessions-create.ts`
- `apps/web/src/server/routers/sessions-pause.ts`
- `apps/web/src/components/sessions/session-card.tsx`
- `apps/web/src/app/(command-center)/dashboard/sessions/page.tsx`
- `apps/web/src/app/(command-center)/dashboard/inbox/page.tsx`
- `apps/web/src/components/inbox/inbox-item.tsx`
- `apps/web/src/hooks/use-attention-inbox.ts`
- `apps/gateway/src/hub/event-processor.ts`
- `apps/gateway/src/hub/session-hub.ts`
- `apps/gateway/src/hub/migration-controller.ts`
- `apps/gateway/src/api/proliferate/http/sessions.ts`
- `apps/gateway/src/hub/capabilities/tools/automation-complete.ts`
- `packages/services/src/runs/service.ts`
- `packages/db/src/schema/sessions.ts`
- `docs/session-display-redesign-spec.md`

---

## 14) One-Paragraph Executive Summary

Current session/inbox UX is metadata-heavy but outcome-light; users cannot reliably tell what work is happening, what finished, or what is blocked without opening full workspaces. The redesign should center on durable prompt context, honest derived status semantics (especially for paused states), and passive gateway capture of outputs/metrics to populate triage-ready list and inbox cards. The highest-priority correctness fix is persisting `initialPrompt` in the web session create path; after that, the most leverage comes from introducing session-level `summary/outcome/prUrls/metrics/latestTask`, then wiring them into sessions/inbox/my-work/activity surfaces with clear role-based blocked-state handling.
