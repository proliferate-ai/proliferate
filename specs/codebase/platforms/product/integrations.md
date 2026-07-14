# Integrations And Runtime Worker Authentication

Status: current

This platform owns connected third-party integration accounts, the Cloud-hosted
integration MCP gateway, and the Worker identity that gives AnyHarness scoped
access to that gateway. Provider credentials remain encrypted in Cloud;
AnyHarness receives only a Proliferate gateway bearer.

Harness model credentials and the LLM gateway are separate owners:
[Agent auth](agent-auth.md) and [Agent gateway / BYOK](agent-auth-bifrost-byok.md).

## Mental Model

```text
user connects provider
  -> Cloud stores encrypted credentials on cloud_integration_account

runtime enrolls Worker once
  -> Worker token authenticates heartbeat
  -> catalog fetch currently accepts the request without Worker auth
  -> gateway token is written to integration-gateway.json

AnyHarness session starts
  -> reads the gateway token
  -> mounts the Cloud integration MCP endpoint
  -> agent invokes one of three virtual tools
  -> Cloud resolves policy + account and calls the provider with Cloud-held credentials
```

## Integration State

[`db/models/cloud/integrations.py`](../../../../server/proliferate/db/models/cloud/integrations.py)
owns the current schema:

| Table | Ownership |
| --- | --- |
| `cloud_integration_definition` | Seed or organization-custom provider definition and launch/auth configuration. Organization-custom rows reference `organization.id` with cascade delete. |
| `cloud_integration_policy` | Organization enable/disable overlay for a definition. Organization deletion cascades; definition and acting-admin references use the database default action. |
| `cloud_integration_account` | One user's connected instance of a definition. User deletion cascades; the definition reference uses the database default action. Credential material is encrypted. |
| `cloud_integration_oauth_client` | Cached static or dynamically registered OAuth client for a definition. |
| `cloud_integration_oauth_flow` | Short-lived OAuth authorization state. Account and user deletion cascade; the definition reference uses the database default action. |
| `cloud_integration_tool_schema_cache` | Account-keyed `tools/list` cache; account deletion cascades. |
| `cloud_integration_tool_call_event` | One audit row per proxied call, including failures. User, organization, and Worker deletion set their attribution fields to null. |

Accounts are personal today even though the schema reserves an organization
owner-scope value. Credential writes increment `auth_version`; the tool cache
is valid only when its version matches and its `fetched_at` is inside the
configured TTL. A transient provider failure may serve a version-matching
stale schema, while auth/configuration failures remain actionable errors.

Definitions, accounts, policies, OAuth, health, cache behavior, and provider
access live under
[`server/.../cloud/integrations/`](../../../../server/proliferate/server/cloud/integrations/).
Raw OAuth and MCP protocol clients live under
[`server/proliferate/integrations/`](../../../../server/proliferate/integrations/)
and do not own product persistence.

## Runtime Worker Identity

[`db/models/cloud/runtime_workers.py`](../../../../server/proliferate/db/models/cloud/runtime_workers.py)
owns three related tables:

| Table | Ownership |
| --- | --- |
| `cloud_runtime_worker` | Active or revoked identity for a `cloud_sandbox` or desktop install, with last heartbeat and reported Worker/AnyHarness versions. User, organization, and sandbox references have cascade delete. |
| `cloud_runtime_worker_enrollment` | Single-use pending/consumed/expired/revoked enrollment. User, organization, and sandbox references cascade; `created_by_user_id` is attribution and uses the database default action. |
| `cloud_integration_gateway_token` | One active AnyHarness-facing token per Worker. Worker, user, and organization references cascade. |

At most one non-revoked Worker exists per cloud sandbox and per `(owner,
desktop_install_id)`. Worker liveness is derived from `status = online` plus a
recent `last_seen_at`; the application does not eagerly write `offline`.

Enrollment, Worker, and gateway tokens are HMAC-SHA256 hashed under distinct
domains before persistence. A raw token cannot authenticate as another token
family.

### Enrollment and heartbeat

[`runtime_workers/service.py`](../../../../server/proliferate/server/cloud/runtime_workers/service.py)
implements the server flow:

1. consume and row-lock a single-use enrollment;
2. revoke the prior Worker and gateway token for the same runtime identity;
3. persist the new Worker's reported version, hostname, and fingerprint;
4. mint separate Worker and integration-gateway tokens; and
5. return the heartbeat interval and gateway configuration.

Heartbeat authenticates the opaque Worker bearer, updates `last_seen_at`, and
persists any reported Worker and AnyHarness versions. Its response carries the
desired Worker, AnyHarness, and agent-catalog versions. The Worker uses that
response for heartbeat-driven convergence; see the
[Proliferate Worker structure](../../structures/proliferate-worker/README.md).

The gateway token's `last_used_at` column is deliberately not updated on the
request hot path. It remains nullable bookkeeping, not reliable usage
evidence.

### Gateway credential file

A fresh Worker enrollment returns the gateway URL and bearer. The Worker
writes them atomically with private permissions to
`<runtime_home>/integration-gateway.json` using
[`integration_gateway.rs`](../../../../anyharness/crates/proliferate-worker/src/integration_gateway.rs).
AnyHarness loads that file at session launch and mounts the integration
gateway when the binding policy permits it.

A restart that loads an existing Worker identity from local SQLite does not
receive or recreate a missing gateway file. A revoked or invalid durable
Worker token also does not automatically re-enroll. Do not prescribe deleting
Worker SQLite or rotating tokens as routine recovery.

## Cloud And Desktop Worker Startup

When Cloud materialization launches or relaunches AnyHarness, it then starts
Worker as a best-effort detached sidecar through
[`worker_sidecar.py`](../../../../server/proliferate/server/cloud/materialization/sandbox_io/worker_sidecar.py).
Direct AnyHarness health is independent of Worker health. Reusing an
already-healthy AnyHarness does not restart a missing Worker.

Desktop obtains a short-lived user-authenticated enrollment for its install,
then starts the local Worker through Tauri. Desktop revoke is an idempotent
user-authenticated operation that revokes the matching active Worker and
gateway token.

## Integration Gateway

[`integration_gateway/dependencies.py`](../../../../server/proliferate/server/cloud/integration_gateway/dependencies.py)
resolves an active gateway token to its non-revoked Worker and revalidates
organization membership on each organization-scoped request.

[`integration_gateway/service.py`](../../../../server/proliferate/server/cloud/integration_gateway/service.py)
applies definition visibility and organization policy, then exposes three
virtual MCP tools:

```text
integrations.list_providers
integrations.list_tools
integrations.call_tool
```

`integrations.call_tool` decrypts and resolves provider credentials inside
Cloud, invokes the remote provider, and records a
`cloud_integration_tool_call_event` on success or failure. Provider credentials
and rendered auth headers never cross the Cloud boundary.

## Mounted Routes

Worker and public artifact routes:

```text
POST /v1/cloud/worker/enroll
POST /v1/cloud/worker/heartbeat
GET  /v1/cloud/worker/download/{target}/{asset}
GET  /v1/cloud/runtime/download/{target}/{asset}
POST /v1/cloud/workers/desktop/enrollment
POST /v1/cloud/workers/desktop/revoke
```

The two download routes are intentionally public redirects to pinned or stable
Worker and AnyHarness artifacts. They are usable before a Worker identity
exists and do not expose private credentials.

The MCP endpoint is:

```text
POST /v1/cloud/integration-gateway/mcp
```

User-authenticated integration routes under `/v1/cloud/integrations` own the
catalog, health, authentication, account deletion, OAuth flow, and callback
surfaces. Organization-admin definition and policy routes are under
`/v1/cloud/integrations/admin`. The mounted router files are
[`integrations/api.py`](../../../../server/proliferate/server/cloud/integrations/api.py)
[`integration_gateway/api.py`](../../../../server/proliferate/server/cloud/integration_gateway/api.py),
and [`runtime_workers/api.py`](../../../../server/proliferate/server/cloud/runtime_workers/api.py).

## Boundaries

- The Worker currently enrolls, heartbeats, converges catalog and binaries,
  and materializes the integration-gateway credential. It is not the owner of
  workspace creation or repository materialization.
- Cloud directly creates or reconnects AnyHarness for managed sandboxes; the
  Worker sidecar is optional.
- Generic MCP session assembly belongs to [MCP runtime](mcp-runtime.md).
- Sandbox lifecycle belongs to
  [Cloud sandbox provisioning](sandbox-provisioning.md).
- Server vendor adapters follow the
  [Server integrations structure](../../structures/server/guides/integrations.md).

## Failure Boundaries

- Enrollment tokens are single-use and expire; an invalid, consumed, expired,
  or revoked token returns an authentication error.
- A missed heartbeat does not itself stop AnyHarness. Diagnose the runtime and
  Worker separately.
- A missing gateway credential file prevents integration injection even when
  the Worker's durable identity is intact.
- Organization-scoped gateway access fails closed when membership is no longer
  active, and explicit organization policy can hide a definition.
- OAuth refresh and provider access errors are product errors owned by the
  integrations service; tool-level provider errors are returned to the agent
  without leaking credentials.

## Verification

Focused server tests include:

- `server/tests/integration/test_cloud_runtime_workers_api.py`
- `server/tests/integration/test_cloud_runtime_worker_versions_api.py`
- `server/tests/integration/test_cloud_integration_gateway_api.py`
- `server/tests/integration/test_cloud_integrations_api.py`
- `server/tests/integration/test_cloud_integration_catalog_api.py`
- `server/tests/integration/test_cloud_integration_health_api.py`
- `server/tests/integration/test_integration_provider_access.py`

Worker behavior is covered by `cargo test -p proliferate-worker`. For an
enrollment incident, use
[`worker-enrollment-failure.md`](../../../developing/runbooks/worker-enrollment-failure.md).
