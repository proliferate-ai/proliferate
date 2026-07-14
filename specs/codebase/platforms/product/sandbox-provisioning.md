# Cloud Sandbox Provisioning

Status: current

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
- Runtime access consists of `anyharness_base_url`, an encrypted bearer token,
  and an encrypted AnyHarness data key.
- `ready_at`, `last_health_at`, and `destroyed_at` record lifecycle evidence.

The row is personal-only. It has no organization scope, reusable profile,
template revision, runtime generation, or persisted last-error field.
Destroyed rows remain history; a later ensure may create a new active row.

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
owns the real connection work:

1. reject a destroyed sandbox and re-check billing;
2. create an E2B sandbox when `provider_sandbox_id` is absent, recording the
   provider id immediately;
3. resume the provider sandbox and resolve its endpoint and runtime context;
4. reuse a healthy authenticated AnyHarness, or launch it directly with the
   recorded or newly minted runtime credentials;
5. when AnyHarness is launched, start Proliferate Worker as a detached,
   best-effort sidecar; and
6. after launch/relaunch, persist ready status and encrypted runtime access.

Healthy reuse still verifies AnyHarness health and bearer enforcement. With
unchanged credentials and runtime URL it returns without synchronously
rewriting ready/health evidence; minted credentials or a changed URL trigger a
ready-state write.

The E2B launch path does not launch Proliferate Supervisor. A missing or
unhealthy Worker does not make direct AnyHarness access unavailable. Reusing an
already-healthy AnyHarness does not currently restart or self-heal a missing
Worker sidecar.

### Delete

Delete revokes the active Worker and its integration-gateway token, then marks
the `cloud_sandbox` row destroyed. It does not:

- kill the E2B provider sandbox;
- delete or remap `cloud_workspace` rows;
- clear their stored AnyHarness workspace ids; or
- provide an atomic sandbox-replacement workflow.

Treat existing runtime identities as potentially unreachable after deletion.
Do not present deletion and recreation as a lossless repair.

### Provider webhooks

`POST /v1/cloud/webhooks/e2b` is implemented by
[`webhooks/service.py`](../../../../server/proliferate/server/cloud/webhooks/service.py).
It verifies the E2B signature, deduplicates provider events, updates provider
status, and opens or closes billing usage segments. Spend-hold processing may
pause a created or resumed sandbox. A killed event marks the sandbox destroyed,
but does not revoke its active Worker.

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
- Runtime access is usable only when URL, bearer ciphertext, and data-key
  ciphertext are all present.
- Worker sidecar launch failures are logged and swallowed; diagnose Worker
  liveness independently from AnyHarness health.
- There is no shipped safe operation that atomically replaces a sandbox while
  preserving all existing runtime identities.

## Verification

The narrow contract tests are:

- `server/tests/unit/test_sandbox_materialization.py`
- `server/tests/unit/test_cloud_webhook_service.py`
- `server/tests/unit/test_cloud_sandbox_gateway_access.py`
- `server/tests/integration/test_cloud_sandbox_wake_billing_gate.py`

For an incident, follow
[`cloud-provisioning-failure.md`](../../../developing/runbooks/cloud-provisioning-failure.md)
instead of mutating rows or destroying provider state by hand.
