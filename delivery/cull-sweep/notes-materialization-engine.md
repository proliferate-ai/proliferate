# Salvage note: the materialization engine's invariants (cull A-b part 2)

Starting material for the environments rebuild, recorded per the coordinator
ruling before `server/cloud/materialization/` was deleted. The frozen
delete-dark-cloud spec governs over the Cull Plan's earlier reuse note: the
engine is deleted, not restructured. Every file below is restorable in one
command from the pre-deletion main:

    git show 1aae88d36d611392cb29875aa28d8520fa1d5158:server/proliferate/server/cloud/<path>

Pre-deletion main SHA: `1aae88d36d611392cb29875aa28d8520fa1d5158`.

## `materialization/sandbox_io/connect.py`

Owned the sandbox connect/ready choreography: a compare-and-swap on the materialization attempt admits exactly one connector per sandbox lifetime; usage segments converge at the ready re-stamp; gateway access caches invalidate on re-stamp so a stale token can never reach a re-materialized sandbox.

## `materialization/operation.py`

Provision-on-placement engine: every provisioning operation is keyed by (sandbox id, attempt) so a retry replays the same operation id instead of forking a second provision; state transitions commit before provider I/O (session-before-compute).

## `materialization/locks.py`

One Redis lock per sandbox (`cloud-sandbox:<id>`) scopes ALL provider-facing mutation; the reconciler and provisioning engine thread the held lock through recursion rather than re-acquiring, and lock scope never spans a provider round-trip plus an unrelated row.

## `materialization/sandbox_io/resume_acceptance.py`

Resume acceptance rules: a wake is accepted only when the provider sandbox id AND materialization attempt on the row still match the values the waker resolved — the fencing-token discipline that makes a stale waker a no-op instead of a corruption.

## `materialization/sandbox_io/runtime_launch.py`

Launched the runtime inside a connected sandbox with the rendered env (pins, telemetry, surface identity) and treated 'runtime already at desired state' as success — idempotent relaunch, never a second runtime.

## `materialization/failures.py`

Typed failure taxonomy with a terminal/retryable split; a terminal receipt (e.g. provider sandbox missing) is preserved across retries so the row remembers WHY it last failed even after it recovers.

