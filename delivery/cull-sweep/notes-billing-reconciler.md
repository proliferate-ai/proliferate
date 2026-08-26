# Salvage note: billing reconciler invariants (cull A-b part 2)

Starting material for the task-class simple-path billing rebuild, captured
before deleting `server/proliferate/server/billing/reconciler.py` per
[delivery-spec-delete-dark-cloud](delivery-spec-delete-dark-cloud.md) (the
coordinator ruling that approved the deletion asked for this note). Git
history holds the code; this records what it guaranteed.

## What it reconciled

One background loop (`BILLING_RECONCILE_INTERVAL_SECONDS`, single-instance
via a Postgres advisory lock — `try_acquire_billing_reconciler_lock`, never
held across the loop's sleep) did, per pass:

1. Run the accounting pass first (`run_billing_accounting_pass`) so the
   segment ledger it reads is already settled.
2. List every **open usage segment** — the money-side record of a sandbox
   that is (believed to be) running — and, only if there are any, fetch the
   provider's live sandbox states once for the whole pass. No open segments
   means no provider round-trip, so an accounting-only deployment never
   needs sandbox credentials.
3. For each open segment, converge record and provider truth:
   - provider says **running** → refresh the provider observation on the
     sandbox row; then evaluate the payer's billing snapshot and org budget
     limits and, in enforce mode, pause/close the sandbox and close the
     segment (`USAGE_SEGMENT_CLOSED_BY_QUOTA_ENFORCEMENT`) when a limit is
     breached; a hold decision is recorded once per subject per pass.
   - provider says **missing/stopped** → close the segment
     (`USAGE_SEGMENT_CLOSED_BY_RECONCILER`) and mark the sandbox row
     accordingly, without ever inventing a stop time earlier than the last
     provider observation.
4. Every decision writes a billing decision event (`record_billing_decision_event`)
   with whether it *would* block a start, so observe mode leaves the same
   audit trail as enforce mode.

## Invariants worth keeping

- **Segments are opened by the thing that starts compute and closed by
  whichever observer first learns it stopped** (webhook, reconciler,
  provision failure) — the closer is recorded (`closed_by`), and a second
  closer is a no-op, not a double close.
- **Stale-segment fencing:** a segment carries the provider sandbox id it was
  opened against; if the row's current provider id differs (sandbox was
  re-materialized), the segment is ignored rather than closed against the
  wrong lifetime. The same fencing uses the row's materialization attempt.
- **Lock discipline:** provider-facing mutation of a sandbox row runs under
  that sandbox's materialization lock (`redis_materialization_lock(
  "cloud-sandbox:<id>")`) so the reconciler and the provisioning engine never
  race on the same row; the lock is taken once and threaded through
  recursion rather than re-acquired.
- **Fail closed on read errors:** when the billing snapshot cannot be
  computed, the reconciler does not enforce; it records and moves on
  (money decisions are never made on partial data).
- **Distinct locks for distinct external-truth readers:** the reconciler
  lock was deliberately separate from the orphan-reaper lock so the two
  readers of provider state never suppressed each other.

## What the rebuild changes

Task-class environments open their segment at provision and close it at
terminal state on the same code path that owns the environment; the
reconciler's job collapses to "close what the owner failed to close",
which the invariants above already describe.
