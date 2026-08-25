# Delivery Spec: delete-gen1-workflows

Status: frozen delivery specification
Program: cull-sweep (Track B)
Approved: 2026-08-25

Shared rules for all cull-sweep tracks: own worktree + branch, moves never mix
with behavior changes, narrowest proof that establishes the delta, docs updated
in the same PR, commit trailers per repo convention.

## Intent

Delete the gen-1 workflow lane whole. Gen-2 is untouched and remains the
engine.

## Scope

- `workflows/managed.py`, `managed_models.py`, `worker/delivery.py`
- v1 halves of `service.py`/`models.py`/`api.py`
- 5 `workflow_managed_*` stores
- 3 Celery tasks
- `workflow_managed_runs_enabled` flag
- `check_workflow_managed_boundaries.py`
- v1 client paths behind `workflows_v2` flag (4 files) +
  `WorkflowMainLegacyGroup` wiring
- intent-test entries pinning v1
- 12+ lint-exception rows
- SDK regen
- **Rewrite `specs/FEATURE_DOCS/WORKFLOWS.md`** in this PR: banner dies, doc
  describes gen-2 current behavior.

## Non-goals

Gen-2 stays completely untouched — it is the engine the new automation lane
runs on. No route renames, no gen-2 behavior change of any kind.

## Salvage

Before deleting `worker/delivery.py`, write a short note (scratch) of its
delivery/retry shape as server-courier starting material — git history holds
the code.

## Acceptance

- all gen-2 tests green;
- v2 UI flows unaffected;
- `grep -ri "schema_version.*1" server/proliferate/server/workflows/` clean;
- docs checker green.
