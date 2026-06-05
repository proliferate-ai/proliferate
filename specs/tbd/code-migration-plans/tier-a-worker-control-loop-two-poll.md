# Tier A: Worker Control-Loop / Two-Poll Transport

Status: executable planning target after PR 529 merges, but requires the shared
Redis/wake mini-ratification and a concrete implementation plan before coding.

## Starting Baseline

Start from `main` after PR 529 merges. The code is target-scoped and slot-free,
but the worker may still use separate DB-backed endpoints for idle command
leasing and exposure refresh. This track implements the PR 528 worker transport
shape: one Cloud control long-poll down and one AnyHarness event tail up.

Before coding, record the shared Redis/wake ownership decision from
`post-529-migration-roadmap.md`. If this track owns the pub/sub doorbell, the
worker-tier durable-job plan must conform to that decision. If the worker-tier
substrate owns shared Redis/wake infrastructure, this track must use that
ratified namespace and boundary.

## Docs To Read

- `AGENTS.md`
- `specs/README.md`
- `specs/codebase/primitives/cloud-commands.md`
- `specs/codebase/structures/proliferate-worker/README.md`
- `specs/codebase/structures/proliferate-worker/architecture.md`
- `specs/codebase/structures/proliferate-worker/guides/control.md`
- `specs/codebase/structures/proliferate-worker/guides/event-uplink.md`
- `specs/codebase/structures/proliferate-worker/guides/lifecycle.md`
- `specs/codebase/structures/server/README.md`
- `specs/codebase/structures/server/guides/workers.md`
- `specs/tbd/cloud-worker-control-loop.md`
- `specs/tbd/worker-tier-scalability-rfc.md` for Redis/redbeat coordination only

## Intended End State

- Worker idle state uses a bounded `control/wait` long-poll instead of frequent
  empty command lease and exposure refresh requests.
- Cloud control responses can deliver:
  - a leased command
  - an exposure/projection snapshot change
  - a state-changed cursor advance
  - a timeout
- Cloud does not hold a DB connection while waiting.
- Producers bump target-scoped control state after commits.
- Redis/pubsub or an equivalent doorbell wakes long-poll waiters.
- Doorbell implementation follows the pre-ratified shared Redis/wake ownership
  decision rather than inventing a track-local Redis shape.
- Worker event tail remains local and frequent, but uploads only real event
  batches.
- Existing command lease and exposure endpoints remain only as fallback or
  compatibility during rollout, with a clear deletion plan.

## Owned Files / Surfaces

- `server/proliferate/server/cloud/worker/**`
- `server/proliferate/db/store/cloud_sync/**`
- `server/proliferate/server/cloud/commands/**`
- Exposure/projection stores that change worker-visible topology
- `anyharness/crates/proliferate-worker/src/**` control/tail/cloud client paths
- Desktop native worker launch guard if duplicate workers remain a current issue
- Tests for worker control, commands, event sync, and exposure projection

## Out Of Scope

- Celery/durable job substrate, except for coordinating Redis ownership.
- Full Rust worker folder reshape, unless this plan is run after that reshape and
  lands into the new folders.
- Product command feature changes not needed for transport.

## Migration Slices

1. **Shared Redis/wake ownership slice**
   - Decide and document the doorbell owner, Redis namespace, pub/sub vs redbeat
     relationship, and command-wake/task boundary.
   - Confirm whether control-loop owns pub/sub and worker-tier conforms, or
     durable-job infrastructure owns shared Redis/wake and control-loop conforms.
2. **Contract slice**
   - Finalize request/response models for `/v1/cloud/worker/control/wait`.
   - Define cursor format, timeout semantics, error behavior, and fallback rules.
3. **Server state slice**
   - Add target-scoped worker control state and store helpers.
   - Add after-commit bump helpers for command, exposure, projection, target, and
     auth/runtime-config changes.
4. **Long-poll service slice**
   - Implement wait without holding a DB connection.
   - Subscribe to doorbells, re-open short DB transactions on wake/timeout.
5. **Worker client/control slice**
   - Add client method and worker loop support.
   - Persist returned cursor locally.
   - Fall back only on explicit unsupported responses.
6. **Exposure/event-tail slice**
   - Make exposure reconciliation change-driven from control responses.
   - Keep local AnyHarness tailing independent.
7. **Desktop duplicate-worker guard**
   - Add or tighten cross-process guard if still needed.
8. **Cutover and deletion**
   - Remove or demote legacy high-frequency polling paths after rollout safety is
     proven.

## Data / Contract Changes

Likely additions:

- server model/table for worker target control state
- optional Redis/pubsub channel naming helper
- worker local cursor persistence
- OpenAPI/SDK changes for the worker control endpoint

## Backward Compatibility And Deletion Plan

New workers should try `control/wait` first. Legacy endpoints can remain during
rollout but must be throttled and have a deletion issue/plan. Do not silently
fallback on auth, stale-target, or malformed success responses.

## Verification

- Server worker/control integration tests
- Command lease/result tests
- Exposure projection/event sync tests
- Rust worker tests for cursor persistence and fallback behavior
- `cargo check -p proliferate-worker`
- `cd server && DEBUG=true uv run pytest -q <targeted worker/control tests>`
- Load-oriented smoke or synthetic test showing idle workers do not issue
  high-frequency DB-backed empty polls

## Risks And Open Questions

- Redis ownership overlaps with the worker-tier durable job track. Decide whether
  the same Redis deployment handles redbeat locks, rate limits, and control
  doorbells before implementation, not after this track has baked in a doorbell
  shape.
- Wake jobs are both durable-job work and command-delivery work. Coordinate
  boundaries before implementation.
- Long-poll timeout must stay below client HTTP timeout.

## Critique Prompts

Plan critique:

```text
Review the worker control-loop plan. Does it avoid holding DB connections while
waiting? Are cursor semantics, fallback rules, producer bumps, and Redis
ownership clear? Does it preserve command delivery semantics? Return findings
first.
```

Implementation critique:

```text
Review the control-loop implementation. Look for DB sessions held across waits,
missing after-commit bumps, unsafe fallback on auth/stale-target errors,
duplicate polling paths, and untested cursor/exposure behavior. Return findings
first.
```
