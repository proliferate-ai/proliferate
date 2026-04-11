# Workspace Mobility Decision: v1 Support Matrix

Status: accepted

## Decision

Workspace mobility v1 supports moving:

- Claude sessions
- Codex sessions

Workspace mobility v1 does not support moving:

- Gemini sessions
- any future agent kinds without an explicit portability adapter

## Why

Claude and Codex have the cleanest portability model:

- a small number of agent-native session artifacts
- no server-side conversation state
- deterministic local resume mechanics
- known install locations in the target runtime

Gemini is intentionally deferred even though the research shows it is
technically portable. The install path is materially messier:

- project-slug registry management
- more sidecar/state-directory surface
- more install-time path-sensitive restoration behavior

That complexity is not required to ship the core local `<->` cloud mobility
workflow.

## Product behavior

Mobility operates at the workspace level.

- supported sessions are moved
- unsupported sessions are skipped
- skipped sessions remain on their original side
- skipped sessions must be surfaced clearly in preflight and status UI

## Blocking rules

Unsupported sessions do not block handoff merely because they exist.

Unsupported sessions do block handoff when they are actively running.

Concretely:

- idle Gemini session present: do not block; skip it
- running Gemini session present: block handoff

## Implementation consequences

- add a per-agent mobility support matrix in AnyHarness
- preflight must return both:
  - syncable sessions
  - unsupported sessions
- UI confirmation must show the unsupported-session summary before handoff
- source cleanup after success must remove moved supported sessions only

## References

- [session-portability-summary.md](./session-portability-summary.md)
- [session-portability-claude.md](./session-portability-claude.md)
- [session-portability-codex.md](./session-portability-codex.md)
- [session-portability-gemini.md](./session-portability-gemini.md)
