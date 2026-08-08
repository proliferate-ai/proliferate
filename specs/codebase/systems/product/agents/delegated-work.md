# Delegated Work UX

Status: authoritative target UX spec for subagents, cowork agents, plan review
agents, and code review agents in the desktop app.

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

Delegated work appears in six places.

```text
Tab strip
  lightweight presence and quick entry

Composer Agents popover
  active delegated-work inbox for the current session

Agents pane
  one global overview → cluster → agent drill, in the right panel

Sidebar/session hierarchy
  durable relationship map and navigation

Transcript
  durable receipts, plans, and review feedback artifacts

Details surface
  focused inspect/manage view for one item
```

No surface should expose MCP mechanics as the user-facing concept.

## Agents Pane

One global pane, in the right panel, navigating overview → cluster → agent.
`lib/domain/delegated-work/agents-pane-model.ts` holds every rule below as pure
functions; the components render them and nothing more.

Levels:

```text
Level 1 — overview
  only sessions that are DELEGATING appear
  row = title + live summary + its live agents as a glyph stack
  header summary = "N sessions delegating · N agents"

Level 2 — cluster
  Working / Idle / Done / Closed, in that order, empty sections omitted
  row = glyph + task title + ONE status line
  header summary = "N working · N idle · N done"

Level 3 — agent
  glyph, title, status line, copyable short id
  Parent prompt / Tool / latest Agent message
  actions: Open as tab · Promote · Close
  composer: "Message this agent — delivered on its next turn"
```

Rules:

- Native harness work and terminals NEVER appear here. They are read-only and
  live in the transcript and the terminal panel.
- Section membership is derived from the reported status, with two overrides:
  `Starting` counts as Working, and an agent whose close was requested stays
  under Working until it stops — it is working its last step.
- One status line per row, never two. A requested close outranks a promoted
  stamp, which outranks an armed wake, which outranks the latest completion.
- Entry points: the composer's "N working" cap opens THAT session's cluster;
  the panel's `Agents` tab opens the overview. The pane never auto-follows tab
  focus, so where it is pointed lives in `stores/agents/agents-pane-store.ts`
  rather than in the pane's own state.
- The overview's glyph stack shows live agents only. A closed agent is not on
  it and is not counted by the overview summary.
- Level 3 shows only what the read models carry. The session-subagents endpoint
  reports the delegated task and the latest completion; it carries no tool
  cursor and no message text, so those lines are absent rather than faked.
- The "Wake me on reply" toggle renders DISABLED with a tooltip saying why:
  `wakeOnReply` is a flag on the agents' own `send_agent_message` tool, and the
  human prompt route carries no equivalent. It must not pretend to arm one.

### Promotion

- Promote lives in the agent detail header, and is offered only for an agent
  that is still subordinate and not already closing. A peer has nothing to be
  promoted out of.
- One confirm, with exactly this sentence: "It becomes a top-level session in
  this workspace's tabs, keeps its transcript, and can spawn its own
  subagents."
- Afterwards the agent carries the badge `Promoted · top-level session` and
  renders as a normal top-level tab.

### Closing

- Closing is a PANE operation, not a transcript event. A human close leaves no
  transcript trace at all.
- Close sits on a cluster row's hover and in the agent detail header. An idle
  or finished agent closes instantly; only work in flight asks, with exactly
  this sentence: "It's mid-turn — it will finish the current step, then stop.
  The transcript stays readable under Closed."
- The confirm is calm. Nothing on it is destructive-styled — closing is
  routine, not an alarm.
- The pane names a closer only where the read models carry one. The subagents
  endpoint returns OPEN links, so attribution exists exactly in the
  close-requested window and in the transcript's close receipt. A landed close
  gets `Closed · transcript is read-only` and no invented closer.

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
- Peer calls — spawning a peer, messaging one, waking one, reading one's
  transcript, configuring one — render agent receipts of their own and say
  "agent", never "subagent". The target of a peer call is addressed by session
  id and is nobody's subagent; a peer receipt opens that session directly,
  because there is no delegation link behind it.
- The workspace pair names no agent at all. `spawn_workspace` and
  `get_workspace_options` render as workspace work, and a landed spawn says what
  it made — repo, mode, branch — rather than borrowing the subagent label they
  share a semantic kind with.

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
- Existing tab grouping stays supported, but the child-agent group is a sibling
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
- An agent spawned as a PEER, and a workspace spawned by an agent, appear
  without a manual refresh. Neither is announced by a stream event, so the
  completed `spawn_agent` / `spawn_workspace` receipt is what refreshes the
  workspace collections and the agents read model. A peer never records a
  parent-child relationship from that receipt: it is nobody's subagent, and
  claiming otherwise would file it under a parent's fanout in this tree.

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
apps/desktop/src/components/workspace/shell/tabs/
  WorkspaceTabStrip.tsx
  ChatTabWithMenu.tsx
  tab-rendering.tsx
  TabContextMenu.tsx

apps/desktop/src/components/workspace/shell/topbar/
  HeaderChatTab.tsx

apps/packages/product-client/src/components/workspace/chat/input/delegated-work/
  DelegatedWorkComposerControl.tsx
  AgentsPopoverSubagentSection.tsx
  AgentsPopoverCoworkSection.tsx
  AgentsPopoverReviewSection.tsx
  PopoverSection.tsx

apps/packages/product-client/src/components/workspace/delegated-work/
  AgentChip.tsx
  DelegatedAgentIdenticon.tsx

apps/packages/product-client/src/components/workspace/agents-pane/
  AgentsPane.tsx
  AgentsPaneHeader.tsx
  AgentsPaneOverview.tsx
  AgentsPaneClusterSections.tsx
  AgentsPaneAgentDetail.tsx
  AgentsPaneConfirm.tsx
  ConnectedAgentsPane.tsx

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
apps/packages/product-client/src/lib/domain/delegated-work/
  model.ts
  ordering.ts
  presentation.ts
  identity.ts
  agents-pane-model.ts

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
apps/packages/product-client/src/stores/reviews/**
apps/packages/product-client/src/stores/sessions/session-directory-store.ts
apps/packages/product-client/src/stores/agents/agents-pane-store.ts
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
- every agent renders through ONE chip primitive and ONE identity glyph
- a human close never writes to the transcript, and the pane never invents a
  closer for a close that already landed
