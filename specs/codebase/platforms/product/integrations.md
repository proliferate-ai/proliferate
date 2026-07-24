# Integrations And Runtime Worker Authentication

This platform owns connected third-party integration accounts, the Cloud-hosted
integration MCP gateway, and the Worker identity that gives AnyHarness scoped
access to that gateway. Provider credentials remain encrypted in Cloud;
AnyHarness receives only a Proliferate gateway bearer.

Harness model credentials and the LLM gateway are separate owners; see the
Agent auth and Managed model gateway rows in [README.md](README.md) (their
platform documents are being rewritten after the Bifrost-era versions were
removed).

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
  -> Cloud mints a signed MCP session header bound to that Worker
  -> agent invokes one of three virtual tools
  -> Cloud resolves the typed tool policy before credentials or provider I/O
  -> allowed reads call the provider with Cloud-held credentials
  -> approval-gated actions create a durable, exact, one-time approval request
```

## Integration State

[`db/models/cloud/integrations.py`](../../../../server/proliferate/db/models/cloud/integrations.py)
and
[`db/models/cloud/integration_approvals.py`](../../../../server/proliferate/db/models/cloud/integration_approvals.py)
own the current schema:

| Table | Ownership |
| --- | --- |
| `cloud_integration_definition` | Seed or organization-custom provider definition and launch/auth configuration. Organization-custom rows reference `organization.id` with cascade delete. |
| `cloud_integration_policy` | Organization enable/disable overlay for a definition. Organization deletion cascades; definition and acting-admin references use the database default action. |
| `cloud_integration_account` | One user's connected instance of a definition. User deletion cascades; the definition reference uses the database default action. Credential material is encrypted. |
| `cloud_integration_oauth_client` | Cached static or dynamically registered OAuth client for a definition. |
| `cloud_integration_oauth_flow` | Short-lived OAuth authorization state. Account and user deletion cascade; the definition reference uses the database default action. |
| `cloud_integration_tool_schema_cache` | Account-keyed `tools/list` cache; account deletion cascades. |
| `cloud_integration_tool_call_event` | One audit row per proxied call, including failures. User, organization, and Worker deletion set their attribution fields to null. |
| `cloud_integration_action_approval` | One exact external-action request. Its immutable user, organization, account revision, Worker, and MCP-session identity snapshots deliberately are not foreign keys, so later deletion cannot erase or rewrite the authorization evidence. |
| `cloud_integration_action_approval_event` | Append-only request, decision, expiry, and consumption evidence with immutable actor-id snapshots and a product-safe action summary. |

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

### OAuth scope integrity

Definition config chooses either the default provider-directed OAuth scope
behavior or an exact scope policy. Slack uses the exact policy with this
read/search-only ceiling:

```text
search:read.public
search:read.private
search:read.im
search:read.mpim
search:read.files
search:read.users
```

For an exact policy, an authorization challenge may omit scopes or name a
subset, but it cannot add a scope; Cloud always requests the canonical
configured set. The callback must report that same set before credentials can
become ready. Token parsing accepts standard top-level scope metadata and
Slack's nested user-token scope metadata with comma or whitespace separators.
Slack's token endpoint can also return an HTTP-success response whose JSON body
has `ok: false`. Cloud translates that envelope into a typed provider error
before reading or persisting token fields; callback and refresh surfaces expose
only fixed product-safe codes and messages, never the raw provider payload.
Hosted callback and refresh paths identify Slack from the trusted definition
namespace. Generic protocol callers fall back only to a narrowly validated
equivalent of the canonical Slack token URL; a non-Slack namespace overrides a
Slack-looking URL so other providers retain their existing response semantics.

A refresh response that omits scope metadata preserves the stored value. An
explicit non-empty refresh grant may be a subset but cannot exceed the ceiling;
an explicit empty grant or known stored scope outside the ceiling requires
reauthentication. Legacy Slack bundles with empty scope metadata remain usable
for existing search behavior. This scope ceiling does not authorize outbound
Slack tools; gateway tool authorization is a separate boundary.

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

Desktop enrollment issuance and consumption are serialized per
`desktop_install_id`. Issuing a ticket revokes older pending tickets for that
physical install, so only the newest ticket can enroll; the currently active
Worker remains valid until the replacement consumes its ticket. This prevents
a delayed pre-enrollment Worker from reclaiming authority after its
replacement starts. The response advertises `pendingTicketPolicy =
newest_wins`; repaired Desktop clients defer native Worker cutover and retry
until the serving control plane provides that guarantee, so Desktop artifact
publication does not have to race a matching server deployment.

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

### Gateway execution session

At launch AnyHarness supplies its host-owned workspace and session ids as
static MCP headers. The MCP initialize response mints an opaque, signed
`Mcp-Session-Id` header whose signature binds the authenticated Worker plus
those exact launch ids. Changing or omitting any identity invalidates the
session; a session minted for one Worker, workspace, or AnyHarness session
cannot be replayed in another.
Subsequent approval-gated calls must return that header. Missing or invalid
session state fails before an approval is requested; the agent cannot choose
the trusted session id by supplying prompt text or tool arguments.

An older unbound client can still initialize and use read-only gateway tools,
but cannot request an external-action approval. The signed header narrows an
approval to one gateway execution session and one exact workspace/session
launch. It is not an approval credential: only a product-authenticated human
can approve, reject, or revoke an action.

### Gateway credential file

A fresh Worker enrollment returns the gateway URL and bearer. The Worker
writes them atomically with private permissions to
`<runtime_home>/integration-gateway.json` using
[`integration_gateway.rs`](../../../../anyharness/crates/proliferate-worker/src/integration_gateway.rs).
AnyHarness loads that file at session launch and mounts the integration
gateway when the binding policy permits it. The freshly enrolled Worker keeps
that response in memory and, after each successful authenticated heartbeat,
repairs the file if a delayed predecessor overwrote it. Once a predecessor
observes heartbeat rejection it no longer reasserts its stale bearer; if a
heartbeat succeeded just before revocation and its write lands afterward, the
active successor repairs that final race on its next successful heartbeat.

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

### Slack tool-call policy

The gateway classifies Slack by the exact canonical `(provider, tool)` pair
before account resolution, credential rendering, or an upstream MCP call. The
provider identity must be exactly `slack`; other providers preserve the generic
gateway behavior.

These known read/search tools execute directly:

```text
slack_get_reactions
slack_list_channel_members
slack_list_starred_items
slack_list_user_conversations
slack_list_user_groups
slack_list_workspaces
slack_read_canvas
slack_read_channel
slack_read_file
slack_read_thread
slack_read_user_profile
slack_search_channels
slack_search_emojis
slack_search_public
slack_search_public_and_private
slack_search_users
```

These known external-action tools require approval and are currently rejected
from provider execution after Cloud has created or reused the durable pending
request for the exact action:

```text
slack_add_reaction
slack_complete_file_upload
slack_create_canvas
slack_create_conversation
slack_create_reminder
slack_delete_message
slack_edit_message
slack_get_file_upload_url
slack_invite_to_conversation
slack_join_conversation
slack_leave_conversation
slack_schedule_message
slack_send_message
slack_send_message_draft
slack_update_canvas
slack_update_user_profile
```

Every other Slack tool name fails closed. Matching is case-sensitive and does
not normalize whitespace or infer behavior from prefixes. A known external
action returns the typed code `integration_tool_approval_required` with a
product-safe approval object; an unknown Slack tool returns
`integration_tool_not_allowed`. Both are MCP tool errors and audit as failed
calls. No Slack action is delivered in the current slice, including after its
durable request becomes `approved`.

### Durable external-action approvals

The approval service consumes the pure `ToolCallRequiresApproval` verdict; it
does not accept a provider or tool identity reconstructed from prompt text,
client claims, or arbitrary approval-like tool arguments. One approval binds:

- the exact authenticated product user and personal-or-organization scope;
- the integration account UUID and current `auth_version`;
- the runtime Worker UUID, signed gateway-session UUID, exact AnyHarness
  workspace id, and exact AnyHarness session id;
- the verdict's exact canonical provider and tool; and
- the SHA-256 digest of canonical JSON action arguments.

The combined binding and payload produce a deterministic idempotency key.
Concurrent identical requests in the same authority and execution session
converge on one active row. Actor, account, organization, Worker, and session
identifiers are immutable audit snapshots rather than mutable client claims.

Requests have a 600-second TTL, measured from PostgreSQL
`clock_timestamp()`, and the explicit states `pending`, `approved`,
`rejected`, `revoked`, `expired`, and `consumed`. `expires_at` is the
authoritative time boundary: an approved row cannot be consumed at or after
that instant even if its stored status has not yet changed. List, get,
decision, request-reuse, and admission observations materialize a due active
row as terminal `expired` and append the corresponding system audit event.
Transitions acquire the approval row lock before evaluating that database
clock, so waiting on a lock cannot extend approval validity.

Approval, rejection, revocation, expiry, and the `approved -> consumed`
transition are compare-and-set updates. Consumption matches every bound field
again and succeeds once; replay and concurrent double consumption return the
already-observed terminal result. Request creation and execution admission use
short, independently committed transactions. A future provider delivery may
continue only after the one-time consumption and its audit event have
committed, so a crash cannot roll back admission after credentials or network
I/O begin.

The first-party response contains typed ids, status and timestamps, the payload
digest, and fixed action/account/source labels. Because this slice has no
frozen per-tool argument schema, its reserved target, content-preview, and
character-count fields remain null: guessing among provider aliases or rich
fields could persist a secret or show a benign value while another field is
later delivered. The full provider argument object is canonicalized only long
enough to hash and is never stored or returned. The response never contains
stored credentials, rendered authorization headers, or the raw provider
payload.
Product-user authorization rechecks ownership and active organization
membership for list, get, approve, reject, and revoke operations. A Worker,
gateway bearer, or MCP session cannot call those human decision routes or
bypass them.

### Frozen next Slack delivery slice

The next slice is limited to actual approved delivery of
`slack_send_message`. Its contract is:

1. Add only `chat:write` to the exact six-scope Slack set above and require an
   explicit OAuth reauthorization before a Slack account at the new
   `auth_version` can send. Do not add any other scope.
2. Define one canonical typed `slack_send_message` action with exactly
   `channel_id` (a real `C...`, `G...`, or `D...` Slack conversation id) and a
   non-empty `message` string. Reject aliases, conflicting values, unknown
   fields, blocks, attachments, and the optional draft/thread/broadcast
   variants in this slice. Derive the approval binding, safe UI summary, and
   delivered provider arguments from that same typed object; never select a
   display value and a delivery value through separate parsing paths.
3. Add a separate `approvalId` wrapper field to `integrations.call_tool`; it is
   not part of the provider `arguments` object or its canonical payload digest.
4. On the delivery retry, recompute the typed Slack policy verdict and recheck
   the exact user/organization, account UUID plus current `auth_version`,
   Worker/session, provider/tool, and canonical payload binding.
5. Commit the atomic one-time consumption and audit event before decrypting or
   rendering credentials and before any provider network I/O. Only a newly
   `consumed` result may proceed. Already-consumed, mismatched, expired,
   rejected, revoked, pending, or missing approvals must not call Slack.
6. After that commit, load credentials only by the exact bound
   `(integration_account_id, auth_version)`. Copy that matching ciphertext and
   provider-config snapshot for this delivery or fail closed; never call a
   generic launch resolver that can refetch a newer account revision. A
   reauthorization before the snapshot read therefore prevents delivery, while
   one after the read cannot change which approved workspace credentials are
   used.
7. Provide the first-party confirmation flow over the typed product-user API
   and preserve at-most-once admission and replay-safe double-submit behavior.
8. Prove all paths with deterministic mocks; do not install or reauthorize a
   live Slack account and do not send a live Slack message in tests or rollout
   preparation.

Every other Slack external-action tool remains non-executable and denied from
the delivery path, even if an approval record exists.

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
`/v1/cloud/integrations/admin`. Product-user approval routes are:

```text
GET  /v1/cloud/integrations/action-approvals
GET  /v1/cloud/integrations/action-approvals/{approval_id}
POST /v1/cloud/integrations/action-approvals/{approval_id}/approve
POST /v1/cloud/integrations/action-approvals/{approval_id}/reject
POST /v1/cloud/integrations/action-approvals/{approval_id}/revoke
```

The mounted router files are
[`integrations/api.py`](../../../../server/proliferate/server/cloud/integrations/api.py),
[`action_approvals/api.py`](../../../../server/proliferate/server/cloud/integrations/action_approvals/api.py),
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
- Slack HTTP-success token error envelopes become typed OAuth provider errors
  before token indexing or persistence, and raw provider payloads do not cross
  callback or refresh failure surfaces.
- An exact-policy challenge cannot exceed the ceiling, a callback grant must
  equal the requested set, and an explicit refresh grant must be non-empty and
  remain within the ceiling; failures store no replacement credentials.
- Slack gateway calls use an exact read allowlist, a typed approval-required
  result for known external actions, and a deny-by-default result for unknown
  tools. Known actions persist a narrowly bound request, but this slice never
  delivers them. Agent arguments do not participate in the authorization
  decision.
- The signed MCP session is Worker/workspace/AnyHarness-session bound; missing,
  forged, unbound, or cross-context session state cannot create an approval
  request.
- Approval expiry is governed by `expires_at`, including before its terminal
  row and audit event have been materialized by an observation.
- Account reauthorization increments `auth_version`; an approval for an older
  account revision cannot be consumed.

## Verification

Focused server tests include:

- `server/tests/integration/test_cloud_runtime_workers_api.py`
- `server/tests/integration/test_cloud_runtime_worker_versions_api.py`
- `server/tests/integration/test_cloud_integration_gateway_api.py`
- `server/tests/integration/test_cloud_integration_gateway_tool_policy_api.py`
- `server/tests/integration/test_cloud_integration_action_approvals_api.py`
- `server/tests/integration/test_cloud_integrations_api.py`
- `server/tests/integration/test_cloud_integration_catalog_api.py`
- `server/tests/integration/test_cloud_integration_health_api.py`
- `server/tests/integration/test_integration_provider_access.py`
- `server/tests/integration/test_integration_oauth_scope_policy.py`
- `server/tests/unit/test_cloud_integration_gateway_tool_policy.py`
- `server/tests/unit/test_integration_oauth_tokens.py`

Worker behavior is covered by `cargo test -p proliferate-worker`. For an
enrollment incident, use
[`worker-enrollment-failure.md`](../../../developing/operating/worker-enrollment-failure.md).
