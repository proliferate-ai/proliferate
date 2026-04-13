# Workspace Mobility Decision: Composer Footer Redesign

Status: accepted

Supersedes:

- `decision-handoff-ui-and-user-flow.md`

## Decision

Persistent workspace identity and workspace mobility entry now live inside a
dedicated composer footer row.

The primary move flow is:

1. Open the location control in the composer footer row
2. See a small attached popover with either an action, a blocker, or a recovery state
3. Confirm the move in a lightweight modal
4. See in-flight progress in a dedicated `ChatView` overlay
5. See completion and MCP reconnect follow-up in that same overlay

v2 removes the old mobility-specific bottom bar and the old mobility branch in
the workspace status top-slot path.

## Surface contract

- `ChatComposerDock` no longer has a mobility-specific `bottomSlot`
- `ChatInput` composes a dedicated `WorkspaceMobilityFooterRow` under the main
  composer controls
- `useComposerTopSlot` remains responsible for approval, todo tracker,
  workspace arrival/setup, and cloud runtime only
- mobility progress no longer renders through `WorkspaceArrivalAttachedPanel`
- the overlay is additive to the existing chat view and keeps the transcript
  faintly visible behind a soft scrim

## Confirmation content

The confirmation modal remains compact, but it still discloses:

- destination direction
- branch
- sync basis
- one concise non-migrating summary when applicable

Blockers are shown one at a time in the location popover instead of as a large
stack of sections in the confirm modal.

## Why

The previous split across a bottom action bar, a heavy confirm modal, a top-slot
mobility panel, and a post-move MCP notice created too many competing surfaces
for one workflow.

The new contract keeps:

- persistent workspace facts in one stable footer row
- the action/blocked decision in one popover
- the destructive confirmation in one modal
- the in-flight and completion states in one overlay
