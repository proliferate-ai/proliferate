# Workflows

Status: current gen-2 owner contract

Read before touching Workflow definitions, invocations, runs, workspace
placement, context documents, or the Workflow UI:

- `server/proliferate/server/workflows/**`
- `anyharness/crates/anyharness-lib/src/domains/workflows/**`
- `anyharness/crates/anyharness-lib/src/live/workflows/**`
- `anyharness/crates/anyharness-lib/src/api/http/workflow_run*.rs`
- `apps/packages/product-client/src/**/*workflow*`

This document owns the cross-plane Workflow contract. The control plane stores
reusable definitions and freezes invocations. ProductClient delivers each
frozen invocation to the selected runtime. AnyHarness places a workspace and
executes the run as a linear chain with one ordinary, chattable session per
active node. SQLite rows are the sole runtime truth; live actors are
reconstructible execution machinery.

## Current gen-2 authoring experience

The authenticated Workflows surface keeps the production shell and routes. Its
index lists saved schema-v2 definitions, legacy delete-only definitions, and
runtime executions; creation starts from a blank workflow or one of the four
starter templates. Definition Run continues through the existing Cloud
invocation/runtime courier and opens the exact workspace. The workspace
right-panel run pane is unchanged.

The schema-v2 builder has a fixed palette rail, deterministic graph canvas,
and inspector. The draft owns explicit real-node `edges`; the editor-only Input
sentinel connects to the unique head and is never serialized. New nodes start
detached, removing a node removes only incident edges, and moving a node changes
display order without rewiring. Save requires a workflow title, a title and a
prompt on every step, one linear path covering every node, and an
Input-to-head connection, in addition to the definition, reference, catalog,
and repository rules — the same set the control plane and the runtime enforce,
so a savable draft is one every plane accepts. Every gate that holds Save down
is stated on the surface: definition issues against the step that owns them,
and the workflow title and unapplyable JSON as their own banners. Canvas
Backspace/Delete removes the selected node or document, while Cmd/Ctrl+Z and
Shift+Cmd/Ctrl+Z undo and redo the whole draft outside editable controls.

Cards are placed by hand: dragging a card body moves it under the pointer at
any zoom, arrow keys nudge a focused card by the grid pitch, and edges are
redrawn from wherever the cards now sit. A card that has not been moved keeps
its rank in the deterministic layout, so placement is an override of that
layout and never a replacement for it. Placements are local to the machine and
keyed by workflow (`workflow_node_layout` in product storage): they are not
part of the definition — the document is sealed and frozen into every
invocation — and two people can arrange the same chain differently. A draft
holds its arrangement in memory and adopts it under the new id at the first
save.

The JSON tab edits only the camelCase `WorkflowDefinitionV2` document. Title,
description, and default repository stay in the record envelope. Valid JSON is
applied atomically to the graph; malformed, semantically invalid, or
unknown-field JSON keeps the last valid graph, retains its editor text, and
blocks Save. Format prettifies the valid document and Revert restores the
graph's current document, which the tab also re-seeds from on every reopen
unless it holds unparseable text the author typed.

This current behavior explicitly supersedes the older PR7 delivery-spec rules
that treated graph editing as a non-goal and rebuilt edges from array order.
There is no schema, API, database, runtime, or run-pane change in this UI
migration.

## Mental model

```text
Server / Postgres               ProductClient                 AnyHarness / SQLite

definition v2  ──PUT invocation──► frozen invocation ──PUT run──► workflow_runs
  nodes + edges                    snapshot + ids               workflow_run_nodes
  inputs + docs                    same ids on retry             workflow_run_docs
                                                                    │
                                                                    ▼
                                                          WorkflowManager
                                                            one actor/run
                                                                    │
                                                                    ▼
                                                          one session/node
```

The control plane never owns gen-2 execution progress. The runtime never
refetches a mutable definition from the control plane. The courier is the seam:
it takes the server-frozen snapshot and hands it unchanged to the runtime.

## Definitions and invocation snapshots

Schema-version 2 definitions contain:

- a non-empty set of `agent` or `human_in_loop` nodes with unique ids;
- edges forming exactly one linear path covering every node;
- declared scalar inputs;
- optional per-node `{ agentKind, modelId?, modeId? }` selections; and
- document templates with unique lowercase-kebab slugs and a declared
  producing node.

Prompts may refer to `@input:name` and `@doc:slug`. Validation scans the
reference syntax, rejects malformed or wrong-case sigils, and requires every
reference, edge endpoint, and producing node to resolve. Placement is not part
of the definition. The same fixtures under
[`fixtures/contracts/workflow-definition/`](../../fixtures/contracts/workflow-definition/)
exercise the Python, Rust, and TypeScript validators.

The server owns create, list, read, optimistic full-replacement update, and
soft-delete for definitions. Existing schema-version 1 rows remain visible as
delete-only legacy definitions; they cannot be edited or launched through the
gen-2 surface.

`PUT /v1/workflow-invocations/{invocationId}` accepts a client-minted id, the
definition id, arguments, and placement. It validates argument names and
required/referenced inputs, freezes the current definition and revision, and
persists canonical request identity. Repeating the id with the same body
returns the same invocation; a different body conflicts. The frozen record
contains the exact definition document, normalized arguments, and placement
used by execution.

## Courier and placement

ProductClient's `runWorkflowTrigger` mints the invocation and run ids before
performing either request:

1. PUT the invocation to the control plane.
2. Build the runtime request from the returned frozen record, never from the
   mutable editor input.
3. PUT the run to the selected AnyHarness runtime.

A failure carries both ids back to the caller. Retrying unchanged input reuses
both ids; editing inputs or placement requires new ids. This makes ambiguity at
either PUT recoverable without creating a second logical run.

AnyHarness validates the delivered snapshot and resolves placement before
creating run rows. Repository mode resolves the selected repo root to an
immutable base OID and a deterministic `workflow/<runId>` branch/worktree.
Repo-root mode adopts the resolved checkout. Scratch placement creates an
internal blank repository. The runtime owns these placement facts; the control
plane treats placement ids as opaque.

Placement, the workspace record, the shared Git exclude entry, and
`.proliferate/context/` files are materialized before run rows. If this phase or
the later insert fails, a newly created placement is compensated so an exact
retry starts clean. A workspace may host at most one non-terminal Workflow run;
the store rechecks that invariant in the insert transaction.

## Durable runtime truth

The runtime owns three table families:

| Table | Owns |
| --- | --- |
| `workflow_runs` | Invocation/definition/argument snapshots, workspace, run status, current node, failure/interruption codes, timestamps |
| `workflow_run_nodes` | Defined, replacement, and ad hoc node rows; chain position; prompt/envelope; node status; linked session and prompt ids |
| `workflow_run_docs` | Per-run slug registry, deterministic filename, producing node, template origin, timestamps |

Creation writes the run, all defined node rows, and document-registry rows in
one SQLite transaction. `workflow_run_docs` is unique on `(run_id, slug)`.
Sessions carry nullable `workflow_run_id` and `workflow_node_row_id` columns so
turn reports can return to the owning run without making the session actor know
Workflow policy.

The stored `RenderedEnvelope` is the re-creatable unit for launch, retry, and
resume. It resolves frozen inputs and registered documents to their real
workspace-relative paths, and carries the fixed Workflow context preamble as
wrapped instruction blocks. The envelope is persisted before session launch.

## State transitions and execution

`transition::next(state, event)` is pure. It returns a transition, a hold, or
an illegal result. `WorkflowStore::apply_transition` persists the chosen row
changes atomically before the live layer performs any side effect. The main
events are API commands, completed-turn reports, boot fencing, and node-launch
failure.

The chain supports:

- normal agent completion and automatic advance;
- a human node parking at `awaiting_human` until approval;
- changing an active node between agent and human-in-loop behavior;
- fail-and-redo through a replacement row while retaining the failed row;
- undoing a just-started advance and disposing the younger session;
- recoverable interruption and explicit resume;
- cancellation of the chain and any running ad hoc nodes; and
- ad hoc nodes anchored beside the chain without advancing or blocking it.

Run status is one of `running`, `awaiting_human`, `interrupted`, `completed`,
`failed`, or `cancelled`. Node status is `pending`, `running`,
`needs_attention`, `awaiting_human`, `completed`, `failed`, or `cancelled`.
Refusal, empty turns, harness caps, turn errors, and launch failures use bounded
node failure codes; user cancellation, app shutdown, and runtime restart use
bounded interruption codes.

Every defined node executes in its own ordinary session. Workflow sessions
remain chattable; a queued user interjection completes before the chain can
advance. A clean turn advances only when the session's pending queue is empty.
Stale turn reports are ignored rather than moving a row the run has already
left.

## Live actor ownership

`WorkflowManager` owns the run-id-to-actor registry and is the only command
door. Each `WorkflowActor` serializes commands and turn notifications for one
run. The actor loads its state from SQLite, persists the transition, updates
its cache, then performs the resolved session effect. Commands receive the
fresh rows-backed projection through a oneshot; turn reports notify without
blocking the session actor.

No durable truth lives in the manager or actor registry. A registry miss for an
existing run rebuilds an actor from rows. Racing rebuilds recheck the registry
under the lock so only one actor wins. The bounded command mailbox supplies
backpressure; session notifications use the separate notification channel.

The one launch rule is a current `running` node without a linked session. The
actor creates a persisted session, links the Workflow columns, stamps the node,
starts the session, and sends the stored envelope. A failure before a working
session exists compensates the half-born session and records a bounded launch
failure. A failure after dispatch may represent a live turn, so recovery is
left to the turn report or boot fence rather than guessing.

## Restart, recovery, and idempotency

App construction runs the boot fence before the manager can accept a command.
Every row that claims live execution is parked durably: running chain or ad hoc
nodes become `needs_attention`, and a running run becomes `interrupted` with
`runtime_restarted`. A run already waiting at a human gate keeps that durable
gate. The fence is idempotent and logs per-run failures without blocking the
rest of application boot.

Resume is always an explicit user choice. It runs the current node again in a
fresh session in the same workspace and resends the stored envelope. Because
rows, not actors, own status and context, manager eviction or process restart
does not lose the run's meaning.

Exact replay rules:

- server invocation PUT: same id plus canonical body returns the frozen row;
  different body conflicts;
- runtime run PUT: an existing run id returns its current projection untouched
  and reconstructs the actor if necessary;
- transition holds make duplicate or stale events harmless;
- invariant sweeps reject or report impossible row combinations instead of
  repairing them by inference.

## API and client ownership

The control plane owns definition and invocation routes under `/v1/workflows`
and `/v1/workflow-invocations`. Gen-2 invocations do not enter the legacy
managed-execution delivery lane; the client courier owns delivery.

AnyHarness owns:

- `PUT /v1/workflow-runs/{runId}`
- `GET /v1/workflow-runs/{runId}`
- `GET /v1/workflow-runs?workspace_id=...`
- node approve, fail-redo, and type commands
- run undo-advance, resume, cancel, and add-ad-hoc-node commands

Every command returns a fresh full projection. Invalid snapshots are 400,
missing runs/nodes are 404, illegal transitions or placement occupancy are
409, and materialization failure is 503. The AnyHarness generated SDK and
React hooks own this wire surface and cache write-through.

ProductClient owns the builder, trigger dialog/courier, main definitions and
executions page, run graph/docs panes, exact-session navigation, resume
popover, and the temporary `VITE_WORKFLOWS_V2` kill switch. The compiled
default is enabled; explicit `0` disables the surface without changing stored
data. Context documents open through the ordinary workspace file editor at
`.proliferate/context/<filename>` rather than a second document store.

## Failure and observability

Rows retain bounded failure and interruption codes; raw provider responses,
prompts, arguments, document bodies, credentials, and transcript content do
not belong in telemetry. Stable targets in the `anyharness.workflow_*` family
cover acceptance, workspace materialization, node start/completion, transition
illegality, invariant violation, interruption, and completion. Renderer
diagnostics carry only operational ids and bounded stage classifications.

The invariant sweep checks the row laws after transitions in debug builds and
whenever an actor is reconstructed in every build. Material invariants include
at most one active chain node, a consistent `current_node_row_id`, and no
long-lived running node without its linked session.

## Current proof

- Server definition/invocation validation and CRUD/invocation integration
  tests cover both v2 success and rejection, frozen snapshot identity,
  optimistic revision conflicts, and v1 compatibility.
- `definition_tests.rs` and `contract_fixture_tests.rs` consume the shared v2
  fixtures on the runtime plane.
- `transition_tests.rs` enumerates the pure transition table, holds, and
  illegal cases.
- `store_tests.rs` uses real AnyHarness SQLite migrations for creation,
  idempotent PUT state, transitions, projections, cancellation, fencing, and
  corruption detection.
- `materialize_tests.rs` and `render_tests.rs` cover real filesystem context
  placement and frozen envelope rendering.
- `live/workflows/lifecycle_tests.rs` drives the real manager, actor, session
  extension, scripted agent, restart fence, compensation, stale notifications,
  retry, undo, cancellation, and resume paths.
- HTTP tests under `api/workflow_runs_route_tests.rs`,
  `api/workflow_runs_placement_route_tests.rs`, and
  `api/workflow_run_command_route_tests.rs` cover placement, replay, commands,
  typed failures, and generated contract shape.
- ProductClient unit/component tests cover validation, courier id reuse and
  order, builder save gates, transition controls, docs paths, resume, and the
  enabled/disabled surface gate. The focused v2 workflow-definition intent
  spec is the current merge-gating browser seam; broader Tier 2 and live-agent
  qualification remain governed by [`specs/TESTING.md`](../TESTING.md).

## Provenance

The implementation landed through the frozen PR1–PR7 delivery ladder at the
repository revision history:

`delivery-spec-workflows-gen2-pr1.md`,
`delivery-spec-workflows-gen2-pr2-server-v2.md`,
`delivery-spec-workflows-gen2-pr3.md`,
`delivery-spec-workflows-gen2-pr4.md`,
`delivery-spec-workflows-gen2-pr5a.md`,
`delivery-spec-workflows-gen2-pr5b.md`,
`delivery-spec-workflows-gen2-pr6.md`, and
`delivery-spec-workflows-gen2-pr7.md`.

Those files explain individual deltas and rulings at their exact Git
revisions. They are provenance, not current operating law; this owner document
and the pinned implementation define the current system.
