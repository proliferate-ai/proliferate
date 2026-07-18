# Cloud Sandbox Provisioning

This platform owns the personal managed-cloud sandbox row and the just-in-time
connection from Proliferate Cloud to E2B and AnyHarness. It does not own
workspaces, repository configuration, or AnyHarness runtime state.

## Mental Model

```text
one product user
  -> one active cloud_sandbox row
  -> just-in-time E2B create/resume during materialization
  -> direct AnyHarness launch and authenticated access
  -> optional Proliferate Worker sidecar
```

`POST /v1/cloud/cloud-sandbox/ensure` and `POST
/v1/cloud/cloud-sandbox/wake` ensure the database row after configuration and
billing checks. They do not contact E2B, resume a provider sandbox, launch
AnyHarness, or reconcile repositories. Provider and runtime work happens when
a materialization operation calls `connect_ready_sandbox` under the sandbox
operation lock.

## Persisted Owner

[`CloudSandbox`](../../../../server/proliferate/db/models/cloud/sandboxes.py)
maps to `cloud_sandbox`.

- A partial unique index permits one non-destroyed row per `owner_user_id`.
- The provider is E2B. `provider_sandbox_id` is nullable until first provider
  creation.
- Status is `creating`, `ready`, `paused`, `error`, or `destroyed`.
- `last_error` is a nullable, durable, bounded, secret-safe receipt for the
  latest terminal connection attempt or authoritative current-provider loss.
  It contains a classified operator-safe message, not raw provider or runtime
  exception text.
- `materialization_attempt` advances for every connection attempt, including a
  healthy `ready` retry. Attempt-owned completions compare that epoch before
  changing lifecycle or accounting state.
- `provider_observed_at` is the provider-specific freshness floor. Retry start,
  conservative resume request-start acceptance, and direct provider
  observations advance it; runtime-ready persistence does not. Delayed
  provider observations at or before the floor are inert.
- Runtime access consists of `anyharness_base_url`, an encrypted bearer token,
  and an encrypted AnyHarness data key.
- `ready_at`, `last_health_at`, and `destroyed_at` record lifecycle evidence.

The row is personal-only. It has no organization scope, reusable profile,
template revision, or runtime generation. Destroyed rows remain history; a
later ensure may create a new active row.

## Mounted API

User-authenticated routes in
[`cloud_sandboxes/api.py`](../../../../server/proliferate/server/cloud/cloud_sandboxes/api.py):

```text
GET    /v1/cloud/cloud-sandbox
POST   /v1/cloud/cloud-sandbox/ensure
POST   /v1/cloud/cloud-sandbox/wake
DELETE /v1/cloud/cloud-sandbox
```

The AnyHarness gateway is mounted separately:

```text
HTTP/WS /v1/gateway/cloud-sandbox/anyharness/{path...}
```

[`gateway/service.py`](../../../../server/proliferate/server/cloud/gateway/service.py)
loads and decrypts runtime access from the caller's active `cloud_sandbox`.
[`gateway/proxy.py`](../../../../server/proliferate/server/cloud/gateway/proxy.py)
then proxies HTTP or WebSocket traffic to AnyHarness with the sandbox bearer.
The gateway finishes the shared authentication/access transaction before it
enters HTTP response streaming or the WebSocket pump. Long-lived proxy
connections must not retain a database-pool checkout or transaction-scoped
sandbox locks.

## Lifecycle

### Ensure and wake

[`cloud_sandboxes/service.py`](../../../../server/proliferate/server/cloud/cloud_sandboxes/service.py)
does three things:

1. reject explicitly requested provisioning when E2B configuration is
   incomplete;
2. enforce the current billing resume gate;
3. lock the personal owner and ensure the `cloud_sandbox` and billing-subject
   rows.

`wake` delegates to the same row-level operation as `ensure`. A returned
`creating` row is not proof that E2B or AnyHarness is running.

### Just-in-time provider and runtime connection

[`connect.py`](../../../../server/proliferate/server/cloud/materialization/sandbox_io/connect.py)
owns the real connection work. Every materialization operation ends its caller
database phase before waiting for the per-sandbox lock, then reloads the current
row inside the lock before making a lifecycle decision; a caller's pre-lock
snapshot is never provider authority.

1. reject a destroyed sandbox and re-check billing;
2. begin a new attempt epoch before provider I/O, preserving `ready` for healthy
   reuse while moving other retryable states to `creating`, and clear the old
   failure receipt;
3. before provider I/O, close a legacy null-attributed open usage segment under
   that unchanged unknown identity, clamping its end no earlier than its start;
   `binding_convergence` records the repair. A non-null conflicting provider is
   preserved open and produces a durable support receipt before any provider
   call, because it may still be live; duration is never reassigned;
4. if and only if resume reports authoritative provider-target-not-found,
   compare-and-swap the expected binding to absent and close that exact
   provider's open usage segment in one transaction with cloud-row-first lock
   order. Commit the supersession before creating one replacement;
5. create an E2B sandbox when `provider_sandbox_id` is absent, then record its
   exact provider id and provision usage in one transaction. If that commit is
   ambiguous and the same attempt remains unbound, the failure transaction
   adopts the known candidate and its exact usage instead of losing custody;
6. after every successful provider resume, revalidate the exact binding and
   attempt epoch at the conservative request-start boundary. If a pause overlaps
   the request, a post-resume exact-ID state read decides whether to reopen usage
   as running or retain paused closure. Cancellation, an ambiguous commit, or an
   active observation after a transient response uses the same fenced usage
   open in the failure transaction;
7. resolve the provider endpoint and runtime context, then reuse a healthy
   authenticated AnyHarness or launch it directly with the
   recorded or newly minted runtime credentials;
8. when AnyHarness is launched, start Proliferate Worker as a detached,
   best-effort sidecar; and
9. after launch/relaunch, persist ready status and encrypted runtime access
   only when the expected provider binding and attempt epoch are still current.

Provider configuration failures and transient provider unavailability do not
supersede the binding or create a replacement. They fail closed and preserve
the existing provider id for a later retry. Any connection failure writes
`error` and a sanitized `last_error` only if the attempt's exact provider
binding and epoch are still current; a concurrent authoritative pause, newer
attempt, or explicit delete wins instead. `error` is terminal for that attempt,
not for the logical sandbox row; a later normal materialization can retry the
same row.

Healthy reuse still verifies AnyHarness health and bearer enforcement, then
finishes with an exact-binding ready-state write. This refreshes health
evidence and clears `last_error` without fabricating a newer provider lifecycle
observation, even when the runtime URL and credentials were reused.

Sandbox bootstrap applies global secrets and agent-auth state independently of
repository configuration. A user with no Cloud repository environments does
not need GitHub App authorization for that bootstrap. Each configured
repository attempt owns its GitHub authority check and credential
materialization, and remains best-effort so one repository failure cannot
prevent the non-repository state from converging.

The E2B launch path does not launch Proliferate Supervisor. A missing or
unhealthy Worker does not make direct AnyHarness access unavailable. Reusing an
already-healthy AnyHarness does not currently restart or self-heal a missing
Worker sidecar.

### Delete

Delete revokes the active Worker and its integration-gateway token, marks the
`cloud_sandbox` row destroyed, and schedules best-effort destruction of the
exact current provider sandbox after the database commit. The after-commit
callback can be lost if the server process exits; the periodic orphan reaper is
the backstop for that gap and for a create that reached E2B but lost its local
binding. Delete does not:

- delete or remap `cloud_workspace` rows;
- clear their stored AnyHarness workspace ids; or
- provide an atomic sandbox-replacement workflow.

Treat existing runtime identities as potentially unreachable after deletion.
Do not present deletion and recreation as a lossless repair.
If the provider later reports paused, timeout, stopped, killed, or exact target
absence for the retained binding, the exact attempt's usage is closed while the
product-owned destroyed state and binding remain unchanged.

### Orphan reaping

Celery Beat schedules `cloud_sandboxes.orphan_reap` every five minutes only
when Cloud provisioning is configured. The thin task opens a database session
and delegates to
[`cloud/worker/service.py`](../../../../server/proliferate/server/cloud/worker/service.py).
A session advisory lock admits at most one reaper pass across the worker fleet.

The reaper lists both running and paused provider sandboxes and destroys only
objects whose exact `proliferate_cloud_sandbox_id` creation tag is a canonical
UUID for a row in the current database. Untagged objects, legacy tags,
malformed or noncanonical ids, and tags without a local row are not ownership
evidence and are never destroyed. A provider object is eligible only when:

- its local row is destroyed and any known provider age is past the configured
  grace window; or
- its active local row is bound to a different exact provider id, its age is
  known, and it is past the grace window.

An active row with no binding may be between provider create and local record,
so it is always preserved. The exact current binding, transitional or terminal
provider states, and young or unknown-age live-row duplicates are also
preserved. One provider deletion failure is logged and does not widen
attribution or abort evaluation of later independently attributed objects.

### Provider webhooks

`POST /v1/cloud/webhooks/e2b` is implemented by
[`webhooks/service.py`](../../../../server/proliferate/server/cloud/webhooks/service.py).
It verifies the E2B signature, correlates events to an already persisted exact
binding, deduplicates them, updates provider status, and idempotently reinforces
or closes billing usage segments. Webhook metadata is never authority to adopt
an uncommitted provider; direct materialization owns the required usage open,
so delivery timing is advisory. Spend-hold processing may pause a created or
resumed sandbox. Lifecycle state and usage mutate in one cloud-row-first
transaction and are fenced by the current binding, attempt epoch, and provider
freshness floor. Spend-hold work uses the same materialization lock, releases
each database phase before provider I/O, and commits its receipt, lifecycle
update, and usage close before releasing the lock. A killed event for the
current binding closes that provider's exact usage segment, detaches the missing
provider, and records a recoverable `error`; it does not destroy the logical
sandbox row. Terminal events for an already-destroyed row close only exact usage
and preserve deletion. Explicit product deletion is the only transition that
destroys that row.

## Ownership Map

| Concern | Current owner |
| --- | --- |
| Sandbox row, ensure/wake/delete | [`server/.../cloud/cloud_sandboxes/`](../../../../server/proliferate/server/cloud/cloud_sandboxes/) |
| Sandbox persistence | [`db/models/cloud/sandboxes.py`](../../../../server/proliferate/db/models/cloud/sandboxes.py), [`db/store/cloud_sandboxes.py`](../../../../server/proliferate/db/store/cloud_sandboxes.py) |
| E2B and AnyHarness connection | [`server/.../cloud/materialization/sandbox_io/`](../../../../server/proliferate/server/cloud/materialization/sandbox_io/) |
| Provider adapter | [`integrations/sandbox/`](../../../../server/proliferate/integrations/sandbox/) |
| Billing gate and usage | [Billing](billing.md) |
| Optional Worker | [Proliferate Worker structure](../../structures/proliferate-worker/README.md) |
| Runtime behavior | [AnyHarness structure](../../structures/anyharness/README.md) |
| Repository and workspace flow | [Workspace provisioning](workspace-provisioning.md) |
| Server placement rules | [Server structure](../../structures/server/README.md) |

## Failure Boundaries

- An ensure/wake configuration or billing error occurs before provider work.
- Provider create/resume, launch, health, and auth failures surface from
  materialization, not from the row ensure alone.
- A persisted `error` and non-null `last_error` describe the latest completed
  connection failure or authoritative current-provider loss. Beginning a
  connection retry clears that receipt; a later failure or provider-loss
  observation replaces it with a sanitized receipt.
- Runtime access is usable only when URL, bearer ciphertext, and data-key
  ciphertext are all present.
- Worker sidecar launch failures are logged and swallowed; diagnose Worker
  liveness independently from AnyHarness health.
- Automatic replacement is limited to authoritative absence of the exact
  persisted provider target. There is no general-purpose manual replacement
  operation, and existing AnyHarness workspace identities can still be
  unreachable when their old runtime is gone.

## Verification

The narrow contract tests are:

- `server/tests/unit/test_sandbox_materialization.py`
- `server/tests/unit/test_cloud_connect_race.py`
- `server/tests/unit/test_cloud_materialization_failures.py`
- `server/tests/unit/test_cloud_webhook_service.py`
- `server/tests/unit/test_cloud_webhook_recovery_races.py`
- `server/tests/unit/test_cloud_sandbox_gateway_access.py`
- `server/tests/unit/test_cloud_orphan_reaper.py`
- `server/tests/unit/test_cloud_sandbox_reaper_task.py`
- `server/tests/integration/test_cloud_sandbox_recovery.py`
- `server/tests/integration/test_cloud_sandbox_orphan_reaper_lock.py`
- `server/tests/integration/test_cloud_sandbox_recovery_invariants.py`
- `server/tests/integration/test_cloud_sandbox_reconciler_recovery.py`
- `server/tests/integration/test_cloud_sandbox_last_error_migration.py`
- `server/tests/integration/test_cloud_sandbox_reconnect_self_heal.py`
- `server/tests/integration/test_cloud_sandbox_wake_billing_gate.py`

These deterministic tests establish the state-machine, concurrency, and error
classification contracts. They are not a live E2B qualification receipt; any
release-specific live provider exercise remains separate operational evidence.

For an incident, follow
[`cloud-provisioning-failure.md`](../../../developing/operating/cloud-provisioning-failure.md)
instead of mutating rows or destroying provider state by hand.
