# Workspace Mobility Decision: Agent History Rewriting and Source Cleanup

Status: accepted

## Decision

Workspace mobility v1 does not perform broad transcript/history rewriting.

It only performs targeted rewrite or explicit override when structurally
required for resume mechanics.

After a successful handoff, the source runtime deletes or tombstones moved
supported sessions. Unsupported skipped sessions remain on the source side.

## History rewrite policy

Do not do best-effort global project-root path replacement across historical
transcript content in v1.

Allowed in v1:

- targeted rewrite of structurally active cwd fields if an agent requires it
- explicit runtime cwd override when the agent supports it

Not allowed in v1:

- broad search-and-replace across all stored transcript/tool history
- rewriting arbitrary tool output blobs
- rewriting historical text just to make past paths look cleaner

## Agent-specific implications

Claude:

- no broad transcript rewrite
- install files into the correct target Claude storage location
- historical absolute paths remain as stale history

Codex:

- prefer resume with explicit cwd override
- rewrite only structurally necessary cwd fields if required by the final
  installer path
- do not broadly rewrite the rollout history

Gemini:

- unsupported for mobility v1

## Source cleanup policy

The source-side transition is split conceptually into two parts:

1. source deactivation before owner flip
2. source garbage collection immediately after successful finalize

Before finalize:

- moved supported sessions must stop being runnable on the source side
- source runtime mode must become `remote_owned`

After successful finalize:

- moved Claude/Codex sessions are deleted or tombstoned on the source side
- moved provider-native artifacts are removed with them when appropriate
- unsupported skipped sessions remain on the source side
- source workspace remains in `remote_owned` mode until ownership returns

This is intentionally aggressive.

The source should not retain a second apparently-live copy of moved supported
sessions because that creates:

- session-id collisions on future round-trip
- confusion about which side is real
- accidental resume into stale local state

## Why

The product model is a move, not dual-writer sync.

Deactivating the source before finalize avoids a crash window where ownership
has flipped but the old side still looks like a live resumable copy.

Deleting migrated supported sessions after successful finalize reinforces the
move model and keeps the next handoff simpler.

Likewise, broad history rewriting is too risky for v1. The benefit is lower
than the probability of corrupting vendor-native transcript files.

## References

- [session-portability-claude.md](./session-portability-claude.md)
- [session-portability-codex.md](./session-portability-codex.md)
- [session-portability-summary.md](./session-portability-summary.md)
