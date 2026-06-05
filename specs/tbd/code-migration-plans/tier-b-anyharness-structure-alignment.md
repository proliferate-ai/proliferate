# Tier B: AnyHarness Structure Alignment

Status: executable coordinator wrapper around the existing AnyHarness swarm
draft.

## Starting Baseline

This track is independent of PR 529. Start from latest `main`, read the
AnyHarness structure docs, and preserve behavior unless a swarm explicitly owns
a behavior change.

## Docs To Read

- `AGENTS.md`
- `specs/README.md`
- `specs/codebase/structures/anyharness/README.md`
- Relevant guides under `specs/codebase/structures/anyharness/guides/**`
- Relevant specs under `specs/codebase/structures/anyharness/specs/**`
- Relevant legacy subsystem docs under `specs/codebase/structures/anyharness/src/**`
- Relevant primitives/features for touched code
- `specs/tbd/anyharness-structure-alignment-swarms.md`
- `specs/tbd/structure-alignment-coordinator-model.md`

## Intended End State

AnyHarness code follows the documented structure:

- live runtime code is split by manager, handle, actor, driver, event sink,
  interactions, background work, and replay roles
- durable session/workspace/repo domains are legible by store/service/runtime
  responsibility
- core domains avoid direct product-surface imports
- adapter code owns local capability mechanics
- final topology moves happen after decomposition makes them mechanical

## Owned Files / Surfaces

- `anyharness/crates/anyharness/**`
- `anyharness/crates/anyharness-lib/**`
- `anyharness/crates/anyharness-contract/**` only when a swarm owns contract
  shape
- AnyHarness boundary/max-line/old-path ratchets

## Out Of Scope

- Proliferate Worker Rust crate structure. That is a Tier A worker track.
- Cloud/server control-plane changes.
- Broad product behavior changes not named by an AnyHarness swarm.

## Migration Slices

Use `anyharness-structure-alignment-swarms.md`:

1. Swarm 0: docs truth and ratchets.
2. Swarm 1: live session runtime.
3. Swarm 2: core session domain.
4. Swarm 3: core workspace domain.
5. Swarm 4: core/product coupling.
6. Swarm 5: adapter shape.
7. Later final topology moves once decomposition is mostly mechanical.

Each swarm should be a separate branch/PR or a carefully bounded PR series.

## Data / Contract Changes

Avoid contract changes during pure structure work. If a contract change is
required, split it out with explicit contract doc updates and generation.

## Backward Compatibility And Deletion Plan

Preserve behavior. Delete old paths after moves. Tighten allowlists and old-path
ratchets as debt is removed.

## Verification

- `cargo check` for touched AnyHarness crates
- Targeted Rust tests for moved code
- `python3 scripts/check_anyharness_boundaries.py`
- Max-line/old-path checks when applicable

## Risks And Open Questions

- Final topology moves too early can create huge noisy PRs. Decompose first.
- Core/product coupling seams need careful trait/port design.
- Contract event payloads should stay where docs say they are durable truth.

## Critique Prompts

Plan critique:

```text
Review the AnyHarness structure plan. Does it follow the swarm order, preserve
behavior, avoid premature topology moves, and respect core/product boundaries?
Return findings first.
```

Implementation critique:

```text
Review the AnyHarness structure diff. Look for behavior changes, old/new path
duplicates, product imports in core domains, adapter/domain leakage, contract
churn, and missing Rust checks. Return findings first.
```
