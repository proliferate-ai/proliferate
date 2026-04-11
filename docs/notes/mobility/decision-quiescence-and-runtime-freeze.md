# Workspace Mobility Decision: Quiescence and Runtime Freeze

Status: accepted

## Decision

Workspace mobility handoff is allowed only when the source workspace is
quiescent enough to export a stable snapshot.

When handoff starts, the source runtime enters a durable frozen mode and must
reject all workspace-scoped mutations until the handoff either finalizes or
fails.

## Quiescence rules

Handoff must be blocked when any session in the workspace is actively running.

Blocked conditions:

- any session status is actively running or mid-turn
- any pending approval is unresolved
- any queued pending prompt exists
- any workspace setup execution is currently running

Not blocked by themselves:

- open terminals
- existing background processes unrelated to live session execution
- unsupported sessions that are idle

Blocked even when unsupported:

- unsupported sessions that are actively running

This preserves the invariant that no live session execution is allowed to race
with export.

## Freeze rules

Once the server starts a handoff operation, desktop must set the source
AnyHarness workspace into a durable `frozen_for_handoff` mode.

That mode should survive runtime restart.

While frozen, AnyHarness must reject all workspace-scoped mutators through one
central gate.

Mutators that must be blocked:

- session prompt / cancel / config / close / dismiss / restore / approval resolution
- file writes
- git stage / unstage / rename / commit / push
- process launches that mutate workspace state
- terminal create / input / resize / destroy
- setup execution
- worktree creation
- ACP background work that can still append durable session state

Read-only APIs remain available.

## Implementation shape

Own the gate in the runtime, not in transport handlers.

Recommended runtime pieces:

- `workspaces/access_store.rs`
  - durable workspace access mode row
- `workspaces/access_service.rs`
  - `assert_can_mutate(workspace_id)`
  - `set_workspace_runtime_mode(workspace_id, mode, handoff_op_id)`

Recommended modes:

- `normal`
- `frozen_for_handoff`
- `remote_owned`

All mutating flows should go through that gate rather than each endpoint having
its own bespoke mobility check.

## Why

UI-only disable is insufficient.

- desktop can crash
- local runtime can restart
- ACP actors can still mutate after a UI disable unless the runtime itself owns
  the guard

The only reliable model is:

- server owns handoff phase truth
- AnyHarness owns local mutation enforcement

## References

- [docs/anyharness/README.md](/Users/pablo/proliferate-workspace-mobility-plan/docs/anyharness/README.md)
- [docs/anyharness/src/acp.md](/Users/pablo/proliferate-workspace-mobility-plan/docs/anyharness/src/acp.md)
- [docs/anyharness/src/workspaces.md](/Users/pablo/proliferate-workspace-mobility-plan/docs/anyharness/src/workspaces.md)
