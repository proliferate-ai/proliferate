# Salvage note: gen-1 managed-workflow delivery/retry shape

Scratch notes accompanying `delivery-spec-delete-gen1-workflows.md`. The gen-1
managed-execution lane (`server/proliferate/server/workflows/worker/`, deleted
by that spec) contained a durable server-side delivery machine whose *shape* is
the starting material for the server courier (prompt/invocation delivery to
runtimes). Git history holds the code; this note holds the design so nobody has
to excavate it.

## The shape worth keeping

1. **Checkpoint ladder, persist-before-act.** Delivery advances through a
   closed checkpoint enum — `none → target_plan_frozen → target_bound →
   workspace_put_started → workspace_ready → run_put_started → accepted` —
   where every external effect is bracketed by a durable `*_started` checkpoint
   committed *before* the effect runs. A crash between intent and effect
   resumes at the checkpoint and re-runs one bounded phase, never the whole
   delivery. Each task invocation does exactly one persisted checkpoint or one
   bounded external phase.

2. **Generation fencing.** Each operation family (deliver / observe / cancel)
   carries its own monotonically increasing generation on the row. A task run
   starts by compare-and-set claiming its (invocation, generation); a stale
   generation no-ops. Retries bump the generation, so redelivered or duplicate
   Celery messages are harmless. All state transitions are guarded
   compare-and-set writes keyed on (expected_generation, expected_checkpoint).

3. **Transactional-outbox enqueue.** Follow-on work is enqueued via
   `enqueue_outbox_task` in the same DB transaction as the state change, and a
   relay publishes to Celery afterward — the queue message can never exist
   without the row-state that justifies it (and vice versa never lost).

4. **Closed error classification → durable action.** Every known failure maps
   to a stable `workflow_*` code with `{retryable, authentication}` bits;
   unknown crashes are caught by the Celery wrapper (autoretry, exponential
   backoff capped at 60s, unlimited retries) so a claimed generation is never
   stranded. The action function (`delivery_error_action`) is a pure decision:
   - at the run-put boundary, `execution_store_changed` / `run_put_not_found` /
     `target_destroyed` → **target_lost** (a distinct terminal that keeps the
     row honest instead of pretending failure);
   - codes ending `_rejected` → **fail** (definitive peer refusal);
   - an authentication error repeating with the same code → **fail** (retry
     dampening via `previous_code`);
   - `retryable` (or any error at the run boundary) → **retry**; else **fail**.

5. **Backoff policy, small and closed.**
   - access retry: `min(60, 5 * 2^min(attempt, 4))` seconds;
   - observation polling: `1s` after progress, else `min(10, 2^min(unchanged-1, 4))`
     — cheap adaptive poll without a scheduler.

6. **Freshness as derived data.** The row stores a `freshness_basis`
   (`pending | live | unreachable | target_lost`) plus `latest_observed_at`;
   presentation-facing freshness (`stale` vs `live`) is derived at read time
   from `now - latest_observed_at > stale_after`, never stored.

7. **Desired-state vs delivery-state split.** `desired_state ∈ {active,
   cancelled}` is written by the user-facing verb; the worker reconciles toward
   it at safe points (e.g. delivery completing under a cancelled desired state
   immediately enqueues the cancel operation). Cancellation is truthful — it
   marks intent and converges, it never pretends the remote work stopped.

## What NOT to carry forward

- The lane's coupling to the dark cloud plane (`server.cloud.materialization`,
  `server.cloud.workspaces`, sandbox target planning) — the environments
  rebuild owns placement; the courier should deliver to an already-bound
  environment.
- The per-invocation Celery task fan (`workflows.deliver/observe/cancel`) —
  the seam design replaces polling observation with runtime-pushed events plus
  a heartbeat cursor drain.
- The projection copy (`latest_projection_json`) — the session record is the
  read model now.
