# Workflows

> Superseded as system authority by
> [specs/systems/automations/README.md](README.md)
> (the `automations` system spec). This document is retained as the narrative
> reference until its sections are folded in; where the two disagree, the
> system spec wins.

Read before touching: `apps/packages/product-client/src/**/*workflow*`, `server/proliferate/server/workflows/**`, `anyharness/crates/anyharness-lib/src/domains/workflows/**`, `anyharness/crates/anyharness-lib/src/live/workflows/**`, `anyharness/crates/anyharness-lib/src/domains/workspaces/workflow_placement.rs`

This document describes the current (gen-2, `schema_version` 2) Workflow system across its three planes: the control plane owns definitions and frozen invocations; the client owns authoring, the trigger courier, and the run view; the AnyHarness runtime owns placement and execution. The gen-1 lane (one-prompt runs, portable invocations, run control, managed cloud execution) was deleted end to end — runtime first by the gen-2 ladder, then the server managed-delivery lane, v1 wire shapes, and legacy client surfaces by `delivery/cull-sweep/delivery-spec-delete-gen1-workflows.md`. Git history is the archive; the managed lane's delivery/retry design is summarized in `delivery/cull-sweep/notes-gen1-delivery-retry-shape.md` as courier starting material.

## Mental model

```text
definition (CP, Postgres)         a saved, validated gen-2 document
  -> invocation (CP, Postgres)    the definition frozen verbatim + arguments
                                  + placement, immutable, replay-exact
  -> run (runtime, SQLite)        multi-node execution on a linear chain,
                                  one session per node, pure transition table
```

Delivery between the planes is the **client trigger courier**: the client PUTs the invocation to the control plane, then reconstitutes the frozen snapshot into a run PUT against the local runtime. The server never contacts the runtime to execute a workflow.

- **Control plane governs, runtime executes.** The CP validates and stores
  documents and freezes invocations; it never resolves placement, models, or
  repo-root ids — those are runtime-plane meanings frozen opaquely
  ("Ruling A").
- **Both ids are client-minted and both PUTs are idempotent**, so the courier
  is safely re-runnable after a partial failure as long as a retry reuses the
  same two ids.
- **SQLite rows are the sole runtime truth**, advanced by a pure transition
  table with persist-before-act ordering; the per-run actor only does what a
  committed row already says.

## Definitions (control plane)

A workflow definition is a personal, revisioned record whose payload is one camelCase `WorkflowDefinitionV2` JSON document:

- `nodes` (1–64): `{id, type: "agent" | "human_in_loop", title, prompt,
  model?}`. `model` is a pass-through config
  `{agentKind, modelId?, controlValues?}`; an empty `controlValues` map
  serializes as absent so installed runtimes never receive a field the author
  left out.
- `edges` (≤64): `{from, to}` over real node ids. A savable document has one
  linear path covering every node.
- `inputs` (≤64): `{name, description, required}`. Prompts reference inputs
  as `@input:name` and context docs as `@doc:slug`; sigils are lowercase and
  malformed references are validation errors, not text.
- `docTemplates` (≤64): `{slug, producingNodeId, body}` — the context
  documents the run materializes into the workspace.

Validation is identical in intent on every plane (the runtime re-validates the frozen document with no CP catalog available). Placement never appears in the document — it is a trigger-time binding.

Persistence is the `workflow_definition` Postgres table (definition document in `definition_json`, optimistic `revision` counter, soft delete). The `schema_version` column and the legacy `inputs_json`/`stages_json`/ `validated_catalog_version` columns predate gen-2's single-document shape; gen-2 rows write the legacy columns empty. `default_repo_config_id` is an opaque runtime repo-root id stored shape-only.

API (`server/proliferate/server/workflows/api.py`, camelCase wire):

```http
GET    /v1/workflows                 list (v2 responses)
POST   /v1/workflows                 create (strict v2 body)
GET    /v1/workflows/{id}
PUT    /v1/workflows/{id}            full replacement + expectedRevision
DELETE /v1/workflows/{id}?expectedRevision=
```

Access policy: owner-only, non-enumerating not-found for anyone else, server-owned identity fields. A stale `expectedRevision` is a 409 that changes nothing; the update store is one conditional `UPDATE ... WHERE revision = :expected` — read-then-write without the predicate is invalid.

## Invocations (control plane)

`PUT /v1/workflow-invocations/{id}` freezes the current definition revision, the caller's scalar arguments, and the placement into an immutable record; `GET` returns the frozen record verbatim. The invocation id is a client-minted canonical lowercase UUID supplied in the path only.

- **Replay identity is RFC 8785 canonical JSON** of the creation request:
  whitespace and key order never matter, values always do. Same id + equal
  canonical request replays 200 with the stored record; same id + different
  input is `409 workflow_invocation_conflict`. Acceptance runs under a
  per-invocation `pg_advisory_xact_lock`, so racing writers serialize.
- Canonicalization is also the argument-portability gate: non-finite numbers
  and integers outside the I-JSON safe range are rejected
  (`domains/invocation.py::canonical_json`).
- Arguments must name declared inputs, cover every required input, and cover
  every input any prompt references.
- Placement is `{repoConfigId, mode: "worktree" | "repo_root"}` and is frozen
  **verbatim** — `repoConfigId` is a runtime repo-root id
  (`GET /v1/repo-roots`), not a CP table reference, and the CP never resolves
  it.
- The frozen response (`invocation_json`) is exactly what the courier later
  delivers: `WorkflowInvocationResponseV2.frozen_json()` normalizes the
  document (`document_json()`) so the runtime never receives an
  author-omitted model field.

Argument values are redacted from this route's validation-error responses (`main.py::_validation_error_handler`) — a 422 must not leak argument content.

## Trigger courier (client)

`apps/packages/product-client/src/lib/workflows/trigger/trigger-courier.ts` runs the two-plane placement sequence behind every "run this workflow" affordance:

1. `PUT /v1/workflow-invocations/{id}` (control plane) freezes the snapshot;
2. `PUT /v1/workflow-runs/{run_id}` (runtime plane) is handed a body
   assembled from the frozen record — definition snapshot,
   server-normalized arguments, placement — and materializes the workspace
   and the run.

Both ids are minted before the first request and travel out on success and failure paths alike, so a retry after a partial failure replays rather than duplicates. Failure classification (`lib/domain/workflows/workflow-trigger-failure.ts`) names the plane that failed: control-plane errors carry their typed envelope; a run-stage fetch `TypeError` (nothing answered) renders as "runtime not connected" copy; both planes' coded errors are read through `workflow-run-state.ts::inspectWorkflowCloudError` / `inspectWorkflowRuntimeError` (AnyHarness errors carry RFC 7807 fields under `.problem`).

## Runtime execution

Owner: `domains/workflows` (durable cell) + `live/workflows` (per-run actor) in `anyharness-lib`. SQLite owns three tables — `workflow_runs`, `workflow_run_nodes`, `workflow_run_docs` — and they are the sole truth.

- **Acceptance** (`api/http/workflow_runs.rs`): the PUT re-validates the
  frozen snapshot, resolves placement, and inserts the run + node + doc rows.
  Idempotent on the run id: an existing identical run replays 200 untouched.
  A malformed body or unknown repo-root id is
  `400 WORKFLOW_SNAPSHOT_INVALID`; a placement that conflicts with reality is
  `409 WORKFLOW_PLACEMENT_CONFLICT` (zero rows); an unresolvable base ref or
  Git failure is the retry-safe `503
  WORKFLOW_WORKSPACE_MATERIALIZATION_FAILED` (zero rows — the client may
  simply re-PUT). Caller-visible failure detail is scrubbed of local paths;
  the full error goes to the runtime log.
- **Placement** (`domains/workspaces/workflow_placement.rs`, workspace-owned):
  `mode: "worktree"` resolves the repo root's default branch to an immutable
  base commit OID before any effect, then creates branch
  `workflow/<runId>` at the deterministic managed path; a failing PUT
  compensates the worktree artifact so a retry is genuinely fresh.
  `mode: "repo_root"` resolves-or-reuses the workspace already registered at
  the repo root's path — never a duplicate row — stamping
  `Workflow { runId }` provenance only when this call creates it.
- **Transitions** (`domains/workflows/transition.rs`): a pure table over
  run/node states; every state change is a guarded compare-and-set through
  `apply_transition`, and illegal commands answer
  `409 WORKFLOW_TRANSITION_ILLEGAL` naming the refused command and current
  state.
- **Execution**: the manager (`app` wiring + `live/workflows`) runs one actor
  per run. Each `agent` node executes as one ordinary session in the placed
  workspace: the envelope renderer (`domains/workflows/render.rs`) resolves
  `@input:`/`@doc:` references, prepends the hidden system-instruction
  preamble that teaches the `.proliferate/context/` docs contract, and the
  context materializer (`materialize.rs`) writes the run's docs
  (`NN-slug.md`) into the workspace. `WorkflowSessionExtension`
  (`session_extension.rs`) observes exact session+prompt completion and
  schedules the durable transition; a `human_in_loop` node parks the run
  until approved.
- **Boot fence**: on startup, before serving HTTP, the invariant sweep fences
  nonterminal state — in-flight runs surface as interrupted (with an
  `interruptionCode`) rather than silently resuming; the resume command is
  the explicit way back.

Runtime API (`/v1`, ordinary bearer auth):

```text
GET  /v1/workflow-runs?workspaceId=      list
GET  /v1/workflow-runs/{run_id}          projection (run + nodes + docs)
PUT  /v1/workflow-runs/{run_id}          accept + place + start
POST .../approve-node · fail-redo-node · flip-node-type · undo-advance
     · resume · add-adhoc-node · cancel
```

## Client surfaces

All Workflows UI ships behind the `workflows_v2` gate (`lib/domain/capabilities/workflows-v2.ts`): the compiled-in default is ON and `VITE_WORKFLOWS_V2` is the runtime kill switch ("0" forces the whole surface dark without cutting a release).

### Index and authoring

The authenticated Workflows surface lists saved schema-v2 definitions and runtime executions; creation starts from a blank workflow or one of the four starter templates. Definition Run continues through the trigger courier and opens the exact workspace.

The builder has a fixed palette rail, deterministic graph canvas, and inspector. The draft owns explicit real-node `edges`; the editor-only Input sentinel connects to the unique head and is never serialized. New nodes start detached, removing a node removes only incident edges, and moving a node changes display order without rewiring. Save requires a workflow title, a title and a prompt on every step, one linear path covering every node, and an Input-to-head connection, in addition to the definition, reference, launch-intent, and repository rules — the same set the control plane and the runtime enforce, so a savable draft is one every plane accepts. Every gate that holds Save down is stated on the surface: definition issues against the step that owns them, and the workflow title and unapplyable JSON as their own banners. Canvas Backspace/Delete removes the selected node or document, while Cmd/Ctrl+Z and Shift+Cmd/Ctrl+Z undo and redo the whole draft outside editable controls.

Cards are placed by hand: dragging a card body moves it under the pointer at any zoom, arrow keys nudge a focused card by the grid pitch, and edges are redrawn from wherever the cards now sit. A card that has not been moved keeps its rank in the deterministic layout, so placement is an override of that layout and never a replacement for it. Placements are local to the machine and keyed by workflow (`workflow_node_layout` in product storage): they are not part of the definition — the document is sealed and frozen into every invocation — and two people can arrange the same chain differently. A draft holds its arrangement in memory and adopts it under the new id at the first save.

The JSON tab edits only the camelCase `WorkflowDefinitionV2` document. Title, description, and default repository stay in the record envelope. Valid JSON is applied atomically to the graph; malformed, semantically invalid, or unknown-field JSON keeps the last valid graph, retains its editor text, and blocks Save. Format prettifies the valid document and Revert restores the graph's current document, which the tab also re-seeds from on every reopen unless it holds unparseable text the author typed.

### Run view and lifecycle

The run view is the existing workspace view plus a right-panel "workflow" tool: a graph pane over the run's nodes and a docs pane over its context documents, with the run commands (approve, fail-and-redo, flip node type, undo advance, add ad-hoc node, cancel) as controls. Auto-advance announces a newly started node with an undoable toast, keyed on the started row plus its `startedAt` instant so a poll re-delivering an already-announced advance stays silent. The resume popover surfaces interrupted (parked) runs; its dismissals are per browser session and keyed `{runId: updatedAt}` so a run interrupted again after a resume is a new, unanswered interruption. Data comes from the runtime SDK hooks (`@anyharness/sdk-react`); the Cloud SDK v2 module (`cloud/sdk/src/client/workflows-v2.ts`) and `@proliferate/cloud-sdk-react/hooks/workflows-v2` own the control-plane half.

## Proof

- Server: `server/tests/unit/test_workflow_definition_v2_validation.py`,
  `test_workflow_invocations.py` (canonical numbers, argument redaction);
  `server/tests/integration/test_workflow_definitions_v2_api.py`,
  `test_workflow_invocations_v2_api.py` (real-Postgres CRUD, freeze, replay,
  advisory-lock races, placement pass-through).
- Runtime: `domains/workflows/*_tests.rs` (contract fixtures, transitions,
  rendering, materialization, stores) against
  `fixtures/contracts/workflow-definition/v2-*.json` — every
  `v2-invalid-*` fixture declares how it must be rejected.
- Client: vitest suites beside each surface;
  `fixtures/contracts/workflow-definition/v2-full.json` is the shared
  cross-language document.
- Tier 2 intent: `tests/intent/specs/workflow-definitions.spec.ts`
  (definition lifecycle through the real UI/server) and
  `workflow-trigger-seam.spec.ts` (T2-WF-1: exactly one invocation PUT, and
  the UI survives the runtime-plane PUT failing).
