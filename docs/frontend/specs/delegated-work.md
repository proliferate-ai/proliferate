# Delegated Work UX

Status: authoritative target UX spec for subagents, cowork agents, plan review
agents, and code review agents in the desktop app.

Scope:

- `desktop/src/components/workspace/chat/input/delegated-work/**`
- `desktop/src/components/workspace/shell/tabs/**`
- `desktop/src/components/workspace/reviews/**`
- `desktop/src/components/workspace/chat/plans/**`
- `desktop/src/hooks/chat/use-delegated-work-composer.ts`
- `desktop/src/hooks/chat/subagents/**`
- `desktop/src/hooks/cowork/**`
- `desktop/src/hooks/reviews/**`
- `desktop/src/hooks/workspaces/tabs/use-workspace-header-subagent-hierarchy.ts`
- `desktop/src/lib/domain/delegated-work/**`
- `desktop/src/lib/domain/chat/subagents/**`
- `desktop/src/lib/domain/reviews/**`
- `desktop/src/lib/domain/plans/**`

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
wake_scheduled
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
wake_scheduled: muted/neutral with explicit label
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

Avoid using one word for both action and state. For example, state is
`Wake scheduled`; action is `Notify me` or `Wake parent`.

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

## Tool And Workflow Result Rendering

Tool calls and workflow receipts that create or update delegated agents should
render as named product events.

Examples:

```text
API Surface Check agent created
Running - Claude - Wake scheduled
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

Tabs carry lightweight delegated-work presence.

Target delegated-agent tab shape:

```text
[X] Main session  [X] robot Mary  [other tabs]
```

Rules:

- The close `X` lives on the left side of the tab.
- A delegated-agent tab uses a robot icon colored by the agent's deterministic
  semantic identity token. The text remains normal tab text color.
- A delegated-agent tab label is only the generated agent name. The full
  `GeneratedName (title ID)` identity stays in the hover card and transcript
  receipts.
- Running, attention, and error states use a status ring/badge around or beside
  the robot. Status must remain visible and must not replace the robot icon.
- The parent tab is the anchor. It is not itself a member of the delegated
  agent group.
- Open delegated-agent tabs appear immediately to the right of the parent tab
  and remain contiguous with sibling delegated-agent tabs for that parent.
- Delegated-agent tabs are shorter by default than normal chat tabs.
- Hover on a delegated-agent tab shows origin, parent/source context, and
  status.
- Closing a delegated-agent tab hides the tab only. It does not delete the
  delegated item or end active work.

Example hover:

```text
Mary (API Surface Check abc123)
Subagent
Parent: Main session
Running
```

Review runs are logical delegated-work items. Reviewer sessions remain real
chat tabs, and each reviewer tab uses its own generated identity. Review
`kind: code` maps to `code_review`; review `kind: plan` maps to `plan_review`.

### Attached Agent Tabs

When the user opens a delegated agent, its chat tab appears immediately to the
right of the parent session tab, inside the parent's attached-agent run.

Target expanded shape:

```text
[X] Main session  [X] robot Mary  [X] robot Nina
```

Rules:

- Opening any delegated agent inserts or moves that tab next to its parent.
- All open delegated-agent tabs for the same parent remain contiguous.
- The parent remains the left anchor and is not visually grouped inside the
  delegated-agent run.
- Cowork child tabs must carry their managed `workspaceId`, relationship
  source, and link handle through the tab view model. Selecting a cowork child
  tab opens that session in the managed cowork workspace, not in the parent's
  current workspace.
- Existing tab grouping can remain, but the child-agent group is a sibling
  attached to the parent, not a group that contains the parent.
- Reordering normal tabs must not separate open delegated-agent tabs from their
  parent unless the user explicitly detaches them through a future advanced
  action.

## Composer Agents Popover

The composer Agents popover is an inbox for active/attention work in the
current session. It is not a full session browser.

Sections:

```text
Needs attention
Running
Queued
Wake scheduled
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
  cowork: auth-workspace         2 sessions          Open workspace
```

Row rules:

- primary text is the generated display identity
- secondary text is status or scope
- actions are short and direct
- icon-only actions need tooltips
- raw ids do not appear unless the user opens debug/details
- Finished successful work is hidden by default unless it produced an action or
  durable notice that still needs attention.

The `Agents` trigger stays generic when it represents zero or multiple visible
items. It may show a colored robot identity only when exactly one specific
active/attention item is represented by the control.

Primary actions by kind:

```text
subagent
  Open
  Notify me
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
  group together. Creation receipts do not group with send, wake, status, read,
  search, close, or generic tool calls.
- Parent messages rendered in a child session show
  `Sent by parent - {parent chat title}`.
- Wake prompts and queued outbound prompts belong in composer outbound state,
  not only as silent background state.
- Do not paste long raw child transcripts into parent transcript receipts.

## Details Surface

Opening a delegated-work item shows a focused details surface.

Subagent details:

```text
API Surface Check
Status: Completed
Harness: Claude
Latest result: Found one SDK mismatch in create_subagent.

Actions:
  Open session
  Notify me
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
desktop/src/components/workspace/shell/tabs/
  WorkspaceTabStrip.tsx
  ChatTabWithMenu.tsx
  tab-rendering.tsx
  TabContextMenu.tsx

desktop/src/components/workspace/shell/topbar/
  HeaderChatTab.tsx

desktop/src/components/workspace/chat/input/delegated-work/
  DelegatedWorkComposerControl.tsx
  AgentsPopoverSubagentSection.tsx
  AgentsPopoverCoworkSection.tsx
  AgentsPopoverReviewSection.tsx
  PopoverSection.tsx

desktop/src/components/workspace/reviews/**
desktop/src/components/workspace/chat/plans/**
desktop/src/components/workspace/chat/transcript/**
```

Hooks:

```text
desktop/src/hooks/chat/use-delegated-work-composer.ts
desktop/src/hooks/chat/subagents/**
desktop/src/hooks/cowork/**
desktop/src/hooks/reviews/**
desktop/src/hooks/plans/**
desktop/src/hooks/workspaces/tabs/use-workspace-header-subagent-hierarchy.ts
desktop/src/hooks/workspaces/tabs/use-workspace-header-tabs-view-model.ts
desktop/src/hooks/workspaces/tabs/use-header-tabs-close-actions.ts
```

Pure domain logic:

```text
desktop/src/lib/domain/delegated-work/
  model.ts
  ordering.ts
  presentation.ts
  identity.ts

desktop/src/lib/domain/chat/subagents/**
desktop/src/lib/domain/chat/tools/**
desktop/src/lib/domain/reviews/**
desktop/src/lib/domain/plans/**
desktop/src/lib/domain/workspaces/tabs/**
```

Access:

```text
desktop/src/lib/access/anyharness/sessions.ts
desktop/src/lib/access/anyharness/cowork.ts
desktop/src/lib/access/anyharness/reviews.ts
desktop/src/lib/access/anyharness/plans.ts
```

State:

```text
desktop/src/stores/reviews/**
desktop/src/stores/sessions/session-directory-store.ts
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
