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
therefore resolve only against the fresh directory result. If the selection
attempt loses ownership while that forced read is in flight, its response is
discarded before classification and is not committed to the shared session
cache.

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
attempt. A confirmed empty directory reuses the selected projected empty
session when one exists; otherwise it performs one materialization through the
normal session-creation workflow. That workflow publishes the optimistic
session shell before runtime materialization and preserves it on failure, so
the workspace never transitions to a selected-session-null canvas.

A failed directory read, failed empty-session materialization, failed
remembered-session selection, or confirmed no-visible-session state is shown as
a compact inline alert attached to the retained selected session composer. The
normal workspace shell, session tab, ready composition, model selector, and Add
New affordance stay mounted. Sending is blocked only for that recovery session
until a usable runtime session exists; editing and harness controls remain
available.

Retry starts one new cold workspace-open attempt with an authoritative
directory read while carrying the retained client session id. If the directory
is still empty, the same projected record is rematerialized through the normal
creation owner instead of allocating another shell. The alert is announced and
focuses Retry on entry and re-entry. Selecting a different session, changing
workspaces, or completing materialization clears recovery.

If there is neither an existing session shell nor a complete configured
agent/model launch identity, recovery creates one deterministic client-only
setup-session surface. It does not guess launch configuration, call a runtime
create API, or enable sending. The inline alert links to Agent settings and
keeps Retry focused. After configuration becomes available, Retry carries the
same client id into the normal session-creation owner, so materialization or
selection of an authoritative existing session replaces the setup surface
without a selected-session-null frame.

Setup-session ids use the existing transient `client-session:` namespace and
are removed by the canonical workspace-UI persistence sanitizers, including
visible-session, last-viewed, active-shell, and tab-order state. They count as
the live visible surface for the last-tab invariant, but archive/dismiss owners
reject them before any runtime request.

## Code ownership

- `lib/domain/workspaces/selection` owns session-scoped recovery/setup identity
  types and selection ordering.
- `lib/domain/workspaces/tabs` owns the pure visible-session preservation rule.
- `hooks/workspaces/workflows` owns bounded bootstrap and user recovery actions.
- `stores/sessions/session-selection-store.ts` owns the ephemeral recovery
  state alongside workspace and session selection.
- `components/workspace/chat/surface` owns the inline composer-attached recovery
  presentation.
