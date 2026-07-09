# Integrations + Runtime Worker Auth

Status: authoritative for the integrations subsystem and the runtime worker
auth model that feeds it. Current-state sweep of the code landed in PRs #823,
#827, #830, #832, #835, #836, #837, #844 (hotfix #872), verified against main.

This primitive owns how a user connects third-party tool providers (Linear,
Notion, Context7, ...) to Proliferate, how those credentials stay in Cloud,
and how an agent running inside AnyHarness reaches those providers through a
single Cloud-hosted MCP gateway. It also owns the runtime worker identity
model (enrollment, heartbeat, tokens) because the gateway's auth is derived
from it.

It is NOT the agent LLM auth system. Harness model credentials, BYOK, and the
agent gateway are a separate primitive: [agent-auth.md](agent-auth.md) and
[agent-auth-bifrost-byok.md](agent-auth-bifrost-byok.md). It is also not the
server's vendor-client layer; see Boundaries below.

## What It Is

Three cooperating pieces:

1. **Integration accounts in Cloud.** Definitions describe providers (seed or
   org-custom), accounts hold a user's encrypted credentials, org policies
   gate visibility. All credential material stays server-side, Fernet
   encrypted (`server/proliferate/db/models/cloud/integrations.py`).
2. **The integration gateway.** A Cloud-hosted HTTP MCP endpoint
   (`/v1/cloud/integration-gateway/mcp`) that AnyHarness attaches to every
   eligible session. It advertises exactly three virtual tools and proxies
   calls to the upstream provider MCP with Cloud-held credentials
   (`server/proliferate/server/cloud/integration_gateway/service.py`).
3. **The runtime worker.** A small Rust sidecar
   (`anyharness/crates/proliferate-worker/`) that enrolls with Cloud from a
   cloud sandbox or a desktop install, heartbeats, and writes the gateway
   bearer token to a dotfile that AnyHarness reads at session launch.

Core invariant: provider credentials never leave Cloud. AnyHarness only ever
holds the Proliferate gateway bearer token.

## Core Concepts

- **Definition** (`cloud_integration_definition`): a provider. `source` is
  `seed` (code-defined, global) or `org_custom` (created by an org admin,
  scoped to that org). `config_json` carries the MCP launch + auth config via
  the codec in `server/proliferate/server/cloud/integrations/config.py`
  (transport, URL spec, header/query templates with `{secret.X}` and
  `{settings.X}` placeholders, secret/settings field schemas).
- **Seed registry**: `SEED_DEFINITIONS` in
  `server/proliferate/server/cloud/integrations/seeds.py`, 14 providers
  (context7, exa, tavily, posthog, sentry, axiom, linear, slack, supabase,
  notion, cloudflare_docs, gitlab, render, neon), ported from the deleted
  `BASE_CONNECTOR_CATALOG`. `sync_seed_definitions` reconciles them into the
  DB at every server boot, from the lifespan in
  `server/proliferate/main.py:230`.
- **Policy** (`cloud_integration_policy`): per-org enable/disable of a
  definition. Absent policy row means the definition's
  `enabled_by_default` applies.
- **Account** (`cloud_integration_account`): a user's authenticated instance
  of a definition, one per (user, definition). `auth_kind` is `oauth2`,
  `api_key`, or `none`; credentials are an encrypted JSON bundle
  (`secret-fields-v1` or `oauth-bundle-v1`); `auth_version` bumps on every
  credential write and invalidates the tool cache. `owner_scope` is
  `personal` only today (the column and CHECK reserve `organization`).
- **OAuth client** (`cloud_integration_oauth_client`): a dynamically
  registered (RFC 7591) or statically configured client, cached per
  (issuer, redirect_uri, definition). Static config exists only for Slack via
  deployment settings (`server/proliferate/config.py:358`), resolved in
  `server/proliferate/server/cloud/integrations/oauth/clients.py`.
- **OAuth flow** (`cloud_integration_oauth_flow`): one in-flight
  authorization: hashed state, encrypted PKCE verifier, surfaces
  (desktop/web), 10 minute TTL.
- **Tool schema cache** (`cloud_integration_tool_schema_cache`): cached
  upstream `tools/list` per account, stamped with the account `auth_version`.
- **Runtime worker** (`cloud_runtime_worker`): the enrolled sidecar process.
  `runtime_kind` is `cloud_sandbox` (identity: `cloud_sandbox_id`) or
  `desktop` (identity: `owner_user_id` + `desktop_install_id`). At most one
  non-revoked worker per identity (partial unique indexes).
- **Enrollment** (`cloud_runtime_worker_enrollment`): a single-use pending
  token that mints a worker. Consumed under row lock; expired rows flip to
  `expired` on touch.
- **Gateway token** (`cloud_integration_gateway_token`): the bearer
  AnyHarness presents to the gateway. One active per worker; revoked together
  with its worker.
- **Gateway grant**: the resolved caller identity
  (`IntegrationGatewayGrant` in
  `server/proliferate/db/store/runtime_workers.py`): worker id, runtime kind,
  owner user, org. All gateway visibility decisions key off this.
- **Virtual tools**: the fixed three-tool surface the gateway advertises
  (`integrations.list_providers`, `integrations.list_tools`,
  `integrations.call_tool`), defined in
  `server/proliferate/server/cloud/integration_gateway/domain/virtual_tools.py`.

## The Two-Token Worker Model

Enrollment returns two secrets with different audiences:

1. **Worker token**: the private worker-to-Cloud bearer. Persisted only in
   the worker's local SQLite (`identity` table,
   `anyharness/crates/proliferate-worker/src/store/migrations.rs`). Used for
   heartbeat. Never visible to AnyHarness.
2. **Gateway token**: the AnyHarness-facing bearer for the integration
   gateway. The worker writes it to
   `<runtime_home>/integration-gateway.json` (0600, atomic rename) via
   `anyharness/crates/proliferate-worker/src/integration_gateway.rs`.
   "AnyHarness enrollment" is nothing more than this file; AnyHarness has no
   other Cloud identity for integrations.

Plus the bootstrap secret that precedes both: the **enrollment token**,
single-use, TTL 1 hour for cloud sandboxes and 15 minutes for desktop
(`server/proliferate/constants/cloud.py:320`).

All three families are stored as HMAC-SHA256 hashes keyed by
`settings.cloud_secret_key` over `"{domain}:{token}"`, with a distinct domain
per family so a raw value can never authenticate against the wrong table
(`server/proliferate/db/store/runtime_workers.py:34`, domains at
`server/proliferate/constants/cloud.py:314`).

Lifecycle rules (all in
`server/proliferate/server/cloud/runtime_workers/service.py` and
`server/proliferate/db/store/runtime_workers.py`):

- Consuming an enrollment revokes any prior non-revoked worker and its
  gateway tokens for the same identity, then creates the new worker
  (`token_urlsafe(48)`) and gateway token. Re-enrollment therefore rotates
  both tokens.
- Heartbeat interval is 30s; a worker is `online` when its `last_seen_at` is
  within 90s, derived at read time (`RuntimeWorkerValue.online`); nothing
  writes `offline` eagerly and nothing gates on worker status.
- Destroying a cloud sandbox revokes its workers and gateway tokens
  (`server/proliferate/server/cloud/cloud_sandboxes/service.py:77`).

## Data Model

Nine tables across two migrations. No foreign key constraints were created
(deliberate deferral, see Known Gaps); relations are by bare UUID columns.
Presence is asserted in
`server/tests/integration/schema_migration_assertions.py`.

Worker auth, migration
`server/alembic/versions/b8c9d0e1f2a3_runtime_worker_auth.py`, models in
`server/proliferate/db/models/cloud/runtime_workers.py`:

| Table | One line |
| --- | --- |
| `cloud_runtime_worker` | Enrolled worker identity; kind/identity CHECK; partial-unique one non-revoked per sandbox and per (owner, desktop install); status online/offline/revoked. |
| `cloud_runtime_worker_enrollment` | Single-use pending enrollment; token_hash unique; status pending/consumed/expired/revoked; expires_at. |
| `cloud_integration_gateway_token` | AnyHarness gateway bearer; partial-unique one active per worker; last_used_at bumped on every gateway request. |

Integrations, migration
`server/alembic/versions/d7f3a91c4b2e_integration_models.py`, models in
`server/proliferate/db/models/cloud/integrations.py`:

| Table | One line |
| --- | --- |
| `cloud_integration_definition` | Provider (seed/org_custom); namespace unique per seed scope and per (org, namespace); auth_kind; oauth_client_mode; config_json codec payload; enabled_by_default; archived_at. |
| `cloud_integration_policy` | Org enable/disable per definition; unique (organization_id, definition_id); updated_by_user_id. |
| `cloud_integration_account` | User's credentialed instance; unique (owner_user_id, definition_id); status setup_required/ready/error; credential_ciphertext + credential_format + auth_version; token_expires_at; last_error_code. |
| `cloud_integration_oauth_client` | DCR or static OAuth client per (issuer, redirect_uri, definition); encrypted client secret + registration access token. |
| `cloud_integration_oauth_flow` | In-flight authorization: state_hash, encrypted PKCE verifier, token_endpoint, surfaces, status active/exchanging/completed/expired/cancelled/failed. |
| `cloud_integration_tool_schema_cache` | Cached tools/list per account (PK account_id); auth_version stamp; content_hash; status ready/stale/error. |

Stores are one module per table family under
`server/proliferate/db/store/integrations/`:
`server/proliferate/db/store/integrations/accounts.py`,
`server/proliferate/db/store/integrations/definitions.py`,
`server/proliferate/db/store/integrations/policies.py`,
`server/proliferate/db/store/integrations/oauth_clients.py`,
`server/proliferate/db/store/integrations/oauth_flows.py`,
`server/proliferate/db/store/integrations/tool_cache.py`, plus
`server/proliferate/db/store/runtime_workers.py` for the worker tables.

## Request Flows

### Cloud sandbox worker enrolls (sidecar boot)

1. `connect_ready_sandbox` launches AnyHarness directly (unchanged runtime
   path), then calls `launch_worker_sidecar`
   (`server/proliferate/server/cloud/materialization/sandbox_io/connect.py:212`).
2. `launch_worker_sidecar`
   (`server/proliferate/server/cloud/materialization/sandbox_io/worker_sidecar.py`)
   mints an enrollment in its own committed transaction (so the separate
   worker process can see it), writes the worker `config.toml` into the
   sandbox, and launches the binary detached behind a `test -x` guard (a
   stale template without the binary means no worker this run). Every failure
   is logged and swallowed: the sandbox is fully usable over its direct
   AnyHarness bearer without a worker.
3. Paths come from `server/proliferate/server/cloud/runtime/bootstrap.py`:
   binary `~/.proliferate/bin/proliferate-worker`, config
   `~/.proliferate/worker/config.toml`, DB
   `~/.proliferate/worker/worker.sqlite3`, log `~/proliferate-worker.log`.
4. The worker (`anyharness/crates/proliferate-worker/src/runtime.rs`) takes a
   process lock on the DB path (relaunch is a no-op), loads or creates its
   identity via `ensure_enrolled`
   (`anyharness/crates/proliferate-worker/src/identity/mod.rs`): if the
   `identity` row exists it skips enrollment; otherwise it POSTs
   `/v1/cloud/worker/enroll` with the enrollment token
   (`anyharness/crates/proliferate-worker/src/identity/enrollment.rs`,
   transport in `anyharness/crates/proliferate-worker/src/cloud_client/auth.rs`),
   saves worker_id + worker_token to SQLite, scrubs the enrollment token from
   `config.toml`, and writes the gateway dotfile.
5. Server side, `enroll_worker`
   (`server/proliferate/server/cloud/runtime_workers/service.py`) consumes
   the enrollment under `SELECT ... FOR UPDATE`, revokes the prior worker for
   the identity, creates worker + gateway token, and responds with
   `{workerId, workerToken, heartbeatIntervalSeconds, integrationGateway:
   {url, authorization}}`
   (`server/proliferate/server/cloud/runtime_workers/models.py`). The gateway
   URL is `settings.cloud_worker_base_url` (falling back to `api_base_url`,
   `server/proliferate/config.py:327`) plus
   `CLOUD_INTEGRATION_GATEWAY_MCP_PATH`
   (`server/proliferate/constants/cloud.py:325`).

### Desktop worker enrolls

1. `AuthenticatedAppHost` mounts the once-per-session hook
   (`apps/desktop/src/pages/AuthenticatedAppHost.tsx:25`,
   `apps/desktop/src/hooks/cloud/lifecycle/use-desktop-worker-enrollment.ts`).
2. `ensureDesktopWorker`
   (`apps/desktop/src/lib/workflows/cloud/ensure-desktop-worker.ts`) reads
   the persisted install UUID (created on first use by the Tauri command in
   `apps/desktop/src-tauri/src/commands/desktop_identity.rs`, TS wrapper
   `apps/desktop/src/lib/access/tauri/desktop-install-id.ts`), calls the
   user-authed `POST /v1/cloud/workers/desktop/enrollment`
   (`server/proliferate/server/cloud/runtime_workers/api.py`, SDK
   `cloud/sdk/src/client/desktop-workers.ts`), then invokes
   `ensure_desktop_dispatch_worker`
   (`apps/desktop/src-tauri/src/commands/cloud_worker.rs`, TS wrapper
   `apps/desktop/src/lib/access/tauri/cloud-worker.ts`). Failures never block
   login; they go to telemetry.
3. The Tauri command keys the worker's config/DB dir by install id, sets
   `integration_gateway_home` to the AnyHarness runtime home so the dotfile
   lands where the local runtime reads it, deletes a stale `worker.sqlite3`
   when a fresh enrollment token arrives, and spawns the worker binary. The
   input field is still named `targetId` but carries the desktop install id
   (naming vestige).
4. Desktop workers are user-scoped: `organization_id` NULL on the worker row.
   Org visibility is supposed to be resolved dynamically at gateway call time
   (see Known Gaps for the current state of that).

### Heartbeat

Worker loop (`anyharness/crates/proliferate-worker/src/lifecycle/heartbeat.rs`)
POSTs `/v1/cloud/worker/heartbeat` with its worker bearer every
`heartbeat_interval_seconds` (floored at 10s;
`anyharness/crates/proliferate-worker/src/config.rs` defaults 30). Server
auth is `authenticate_worker`
(`server/proliferate/server/cloud/runtime_workers/auth.py`); the handler
ignores the request body and bumps `last_seen_at`
(`server/proliferate/server/cloud/runtime_workers/api.py`). Ack parsing is in
`anyharness/crates/proliferate-worker/src/cloud_client/heartbeat.rs`.

### AnyHarness injects the gateway MCP server

At session launch the `IntegrationGatewaySessionLaunchExtension`
(`anyharness/crates/anyharness-lib/src/domains/sessions/mcp_bindings/integration_gateway.rs`),
registered in the session-extensions vec at
`anyharness/crates/anyharness-lib/src/app/mod.rs:277`, loads the dotfile via
the pure loader `IntegrationGatewayConfig::load`
(`anyharness/crates/anyharness-lib/src/integrations/integration_gateway.rs`)
and injects `SessionMcpServer::Http` named `proliferate_integrations` with a
single `authorization` header. Missing/invalid dotfile is a silent no-op;
sessions with `SessionMcpBindingPolicy::InternalOnly` are skipped; logs carry
the gateway host only, never the URL path or the header value. Generic MCP
assembly stays with [mcp-runtime.md](mcp-runtime.md).

### Agent calls a virtual tool end to end

1. Agent POSTs MCP JSON-RPC to `/v1/cloud/integration-gateway/mcp`
   (`server/proliferate/server/cloud/integration_gateway/api.py`; GET answers
   405 with `Allow: POST` so streamable-HTTP clients stop re-opening the
   event stream; single and batch payloads are dispatched per message;
   notification-only input returns 202).
2. `require_integration_gateway_grant`
   (`server/proliferate/server/cloud/integration_gateway/dependencies.py`)
   hashes the bearer under the gateway domain, resolves active token to
   non-revoked worker to `IntegrationGatewayGrant`, bumping `last_used_at`
   (`server/proliferate/db/store/runtime_workers.py:316`).
3. `handle_integration_gateway_json_rpc`
   (`server/proliferate/server/cloud/integration_gateway/service.py`) handles
   `initialize` (protocol `2025-06-18`, server `proliferate_integrations`),
   `notifications/initialized` (no reply), `tools/list` (the three virtual
   tool definitions), and `tools/call`. Argument parsing lives in
   `server/proliferate/server/cloud/integration_gateway/domain/tool_args.py`,
   JSON-RPC envelope helpers in
   `server/proliferate/server/cloud/integration_gateway/domain/json_rpc.py`.
4. Visibility: `ready_accounts_for_grant` returns the grant owner's enabled +
   `ready` accounts whose definition is not archived
   (`server/proliferate/db/store/integrations/accounts.py:109`). See Known
   Gaps: no org-policy filter is applied here yet.
5. `integrations.call_tool` resolves the account
   (`integration_provider_not_found` 404 on a bad namespace), renders launch
   material via `resolve_launch`
   (`server/proliferate/server/cloud/integrations/access.py`), and proxies
   through the outbound MCP client
   (`server/proliferate/integrations/mcp_remote.py`): initialize handshake,
   then `tools/call`; tolerant of both `application/json` and SSE response
   bodies; per-operation 45s overall deadline on top of httpx timeouts.
6. Tool-level failures (`CloudApiError`, `McpRemoteError`) return as MCP
   `isError` results, not transport errors, so agents can react and sibling
   batch entries still answer. Successful results are returned both as a JSON
   text content block and as `structuredContent`.
7. `integrations.list_tools` serves from
   `get_or_refresh_tool_cache`
   (`server/proliferate/server/cloud/integrations/tools.py`): a `ready` cache
   matching the account's `auth_version` is returned directly; otherwise the
   upstream `tools/list` is fetched and re-cached; fetch failure marks the
   cache `error` and re-raises.

### Credential resolution (`ensure_provider_access`)

`server/proliferate/server/cloud/integrations/access.py`:

- `none`: empty headers/query.
- `api_key`: decrypt the `secret-fields-v1` bundle, render header/query
  templates (`{secret.<id>}`, `{settings.<id>}`); CRLF in a rendered header
  is rejected; unresolved placeholders raise `integration_config_invalid`.
- `oauth2`: use the `oauth-bundle-v1` access token; when missing or within a
  60s expiry skew, refresh via the stored token endpoint (resolving the
  cached OAuth client for its secret/auth method), persist the re-encrypted
  bundle, and continue. Refresh failure raises
  `integration_reauth_required` (401). An `Authorization: Bearer` header is
  guaranteed present.

### User connects an integration (OAuth)

1. Desktop calls `POST /v1/cloud/integrations/authentications`
   (`server/proliferate/server/cloud/integrations/api.py`). For `none` the
   account is ready immediately; for `api_key` the key is stored under the
   definition's first secret field and the account is ready; for `oauth2` the
   account is upserted as `setup_required` and a flow starts
   (`server/proliferate/server/cloud/integrations/service.py`).
2. `start_oauth_flow`
   (`server/proliferate/server/cloud/integrations/oauth/service.py`)
   discovers protected-resource + authorization-server metadata, resolves the
   OAuth client (DCR register-once-and-cache, or the static Slack client;
   `server/proliferate/server/cloud/integrations/oauth/clients.py`), mints
   state + PKCE verifier, persists the flow (canceling any prior active flow
   for the user + definition), and returns the authorization URL. The
   discovery/DCR/token machinery lives in
   `server/proliferate/integrations/integration_oauth/` (protocol-only, no DB
   access).
3. Browser returns to the shared callback
   `GET /v1/cloud/integrations/oauth/callback`. `complete_oauth_callback`
   claims the flow by state hash (single-use, `exchanging`), exchanges the
   code with PKCE, stores the encrypted `oauth-bundle-v1` on the account
   (status `ready`), and completes the flow. An `invalid_client` token error
   drops the cached DCR client so the next attempt re-registers.
4. The response surface depends on the flow: desktop flows render an HTML
   page that fires a `proliferate://` deep link
   (`server/proliferate/server/cloud/integrations/pages.py`); web flows 303
   to the frontend completion path. The desktop pane polls
   `GET /v1/cloud/integrations/oauth/flows/{id}` (cancel via
   `POST .../cancel`) until terminal
   (`apps/desktop/src/hooks/access/cloud/integrations/use-integration-oauth-flow.ts`).
5. Disconnect is `DELETE /v1/cloud/integrations/accounts/{id}` (owner only),
   which also drops the tool cache.

### Admin configures org integrations

Org-admin guarded routes under `/v1/cloud/integrations/admin`
(`server/proliferate/server/cloud/integrations/api.py`, enforcement in
`server/proliferate/server/cloud/integrations/service.py`):

- `GET /organizations/{org}/definitions`: seeds + that org's customs with
  policy overlay (`effective_enabled`).
- `POST /organizations/{org}/definitions`: create an org-custom HTTP MCP
  definition (namespace regex `^[a-z0-9][a-z0-9_-]{0,63}$`, http(s) URL
  validation, `auth_kind='none'` only), auto-enabling its policy.
- `PATCH .../definitions/{id}/enabled`: upsert the policy row. Disabling
  never deletes user credentials; it only flips visibility.

### Health

`GET /v1/cloud/integrations/health`
(`server/proliferate/server/cloud/integrations/health.py`) returns one
verdict per visible definition: `ready`, `needs_auth`, `needs_reauth`,
`disabled_by_user`, `disabled_by_org`, or `error`, plus
`token_expires_at`, `tool_count` (from the cache), and `last_error_code`.
OAuth accounts claiming `ready` are actively probed via
`ensure_provider_access` so silently expired refresh tokens surface as
`needs_reauth` instead of failing mid-session. Passing `organizationId` is
membership-guarded (404 for non-members) so org customs cannot be enumerated
cross-tenant. `GET /v1/cloud/integrations/catalog` mirrors the same
visibility rules and exposes connect-time field schemas (metadata only, never
secret values or header templates).

## API Surface

Mounted in `server/proliferate/server/cloud/api.py` under `/v1/cloud`:

- Worker (bearer or public): `POST /worker/enroll`,
  `POST /worker/heartbeat`; user-authed
  `POST /workers/desktop/enrollment`
  (`server/proliferate/server/cloud/runtime_workers/api.py`). This is the
  entire worker API; command lease/delivery, events, exposures, and the rest
  of the old worker protocol were deleted in #823, to be rebuilt separately.
- Gateway (gateway-token bearer): `GET|POST /integration-gateway/mcp`
  (`server/proliferate/server/cloud/integration_gateway/api.py`).
- Integrations (user-authed): catalog, health, authentications, account
  delete, oauth flow status/cancel, oauth callback, admin definitions
  (`server/proliferate/server/cloud/integrations/api.py`, response models in
  `server/proliferate/server/cloud/integrations/models.py`).

SDK client modules: `cloud/sdk/src/client/integrations.ts` and
`cloud/sdk/src/client/desktop-workers.ts`.

## Desktop UI Entry Points

Settings-only by locked decision: no sidebar item, no `/integrations` page.

- User settings pane:
  `apps/desktop/src/components/settings/panes/UserIntegrationsPane.tsx`
  (connect/disconnect, health badges, OAuth return handling), with shared
  pieces in `apps/desktop/src/components/settings/panes/integrations/`
  (`IntegrationRow.tsx`, `IntegrationConnectDialog.tsx`,
  `IntegrationIcon.tsx`, `AddCustomIntegrationDialog.tsx`).
- Org admin pane:
  `apps/desktop/src/components/settings/panes/OrganizationIntegrationsPane.tsx`
  (policy switches + custom definition creation).
- Data hooks: facade
  `apps/desktop/src/hooks/cloud/facade/use-cloud-integrations.ts` over the
  access hooks in `apps/desktop/src/hooks/access/cloud/integrations/`
  (`use-integration-catalog.ts`, `use-integration-health.ts`,
  `use-integration-actions.ts`, `use-integration-oauth-flow.ts`,
  `use-admin-integration-definitions.ts`).
- Proactive surfacing: the composer chip
  `apps/desktop/src/components/workspace/chat/input/ComposerIntegrationReauthChip.tsx`
  (mounted in
  `apps/desktop/src/components/workspace/chat/input/ChatInputControlRow.tsx`)
  appears only when a connected integration reports `needs_reauth`
  (`apps/desktop/src/hooks/cloud/derived/use-integration-reauth-state.ts`)
  and deep-links to the settings section.

## Boundaries

- **Agent auth / LLM gateway is a different primitive.** Harness credential
  selection, synced auth files, BYOK, and the agent gateway
  (`server/proliferate/server/cloud/agent_gateway/`) belong to
  [agent-auth.md](agent-auth.md) and
  [agent-auth-bifrost-byok.md](agent-auth-bifrost-byok.md). "Gateway" in this
  spec always means the integration MCP gateway.
- **`server/proliferate/integrations/` is the server's vendor-client layer**,
  a structure with its own rules
  ([../structures/server/guides/integrations.md](../structures/server/guides/integrations.md)):
  no DB access, protocol/vendor code only. This primitive's outbound pieces
  live there by that rule (`server/proliferate/integrations/mcp_remote.py`,
  `server/proliferate/integrations/integration_oauth/`), but most of the
  primitive lives in `server/proliferate/server/cloud/integrations/` and
  siblings. Do not conflate the two directories.
- **Generic MCP session assembly belongs to
  [mcp-runtime.md](mcp-runtime.md).** This primitive contributes exactly one
  session extension and one pure dotfile loader on the Rust side; product
  MCP servers, bindings, and elicitation are out of scope here. The Rust
  boundary is enforced by shape checks: the extension lives in
  `anyharness/crates/anyharness-lib/src/domains/sessions/mcp_bindings/`, the
  loader in `anyharness/crates/anyharness-lib/src/integrations/` (which must
  not import domains).
- **The worker is not a command executor.** Everything the old worker did
  besides enroll/heartbeat/dotfile (command leases, tails, materialization,
  exposures) was deleted, and [cloud-commands.md](cloud-commands.md)
  describes the pre-deletion system; a clean command flow is a future
  workstream.

## Divergences From The Approved Plan

The landed code deviates from the 2026-07-01 plan in these places (code
wins; listed for the record):

- **No gateway-side org policy enforcement.** The plan specified call-time
  visibility rules (cloud org worker filtered by that org's policy; desktop
  worker seeing seeds plus policy-enabled org customs across memberships).
  Landed `ready_accounts_for_grant` filters only by the owning user's
  enabled + ready accounts and non-archived definitions; org policy and
  definition source are enforced in the health/catalog UI surfaces but not
  at the gateway. Tracked follow-up, not an accident.
- **No FK constraints.** The plan sketched FKs with CASCADE on the worker
  and gateway-token tables; the migrations create bare UUID columns with
  partial unique indexes instead. Deferred by decision; revocation is done
  explicitly in code paths (enroll, sandbox destroy).
- **Gateway GET returns 405, not 204.** The MCP streamable-HTTP transport
  needs 405 + `Allow: POST` so clients stop re-opening the event stream.
- **PR shape changed.** Planned PR D (virtual tools) folded into the gateway
  endpoint PR (#832); the Rust runtime_config gutting + injection landed as
  a sibling (#837). The desktop UI landed later as #844 with a revised
  locked scope (settings-only panes + composer chip instead of the broader
  plan F chat surfacing).
- **Enroll/heartbeat protocol carries dead fields.** The worker sends
  `machineFingerprint`, `hostname`, `workerVersion` on enroll and a `status`
  on heartbeat; the server accepts and ignores all of them
  (`server/proliferate/server/cloud/runtime_workers/api.py` deletes the
  heartbeat body; `enroll_worker` reads only the token).
- **Dotfile write happens only on a fresh enroll.** The plan said "rewritten
  on every (re)enroll"; the code matches that literally, but a worker that
  restarts with an intact identity does not rewrite the dotfile, so a
  deleted dotfile is not self-healed short of wiping `worker.sqlite3`.
- **Schema grew beyond the sketch.** `auth_version` + `content_hash` on the
  tool cache, `credential_format`/`token_expires_at` on accounts,
  `oauth_client_mode` on definitions, and the six-state OAuth flow status
  all exceed the plan's table sketches.
- **The old `gmail` stdio connector was not ported** (seed registry docstring
  marks it as follow-up; the stdio config types in
  `server/proliferate/server/cloud/integrations/config.py` are reserved but
  unused).

## Known Gaps And Follow-Ups

Verified still open against this code:

- Gateway-side org-policy and definition-source enforcement (see above); an
  org admin disabling a definition today does not cut off an
  already-connected account's gateway access.
- FK constraints and schema vestiges (unused `stale` cache status in the
  CHECK, `json-v1` default `credential_format`, `owner_scope='organization'`
  allowed by CHECK but unimplemented).
- Dead enroll/heartbeat protocol fields (drop or start recording them).
- Tool schema cache has no time-based TTL: it refreshes only on
  `auth_version` change or after an error; a provider that adds tools is
  stale until the user re-authenticates.
- `last_used_at` is written on every gateway request (no throttling), one
  UPDATE per tool call.
- Dead legacy constants `CLOUD_WORKER_TOKEN_DOMAIN` and
  `SUPPORTED_CLOUD_WORKER_STATUSES` remain in
  `server/proliferate/constants/cloud.py:290` with no importers.
- Desktop Tauri input still names the install id `targetId`
  (`apps/desktop/src-tauri/src/commands/cloud_worker.rs`).
- Migration docstring headers carry stale revision ids (the `revision`
  variables are correct; the `Revision ID:` comment lines are not).
- stdio transport (and the gmail seed) unimplemented.
- Adjacent, not owned here: `DirectAttachAuthConfig` in
  `anyharness/crates/anyharness-lib/src/api/auth.rs` is test-only
  (keep-or-delete decision pending).

## Tests

- Worker enroll/heartbeat/desktop enrollment:
  `server/tests/integration/test_cloud_runtime_workers_api.py` (CI has no
  `.env`; enrollment tests monkeypatch `settings.cloud_worker_base_url`).
- Gateway JSON-RPC + virtual tools + grant auth:
  `server/tests/integration/test_cloud_integration_gateway_api.py`.
- Management APIs / catalog / health:
  `server/tests/integration/test_cloud_integrations_api.py`,
  `server/tests/integration/test_cloud_integration_catalog_api.py`,
  `server/tests/integration/test_cloud_integration_health_api.py`.
- Provider access / refresh / template rendering:
  `server/tests/integration/test_integration_provider_access.py`,
  `server/tests/unit/test_integration_config.py`.
- Rust: dotfile loader + extension tests in-module
  (`anyharness/crates/anyharness-lib/src/integrations/integration_gateway.rs`,
  `anyharness/crates/anyharness-lib/src/domains/sessions/mcp_bindings/integration_gateway.rs`);
  worker crate tests run under `cargo test`.
- Desktop: co-located `.test.tsx`/`.test.ts` next to the panes, chip, and
  reauth-state hook.
