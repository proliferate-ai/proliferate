# Delivery Spec — PR5b of workflows-gen2 — sdk hooks + trigger courier + dialog (flag OFF)

Parent ADR: "Workflows ADR" (Proliferate Workspace/ADRs/Workflows/Core, frozen custody), High-level-sequencing PR5, client half (5b split RULED by the overnight program).
Base: origin/main 695994a53 (journaled deviation from planned f753e1b15; delta is 2 TS-irrelevant commits).
Branch: codex/workflows-gen2-pr5b-sdk-courier
Status: FROZEN before implementation. Contradictions with the ADR are journaled, never silently resolved.

## Scope

The complete client data layer for workflows gen-2, plus the trigger dialog, all behind a new `workflows_v2`
client flag that ships OFF:

1. Cloud (CP) plane: schema_version-2 definition types (nodes/edges/inputs/docTemplates), invocation PUT with
   `placement`, on the existing cloud sdk workflows client; React Query hooks for definition CRUD + invocation.
2. Runtime plane: TS types for the run/node/doc projections and all `/v1/workflow-runs*` requests, typed on the
   ADR verbatim (camelCase, per the ADR's wire examples); a thin runtime access client; hooks for run PUT,
   run projection GET with polling, runs-for-workspace, and the six node-command mutations
   (approve, fail-redo, type flip, undo-advance, resume, adhoc). PR6 consumes these and adds NO data code.
3. The courier: a pure sequenced workflow (injected deps) — mint invocation id + run id, PUT invocation to CP,
   PUT the returned frozen invocation_json to the runtime, return the run projection. Idempotent by construction
   (both PUTs are idempotent on client-minted ids); safe to re-fire after any partial failure.
4. Trigger dialog: workflow picker (when opened without a definition), one field per declared input
   (required enforced), repo pick defaulting to the definition's default_repo_config_id, placement pick
   (worktree default | repo root), Confirm runs the courier and hands off to the run workspace.
5. `workflows_v2` boolean flag, default OFF; the only reachable surface change under OFF is nothing.

## Non-goals (later rungs own these)

- Run view, graph pane, docs pane, undo toast, resume popover (PR6).
- Builder v2, main page, templates, flag flip ON, intent-spec evolution, t3-wf-1 (PR7).
- Any Rust; any generated-SDK regeneration (restack reconciliation note below).

## Frozen wire contract (from the ADR, the cross-lane authority)

CP plane (existing FastAPI, Bearer):
- GET/POST /v1/workflows, GET/PUT/DELETE /v1/workflows/{id} — definition_json schema_version 2:
  { schemaVersion: 2, nodes: [{ id, type: "agent"|"human_in_loop", title, prompt, model? }],
    edges: [{ from, to }], inputs: [{ name, description, required }],
    docTemplates: [{ slug, producingNodeId, body }] }
- PUT /v1/workflow-invocations/{id} { workflowDefinitionId, arguments, placement: { repoConfigId,
  mode: "worktree"|"repo_root" } } → frozen invocation_json { schemaVersion, workflowDefinitionId,
  definition (verbatim), arguments, placement }; idempotent on id.

Runtime plane (loopback, no auth):
- PUT /v1/workflow-runs/{run_id}  body = the frozen invocation_json → full projection; idempotent (existing id
  → 200 current projection untouched).
- GET /v1/workflow-runs/{run_id} → { run, nodes[], docs[] }
- GET /v1/workflow-runs?workspace_id=...
- POST .../nodes/{node_row_id}/approve {} | .../fail-redo { prompt? } | .../type { nodeType }
- POST .../undo-advance {} | .../resume {} | .../adhoc-nodes { anchorNodeRowId, prompt, model? }
- Every command returns the fresh full projection; errors are ProblemDetails with WORKFLOW_RUN_NOT_FOUND 404,
  WORKFLOW_NODE_NOT_FOUND 404, WORKFLOW_TRANSITION_ILLEGAL 409, WORKFLOW_SNAPSHOT_INVALID 400,
  WORKFLOW_WORKSPACE_MATERIALIZATION_FAILED 503.

Projection shapes (camelCase mirror of the ADR's SQLite columns):
- run: { id, invocationId, definitionJson, argumentsJson, workspaceId,
  status: running|awaiting_human|interrupted|completed|failed, currentNodeRowId, failureCode?,
  interruptionCode?, createdAt, updatedAt, completedAt? }
- node: { id, runId, definitionNodeId?, kind: defined|replacement|adhoc, nodeType: agent|human_in_loop,
  replacesNodeRowId?, anchorNodeRowId?, chainIndex?, title, prompt,
  status: pending|running|needs_attention|awaiting_human|completed|failed, sessionId?, promptId?,
  failureCode?, createdAt, startedAt?, completedAt? }
- doc: { id, runId, slug, filename, producingNodeRowId?, seededFromTemplate, createdAt, updatedAt }

RESTACK NOTE (cross-lane): Lane R's PR5a owns the Rust routes; the generated anyharness sdk
(openapi.json/openapi.ts via `make sdk-generate`) cannot be regenerated in this lane (cargo is Lane R's slot).
PR5b hand-writes these types against the ADR; at the end-of-night restack onto PR5a the shapes are reconciled
against the real contract crate, and any drift is a journaled finding, not silently absorbed.

## Design delta (paths pinned after recon; taxonomy per specs/frontend/*)

- lib/access + hooks/access per access.md: raw calls in the access layer, query keys beside owning hooks,
  access hooks own cache/invalidation exclusively.
- Courier = lib workflow sequence with injected deps + a workflow hook returning a stable callback.
- Dialog = components/<workflows domain>/ composing existing primitives only (ModalShell/dialog kit, Button,
  Input, form primitives); no raw DOM controls; no new visual language.
- Flag read via the existing client flag mechanism, default OFF.

## Tests

Vitest unit (tier 1, merge gate): courier sequence with injected fake deps — happy path, CP-PUT fails (no
runtime call), runtime-PUT fails (retry re-fires both PUTs safely), id stability across retries. Definition v2
type guards / validators used by the dialog (required inputs enforced). Hook query-key shape tests where the
convention demands. Dialog component tests per existing component-test patterns. One negative control per
behavior (e.g. break the courier ordering and watch the ordering test fail; make a required input optional and
watch enforcement test fail). No LLM, no sandbox, no runtime boot.

## Revert

Flag is OFF; plain revert. Nothing reachable changes under OFF.

## Acceptance proof

pnpm typecheck + lint + vitest green in touched packages, scoped by git diff --stat vs base;
report_frontend_structure.py --strict clean; UI-conformance checklist (DESIGN_SYSTEM.md) self-review pass.

## Design delta — PINNED after recon (interface contract for implementation)

Module map (all new unless marked):

CLOUD PLANE (v2 rides beside gen-1; gen-1 untouched under flag OFF):
- cloud/sdk/src/types/workflows-v2.ts — hand-authored v2 wire types (WorkflowDefinitionV2 {schemaVersion:2,
  nodes, edges, inputs, docTemplates}, WorkflowNodeV2, WorkflowInvocationCreateRequestV2 {schemaVersion:2,
  workflowDefinitionId, arguments, placement}, WorkflowInvocationV2 frozen record). Header comment: typed on the
  gen-2 ADR; reconciled against regenerated openapi.ts when server PR2 lands in the chain (restack task).
- cloud/sdk/src/client/workflows-v2.ts — v2-typed wrappers over the SAME endpoints:
  listWorkflowDefinitionsV2/getWorkflowDefinitionV2/createWorkflowDefinitionV2/updateWorkflowDefinitionV2/
  deleteWorkflowDefinitionV2/putWorkflowInvocationV2/getWorkflowInvocationV2; same (args, client, options)
  convention as workflows.ts. Export from cloud/sdk index.
- cloud/sdk-react/src/hooks/workflows-v2.ts — useWorkflowDefinitionsV2Query, useWorkflowDefinitionV2Query,
  useWorkflowDefinitionV2Actions (create/update/delete + invalidation), useWorkflowInvocationV2Actions
  (putWorkflowInvocationV2 mutateAsync). Query keys in cloud/sdk-react/src/lib/query-keys.ts (v2-suffixed keys,
  scoped like the existing ones). Export via cloud/sdk-react/src/index.ts.

RUNTIME PLANE:
- anyharness/sdk/src/types/workflow-runs-v2.ts — hand-authored (ADR-typed, restack-reconciliation header):
  WorkflowRunProjection {run, nodes, docs}, WorkflowRunV2, WorkflowRunNodeV2, WorkflowRunDocV2, statuses as
  string-literal unions, WorkflowRunPutRequest = frozen invocation_json shape, command bodies
  (FailRedoRequest {prompt?}, FlipTypeRequest {nodeType}, AddAdhocNodeRequest {anchorNodeRowId, prompt, model?}),
  WorkflowProblemCode union of the five WORKFLOW_* codes.
- anyharness/sdk/src/client/workflow-runs-v2.ts — class WorkflowRunsV2Client (hand-written fetch, same style as
  sessions.ts): putRun(runId, body), getRun(runId), listRuns(workspaceId?), approve(runId,nodeRowId),
  failRedo(runId,nodeRowId,body), flipType(runId,nodeRowId,body), undoAdvance(runId), resume(runId),
  addAdhocNode(runId, body). Register on AnyHarnessClient in core.ts as workflowRunsV2 + index export.
  NOTE (journaled ADR ambiguity → cross-lane): listRuns treats workspace_id as OPTIONAL (no param = all runs)
  because the resume popover needs interrupted runs across every workspace; PR5a must implement it that way.
- anyharness/sdk-react/src/hooks/workflow-runs.ts — useWorkflowRunQuery(runId) polling 3s while
  run.status is running|awaiting_human (mirror cloud workflows.ts poll-decider shape), useWorkflowRunsQuery
  (workspaceId?), useWorkflowRunMutations(runId) exposing putRun/approve/failRedo/flipType/undoAdvance/resume/
  addAdhocNode with cache write-through of the returned projection (every command returns the fresh projection —
  write it into the run-detail key, no refetch needed). Keys beside existing anyharness keys. Index export.
- DELETE anyharness/sdk/src/workflow-runs.test.ts + workflow-runs.type-test.ts (they pin gen-1 types against
  fixtures/contracts/workflow-portable-execution/v1.json, which dies with gen-1 in Lane R PR1; deleting here
  keeps the chain green in both stack orders). Replace with workflow-runs-v2.test.ts against the new types.

PRODUCT-CLIENT:
- src/lib/domain/capabilities/workflows-v2.ts — export function isWorkflowsV2Enabled(): boolean =
  WORKFLOWS_V2_DEFAULT (false) OR dev-only envFlagEnabled(import.meta.env.VITE_WORKFLOWS_V2, false).
  PR7's final isolated commit flips WORKFLOWS_V2_DEFAULT to true.
- src/domain/workflows/definition-v2.ts — pure v2 domain: token grammar parse (@input:name, @doc:slug →
  parsePromptTokens(prompt) returning ordered segments + refs), validateDefinitionV2(def) returning coded issues:
  edges form exactly one linear path covering all nodes, unique node ids, unique doc slugs, every @input/@doc
  resolves, model optional. Pure, Cloud-SDK-types-only imports (boundary checker).
- src/lib/workflows/trigger/trigger-courier.ts — runWorkflowTrigger(deps, input): mint invocationId + runId
  (crypto.randomUUID, match gen-1 minting convention if one exists), PUT invocation (CP) → frozen record,
  PUT run (runtime) with the frozen invocation_json → projection; returns {runId, invocationId, workspaceId,
  projection}. deps = {putInvocation, putRun, mintId} injected. Pure sequencing, unit-tested with fakes.
- src/hooks/workflows/workflows/use-workflow-trigger-actions.ts — workflow hook returning {trigger, triggering,
  error}; wires courier deps from cloud client + runtime connection (harness-connection-store / desktop bridge
  pattern), navigates to the run workspace on success (caller-provided onLaunched callback).
- src/components/workflows/trigger/WorkflowTriggerDialog.tsx — composes Dialog/ModalShell + existing form
  primitives; props {definition, open, onOpenChange, onLaunched}; per-input fields (required enforced), repo pick
  (reuse the editor's repo-config hook), placement radio worktree|repo_root (worktree default). No raw DOM
  controls, no lucide imports, no new visual language. Component test.

Validation commands (scope = diff): pnpm --filter @proliferate/cloud-sdk typecheck+build, --filter
@proliferate/cloud-sdk-react typecheck, --filter @anyharness/sdk test, --filter @anyharness/sdk-react test,
product-client typecheck + vitest (scoped), python3 scripts/report_frontend_structure.py --strict --summary-only,
python3 scripts/check_frontend_boundaries.py.
