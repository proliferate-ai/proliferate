# Workspace Mobility Decision: UI Surface and User Flow

Status: superseded by `decision-composer-footer-mobility-redesign.md`

## Decision

The primary handoff action lives below the chat input.

The actual move is initiated by an explicit action, not a background sync or a
silent state transition.

The confirmation surface is a modal/dialog.

The in-progress state is rendered in the existing composer/workspace status
surfaces, with a transient motion treatment during handoff.

v1 does not introduce a fifth independent composer top-slot inhabitant for
handoff progress.

## User flow

The user-facing flow is:

1. Click `Move to cloud` or `Bring back local` below the chat input
2. See a confirmation dialog
3. Confirm the move
4. Source enters moving/frozen state
5. Existing composer area shows in-progress phase text and animation
6. On success, the workspace reconnects to the new owner
7. On failure, the source remains authoritative and the UI shows a recoverable
   handoff failure state

## Confirmation content

The confirmation dialog must show:

- destination side
- branch and sync basis
- supported sessions that will move
- unsupported sessions that will be skipped and remain behind
- blocking reasons if preflight fails

## In-progress rendering

Use the existing composer-adjacent status surfaces rather than introducing a
parallel banner system.

While handoff is active:

- composer input is disabled
- phase text is shown
- a transient visual animation may overlay the page/composer area

The animation should remain additive to the existing surface, not replace the
status information.

Specifically:

- the action lives below the chat input
- confirmation lives in a modal/dialog
- in-progress / failed handoff status extends the workspace status panel path
  above the composer
- `CloudRuntimeAttachedPanel` remains responsible for raw runtime
  connect/resume/error states

## Why

This is a deliberate, potentially destructive move operation.

It should therefore:

- be explicit
- have a confirmation moment
- show clearly what will and will not move
- make the current phase obvious while the workspace is frozen

## References

- [docs/frontend/README.md](/Users/pablo/proliferate-workspace-mobility-plan/docs/frontend/README.md)
- [docs/frontend/chat-composer.md](/Users/pablo/proliferate-workspace-mobility-plan/docs/frontend/chat-composer.md)
