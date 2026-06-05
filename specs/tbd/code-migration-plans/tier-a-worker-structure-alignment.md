# Tier A: Worker Structure Alignment

Status: executable migration plan after PR 529 merges.

## Starting Baseline

Start from `main` after PR 529 merges. The worker should already be slot-free:
identity and command correlation use `target_id`, and no live Rust worker code
should reference `slot_generation` or slot guards.

This track is still required because PR 529 removes the old identity layer but
does not reshape the Rust worker into the folder/role model documented by PR 528.
Until this lands, the worker code is behaviorally target-scoped but only
partially aligned with its README/architecture.

Treat this as the first half of the Tier A worker spec realization. It should
create boundaries that can accept the control long-poll / event-tail behavior,
not merely rehouse today's per-endpoint polling loops.

## Docs To Read

- `AGENTS.md`
- `specs/README.md`
- `specs/codebase/structures/proliferate-worker/README.md`
- `specs/codebase/structures/proliferate-worker/architecture.md`
- `specs/codebase/structures/proliferate-worker/guides/clients.md`
- `specs/codebase/structures/proliferate-worker/guides/command-downlink.md`
- `specs/codebase/structures/proliferate-worker/guides/control.md`
- `specs/codebase/structures/proliferate-worker/guides/event-uplink.md`
- `specs/codebase/structures/proliferate-worker/guides/identity.md`
- `specs/codebase/structures/proliferate-worker/guides/inventory.md`
- `specs/codebase/structures/proliferate-worker/guides/lifecycle.md`
- `specs/codebase/structures/proliferate-worker/guides/materialization.md`
- `specs/codebase/structures/proliferate-worker/guides/runtime.md`
- `specs/codebase/structures/proliferate-worker/guides/store.md`
- `specs/codebase/structures/proliferate-worker/guides/tail.md`
- `specs/codebase/structures/proliferate-worker/guides/target-status.md`
- `specs/codebase/structures/proliferate-worker/guides/target.md`

## Intended End State

The worker filesystem should communicate the worker architecture without opening
large files:

- `control/` owns Cloud-down work:
  - `control/commands` owns command downlink mapping, dispatch, result flushing,
    and legacy fallback command delivery.
  - `control/reconcile` or an equivalent submodule owns worker-visible topology,
    exposure refresh hooks, and control cursor state so the later two-poll work
    can land without another folder reshuffle.
- `tail/` owns AnyHarness event tailing and Cloud event uplink. It does not own
  Cloud exposure refresh once that becomes control-driven.
- `lifecycle/` owns heartbeat, update checks, and process lifecycle reporting.
- `inventory/` owns read-only startup capability inventory.
- `materialization/` owns target-local effects: files, Git, auth, runtime config.
- `cloud_client/` and `anyharness_client/` remain raw HTTP clients only.
- `store/` owns local SQLite persistence with no domain orchestration.
- `identity/` owns enrollment and persisted worker identity.
- `runtime.rs` becomes a thin composition root, not a bag of loop logic.

## Owned Files / Surfaces

- `anyharness/crates/proliferate-worker/src/**`
- Worker tests in the same crate
- Ratchets or allowlists that mention old worker paths, if present

## Out Of Scope

- Server control-loop API changes. Those belong to
  `tier-a-worker-control-loop-two-poll.md`.
- Celery/durable server jobs.
- AnyHarness runtime crate restructuring.
- Feature behavior changes in command semantics, event semantics, or auth
  materialization except where a move exposes an existing bug.

## Migration Slices

1. **Inventory and ratchets**
   - Generate a current file/function map.
   - Identify large files and mixed ownership.
   - Add or update any report-only structure checks if useful.
2. **Control extraction**
   - Move command downlink mapping, dispatch, and result flushing under
     `control/commands/**`.
   - Move exposure/reconcile hooks and cursor-ready state under
     `control/reconcile/**` or the ratified equivalent.
   - Keep raw HTTP calls in `cloud_client/**`.
3. **Tail extraction**
   - Move event polling/uplink and projection cursor handling under `tail/**`.
   - Keep worker-visible exposure refresh out of `tail/**` unless the
     control-loop plan explicitly keeps it there.
   - Keep AnyHarness access in `anyharness_client/**`.
4. **Lifecycle extraction**
   - Move heartbeat, self-update, and process status concerns under
     `lifecycle/**`.
5. **Inventory extraction**
   - Move startup capability collection under `inventory/**`.
6. **Runtime composition cleanup**
   - Make `runtime.rs` compose loops and cancellation only.
   - Delete obsolete old module paths after imports move.
7. **Ratchet**
   - Add or tighten checks so new code does not recreate old mixed-owner paths.

## Data / Contract Changes

None expected. This is a structure alignment track. If a required behavior or
wire-contract change is discovered, stop and split it into a separate plan.

## Backward Compatibility And Deletion Plan

Preserve behavior. Delete old files/modules after moving code. Do not leave
duplicate old and new paths.

## Verification

- `cargo check -p proliferate-worker`
- Worker crate tests if available
- Targeted Rust tests for moved command/materialization/store code
- `rg -n "slot_generation|slotGeneration|slot_guard|leased_slot" anyharness/crates/proliferate-worker/src`
  should return no live matches
- Any repo structure checks that cover worker paths

## Risks And Open Questions

- Moving modules can hide behavior changes through import rewiring. Keep slices
  small and run `cargo check` after each major move.
- Coordinate with the control-loop plan so this structure migration creates the
  path shape the control-loop work can land into.
- Do not simply move today's per-endpoint polling into prettier folders. The
  `control/` and `tail/` split must be forward-compatible with one Cloud
  control long-poll and one local AnyHarness event tail.

## Critique Prompts

Plan critique:

```text
Review the worker structure alignment plan. Does it match the worker README and
focused guides? Does it preserve behavior and keep server/control-loop changes
out of scope while still creating `control/commands`, `control/reconcile`, and
`tail` boundaries that can accept the two-poll transport? Are the slices ordered
to minimize import churn and reviewer risk? Return findings first.
```

Implementation critique:

```text
Review the worker structure alignment diff. Look for behavior changes hidden in
moves, duplicate old/new paths, raw HTTP outside clients, SQLite access outside
store, and target-local effects outside materialization. Return findings first.
```
