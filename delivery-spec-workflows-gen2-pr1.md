# Delivery specification: Workflows gen-2 PR1 — supersede and ground

Status: frozen delivery specification (governs this PR's delta only).
Source of record: the Workflows gen-2 ADR (Pablo's workspace, `ADRs/Workflows/Core/Workflows ADR.md`),
sections Implementation, Failure modes/tests/observability, and High level sequencing (ladder row PR1).

## Intent

Delete the gen-1 runtime workflow lane whole (code, routes, tests, fixtures) in the same PR that
claims the SQLite table names for gen-2, and land the durable ground layer of the gen-2 engine:
schema, models, store, the pure transition function, `apply_transition`, read projections, the
invariant sweep, and the named-event registrations. Nothing is reachable after this PR: no routes,
no UI, no actors. The gate is deletion-completeness plus a compiling, fully tested ground layer.

## Scope

### Superseded (deleted)

- `anyharness-lib/src/domains/workflows/**` (gen-1 tree: control, dispatch, execution, model,
  portable_service*, portable_validation, resolution, runtime, service, session_extension, store,
  workspace_materialization) — replaced by a fresh gen-2 `domains/workflows`.
- `anyharness-lib/src/api/http/{workflow_runs,workflow_runs_contract,workflow_runs_errors,workflow_workspaces,workflow_workspaces_contract}.rs`
  and their router/openapi registrations.
- `anyharness-lib/src/api/{workflow_runs_tests,workflow_runs_scripted_tests,workflow_runs_portable_contract_tests,workflow_workspaces_tests}.rs`.
- `anyharness-lib/src/persistence/{workflow_run_control_migration_tests,workflow_runs_v2_migration_tests}.rs`
  (the migration functions themselves stay: 0061–0063 are already applied on real databases and are
  raw-SQL, standalone).
- `anyharness-contract/src/v1/{workflow_runs,workflow_runs_v2,workflow_workspaces}.rs` + mod exports.
- `anyharness/sdk/src/{workflow-runs.test.ts,workflow-runs.type-test.ts}`; the generated OpenAPI
  json/ts regenerate without the workflow endpoints.
- `fixtures/contracts/workflow-portable-execution/` (dies with gen-1; the gen-2 run-snapshot fixture
  is PR2's, consumed at PUT-run in PR5a).
- `app/workflows.rs` gen-1 wiring. Session mutation admission survives in sessions core with the
  existing `NoControllerPolicy` injected (gen-2 does not gate session mutations; run sessions are
  ordinary chattable sessions). Gen-1-fixture-dependent test cases in `session_admission_tests.rs`,
  `subagent_http_tests.rs`, and `workspaces/retention_tests.rs` are trimmed or reworked to
  sessions-core fixtures.
- `specs/FEATURE_DOCS/WORKFLOWS.md` gets the supersession banner (full rewrite lands with PR4).

### Grounded (added)

- Migration `0069_workflow_runs_gen2.sql`: drop `workflow_runs`, `workflow_run_steps`,
  `workflow_workspace_materializations`; create the ADR schema verbatim — `workflow_runs`,
  `workflow_run_nodes`, `workflow_run_docs` (UNIQUE(run_id, slug)), plus
  `sessions.workflow_run_id` / `sessions.workflow_node_row_id` (nullable, loose, indexed).
- `domains/workflows/model.rs`: status/kind/code enums, row records, `RenderedEnvelope`,
  DSL v2 types (`nodes/edges/inputs/docTemplates`) with validation (single linear path covering all
  nodes, unique ids and slugs, `@input:`/`@doc:` references resolve, optional per-node model).
- `domains/workflows/transition.rs`: `next(state, event) -> Decision::{Transition, Hold, Illegal}`
  implementing the ADR's 13-row table verbatim; `Transition` carries the row updates plus one
  `SideEffect::{StartNode, DisposeSession, None}`.
- `domains/workflows/store/`: `create_run_with_first_node`, `apply_transition` (one transaction,
  committed before any side effect), `load_run_state`, `stamp_session`, projections (`run_detail`,
  `runs_for_workspace`), doc-registry rows.
- Invariant sweep after every `apply_transition` (debug) and at every actor rebuild (all builds):
  at most one active node per run, `current_node_row_id` consistency, no running node without a
  linked session past the stamp step; violations emit one aggregate
  `anyharness.workflow.invariant_violation` and panic in debug.
- Named events: the nine `anyharness.workflow.*` tracing targets in `observability/mod.rs` and
  their `TargetMapping` registrations in `anyharness/src/telemetry.rs`. No dependency on PR #1847.

## Acceptance

- `cargo test` green across the workspace; zero references to gen-1 workflow symbols remain.
- Exhaustive transition-table tests on the pure function (every table row plus illegal/hold cases).
- Store tests on `Db::open_in_memory()` (real migrations) covering create, transitions, projections,
  idempotent re-PUT semantics at the store level, and the invariant sweep firing on seeded corruption.
- Reverts by plain revert; tables recreate empty on next boot either way.
