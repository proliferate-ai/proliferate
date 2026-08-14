# Delegated Work UX

Status: authoritative current spec for the same-workspace subagent Agents pane
and its navigation paths; target UX spec for the remaining cowork and review
surfaces described below.

Scope:

- `apps/desktop/src/components/workspace/chat/input/delegated-work/**`
- `apps/desktop/src/components/workspace/shell/tabs/**`
- `apps/desktop/src/components/workspace/reviews/**`
- `apps/desktop/src/components/workspace/chat/plans/**`
- `apps/desktop/src/hooks/chat/facade/use-delegated-work-composer.ts`
- `apps/desktop/src/hooks/chat/facade/subagents/**`
- `apps/desktop/src/hooks/chat/workflows/subagents/**`
- `apps/desktop/src/hooks/cowork/**`
- `apps/desktop/src/hooks/reviews/**`
- `apps/desktop/src/hooks/workspaces/cache/tabs/use-workspace-header-subagent-hierarchy.ts`
- `apps/desktop/src/lib/domain/delegated-work/**`
- `apps/desktop/src/lib/domain/chat/subagents/**`
- `apps/desktop/src/lib/domain/reviews/**`
- `apps/desktop/src/lib/domain/plans/**`

## Product Model

The UI primitive is delegated work, not subagents.

```text
DelegatedWorkItem
  id
  kind: subagent | cowork | plan_review | code_review
  title
  generatedName
  shortId
  displayName
  colorToken
  scope
  status
  latestResult
  nextActions
  children
```

Kinds:

```text
subagent
  same-workspace child session

cowork
  child session in a managed workspace

plan_review
  structured review run targeting a proposed/stored plan

code_review
  structured review run targeting code changes
```

Names:

| Field | Example | Use |
| --- | --- | --- |
| `title` | `API Surface Check` | sidebar, popovers, transcript, details |
| `generatedName` | `Mary` | primary friendly agent identity; chat header tab label |
| `shortId` | `abc123` | compact stable disambiguator |
| `displayName` | `Mary (API Surface Check abc123)` | composer, transcript receipts, tool-call rows, hover/details |
| `colorToken` | `delegated-agent-3` | deterministic semantic identity color |
| product handle | `subagent_abc123`, `review_abc123` | action routing, debug/details |

Delegated-agent identity is generated and stable for a delegated-work id. Normal
UI should use the canonical display handle when the surface represents the agent
itself:

```text
GeneratedName (title ID)
Mary (API Surface Check abc123)
```

The serious `title` remains available for details, search, and dense secondary
copy. Chat header tabs are intentionally denser and show only `generatedName`;
their hover card exposes the full `displayName`, origin, parent/source context,
and status. Composer rows, transcript receipts, and creation rows should not
fall back to a title-only display when the generated identity can be resolved.
Raw ids do not appear outside debug/details surfaces.

## Status Model

Delegated-work status categories:

```text
needs_attention
failed
running
queued
wake_scheduled (Cowork only)
finished
closed
```

Product-specific statuses map into these categories for display ordering.

Ordering:

```text
needs_attention
failed
running
queued
wake_scheduled
finished
closed
```

Visual treatment:

```text
needs_attention: attention accent
failed: destructive accent
running: active accent, subtle motion only when already established locally
queued: muted active
wake_scheduled: Cowork-only, muted/neutral with explicit label
finished: neutral
closed: hidden by default
```

Composer visibility:

- Hide `finished` items only when they succeeded and have no action needed.
- Hide `closed` items by default.
- Keep `failed`, `needs_attention`, `feedback_ready`, and
  `waiting_for_revision` visible until the user acts or dismisses the item.
- `parent_revising` keeps the delegated-work item visible but must not disable
  normal parent chat input.

Avoid using one word for both action and state. On Cowork-owned surfaces,
state is `Wake scheduled`; the corresponding action is `Notify me` or
`Wake parent`. Delegated-agent surfaces do not expose one-shot wake actions or
state.

## Surfaces

Delegated work appears in five places.

```text
Tab strip
  lightweight presence and quick entry

Composer Agents popover
  active delegated-work inbox for the current session

Sidebar/session hierarchy
  durable relationship map and navigation

Transcript
  durable receipts, plans, and review feedback artifacts

Details surface
  focused inspect/manage view for one item
```

No surface should expose MCP mechanics as the user-facing concept.

## Current Agents Right Pane

The workspace right panel includes an `Agents` tool for browsing and managing
same-workspace subagents. The pane has its own per-workspace route and never
changes the active chat session merely because the user drills through it:

```text
overview
  every parent with durable subagent children

cluster
  one parent's Running, Available, and Closed children

detail
  one child's transcript, composer, and lifecycle actions
```

The durable runtime roster is the source of truth. The overview reads the
workspace roster, while cluster/detail routes also read the selected parent's
session roster. The client preserves server order and uses the server's
`status.presentation` verdict directly; it does not reconstruct membership or
presentation from open tabs, transcript receipts, or execution status. A
settled focused roster may repair a stale route before a slower
workspace-wide refresh finishes, but a loading or failed query must not make a
parent or child disappear.

Current presentation rules:

- The overview shows each parent title, a stack of durable child identity
  glyphs, and the child count. Parents whose remaining children are all Closed
  stay visible and are dimmed; an empty roster shows `No agents yet`.
- A parent cluster contains only its nonempty `Running`, `Available`, and
  `Closed` sections. Rows show the durable identity, title, and truthful
  execution detail (`Starting`, `Working`, `Waiting`, `Available`, `Failed`, or
  `Closed`). Closed children offer Open; every other child offers Close and
  Promote.
- Detail reuses the existing ProductClient session directory, transcript
  store, history hydration, stream connector, message list, and send-or-queue
  intent path for the mapped child session. It never selects that child as the
  main chat. Closed detail is hydrated history with no live stream or composer;
  non-Closed detail connects live updates and exposes its own composer. The
  embedded transcript deliberately does not participate in global transcript
  content search.
- The detail's stream lease is explicit. Leaving the route closes only a stream
  handle the pane opened; it does not close a pre-existing shared handle or a
  handle owned by hot-session ingestion. A disconnected or ended non-Closed
  stream shows `Live updates paused` with a Reconnect action.

Close, Open, and Promote use the durable subagent lifecycle routes. Closing a
Running child requires confirmation; closing an Available child is immediate.
A successful Close interrupts active work, clears queued prompts, disconnects
the pane-owned stream, and preserves the transcript. Open restores a Closed
child to the exact Running or Available presentation returned by the server.
Lifecycle response state is immediate, keyed to the durable parent/child pair,
and later roster invalidation reconciles it; an error is shown only while that
same detail route remains selected.

Promote requires confirmation and turns a non-Closed child into an ordinary
top-level session while preserving its transcript. On success the pane removes
the child from its parent cluster, returns to that cluster, and opens the exact
mapped ordinary session. A Promote 404 is not success by itself: the client
converges it as an already-completed promotion only when successful refreshed
roster and workspace-session reads agree that the child is no longer linked
and is now listed as a workspace session.

Promotion is monotonic local authority for both the durable runtime ID and the
mapped ProductClient session ID. Directory upserts, relationship hints, stale
roster responses, and header hierarchy refreshes cannot reattach a promoted
session as a child. That authority survives a transient directory-entry
unmount/remount and is cleared only with the owning workspace or the full
directory. Successful Promote transcript receipts establish the same authority,
so replaying historical subagent provenance cannot resurrect the Agents-pane
route. History hydration treats legacy completion/create provenance only as a
candidate: a fresh parent roster must still contain that child before it is
mounted as a subagent. When the roster omits it, promotion is recognized only
if a fresh workspace-session read still lists the same durable session ID;
failed or mismatched reads grant no relationship authority.

Current entry points obey the live relationship, not merely the historical
receipt shape:

- The composer Agents popover header and parent row open the parent cluster;
  its subagent rows open child detail.
- Subagent creation chips, Agent Operations receipts, incoming agent-origin
  receipts, and the pending `From subagents` identity glyph open the Agents pane
  only for an authoritative same-workspace subagent target.
- Promoted targets open as ordinary sessions. Cowork, review, or otherwise
  non-subagent relationships retain their existing session navigation, and an
  unresolved target remains non-clickable rather than being guessed into the
  pane.

The current implementation is owned by
`apps/packages/product-client/src/components/workspace/delegated-work/agents-pane/**`,
`apps/packages/product-client/src/hooks/agents/**`, and the shared session
directory, transcript, shell, and receipt-routing owners they call. The Agents
pane currently covers same-workspace subagents only; this section does not
assign cowork or review work to it.

## Tool And Workflow Result Rendering

Tool calls and workflow receipts that create or update delegated agents should
render as named product events.

Examples:

```text
API Surface Check agent created
Running - Claude
Open agent session

Security Review agent created
Reviewing - Claude
Open reviewer session

Message sent to API Surface Check
Queued while the agent is running
Open agent session
```

Rules:

- Always show the delegated agent title.
- Link to the child/reviewer session when one exists.
- Keep raw JSON available only through an explicit details/debug affordance.
- The rendered title should match the `label`/title that the parent agent sees
  in MCP results.
- The link target may be resolved from product state; raw session ids do not
  need to be visible in the formatted row.
- Status, close, read, and search tool calls are not launch/provisioning
  ledgers. They should render their own concise result rows/details instead of
  showing misleading "agent started" affordances.

## Tab Strip

Same-workspace subagents are Agents-pane-only until promotion. They never
appear as main chat tabs, attached tabs, or entries in the closed-tabs menu.
Opening a subagent receipt, composer row, or roster row changes only the
independent right-pane route; it does not change the active main chat tab.
Promote preserves the durable session and transcript, removes the relationship,
and opens that same session as an ordinary top-level chat tab.

Review and Cowork child sessions remain real attached chat tabs because their
owned workflows require a full main-chat surface. Their target shape is:

```text
[X] Main session  [X] reviewer Mary  [other tabs]
```

Rules:

- The close `X` lives on the left side of the tab.
- An attached review/Cowork tab uses an icon colored by the agent's deterministic
  semantic identity token. The text remains normal tab text color.
- Its label is only the generated agent name. The full
  `GeneratedName (title ID)` identity stays in the hover card and transcript
  receipts.
- Running, attention, and error states use a status ring/badge around or beside
  the icon. Status must remain visible and must not replace the identity.
- The parent tab is the anchor. It is not itself a member of the delegated
  agent group.
- Open review/Cowork child tabs appear immediately to the right of the parent
  tab and remain contiguous with sibling attached tabs for that parent.
- Attached child tabs are shorter by default than normal chat tabs.
- Hover shows origin, parent/source context, and
  status.
- Closing an attached child tab hides the tab only. It does not delete the
  delegated item or end active work.
- Cowork child tabs carry their managed `workspaceId`, relationship source,
  and link handle through the view model. Selecting one opens that session in
  the managed Cowork workspace, not in the parent's current workspace.
- Existing manual tab grouping stays supported, but an attached child run is a
  sibling anchored after the parent, not a group that contains the parent.

Example hover:

```text
Mary (API Surface Check abc123)
Code review
Parent: Main session
Running
```

Review runs are logical delegated-work items. Reviewer sessions remain real
chat tabs, and each reviewer tab uses its own generated identity. Review
`kind: code` maps to `code_review`; review `kind: plan` maps to `plan_review`.

## Composer Agents Popover

The composer Agents popover is an inbox for active/attention work in the
current session. It is not a full session browser.

Sections:

```text
Needs attention
Running
Queued
```

Kinds may be grouped inside sections when needed:

```text
Agents

Needs attention
  Plan Review                    Feedback ready      View feedback
    Architecture Review          Approved            Open
    Security Review              Changes requested   View critique

Running
  API Surface Check              Running             Open
```

The composer Agents popover surfaces review and same-workspace subagent work
only. Cowork managed workspaces and their coding sessions live in the cowork
sidebar (`CoworkThreadsSection` → `CoworkManagedWorkspaceList`) and are not
duplicated above the composer.

Row rules:

- primary text is the generated display identity
- secondary text is status or scope
- actions are short and direct
- icon-only actions need tooltips
- raw ids do not appear unless the user opens debug/details
- Finished successful work is hidden by default unless it produced an action or
  durable notice that requires attention.

The `Agents` trigger stays generic when it represents zero or multiple visible
items. It may show a colored robot identity only when exactly one specific
active/attention item is represented by the control.

Primary actions by kind:

```text
subagent
  Open
  Delete

cowork
  Open workspace
  Open session
  Delete

plan_review | code_review
  View feedback
  Send feedback
  Review revision
  Finish review
  Delete review

reviewer row
  Open reviewer
  View critique
  Retry reviewer
```

The tab-cluster popover and composer Agents popover should use the same
delegated-work view model and row components where possible.

## Sidebar And Session Hierarchy

The sidebar/session hierarchy is durable navigation.

Shape:

```text
Main session
  Subagents
    API Surface Check
    Docs Pass

  Reviews
    Plan Review round 1
      Architecture Review
      Security Review

  Cowork workspaces
    auth-workspace
      Implementation Agent
      Test Agent
```

Rules:

- Parent-child relationships should be stable even when a child tab is closed.
- Opening a child should preserve a parent breadcrumb or parent entry.
- Reviewers appear under their review run, not as unrelated child sessions.
- Cowork sessions appear under the managed workspace first, then under the
  parent relationship when space allows.
- Closed/deleted delegated work is hidden from the default tree unless the user
  opens history/debug.

## Transcript

The transcript is the durable story of the workflow.

Examples:

```text
Created subagent Mary (API Surface Check abc123) with prompt "Check SDK usage."

Mary (API Surface Check abc123) finished a turn · Open

Plan Review completed round 1.
2 reviewers approved. 1 reviewer requested changes.
```

Rules:

- Plans render as plan artifacts/cards.
- Review feedback renders as a first-class artifact, with reviewer details one
  click away.
- Subagent creation/completion receipts should be concise.
- Adjacent subagent creation receipts from the same assistant/tool-call cluster
  group together. Creation receipts do not group with messaging, lifecycle,
  configuration, or generic tool calls.
- Parent messages rendered in a child session show
  `Sent by parent - {parent chat title}`.
- Queued outbound prompts belong in composer outbound state, not only as silent
  background state. Automatic completion delivery is represented by the
  resulting parent notification rather than a delegated-agent wake control.
- Do not paste long raw child transcripts into parent transcript receipts.

## Details Surface

Opening a delegated-work item shows a focused details surface.

Subagent details:

```text
API Surface Check
Status: Completed
Harness: Claude
Latest result: Found one SDK mismatch in create_agent.

Actions:
  Open session
  Send message
  Delete
```

Review details:

```text
Plan Review round 1
Result: Changes requested

Architecture Review: Approved
Security Review: Changes requested

Actions:
  View critiques
  Send feedback
  Review revision
  Delete review
```

Cowork details:

```text
auth-workspace
Status: Running
Sessions: 2

Actions:
  Open workspace
  Open session
  Delete
```

Use a popover for quick entry and a dialog/drawer for richer inspection. Do not
put a large details browser directly in the composer dock.

## Close And Delete Semantics

There are three different actions:

| Action | Meaning |
| --- | --- |
| Close tab | Remove the visible tab from the tab strip. |
| Delete delegated item | Remove/delete the delegated work relationship from active UI. |
| End active work | Cancel/stop work that is currently running or queued. |

Rules:

- Closing a child tab does not delete the parent session.
- Closing a parent tab that would close/delete the parent session must confirm
  if active delegated work exists.
- Deleting from the Agents popover or subagent/review popover means deleting
  that delegated item, not merely hiding the row.
- If deletion affects running/queued work, the confirmation says active work
  will end.
- Completed delegated work may be deleted/dismissed without a heavy modal.
- Transcript artifacts remain according to retention policy; delete is not
  transcript erasure unless a future destructive action explicitly says so.

Parent close confirmation:

```text
Close session?

This session has 3 active agents running. Closing it will end their active work.

Cancel
Close and end agent work
```

Active delegated item delete confirmation:

```text
Delete API Surface Check?

This agent is currently running. Deleting it will remove it from this session
and end its active work.

Cancel
Delete agent
```

## Source Ownership

Components:

```text
apps/desktop/src/components/workspace/shell/tabs/
  WorkspaceTabStrip.tsx
  ChatTabWithMenu.tsx
  tab-rendering.tsx
  TabContextMenu.tsx

apps/desktop/src/components/workspace/shell/topbar/
  HeaderChatTab.tsx

apps/desktop/src/components/workspace/chat/input/delegated-work/
  DelegatedWorkComposerControl.tsx
  AgentsPopoverSubagentSection.tsx
  AgentsPopoverCoworkSection.tsx
  AgentsPopoverReviewSection.tsx
  PopoverSection.tsx

apps/desktop/src/components/workspace/reviews/**
apps/desktop/src/components/workspace/chat/plans/**
apps/desktop/src/components/workspace/chat/transcript/**
```

Hooks:

```text
apps/desktop/src/hooks/chat/facade/use-delegated-work-composer.ts
apps/desktop/src/hooks/chat/facade/subagents/**
apps/desktop/src/hooks/chat/workflows/subagents/**
apps/desktop/src/hooks/cowork/**
apps/desktop/src/hooks/reviews/**
apps/desktop/src/hooks/plans/**
apps/desktop/src/hooks/workspaces/cache/tabs/use-workspace-header-subagent-hierarchy.ts
apps/desktop/src/hooks/workspaces/facade/tabs/use-workspace-header-tabs-view-model.ts
apps/desktop/src/hooks/workspaces/workflows/tabs/use-header-tabs-close-actions.ts
```

Pure domain logic:

```text
apps/desktop/src/lib/domain/delegated-work/
  model.ts
  ordering.ts
  presentation.ts
  identity.ts

apps/desktop/src/lib/domain/chat/subagents/**
apps/desktop/src/lib/domain/chat/tools/**
apps/desktop/src/lib/domain/reviews/**
apps/desktop/src/lib/domain/plans/**
apps/desktop/src/lib/domain/workspaces/tabs/**
```

Access:

```text
apps/desktop/src/lib/access/anyharness/sessions.ts
apps/desktop/src/lib/access/anyharness/cowork.ts
apps/desktop/src/lib/access/anyharness/reviews.ts
apps/desktop/src/lib/access/anyharness/plans.ts
```

State:

```text
apps/desktop/src/stores/reviews/**
apps/desktop/src/stores/sessions/session-directory-store.ts
```

## Acceptance

Done when:

- tab close affordance is consistently on the left
- delegated-work indicators live on the right side of chat tabs
- bubble hover shows friendly name, title, and status
- title/label remains the serious name everywhere else
- composer and tab popovers share one delegated-work model
- subagents, cowork, and reviews use the same status ordering language
- review runs are the primary review UI object
- delete semantics are consistent and confirmed when active work will end
- sidebar hierarchy is navigation, not the active-work inbox
- transcript artifacts carry durable workflow results
