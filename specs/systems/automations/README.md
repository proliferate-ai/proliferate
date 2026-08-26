# Automations

The gen-2 Workflow engine: a saved, validated **definition** on the control plane is frozen verbatim into an immutable **invocation** at trigger time, and a **run** executes it on the runtime as a linear chain of nodes, one ordinary session per node. This spec is the system's authority on `main`; the folders still carry the pre-inventory name `workflows` on every plane (see [Known gaps](#known-gaps--follow-ups)). It supersedes [FEATURE_DOCS/WORKFLOWS.md](deep-dive.md), which stays as the narrative reference until it is folded in.

## 1. Purpose

Turn an authored chain of prompts into governed execution without the control plane ever contacting the runtime: the CP validates and freezes, the client couriers, the runtime places and executes. The gen-1 lane (one-prompt runs, managed cloud delivery) was deleted end to end by [delivery-spec-delete-gen1-workflows.md](../../../delivery/cull-sweep/delivery-spec-delete-gen1-workflows.md); its retry shape survives as courier starting material in [notes-gen1-delivery-retry-shape.md](../../../delivery/cull-sweep/notes-gen1-delivery-retry-shape.md).

```text
definition (CP, Postgres)         a saved, validated gen-2 document
  -> invocation (CP, Postgres)    the definition frozen verbatim + arguments
                                  + placement, immutable, replay-exact
  -> run (runtime, SQLite)        multi-node execution on a linear chain,
                                  one session per node, pure transition table
```

## 2. Owned state

Only this system writes these rows.

| Store | Table | Owner module | What it holds |
| --- | --- | --- | --- |
| Postgres | `workflow_definition` | [db/models/workflows.py](../../../server/proliferate/db/models/workflows.py) | personal, revisioned record; the whole `WorkflowDefinitionV2` document in `definition_json`; optimistic `revision`; soft delete. `schema_version` and the legacy `inputs_json`/`stages_json`/`validated_catalog_version` columns predate the single-document shape and are written empty. `default_repo_config_id` is an opaque runtime repo-root id (Ruling A: not an FK, never resolved by the CP). |
| Postgres | `workflow_invocation` | same file | the frozen record: `creation_request_json` (replay identity input) and `invocation_json` (what the courier delivers), plus definition id/revision and title/description snapshots. Rows are never updated after creation. |
| SQLite | `workflow_runs`, `workflow_run_nodes`, `workflow_run_docs` | [domains/workflows/store.rs](../../../anyharness/crates/anyharness-lib/src/domains/workflows/store.rs) | the sole runtime truth for a run: status, effective node chain (`defined`/`replacement`/`adhoc`), per-node session stamps, rendered envelopes, materialized context docs. |
| product storage (client) | `workflow_node_layout` | [use-workflow-node-layout.ts](../../../apps/packages/product-client/src/hooks/workflows/workflows/use-workflow-node-layout.ts) | per-machine card placements, keyed by workflow; never part of the definition. |

Run and node states are the closed vocabularies in [model.rs](../../../anyharness/crates/anyharness-lib/src/domains/workflows/model.rs): run `running | awaiting_human | interrupted | completed | failed | cancelled`; node `pending | running | needs_attention | awaiting_human | completed | failed | cancelled`; failure codes `node_launch_failed | turn_error | refusal | empty_turn | harness_cap | superseded`; interruption codes `user_cancel | app_shutdown | runtime_restarted`.

## 3. Public surface

The only ways in. Everything else is internal.

### Control plane (`/v1`, camelCase, product-user bearer auth)

Served by [workflows/api.py](../../../server/proliferate/server/workflows/api.py), registered from [main.py](../../../server/proliferate/main.py).

```http
GET    /v1/workflows                       list (v2 responses)
POST   /v1/workflows                       create (strict v2 body)            201
GET    /v1/workflows/{id}
PUT    /v1/workflows/{id}                  full replacement + expectedRevision
DELETE /v1/workflows/{id}?expectedRevision= soft delete                        204
PUT    /v1/workflow-invocations/{id}       freeze (201) or replay (200)
GET    /v1/workflow-invocations/{id}       the frozen record verbatim
```

Python callers use exactly the modules the [MANIFEST.toml](../../../server/proliferate/server/workflows/MANIFEST.toml) declares: `workflows.api`, `.service`, `.models`, `.access`. The measured importer set is `main.py` alone.

### Runtime (`/v1`, runtime bearer auth)

Served by [api/http/workflow_runs.rs](../../../anyharness/crates/anyharness-lib/src/api/http/workflow_runs.rs).

```text
GET  /v1/workflow-runs?workspaceId=      list
GET  /v1/workflow-runs/{run_id}          projection (run + nodes + docs)
PUT  /v1/workflow-runs/{run_id}          accept + place + start (idempotent)
POST /v1/workflow-runs/{run_id}/nodes/{node_row_id}/approve
POST /v1/workflow-runs/{run_id}/nodes/{node_row_id}/fail-redo
POST /v1/workflow-runs/{run_id}/nodes/{node_row_id}/type
POST /v1/workflow-runs/{run_id}/undo-advance
POST /v1/workflow-runs/{run_id}/resume
POST /v1/workflow-runs/{run_id}/adhoc-nodes
POST /v1/workflow-runs/{run_id}/cancel
```

### Generated clients

Control plane: [cloud/sdk/src/client/workflows-v2.ts](../../../cloud/sdk/src/client/workflows-v2.ts) and the `workflows-v2` hooks in [cloud/sdk-react](../../../cloud/sdk-react/src/hooks/workflows-v2.ts). Runtime: [anyharness/sdk/src/client/workflow-runs-v2.ts](../../../anyharness/sdk/src/client/workflow-runs-v2.ts) and `@anyharness/sdk-react`.

### The document (`WorkflowDefinitionV2`)

One camelCase JSON blob, validated identically on every plane and pinned by the shared fixtures in [fixtures/contracts/workflow-definition/](../../../fixtures/contracts/workflow-definition):

| Field | Shape | Rule |
| --- | --- | --- |
| `schemaVersion` | the integer `2` | exact integer; strings rejected |
| `nodes` (1–64) | `{id, type: "agent" \| "human_in_loop", title, prompt, model?}` | `model` is a pass-through `{agentKind, modelId?, controlValues?}`; an empty `controlValues` serializes as absent so installed runtimes never see a field the author left out (`document_json()`) |
| `edges` (≤64) | `{from, to}` over real node ids | exactly one linear path covering every node: one head, no branching, no cycles |
| `inputs` (≤64) | `{name, description, required}` | prompts reference inputs as `@input:name`; malformed references are validation errors, not text |
| `docTemplates` (≤64) | `{slug, producingNodeId, body}` | referenced as `@doc:slug`; slugs are lowercase kebab |

Placement never appears in the document — it is a trigger-time binding.

## 4. Consumes

| Dependency | Owner | Used for |
| --- | --- | --- |
| `current_product_user`, session DB | accounts / db infra | route auth and persistence ([access.py](../../../server/proliferate/server/workflows/access.py)) |
| `pg_advisory_xact_lock` | db infra | per-invocation acceptance serialization ([workflow_invocations.py](../../../server/proliferate/db/store/workflow_invocations.py)) |
| `rfc8785` | vendor | canonical replay identity ([domain/invocation.py](../../../server/proliferate/server/workflows/domain/invocation.py)) |
| sessions domain | runtime `sessions` | every node is an ordinary session; `SessionExtension` is the single touchpoint ([session_extension.rs](../../../anyharness/crates/anyharness-lib/src/domains/workflows/session_extension.rs)); the admission gate takes this system's destruction policy ([policy.rs](../../../anyharness/crates/anyharness-lib/src/domains/workflows/policy.rs)) |
| workspaces domain | runtime `workspaces` | placement — `workflow/<runId>` worktrees and repo-root reuse ([workflow_placement.rs](../../../anyharness/crates/anyharness-lib/src/domains/workspaces/workflow_placement.rs), owned by workspaces) |
| harness launch config | harnesses / [agent_auth](../agent_auth/README.md) | a node's `model` pick resolves to the launch config; the app-default harness fills a missing pick ([actor.rs](../../../anyharness/crates/anyharness-lib/src/live/workflows/actor.rs)) |
| repo roots | runtime workspaces | `GET /v1/repo-roots` supplies the ids the trigger dialog freezes into placement |

## 5. Laws

**Control plane governs, runtime executes (Ruling A).** The CP validates and stores documents and freezes invocations; it never resolves placement, models, or repo-root ids — those are runtime-plane meanings stored opaquely (`default_repo_config_id` is not an FK; `placement.repoConfigId` is frozen verbatim). Breaking this couples CP schema to a runtime's local id space.

**Both ids are client-minted and both PUTs are idempotent.** The courier mints the invocation id and the run id before the first request and carries both across retries, so a partial failure replays rather than duplicates ([trigger-courier.ts](../../../apps/packages/product-client/src/lib/workflows/trigger/trigger-courier.ts)).

**Replay identity is RFC 8785 canonical JSON of the creation request.** Same id + equal canonical request → `200` with the stored record; same id + different input → `409 workflow_invocation_conflict`; acceptance runs under a per-invocation advisory lock so racing writers serialize ([service_v2.py](../../../server/proliferate/server/workflows/service_v2.py)). Canonicalization is also the portability gate: non-finite numbers and integers outside the I-JSON safe range are rejected.

**Arguments are validated against the frozen definition.** Every argument names a declared input, every required input has an argument, and every input any prompt references has an argument (`_validate_v2_arguments`). Argument values are redacted from 422 bodies by `main.py`'s validation-error handler.

**Owner-only, non-enumerating.** A definition or invocation owned by someone else answers the same not-found as one that does not exist ([access.py](../../../server/proliferate/server/workflows/access.py)).

**Optimistic revisions are one conditional UPDATE.** Update and delete carry `expectedRevision`; a stale value is a `409 workflow_definition_revision_conflict` that changes nothing, enforced as `UPDATE ... WHERE revision = :expected` in [workflow_definitions.py](../../../server/proliferate/db/store/workflow_definitions.py).

**Validation is identical on every plane.** The runtime re-validates the frozen document with no CP catalog available ([definition.rs](../../../anyharness/crates/anyharness-lib/src/domains/workflows/definition.rs) mirrors [validation_v2.py](../../../server/proliferate/server/workflows/domain/validation_v2.py)); lockstep is proven by the shared `v2-*` fixtures, each invalid one declaring how it must be rejected.

**SQLite rows are the sole runtime truth, advanced by a pure transition table with persist-before-act ordering.** Every state change is a guarded compare-and-set through `WorkflowStore::apply_transition`; the per-run actor only performs side effects a committed row already says ([transition.rs](../../../anyharness/crates/anyharness-lib/src/domains/workflows/transition.rs), [actor.rs](../../../anyharness/crates/anyharness-lib/src/live/workflows/actor.rs)). An illegal command is `409 WORKFLOW_TRANSITION_ILLEGAL` naming the refused command and current state — never a fabricated success.

**At most one effective chain node is active.** Ad-hoc nodes run alongside and are exempt. The invariant sweep ([invariants.rs](../../../anyharness/crates/anyharness-lib/src/domains/workflows/invariants.rs)) panics in debug/tests and emits `workflow.invariant_violation` in release.

**Boot fences nonterminal state.** Before serving HTTP, in-flight runs surface as `interrupted` with an `interruptionCode`; `resume` is the only way back. A silently resumed run would re-launch sessions nobody asked for.

**Terminal runs release their workspaces.** The destruction policy answers "which non-terminal run controls this session" from the rows; completed, failed, and cancelled runs are ordinary destruction candidates again ([policy.rs](../../../anyharness/crates/anyharness-lib/src/domains/workflows/policy.rs)).

**A queued interjection holds the node open.** `on_turn_finished` peeks the durable pending-prompt queue at that instant and reports `queue_empty`; the table answers `Hold` for a clean end-turn with work still queued.

### Behavior by stage

- **Acceptance** (`PUT /v1/workflow-runs/{id}`): re-validate the snapshot,
  resolve placement, insert run + node + doc rows. Existing identical run →
  `200` untouched. Malformed body / unknown repo root → `400
  WORKFLOW_SNAPSHOT_INVALID`; placement conflicting with reality → `409
  WORKFLOW_PLACEMENT_CONFLICT` (zero rows); unresolvable base ref or Git
  failure → retry-safe `503 WORKFLOW_WORKSPACE_MATERIALIZATION_FAILED` (zero
  rows; the client re-PUTs). Caller-visible detail is scrubbed of local paths.
- **Placement**: `worktree` resolves the repo root's default branch to an
  immutable base commit before any effect, creates `workflow/<runId>` at the
  deterministic managed path, and compensates the artifact on failure;
  `repo_root` resolves-or-reuses the registered workspace, stamping
  `Workflow { runId }` provenance only when this call creates it.
- **Execution**: one actor per run, one session per `agent` node in the
  placed workspace. The envelope renderer
  ([render.rs](../../../anyharness/crates/anyharness-lib/src/domains/workflows/render.rs))
  resolves `@input:`/`@doc:` references and prepends the hidden preamble that
  teaches the `.proliferate/context/` docs contract; the materializer
  ([materialize.rs](../../../anyharness/crates/anyharness-lib/src/domains/workflows/materialize.rs))
  writes `NN-slug.md` docs into the workspace. A `human_in_loop` node parks
  the run until approved.
- **Commands** (approve, fail-and-redo, flip type, undo advance, resume, add
  ad-hoc node, cancel) all route through `WorkflowManager` → actor →
  transition table; the HTTP reply is the actor's post-commit projection.

## 6. Emits

Runtime tracing targets, declared in [observability/mod.rs](../../../anyharness/crates/anyharness-lib/src/observability/mod.rs): `anyharness.workflow_run_accepted`, `workflow_run_started`, `workflow_workspace_materialized`, `workflow_transition`, `workflow_transition_illegal`, `workflow_node_launched`, `workflow_node_launch_failed`, `workflow_run_finished`, `workflow_boot_fence`, `workflow_invariant_violation`, `workflow_notification_stale`, `workflow_node_interaction_requested`, `workflow_node_interaction_resolved`, `workflow_interjection_held`.

The control plane emits no named events for definitions or invocations today. The run projection (`GET /v1/workflow-runs/{id}`) is the contract the client run view and the auto-advance toast consume.

## 7. Fences

| Not owned here | Owner | The line |
| --- | --- | --- |
| Session lifecycle, event log, pending-prompt queue | runtime `sessions` ([sessions.md](../sessions/anyharness-sessions.md)) | a node *is* a session; this system observes turn ends through `SessionExtension` and never writes session rows |
| Worktree creation, repo-root registry, destruction | runtime `workspaces` ([workspaces.md](../workspaces/anyharness-workspaces.md)) | `workflow_placement.rs` lives in workspaces; this system supplies the run id and mode |
| Harness selection, credentials, launch options | harnesses / [agent_auth](../agent_auth/README.md) / [MODELS.md](../agent_auth/models.md) | a node's `model` is a pass-through config; resolution is the launcher's |
| In-environment fan-out (subagents, product MCP) | runtime `subagents` | orchestration inside one environment is not an automation; an automation node may *use* subagents like any session |
| Cross-environment spawn, run results, budget envelopes | [runs.md](runs.md) (target) | the CP run record; today the runtime run is the only run object |
| Trigger intake from Slack, webhooks, schedules, API | [api.md](../api/README.md) / product Slack (target) | every source normalizes into one frozen invocation *here*; the intake surfaces are theirs |
| Client orchestration-hook folders named `hooks/<domain>/workflows/` | frontend structure ([hooks.md](../../areas/frontend.md)) | a naming collision, not this system: only the product folders in the code map are Workflows UI |

## 8. Code map

Ordered by how data flows. Every path is owned by this spec unless annotated.

```text
server/proliferate/
├── db/models/workflows.py                      workflow_definition + workflow_invocation tables
├── db/store/workflow_definitions.py            CRUD; conditional-revision UPDATE/soft delete
├── db/store/workflow_invocations.py            advisory lock, global + owner-scoped reads, create
└── server/workflows/
    ├── MANIFEST.toml                           owns / public surface / measured importers
    ├── api.py                                  the two routers (definitions, invocations)
    ├── access.py                               owner-scoped, non-enumerating route dependencies
    ├── models.py                               wire-model bases (strict camelCase, scalar type)
    ├── models_v2.py                            WorkflowDefinitionV2 + invocation request/response
    ├── domain/validation_v2.py                 pure cross-field validation, reference scanner
    ├── domain/invocation.py                    RFC 8785 canonical JSON
    ├── service.py                              list, soft delete, PUT result shape
    ├── service_v2.py                           create/update, invocation freeze + replay
    └── errors.py                               typed error codes

fixtures/contracts/workflow-definition/         v2-full, v2-minimal, run-snapshot-v2, v2-invalid-*

apps/packages/product-client/src/
├── lib/domain/capabilities/workflows-v2.ts     the VITE_WORKFLOWS_V2 kill switch
├── hooks/access/cloud/workflows/               invocation PUT + definitions access
├── lib/workflows/trigger/trigger-courier.ts    the two-plane courier
├── lib/domain/workflows/                       builder authoring/draft/json/validation, trigger
│                                               identity + failure classification, run state
├── domain/workflows/                           definition-v2 model, graph layout, view models
├── hooks/workflows/                            facade (builder, executions, pane), lifecycle
│                                               (auto-advance toast, resume popover), ui, commands
├── hooks/access/anyharness/workflows/          run PUT + resume against the runtime
├── components/workflows/                       builder-v2, canvas, definitions, main, run-view, trigger
├── config/workflows/starter-templates.ts       the four starter templates
├── copy/workflows/                             all Workflows copy
└── pages/WorkflowsPage.tsx                     the authenticated Workflows surface

cloud/sdk/src/client/workflows-v2.ts            generated CP client (+ sdk-react hooks)
anyharness/sdk/src/client/workflow-runs-v2.ts   generated runtime client

anyharness/crates/anyharness-lib/src/
├── api/http/workflow_runs.rs                   route table, PUT acceptance, reads
├── domains/workflows/
│   ├── mod.rs · model.rs                       vocabularies and records
│   ├── definition.rs                           runtime-side document validation
│   ├── store.rs                                the three tables; create_run_with_first_node,
│   │                                           apply_transition, projections
│   ├── transition.rs                           pure table: events × state → Decision
│   ├── invariants.rs                           structural laws; boot-fence sweep
│   ├── render.rs · materialize.rs              envelope rendering; context-doc writes
│   ├── projection.rs                           run + nodes + docs read shape
│   ├── policy.rs                               destruction-policy answer for the admission gate
│   └── session_extension.rs                    launch extras; turn-end notification
├── live/workflows/mod.rs · actor.rs            WorkflowManager registry; per-run actor
└── domains/workspaces/workflow_placement.rs    ← owned by workspaces; consumed here
```

Client folder-fence note: the `workflows_v2` gate defaults ON and `VITE_WORKFLOWS_V2=0` darkens the whole surface without a release.

## 9. Proof

- Server unit: [test_workflow_definition_v2_validation.py](../../../server/tests/unit/test_workflow_definition_v2_validation.py)
  (linear-path, reference grammar, duplicates),
  [test_workflow_invocations.py](../../../server/tests/unit/test_workflow_invocations.py)
  (canonical numbers, argument redaction).
- Server integration (real Postgres):
  [test_workflow_definitions_v2_api.py](../../../server/tests/integration/test_workflow_definitions_v2_api.py)
  (CRUD, revision conflicts),
  [test_workflow_invocations_v2_api.py](../../../server/tests/integration/test_workflow_invocations_v2_api.py)
  (freeze, replay, advisory-lock races, placement pass-through).
- Runtime: `domains/workflows/*_tests.rs` — contract fixtures, definition,
  store, transition, render, materialize — and `live/workflows/{launch,lifecycle}_tests.rs`;
  [policy.rs](../../../anyharness/crates/anyharness-lib/src/domains/workflows/policy.rs)
  carries its own terminal-set tests.
- Client: vitest beside each surface (builder authoring/json/validation,
  trigger identity/failure, run view model, auto-advance toast, resume
  popover, node layout).
- Tier 2 intent: [workflow-definitions.spec.ts](../../../tests/intent/specs/workflow-definitions.spec.ts)
  (definition lifecycle through the real UI/server) and
  [workflow-trigger-seam.spec.ts](../../../tests/intent/specs/workflow-trigger-seam.spec.ts)
  (T2-WF-1: exactly one invocation PUT; the UI survives the runtime PUT failing).

## Failure modes

| Condition | Observed as | Recovery |
| --- | --- | --- |
| Stale `expectedRevision` | `409 workflow_definition_revision_conflict` with expected/current | reload and re-apply |
| Same invocation id, different request | `409 workflow_invocation_conflict` | mint a new id |
| Non-portable argument number | `400 invalid_workflow_invocation` | fix the value |
| Runtime unreachable during the courier's second PUT | client "runtime not connected" copy; invocation already frozen | re-run the trigger with the same two ids (replays) |
| Base ref / Git failure at placement | `503 WORKFLOW_WORKSPACE_MATERIALIZATION_FAILED`, zero rows | re-PUT |
| Command illegal in current state | `409 WORKFLOW_TRANSITION_ILLEGAL` (command + state) | read the projection, act on the real state |
| Runtime restarted mid-run | run `interrupted` / `runtime_restarted` after the boot fence | `resume` |
| Node's harness refuses / empty turn / cap | node `failed` with the mapped failure code; run `failed` | fail-and-redo or add an ad-hoc node |

## Known gaps / follow-ups

Everything the settled architecture adds to this system is a target the code does not yet meet. None of it changes the current laws above.

- [ ] **Name.** The inventory calls this system `automations`; every plane's
      folder and the manifest are still `workflows`, and the client's
      `hooks/<domain>/workflows/` convention collides with the product name.
      Wave-2/3 sweep item — moves never mix with behavior changes.

  > [!decision] PABLO DECIDES: rename folders to `automations` on all planes in
  > Wave 2/3 (recommended — Organization Standard rule 1, and it dissolves the
  > client hook-folder collision), or keep `workflows` as the folder name and
  > let the spec carry the alias.

- [ ] **Triggers other than a human click.** Today the only trigger is the
      client courier. The target adds schedule, webhook (Sentry, support
      intake, GitHub), Slack mention, API call, and agent spawn — all
      normalizing into the same frozen invocation, with external event-id
      dedup because webhook redelivery is the norm. The CP-side freeze
      already has the right shape (canonical identity + advisory lock); what
      is missing is intake and a server courier (the runtime is never
      contacted by the CP today).
- [ ] **Definitions are personal.** Org-shared definitions (the marketplace
      unit) and admin-attached grants at enable-time do not exist;
      `workflow_definition.user_id` is the only scope.
- [ ] **Placement is runtime-local.** `repoConfigId` is a desktop repo-root
      id; task-class cloud placement ([runs.md](runs.md)) needs a placement
      the CP can resolve.
- [ ] **No run record at the CP.** The runtime run is the only run object; the
      CP cannot list, wait on, or cancel a run it did not observe. That is
      the seam [runs.md](runs.md) draws — bucket-4 when it lands.

  > [!decision] PABLO DECIDES: fan-out/DAG stays deferred (recommended —
  > Core Architecture's dial: gen-2 stays linear; orchestration is agent-driven
  > through the spawn API) or the DSL grows branching now.
