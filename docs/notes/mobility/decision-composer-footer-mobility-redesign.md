# Workspace Mobility Decision: Composer Footer Redesign

Status: accepted

Supersedes:

- `decision-handoff-ui-and-user-flow.md`

## Decision

Persistent workspace identity and workspace mobility entry now live inside a
dedicated composer footer row.

The primary move flow is:

1. Open the location control in the composer footer row
2. See a small attached handoff card with either the final move action, one preparation error, or one blocker/remediation
3. Commit the move from that card
4. See in-flight progress replace the normal composer footer row
5. See completion, failure recovery, and MCP reconnect follow-up in the dedicated `ChatView` overlay

v2 removes the old mobility-specific bottom bar and the old mobility branch in
the workspace status top-slot path.

## Surface contract

- `ChatComposerDock` no longer has a mobility-specific `bottomSlot`
- `ChatInput` composes a dedicated `WorkspaceMobilityFooterRow` under the main
  composer controls
- `useComposerTopSlot` remains responsible for approval, todo tracker,
  workspace arrival/setup, and cloud runtime only
- mobility progress no longer renders through `WorkspaceArrivalAttachedPanel`
- the overlay is reserved for completion notice and recovery actions; in-flight
  progress is not modal

## Handoff card content

The handoff card remains compact, but it still discloses:

- destination direction
- branch
- sync basis
- one concise non-migrating summary when applicable

Preparation errors and blockers are shown one at a time in the location card.
Lifecycle recovery does not render in the card. In-flight status belongs to the
footer row; completion and failure states belong to the chat overlay.

## Why

The previous split across a bottom action bar, a heavy confirm modal, a top-slot
mobility panel, and a post-move MCP notice created too many competing surfaces
for one workflow.

The new contract keeps:

- persistent workspace facts in one stable footer row
- the preflight, blocked, and commit decision in one attached card
- the in-flight state as a single footer replacement status
- completion and failure states in one overlay
