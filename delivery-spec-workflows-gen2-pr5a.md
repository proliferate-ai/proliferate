# Delivery spec — workflows gen-2 PR5a: the /v1/workflow-runs HTTP API

Frozen before implementation. Spec of record: the Workflows ADR (Core), API
table lines "Runtime plane" and the failure-code table. Base: PR4
(`codex/workflows-gen2-pr4-actor-and-extension`, #1883). This is the last
runtime rung; Lane C restacks its client chain onto this branch.

## Cross-lane wire contract (binding)

Lane C (PR5b #1877) hand-authored `anyharness/sdk/src/types/workflow-runs-v2.ts`
and the courier reconstitutes the PUT body from PR2 #1876's flat invocation
response. PR5a's wire shapes match those TS types FIELD-FOR-FIELD:

- **PUT body** = the reconstituted invocation snapshot, exactly
  `{ schemaVersion, workflowDefinitionId, definition, arguments, placement }`
  (camelCase; `placement = { repoConfigId, mode: "worktree" | "repo_root" }`).
  This is the runtime's existing `InvocationSnapshot` shape. Unknown extra
  fields (e.g. the CP record's `id`, `title`, `definitionRevision`,
  `createdAt` if a future courier sends the record verbatim) are tolerated
  and ignored — except `id`, which when present becomes the run row's
  `invocation_id`.
  - **Journaled gap**: Lane C's courier does NOT send the invocation id, but
    `workflow_runs.invocation_id` is non-null. Ruling: `invocation_id`
    falls back to the run id when the body carries no `id`. Flagged for the
    morning review (one-line courier fix OR the fallback stands).
- **Projection** (every read and every command response) =
  `{ run, nodes[], docs[] }` per the ADR API table:
  - `run`: the row, camelCase, RAW `definitionJson`/`argumentsJson` strings,
    nullable fields serialized as explicit `null` (TS `string | null`, not
    optional).
  - `nodes[]`: row mirror incl. `runId` and `promptId`, explicit nulls.
  - `docs[]`: row mirror incl. `runId`, explicit nulls.
  - This REPLACES the PR1-era flat `RunProjection` (parsed definition, no
    promptId, skip-null serialization) — that shape predates the ADR API
    table's `{ run, nodes[], docs[] }` and never shipped to a client.
- **List** = `{ runs: WorkflowRun[] }` (Lane C's guessed envelope, kept so
  the restack needs zero reconciliation). `workspace_id` query param
  optional: absent lists all runs.

## Endpoints (all under the existing /v1 router, same auth as siblings)

| Route | Effect | Errors |
| --- | --- | --- |
| PUT /v1/workflow-runs/{run_id} | parse+revalidate snapshot; existing run → ensure actor + return projection untouched (200); else resolve placement → ensure workspace → materialize context (docs + exclude) → one-tx row insert → spawn actor/start node 1 → projection (201) | 400 WORKFLOW_SNAPSHOT_INVALID (parse or validate), 503 WORKFLOW_WORKSPACE_MATERIALIZATION_FAILED (placement/workspace/materialize; zero rows inserted, retry-safe) |
| GET /v1/workflow-runs/{run_id} | projection from rows (no actor) | 404 WORKFLOW_RUN_NOT_FOUND |
| GET /v1/workflow-runs?workspace_id= | { runs } from rows | — |
| POST .../nodes/{node_row_id}/approve | ApproveGate | 404 run / 404 node / 409 |
| POST .../nodes/{node_row_id}/fail-redo | FailAndRedo { prompt? } | 404 / 404 / 409 |
| POST .../nodes/{node_row_id}/type | FlipType { nodeType } | 404 / 404 / 409 |
| POST .../undo-advance | UndoAdvance | 404 / 409 |
| POST .../resume | Resume | 404 / 409 |
| POST .../adhoc-nodes | AddAdhocNode { anchorNodeRowId, prompt, model? } | 404 / 404 (anchor) / 409 |

Every command returns the fresh full projection. ProblemDetails codes:
WORKFLOW_RUN_NOT_FOUND 404, WORKFLOW_NODE_NOT_FOUND 404 (node command routes,
checked against the run's node rows before dispatch),
WORKFLOW_TRANSITION_ILLEGAL 409 (manager `Illegal`; detail names the state and
command), WORKFLOW_SNAPSHOT_INVALID 400,
WORKFLOW_WORKSPACE_MATERIALIZATION_FAILED 503.

## PUT placement resolution (ADR-silent points, boring rulings, journaled)

- `placement.repoConfigId` resolves as the runtime repo-roots row id
  (`RepoRootService::get_repo_root`). The runtime has no CP lookup; the
  courier owns sending a runtime-resolvable id. Unknown id → 503
  WORKFLOW_WORKSPACE_MATERIALIZATION_FAILED (retry-safe, nothing inserted).
- `mode: worktree` → the surviving gen-1 seam:
  `WorkspaceRuntime::resolve_workflow_placement` +
  `ensure_workflow_workspace` (`RepositoryWorktree { run_id, repo_root_id,
  base_ref }`), deterministic `<managed-root>/workflows/<run_id>`, branch
  `workflow/<run_id>`, fail-closed adoption. `base_ref` = the repo root's
  `default_branch`, falling back to `HEAD`.
- `mode: repo_root` → the workspace at the repo root's own path via the
  ordinary create/resolve seam (idempotent at an existing path).
- Disk before rows: context docs are PLANNED pre-insert (the pure
  `doc_filename` law over the validated chain), materialized with the
  exclude entry, and only then does `create_run_with_first_node` run — a
  workspace or disk failure leaves zero rows (the 503 contract). The store
  mints the same filenames from the same law.

## Deliverables

1. `domains/workflows/projection.rs` reworked to the ADR wire shape
   (`RunProjection { run, nodes, docs }`, explicit nulls, `runId`/`promptId`
   included; `RunSummary` replaced by the full run view for the list route).
   ToSchema derives on projection + definition/snapshot types for OpenAPI.
2. `materialize_context` consumes planned `(slug, filename)` docs so PUT can
   materialize before any row exists (store tests keep the record-based
   call path working through a thin adapter or call-site update).
3. `api/http/workflow_runs.rs` (+ `workflow_runs_contract.rs` if mapping
   warrants it): the nine routes, ApiError mappings above, blocking-pool
   for store/workspace work per house `run_blocking` pattern.
4. Router + `api/openapi.rs` registrations.
5. SDK regen: `npm run generate` in `anyharness/sdk` (openapi.json +
   src/generated/openapi.ts are checked in), committed.

## Tests (tier-1, house tower-oneshot pattern, real AppState + scripted agent)

- PUT happy path: 201, projection carries running node 1, workspace exists
  on disk with `.proliferate/context/*` and the exclude entry; replay PUT →
  200 identical projection, no second workspace, no duplicate rows.
- PUT invalid snapshot (broken reference) → 400 WORKFLOW_SNAPSHOT_INVALID,
  zero rows (GET 404).
- PUT unknown repoConfigId → 503 WORKFLOW_WORKSPACE_MATERIALIZATION_FAILED,
  zero rows.
- GET unknown run → 404 WORKFLOW_RUN_NOT_FOUND; list envelope `{ runs }`
  filters by workspace_id.
- Command routes: approve advances a parked gate (projection shows it);
  approve on a running agent node → 409 WORKFLOW_TRANSITION_ILLEGAL naming
  state+command; unknown node_row_id → 404 WORKFLOW_NODE_NOT_FOUND; unknown
  run on a command → 404 WORKFLOW_RUN_NOT_FOUND.
- Wire-shape pin: serialized projection JSON asserts camelCase keys,
  explicit nulls, and raw `definitionJson` string round-trip — the
  field-for-field contract with Lane C's TS types.
- One negative control: sabotage the 409 mapping (map Illegal → 200) and
  watch the illegal-approve test fail; restore.

Out of scope: any client/SDK hand-written TS (Lane C owns reconciliation on
restack), MCP surfaces, list pagination, auth changes.
