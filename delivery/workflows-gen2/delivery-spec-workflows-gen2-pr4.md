# Delivery specification — workflows gen-2 PR4: the live cell (frozen)

Chain position: PR4 of the gen-2 runtime chain, stacked on PR3
(`codex/workflows-gen2-pr3-envelope-and-context`, #1879). Spec of record: the
Workflows ADR (Core), sections "live/workflows", "The actor's running loop",
"WorkflowSessionExtension", "app/workflows.rs", and the transition table. This
document freezes the deltas this PR delivers; PR5a (HTTP API) stacks on it.

## Scope

The live half of the engine: the per-run actor and its manager, the one
sessions-domain touchpoint, and the composition root with the boot fence. No
HTTP routes (PR5a), no client work.

## Deliverables

### 1. `live/workflows` — WorkflowManager + WorkflowActor

- `WorkflowManager` owns the run-id → handle registry (std `Mutex<HashMap>`;
  no await ever held under it). Public surface:
  - `start_run(run_id) -> anyhow::Result<RunProjection>` — ensure the actor;
    the actor's spawn path launches the run's current node when it is
    `running` with no linked session (the create-then-start seam and the
    fence's Resume both reduce to this one rule); reply is the fresh
    rows-backed projection.
  - `command(run_id, WorkflowCommand) -> Result<RunProjection, WorkflowCommandError>`
    with `WorkflowCommandError::{RunNotFound, Illegal(IllegalTransition), Internal}`.
    The oneshot reply IS the eventual HTTP response: Ok = fresh projection,
    Illegal = the 409 body.
  - `notify(run_id, TurnFinished)` — synchronous fire-and-forget from the
    extension. A registry miss is by construction a stale report (every live
    workflow session in this process was launched by an actor): emit
    `anyharness.workflow.notification.stale` and drop.
- `WorkflowActor`: two inbound channels exactly per the ADR pseudo-code —
  bounded mpsc of `(WorkflowCommand, oneshot<Result<RunProjection, IllegalTransition>>)`
  and unbounded mpsc of `TurnFinished` — consumed by one unbiased `select!`
  loop. In-memory `RunState` is a cache of the rows, loaded once at spawn and
  refreshed only after commits. `step()` = pure `next()` → `apply_transition`
  (persist first) → in-memory catch-up → inline side effects.
- **Deviation (journaled): the actor parks instead of self-reaping on terminal
  runs.** FailAndRedo is legal on terminal runs; an exit-on-terminal actor
  would strand mid-mailbox commands and force a rematerialize-retry dance.
  The loop ends when both senders drop (process shutdown). `ensure_actor`
  still rematerializes from rows on first touch of any existing run.
- Staleness guard on notifications only: drop (with the stale event) when the
  node row is unknown or its session is unlinked; everything else feeds
  `next()`, whose `Hold` is silent (the queued-interjection case is normal).
- Side effects, inline after commit:
  - `StartNode`: resolve the node's launch config from the frozen definition
    (`definition_node_id` → `DefinitionNode.model`; absent → default agent
    kind `claude`, no model/mode pick — RULED, journaled); reuse the stored
    envelope or render via PR3's `render_envelope` (context dir =
    `<workspace.path>/.proliferate/context`) and persist it; create the
    durable session (`create_persisted_internal_session` on the blocking
    pool); link the sessions-table workflow columns; stamp the node row
    (`prompt_id = "wf2-<node_row_id>"`, deterministic); start the session;
    dispatch `first_message` via `send_text_prompt_with_id`. A verifiably
    failed create/start/dispatch feeds `NodeLaunchFailed` back through
    `step()`; `Queued` and a LOST acknowledgement are not failures (gen-1's
    ambiguity rule: the fence or the extension resolves them).
  - `DisposeSession` (undo only): `dismiss_live_session` (close + dismiss) and
    clear the sessions-table workflow columns (unlink).
- Illegal decisions emit `anyharness.workflow.transition.illegal` (WARN) at
  the decision site.

### 2. Sessions-table workflow columns (sessions store helpers)

The 0069 columns get their writers, owned by the sessions store (domain table
ownership): `link_workflow_columns(session_id, run_id, node_row_id)`,
`clear_workflow_columns(session_id)`, `workflow_columns(session_id) ->
Option<(run_id, node_row_id)>`.

### 3. `domains/workflows/session_extension.rs` — WorkflowSessionExtension

- `resolve_launch_extras`: if the launching session carries workflow columns,
  load its node row's stored envelope and return
  `first_prompt_system_prompt_append = instruction_blocks` (the house wrapper
  `system_instruction_block` applies them on the first prompt) and
  `system_prompt_append = envelope.system_prompt_append` (additive mirror).
  Non-workflow sessions get `default()`.
- `on_turn_finished`: if the session carries workflow columns, peek the
  durable pending-prompt queue at that instant
  (`peek_head_pending_prompt`), map `(outcome, stop_reason)` →
  `TurnStopReason` — Cancelled→Cancelled, Failed→Error, Completed+`refusal`→
  Refusal, Completed+`max_tokens`/`max_turn_requests`→HarnessCap, otherwise
  CleanEndTurn — and call `manager.notify(run_id, TurnFinished{node_row_id,
  stop_reason, queue_empty})`. Never blocks the session actor.
- **Deviation (journaled): `EmptyTurn` is never produced in PR4.** The turn
  context does not expose turn-activity emptiness; the pure function keeps
  the variant, and the extension starts emitting it when the session layer
  surfaces the signal.
- The manager arrives after `SessionRuntime` in wiring order, so the extension
  holds it in a `OnceLock`, bound by `app/workflows.rs` (the house late-bind
  precedent: `completion_delivery_wiring.spawn(&session_runtime)`).

### 4. `app/workflows.rs` — composition root + boot fence

- `run_boot_fence(store)` — before the manager exists: for every `running`
  run id (RULED in PR1: `awaiting_human` is a durable park and survives
  restarts), load state → `next(BootFence{RuntimeRestart})` →
  `apply_transition`; then `emit_boot_fence_summary`.
- Wiring in `AppState::new`: build `WorkflowStore` → register the extension in
  `session_extensions` → build `SessionRuntime` → run the fence → build
  `WorkflowManager` → bind it into the extension. `AppState` gains
  `workflow_store` and `workflow_manager`.

### 5. Store additions

`WorkflowStore::run_detail(run_id) -> Option<RunProjection>` (project state +
docs; the one read every command replies with).

## Hard gate: the full-lifecycle tier-1 suite

Scripted ACP agent (the house harness: `write_scripted_agent` +
`install_scripted_agent_env`), real `AppState`, real SQLite, real filesystem
workspaces; none of our machinery mocked. The stock scripted agent gains one
text-triggered branch (`PLEASE-REFUSE` → `stopReason: "refusal"`); existing
tests never send that text. Scenarios:

1. **Happy path**: multi-node agent chain with `@input:`/`@doc:` references
   over a materialized context; every node's session receives the resolved
   first message plus the wrapped preamble; run completes; rows quiesce.
2. **Gate approve**: human_in_loop node parks `awaiting_human`; ApproveGate
   advances; run completes.
3. **FlipType both ways**: waiting gate → agent advances immediately; a
   running agent node (held turn) flipped to human_in_loop parks as a gate at
   its next clean turn end.
4. **FailAndRedo**: a refusal fails node and run; FailAndRedo with an edited
   prompt launches the replacement beside the failed row; run completes.
5. **UndoAdvance**: after an auto-advance onto a held node, undo returns it to
   pending unlinked, disposes the seconds-old session, parks the predecessor
   `awaiting_human`; re-approving relaunches.
6. **AddAdhocNode**: an adhoc node launches with preamble + user prompt,
   completes its own row, and never moves the chain.
7. **Boot-fence heal + Resume**: run rows created in the crash-window shape
   (current node running, no session); a fresh `AppState` over the same Db
   fences it interrupted/needs_attention; Resume mints the never-born session
   and the run completes.

Plus unit tests for the stop-reason mapping and the sessions-column helpers,
and one negative control per the ladder's standing rule.

## Non-goals

HTTP routes and ProblemDetails codes (PR5a); client cells; workspace-creation
placement flow (the PUT path, PR5a); cancel-driven interruption UX.
