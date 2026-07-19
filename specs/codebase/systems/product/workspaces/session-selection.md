# Workspace Session Selection

This document owns the product contract for selecting and preserving the
visible session that anchors an open workspace.

## Open and restore

Opening a workspace resolves one visible session. A valid remembered session
wins; otherwise selection uses the existing prompted-session and recent-update
ordering. An unused session is still a valid active session and keeps the
normal ready composer, harness selector, and Add New affordance.

An empty first session-directory read receives one forced authoritative read
before the workspace is treated as empty. A confirmed empty workspace uses the
existing default empty-session bootstrap. This check prevents a delayed cache
or directory result from being mistaken for a new workspace.

Recovery Retry starts with an authoritative session-directory read rather than
accepting a previously populated list cache. A stale remembered session can
therefore resolve only against the fresh directory result.

## Visible-session invariant

An open workspace must retain at least one visible chat session. The invariant
is enforced by the shared visibility workflow before it mutates persisted tab
visibility. It therefore applies to pointer close, the close-tab shortcut,
context and overflow menus, parent-plus-child expansion, and multi-tab close
operations.

The only visible session does not expose direct close or archive actions.
Closing a proper subset of multiple sessions continues to use the existing
deterministic adjacent fallback and activates that survivor once.

Visible-session archive reserves its parent-plus-child visibility change as one
transaction. Each reservation recomputes the live visible set, so concurrent
archives cannot together remove every visible session; cleanup resolves the
captured adjacent survivor against the remaining reserved set before activation.

This invariant concerns product visibility and selection only. Runtime session
deletion, empty-session replacement, harness switching, and Add New composition
retain their existing owners and semantics.

## Bounded recovery

Session-directory lookup receives at most one forced retry per workspace-open
attempt. A failed retry, failed empty-session bootstrap, failed remembered
session selection, or confirmed no-visible-session state records an explicit
workspace recovery state instead of presenting an empty composer or repeating
session creation.

The recovery card leaves the surrounding workspace shell available and offers
three user-driven exits: Retry starts a new cold workspace-open attempt, Reload
reloads the client, and Back to workspaces returns to the workspace list.
Selecting a session, changing workspaces, or leaving the shell clears the
recovery state. The recovery surface is announced as an alert and moves focus
to Retry whenever it enters or re-enters after a failed attempt.

## Code ownership

- `lib/domain/workspaces/selection` owns recovery state types and selection
  ordering.
- `lib/domain/workspaces/tabs` owns the pure visible-session preservation rule.
- `hooks/workspaces/workflows` owns bounded bootstrap and user recovery actions.
- `stores/sessions/session-selection-store.ts` owns the ephemeral recovery
  state alongside workspace and session selection.
- `components/workspace/chat/surface` owns the explicit recovery presentation.
