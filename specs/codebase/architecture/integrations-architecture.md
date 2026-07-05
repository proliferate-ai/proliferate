# Integrations + Runtime Worker Auth

Status: authoritative for the integrations subsystem and the runtime worker
auth model that feeds it. Original-state sweep of the code landed in PRs #823,
#827, #830, #832, #835, #836, #837, #844 (hotfix #872); this revision folds in
the six follow-up PRs #893, #894, #895, #897, #902, #905. Verified against
`origin/main` at commit `2803dfbb4` (2026-07-03).

This primitive owns how a user connects third-party tool providers (Linear,
Notion, Context7, ...) to Proliferate, how those credentials stay in Cloud,
and how an agent running inside AnyHarness reaches those providers through a
single Cloud-hosted MCP gateway. It also owns the runtime worker identity
model (enrollment, heartbeat, tokens) because the gateway's auth is derived
from it.

It is NOT the agent LLM auth system. Harness model credentials, BYOK, and the
agent gateway are a separate primitive: [agent-auth.md](../specs/codebase/primitives/agent-auth.md) and
[agent-auth-bifrost-byok.md](../specs/codebase/primitives/agent-auth-bifrost-byok.md). It is also not the
server's vendor-client layer; see Boundaries below.

This doc reads bottom-up: the data model first, then a map of where the code
lives, then the concepts, the two-token model, the request flows, and the
surfaces built on top.

## What It Is

Three cooperating pieces:

1. **Integration accounts in Cloud.** Definitions describe providers (seed or
   org-custom), accounts hold a user's encrypted credentials, org policies
   gate visibility. All credential material stays server-side, Fernet
   encrypted ([`server/proliferate/db/models/cloud/integrations.py`](../../../server/proliferate/db/models/cloud/integrations.py)).
2. **The integration gateway.** A Cloud-hosted HTTP MCP endpoint
   (`/v1/cloud/integration-gateway/mcp`) that AnyHarness attaches to every
   eligible session. It advertises exactly three virtual tools and proxies
   calls to the upstream provider MCP with Cloud-held credentials
   ([`server/proliferate/server/cloud/integration_gateway/service.py`](../../../server/proliferate/server/cloud/integration_gateway/service.py)).
3. **The runtime worker.** A small Rust sidecar
   ([`anyharness/crates/proliferate-worker/`](../anyharness/crates/proliferate-worker)) that enrolls with Cloud from a
   cloud sandbox or a desktop install, heartbeats, and writes the gateway
   bearer token to a dotfile that AnyHarness reads at session launch.

Core invariant: provider credentials never leave Cloud. AnyHarness only ever
holds the Proliferate gateway bearer token.

## The Data Model, End to End

Nine tables carry the whole subsystem: six for integrations
([`server/proliferate/db/models/cloud/integrations.py`](../../../server/proliferate/db/models/cloud/integrations.py)) and three for the
runtime worker identity that feeds the gateway
([`server/proliferate/db/models/cloud/runtime_workers.py`](../../../server/proliferate/db/models/cloud/runtime_workers.py)). Every id is a
UUID PK, every table carries `created_at`/`updated_at` (`updated_at` on
`onupdate=utcnow`), and no plaintext credential ever lands in a column — secret
material is Fernet-encrypted into `*_ciphertext` columns. They are presented
here in dependency order: definitions first (everything points at them), then
org policy, the user's account, the OAuth client/flow and tool cache hung off
that account, then the worker identity, its enrollment, and the gateway token.

### `cloud_integration_definition` — the provider

A provider description: what MCP endpoint to talk to and how to authenticate.
`source` (CHECK `seed`|`org_custom`) splits the two populations — a `seed`
definition is code-defined and global (`SEED_DEFINITIONS`, reconciled at every
boot), an `org_custom` definition is created by an org admin and lives only in
that org. A CHECK ties `source` to ownership:
`organization_id` (FK `organization.id`, **CASCADE**, nullable) must be NULL for
seeds and NON-null for org customs. Two partial unique indexes enforce namespace
scoping: `namespace` is unique across seeds (`postgresql_where source='seed'`)
and unique per `(organization_id, namespace)` across org customs. `auth_kind`
(CHECK `oauth2`|`api_key`|`none`) and the nullable `oauth_client_mode` (`dcr`
for DCR OAuth) describe the auth path — as of #902 an org custom, not just a
seed, may be `oauth2`/`dcr`. `config_json` (Text, default `"{}"`) holds the
codec payload (transport, URL/header/query templates, secret + settings field
schemas); `enabled_by_default` (Boolean, default true) is the org-policy
fallback; `archived_at` (nullable) soft-retires a definition. No FK points *out*
of a definition except its owning org — it is the root every other integration
row references.

### `cloud_integration_policy` — per-org enable/disable

One row per `(organization_id, definition_id)` (UNIQUE
`uq_cloud_integration_policy_org_definition`) recording an org admin's explicit
enable/disable of a definition; absent row means the definition's
`enabled_by_default` applies. `organization_id` (FK `organization.id`,
**CASCADE**) and `definition_id` (FK `cloud_integration_definition.id`, default
**NO ACTION**/RESTRICT) are the composite key. `enabled` (Boolean) is the
verdict. `updated_by_user_id` (FK `user.id`, **NO ACTION**) is attribution, not
ownership — deliberately RESTRICT so deleting the acting admin can never cascade
away (and silently re-enable) an org's policy.

### `cloud_integration_account` — the user's credentialed instance

A user's authenticated instance of a definition, one row per
`(owner_user_id, definition_id)` (UNIQUE
`uq_cloud_integration_account_owner_definition`). `owner_user_id` (FK `user.id`,
**CASCADE**) is the owner; `definition_id` (FK, **NO ACTION**) the provider.
`owner_scope` (CHECK `personal`|`organization`) is `personal` only today — the
`organization` arm is reserved and unimplemented. `status` (CHECK
`setup_required`|`ready`|`error`) tracks connect progress; `auth_kind` (CHECK
`oauth2`|`api_key`|`none`) mirrors the resolved auth. The credential lives in
`credential_ciphertext` (Text, nullable, Fernet) tagged by `credential_format`
(String(64), **nullable — NULL until credentials are stored**, then the real
`secret-fields-v1`/`oauth-bundle-v1`; the old `json-v1` default was dropped in
#895). `auth_version` (Integer, default 1) is the optimistic-concurrency /
cache-invalidation counter: it bumps on every credential write and any tool
cache stamped with an older value is stale. `token_expires_at` (nullable) and
`last_error_code` (nullable) support health probing; `settings_json` carries
non-secret settings.

### `cloud_integration_oauth_client` — the registered OAuth client

A per-definition OAuth client, either dynamically registered (RFC 7591 DCR) or
statically configured (Slack only), cached so registration happens once. Keyed
UNIQUE on `(issuer, redirect_uri, definition_id)`
(`uq_cloud_integration_oauth_client_key`); `definition_id` (FK, **NO ACTION**)
is the only FK. `client_id` is plaintext; the sensitive fields are encrypted —
`client_secret_ciphertext` and `registration_access_token_ciphertext` (both
nullable Text). `token_endpoint_auth_method`, `registration_client_uri`,
`resource`, and `client_secret_expires_at` round out the RFC 7591/7592
registration record.

### `cloud_integration_oauth_flow` — one in-flight authorization

A single in-flight authorization: hashed state, encrypted PKCE verifier, and the
surfaces to return to. `account_id` (FK `cloud_integration_account.id`,
**CASCADE**, nullable — the account may not exist yet at flow start) is the pure
derivative link that dies with its account; `owner_user_id` (FK, **CASCADE**)
and `definition_id` (FK, **NO ACTION**) pin the who/what. `state_hash`
(String(128), indexed) is the single-use claim key; `code_verifier_ciphertext`
holds the PKCE verifier encrypted. `callback_surface`/`final_surface` (CHECK
`desktop`|`web`) drive the response rendering. `status` (CHECK
`active`|`exchanging`|`completed`|`expired`|`cancelled`|`failed`) is the
six-state lifecycle. `expires_at` (indexed) enforces the 10-minute TTL; `used_at`
/`cancelled_at`/`failure_code` capture terminal detail.

### `cloud_integration_tool_schema_cache` — cached `tools/list`

One cached upstream `tools/list` per account — note the **PK is `account_id`
itself** (FK `cloud_integration_account.id`, **CASCADE**), so the cache is a
strict 1:1 derivative that dies with its account. `auth_version` (Integer) is
the snapshot of the account's `auth_version` at fetch time; a mismatch means the
cache is stale. `tools_json` holds the schema, `content_hash` its digest.
`status` (CHECK narrowed to `ready`|`error` — the `stale` value was dropped in
#895) is never used to mark staleness: staleness is *derived* from the
`auth_version` snapshot plus `fetched_at` age against the 24h TTL
(`CLOUD_INTEGRATION_TOOL_CACHE_TTL_SECONDS = 86400`,
[`server/proliferate/constants/cloud.py`](../../../server/proliferate/constants/cloud.py)). `fetched_at` (nullable) is the TTL
clock; `error_code` records the last transient failure.

### `cloud_runtime_worker` — the enrolled sidecar identity

The enrolled worker process — a cloud sandbox sidecar or a desktop install
process — that authenticates back to Cloud. `runtime_kind` (CHECK
`cloud_sandbox`|`desktop`) selects the identity shape, enforced by a CHECK: a
`cloud_sandbox` worker has `cloud_sandbox_id` NON-null and `desktop_install_id`
NULL; a `desktop` worker the reverse (`desktop_install_id` String(255) NON-null,
`cloud_sandbox_id` NULL). Two partial unique indexes hold "one live worker per
identity": `ux_cloud_runtime_worker_active_sandbox` on `cloud_sandbox_id`
(`where status != 'revoked' AND cloud_sandbox_id IS NOT NULL`) and
`ux_cloud_runtime_worker_active_desktop` on `(owner_user_id, desktop_install_id)`
(same non-revoked guard). `owner_user_id` (FK `user.id`, **CASCADE**),
`organization_id` (FK `organization.id`, **CASCADE**, **nullable** — populated
for org-scoped desktop enrollments since #894, NULL for org-less workers), and
`cloud_sandbox_id` (FK `cloud_sandbox.id`, **CASCADE**, nullable) are the FK
edges. `token_hash` (String(64), unique) is the HMAC of the private worker→Cloud
bearer; `status` (CHECK `online`|`offline`|`revoked`, default `online`) — though
`online`/`offline` is derived at read time from `last_seen_at`, nothing writes
`offline` eagerly. Four nullable metadata columns
`worker_version(64)`/`anyharness_version(64)`/`hostname(255)`/`machine_fingerprint(128)`
are written at enroll and forward-only on heartbeat (#895/#897).
`last_seen_at`/`enrolled_at`/`revoked_at` timestamp the lifecycle.

### `cloud_runtime_worker_enrollment` — the single-use mint ticket

The pending, single-use token that mints a worker. `token_hash` (String(64),
unique) is the enrollment secret's HMAC; `status` (CHECK
`pending`|`consumed`|`expired`|`revoked`, default `pending`) is consumed under
row lock. It mirrors the worker's identity columns — `owner_user_id` (FK,
**CASCADE**), `organization_id` (FK, **CASCADE**, **nullable** — a desktop
enrollment now carries a client-declared, membership-validated org that is
inherited by the minted worker + grant, #894), `cloud_sandbox_id` (FK,
**CASCADE**, nullable), `desktop_install_id` (String(255), nullable) — plus
`created_by_user_id` (FK `user.id`, **NO ACTION**), attribution held RESTRICT so
deleting the acting user cannot silently drop the enrollment. `expires_at`
(indexed) enforces the TTL (1h cloud sandbox, 15m desktop); expired rows flip to
`expired` on touch. `consumed_at` timestamps the mint.

### `cloud_integration_gateway_token` — the AnyHarness-facing bearer

The bearer AnyHarness presents to the integration gateway, one active per worker
(partial unique `ux_cloud_integration_gateway_token_active_worker` on
`runtime_worker_id` `where status='active'`). `runtime_worker_id` (FK
`cloud_runtime_worker.id`, **CASCADE**) is deliberately CASCADE: the token is a
pure hash-only derivative of its worker (revoked alongside it), and because the
token carries no sandbox FK of its own, cascading lets a hard delete reaching the
worker via its sandbox flow through the token cleanly. `owner_user_id` (FK,
**CASCADE**) and `organization_id` (FK, **CASCADE**, nullable) carry the resolved
identity. `token_hash` (String(64), unique) is the gateway bearer's HMAC;
`status` (CHECK `active`|`revoked`). `last_used_at` (nullable) is kept only for
manual-revocation forensics — it is **no longer stamped on the gateway hot
path** (#895), so a gateway request no longer does a per-request row write.

### Migrations, FKs, and stores

The tables land across three migrations. The integration six come from
[`server/alembic/versions/d7f3a91c4b2e_integration_models.py`](../../../server/alembic/versions/d7f3a91c4b2e_integration_models.py); the worker
three from
[`server/alembic/versions/b8c9d0e1f2a3_runtime_worker_auth.py`](../../../server/alembic/versions/b8c9d0e1f2a3_runtime_worker_auth.py). Foreign
keys were retrofitted last, in
[`server/alembic/versions/ab12cd34ef56_integration_fks_and_schema_vestiges.py`](../../../server/alembic/versions/ab12cd34ef56_integration_fks_and_schema_vestiges.py)
(#895, `down_revision` `d2e3f4a5b6c8`), which adds **21 FK constraints** across
the nine tables. The `ondelete` policy summarized: intra-domain parent refs
default to `NO ACTION` (RESTRICT) EXCEPT the pure-derivative children that
CASCADE from their parent (`cloud_integration_oauth_flow.account_id`,
`cloud_integration_tool_schema_cache.account_id`,
`cloud_integration_gateway_token.runtime_worker_id`); cross-domain owner columns
(`owner_user_id`→user, `organization_id`→organization,
`cloud_sandbox_id`→cloud_sandbox) CASCADE; the two pure-attribution columns
(`cloud_integration_policy.updated_by_user_id`,
`cloud_runtime_worker_enrollment.created_by_user_id`) stay `NO ACTION`. The
migration sweeps pre-existing orphans (NULLs the four nullable optional links in
`_NULL_ORPHANS`, deletes the rest) before `ADD CONSTRAINT`, and holds all FK
creation in one transaction (brief SHARE ROW EXCLUSIVE locks on
user/organization/cloud_sandbox). The 21 constraints are asserted in
[`server/tests/integration/schema_migration_assertions.py`](../../../server/tests/integration/schema_migration_assertions.py).

Stores are one module per table family under
[`server/proliferate/db/store/integrations/`](../../../server/proliferate/db/store/integrations):
[`server/proliferate/db/store/integrations/accounts.py`](../../../server/proliferate/db/store/integrations/accounts.py),
[`server/proliferate/db/store/integrations/definitions.py`](../../../server/proliferate/db/store/integrations/definitions.py),
[`server/proliferate/db/store/integrations/policies.py`](../../../server/proliferate/db/store/integrations/policies.py),
[`server/proliferate/db/store/integrations/oauth_clients.py`](../../../server/proliferate/db/store/integrations/oauth_clients.py),
[`server/proliferate/db/store/integrations/oauth_flows.py`](../../../server/proliferate/db/store/integrations/oauth_flows.py),
[`server/proliferate/db/store/integrations/tool_cache.py`](../../../server/proliferate/db/store/integrations/tool_cache.py), plus
[`server/proliferate/db/store/runtime_workers.py`](../../../server/proliferate/db/store/runtime_workers.py) for the three worker tables.
The definition row mapper is the public `definitions_store.record_from_row()`
(module-internal `_record` alias), reused by the accounts store's gateway join
in `_ready_accounts_stmt` — the old `definitions.get_definitions_by_ids` was
deleted, the gateway now joins definitions rather than doing a second per-id
fetch (#894).

### Relationship diagram

FK direction points child → parent; the label is the `ondelete` behavior.

```
        organization ──┐            user ──┐        cloud_sandbox
             ▲         │             ▲     │             ▲
   CASCADE   │  CASCADE │   CASCADE   │     │ CASCADE     │ CASCADE
             │         │             │     │             │
  cloud_integration_definition       │     │             │
        ▲  ▲  ▲  ▲                    │     │             │
        │  │  │  └──────RESTRICT──────┼──── cloud_integration_oauth_client
        │  │  │                       │     │
        │  │  └─RESTRICT─ cloud_integration_policy ─RESTRICT(updated_by)─▶ user
        │  │                          │     │
        │  └─RESTRICT─ cloud_integration_account ──CASCADE(owner)──▶ user
        │                    ▲   ▲    │     │
        │            CASCADE │   │ CASCADE  │
        │        (account_id)│   │(account_id, PK)
        │                    │   │          │
        └──RESTRICT── cloud_integration_oauth_flow   cloud_integration_tool_schema_cache
                             (also owner_user_id ─CASCADE▶ user)

  cloud_runtime_worker ──CASCADE──▶ user / organization / cloud_sandbox
        ▲
        │ CASCADE (runtime_worker_id)
  cloud_integration_gateway_token ──CASCADE──▶ user / organization

  cloud_runtime_worker_enrollment ──CASCADE──▶ user / organization / cloud_sandbox
        └─ created_by_user_id ─RESTRICT──▶ user
```

## Where The Code Lives

The subsystem spans server, the AnyHarness Rust runtime, the shared SDK, and the
desktop app. The load-bearing files:

```
server/proliferate/
├── db/models/cloud/
│   ├── integrations.py            # the six integration tables
│   └── runtime_workers.py         # worker / enrollment / gateway-token tables
├── db/store/
│   ├── integrations/              # one store module per table family
│   └── runtime_workers.py         # worker-tables store + IntegrationGatewayGrant
├── server/cloud/
│   ├── integrations/              # mgmt API, service, seeds, config codec, access, oauth/
│   ├── runtime_workers/           # enroll/heartbeat/revoke API, service, auth, models
│   └── integration_gateway/       # the MCP gateway: api, service, dependencies, domain/
└── integrations/
    ├── mcp_remote.py              # outbound MCP client (protocol-only, no DB)
    └── integration_oauth/         # discovery / DCR / token exchange (protocol-only)

anyharness/crates/
├── anyharness-lib/src/
│   ├── domains/sessions/mcp_bindings/integration_gateway.rs  # session extension
│   └── integrations/integration_gateway.rs                  # pure dotfile loader
└── proliferate-worker/           # the Rust worker sidecar crate
    └── src/self_update.rs         # sandbox self-swap onto the pinned version

cloud/sdk/src/client/
├── integrations.ts               # integrations + admin API client
└── desktop-workers.ts            # desktop enroll / revoke client

apps/desktop/src/
├── hooks/
│   ├── cloud/facade/use-cloud-integrations.ts             # facade over access hooks
│   ├── cloud/derived/use-composer-integrations-state.ts   # composer health state
│   ├── cloud/lifecycle/use-desktop-worker-enrollment.ts   # enrollment guard
│   └── access/cloud/integrations/                         # catalog/health/actions/oauth hooks
├── lib/
│   ├── domain/settings/integrations-presentation.ts       # search/filter presentation
│   ├── domain/cloud/composer-integrations.ts              # composer model derivation
│   └── workflows/cloud/ensure-desktop-worker.ts           # enroll/teardown orchestration
└── components/
    ├── settings/panes/UserIntegrationsPane.tsx            # user connect/disconnect pane
    ├── settings/panes/OrganizationIntegrationsPane.tsx    # org policy + custom-def pane
    └── workspace/chat/input/ComposerIntegrationsControl.tsx  # proactive composer surface

apps/desktop/src-tauri/src/commands/cloud_worker.rs         # spawn/stop the desktop worker
```

- **Server — persistence.** The nine tables live in
  [`server/proliferate/db/models/cloud/integrations.py`](../../../server/proliferate/db/models/cloud/integrations.py) and
  [`server/proliferate/db/models/cloud/runtime_workers.py`](../../../server/proliferate/db/models/cloud/runtime_workers.py), fronted by the
  per-family stores under
  [`server/proliferate/db/store/integrations/`](../../../server/proliferate/db/store/integrations) and the worker store
  [`server/proliferate/db/store/runtime_workers.py`](../../../server/proliferate/db/store/runtime_workers.py) (which also builds the
  `IntegrationGatewayGrant`). Detailed above under The Data Model.
- **Server — cloud API + services.** User/admin integration management is
  [`server/proliferate/server/cloud/integrations/`](../../../server/proliferate/server/cloud/integrations) (the connect/OAuth/admin
  flows below); worker enroll/heartbeat/revoke is
  [`server/proliferate/server/cloud/runtime_workers/`](../../../server/proliferate/server/cloud/runtime_workers) (the Two-Token Worker
  Model + enrollment/heartbeat flows); the MCP endpoint agents call is
  [`server/proliferate/server/cloud/integration_gateway/`](../../../server/proliferate/server/cloud/integration_gateway) (the virtual-tool
  flow). The protocol-only outbound layer —
  [`server/proliferate/integrations/mcp_remote.py`](../../../server/proliferate/integrations/mcp_remote.py) and
  [`server/proliferate/integrations/integration_oauth/`](../../../server/proliferate/integrations/integration_oauth) — sits under the
  vendor-client structure by rule (see Boundaries), used by credential
  resolution and the OAuth flow.
- **AnyHarness (Rust).** The gateway is injected into a session by the extension
  [`anyharness/crates/anyharness-lib/src/domains/sessions/mcp_bindings/integration_gateway.rs`](../anyharness/crates/anyharness-lib/src/domains/sessions/mcp_bindings/integration_gateway.rs),
  which reads the dotfile through the pure loader
  [`anyharness/crates/anyharness-lib/src/integrations/integration_gateway.rs`](../anyharness/crates/anyharness-lib/src/integrations/integration_gateway.rs)
  (covered by "AnyHarness injects the gateway MCP server"). The worker itself is
  the [`anyharness/crates/proliferate-worker/`](../anyharness/crates/proliferate-worker) crate, whose
  [`anyharness/crates/proliferate-worker/src/self_update.rs`](../anyharness/crates/proliferate-worker/src/self_update.rs) drives the
  sandbox self-swap flow.
- **Shared SDK.** [`cloud/sdk/src/client/integrations.ts`](../cloud/sdk/src/client/integrations.ts) and
  [`cloud/sdk/src/client/desktop-workers.ts`](../cloud/sdk/src/client/desktop-workers.ts) are the typed clients the
  desktop app calls; see API Surface.
- **Desktop app.** Data flows through the facade
  [`apps/desktop/src/hooks/cloud/facade/use-cloud-integrations.ts`](../../../apps/desktop/src/hooks/cloud/facade/use-cloud-integrations.ts) over the
  access hooks in
  [`apps/desktop/src/hooks/access/cloud/integrations/`](../../../apps/desktop/src/hooks/access/cloud/integrations), with the composer's
  health state in
  [`apps/desktop/src/hooks/cloud/derived/use-composer-integrations-state.ts`](../../../apps/desktop/src/hooks/cloud/derived/use-composer-integrations-state.ts).
  Worker lifecycle is the enrollment guard
  [`apps/desktop/src/hooks/cloud/lifecycle/use-desktop-worker-enrollment.ts`](../../../apps/desktop/src/hooks/cloud/lifecycle/use-desktop-worker-enrollment.ts)
  driving the orchestration in
  [`apps/desktop/src/lib/workflows/cloud/ensure-desktop-worker.ts`](../../../apps/desktop/src/lib/workflows/cloud/ensure-desktop-worker.ts), which
  calls the Tauri command
  [`apps/desktop/src-tauri/src/commands/cloud_worker.rs`](../../../apps/desktop/src-tauri/src/commands/cloud_worker.rs) to spawn/stop the
  local worker binary. Pure presentation logic lives in
  [`apps/desktop/src/lib/domain/settings/integrations-presentation.ts`](../../../apps/desktop/src/lib/domain/settings/integrations-presentation.ts) and
  [`apps/desktop/src/lib/domain/cloud/composer-integrations.ts`](../../../apps/desktop/src/lib/domain/cloud/composer-integrations.ts). The three UI
  surfaces —
  [`apps/desktop/src/components/settings/panes/UserIntegrationsPane.tsx`](../../../apps/desktop/src/components/settings/panes/UserIntegrationsPane.tsx),
  [`apps/desktop/src/components/settings/panes/OrganizationIntegrationsPane.tsx`](../../../apps/desktop/src/components/settings/panes/OrganizationIntegrationsPane.tsx),
  and the composer's
  [`apps/desktop/src/components/workspace/chat/input/ComposerIntegrationsControl.tsx`](../../../apps/desktop/src/components/workspace/chat/input/ComposerIntegrationsControl.tsx)
  — are detailed under Desktop UI Entry Points.

## Core Concepts

- **Definition** (`cloud_integration_definition`): a provider. `source` is
  `seed` (code-defined, global) or `org_custom` (created by an org admin,
  scoped to that org). `config_json` carries the MCP launch + auth config via
  the codec in [`server/proliferate/server/cloud/integrations/config.py`](../../../server/proliferate/server/cloud/integrations/config.py)
  (transport, URL spec, header/query templates with `{secret.X}` and
  `{settings.X}` placeholders, secret/settings field schemas).
- **Seed registry**: `SEED_DEFINITIONS` in
  [`server/proliferate/server/cloud/integrations/seeds.py`](../../../server/proliferate/server/cloud/integrations/seeds.py), 14 providers
  (context7, exa, tavily, posthog, sentry, axiom, linear, slack, supabase,
  notion, cloudflare_docs, gitlab, render, neon), ported from the deleted
  `BASE_CONNECTOR_CATALOG`. `sync_seed_definitions` reconciles them into the
  DB at every server boot, from the lifespan in
  [`server/proliferate/main.py:230`](../../../server/proliferate/main.py).
- **Policy** (`cloud_integration_policy`): per-org enable/disable of a
  definition. Absent policy row means the definition's
  `enabled_by_default` applies.
- **Definition source and auth**: a `seed` definition is code-defined and
  global; an `org_custom` definition is created by an org admin and scoped to
  that org. Custom definitions are no longer auth-less-only: as of #902 an
  `org_custom` definition can be `auth_kind=oauth2` with
  `oauth_client_mode='dcr'`, making it a first-class participant in the
  RFC 7591 DCR OAuth client + flow lifecycle (previously only seeds used
  oauth2/dcr). No schema change — `auth_kind` and `oauth_client_mode` already
  existed on `cloud_integration_definition`
  ([`server/proliferate/server/cloud/integrations/service.py`](../../../server/proliferate/server/cloud/integrations/service.py),
  [`server/proliferate/server/cloud/integrations/seeds.py`](../../../server/proliferate/server/cloud/integrations/seeds.py)).
- **Account** (`cloud_integration_account`): a user's authenticated instance
  of a definition, one per (user, definition). `auth_kind` is `oauth2`,
  `api_key`, or `none`; credentials are an encrypted JSON bundle
  (`secret-fields-v1` or `oauth-bundle-v1`); `auth_version` bumps on every
  credential write and invalidates the tool cache. `credential_format` is now
  nullable and stays NULL until credentials are stored (`set_account_credentials`
  writes the real format `secret-fields-v1`/`oauth-bundle-v1`); it no longer
  defaults to `json-v1` (#895). `owner_scope` is `personal` only today (the
  column and CHECK reserve `organization`).
- **OAuth client** (`cloud_integration_oauth_client`): a dynamically
  registered (RFC 7591) or statically configured client, cached per
  (issuer, redirect_uri, definition). Static config exists only for Slack via
  deployment settings ([`server/proliferate/config.py:358`](../../../server/proliferate/config.py)), resolved in
  [`server/proliferate/server/cloud/integrations/oauth/clients.py`](../../../server/proliferate/server/cloud/integrations/oauth/clients.py).
  Both seed and org-custom oauth2 definitions drive DCR through it.
- **OAuth flow** (`cloud_integration_oauth_flow`): one in-flight
  authorization: hashed state, encrypted PKCE verifier, surfaces
  (desktop/web), 10 minute TTL.
- **Tool schema cache** (`cloud_integration_tool_schema_cache`): cached
  upstream `tools/list` per account, stamped with the account `auth_version`.
  A `ready` cache is also treated as stale once `fetched_at` is older than the
  24h TTL (`CLOUD_INTEGRATION_TOOL_CACHE_TTL_SECONDS = 86400` in
  [`server/proliferate/constants/cloud.py`](../../../server/proliferate/constants/cloud.py)); the persisted status set is now
  just `ready`/`error` (staleness is derived from `auth_version` + `fetched_at`
  age, never stored) (#895).
- **Runtime worker** (`cloud_runtime_worker`): the enrolled sidecar process.
  `runtime_kind` is `cloud_sandbox` (identity: `cloud_sandbox_id`) or
  `desktop` (identity: `owner_user_id` + `desktop_install_id`). At most one
  non-revoked worker per identity (partial unique indexes). Desktop workers
  are no longer always org-less: the (user, install) identity is now a
  (user, org, install) triple where `organization_id` may be non-null (#894).
  `IntegrationGatewayGrant.organization_id` (resolved in
  [`server/proliferate/db/store/runtime_workers.py`](../../../server/proliferate/db/store/runtime_workers.py), ~line 103) is the key
  input to gateway visibility: org-scoped grants get the policy overlay,
  org-less grants (organization_id NULL) see seeds-with-defaults only.
- **Enrollment** (`cloud_runtime_worker_enrollment`): a single-use pending
  token that mints a worker. Consumed under row lock; expired rows flip to
  `expired` on touch. A desktop enrollment now carries a client-declared,
  membership-validated `organization_id` that is stamped on the enrollment and
  inherited by the minted worker + gateway grant (#894).
- **Gateway token** (`cloud_integration_gateway_token`): the bearer
  AnyHarness presents to the gateway. One active per worker; revoked together
  with its worker.
- **Gateway grant**: the resolved caller identity
  (`IntegrationGatewayGrant` in
  [`server/proliferate/db/store/runtime_workers.py`](../../../server/proliferate/db/store/runtime_workers.py)): worker id, runtime kind,
  owner user, org. All gateway visibility decisions key off this; the
  `organization_id` in particular selects between the org-policy overlay
  (org-scoped) and seeds-with-defaults (org-less).
- **Version convergence** (#897): the heartbeat ack now carries
  `desiredVersions` (`WorkerDesiredVersions {worker?: str, anyharness: str}` in
  [`server/proliferate/server/cloud/runtime_workers/models.py`](../../../server/proliferate/server/cloud/runtime_workers/models.py)). The server
  pins the worker version via `worker_version_pin()` (env `WORKER_VERSION`;
  returns None when unstamped, so an unstamped image pins nothing and drives no
  self-update) and the runtime version via `runtime_version()`
  ([`server/proliferate/server/version.py`](../../../server/proliferate/server/version.py)). A sandbox worker with
  `self_update_enabled` converges its own binary onto `desiredVersions.worker`
  on each heartbeat; the desktop worker never self-swaps (the app bundle owns
  its binary). Distinguish `worker_version()` (display fallback, used by
  `/meta`) from `worker_version_pin()` (drives swaps, no fallback).
- **Virtual tools**: the fixed three-tool surface the gateway advertises
  (`integrations.list_providers`, `integrations.list_tools`,
  `integrations.call_tool`), defined in
  [`server/proliferate/server/cloud/integration_gateway/domain/virtual_tools.py`](../../../server/proliferate/server/cloud/integration_gateway/domain/virtual_tools.py).

## The Two-Token Worker Model

Enrollment returns two secrets with different audiences:

1. **Worker token**: the private worker-to-Cloud bearer. Persisted only in
   the worker's local SQLite (`identity` table,
   [`anyharness/crates/proliferate-worker/src/store/migrations.rs`](../anyharness/crates/proliferate-worker/src/store/migrations.rs)). Used for
   heartbeat. Never visible to AnyHarness.
2. **Gateway token**: the AnyHarness-facing bearer for the integration
   gateway. The worker writes it to
   `<runtime_home>/integration-gateway.json` (0600, atomic rename) via
   [`anyharness/crates/proliferate-worker/src/integration_gateway.rs`](../anyharness/crates/proliferate-worker/src/integration_gateway.rs).
   "AnyHarness enrollment" is nothing more than this file; AnyHarness has no
   other Cloud identity for integrations.

Plus the bootstrap secret that precedes both: the **enrollment token**,
single-use, TTL 1 hour for cloud sandboxes and 15 minutes for desktop
([`server/proliferate/constants/cloud.py:320`](../../../server/proliferate/constants/cloud.py)).

All three families are stored as HMAC-SHA256 hashes keyed by
`settings.cloud_secret_key` over `"{domain}:{token}"`, with a distinct domain
per family so a raw value can never authenticate against the wrong table
([`server/proliferate/db/store/runtime_workers.py:34`](../../../server/proliferate/db/store/runtime_workers.py), domains at
[`server/proliferate/constants/cloud.py:314`](../../../server/proliferate/constants/cloud.py)).

Lifecycle rules (all in
[`server/proliferate/server/cloud/runtime_workers/service.py`](../../../server/proliferate/server/cloud/runtime_workers/service.py) and
[`server/proliferate/db/store/runtime_workers.py`](../../../server/proliferate/db/store/runtime_workers.py)):

- Consuming an enrollment revokes prior non-revoked workers and their gateway
  tokens, then creates the new worker (`token_urlsafe(48)`) and gateway token.
  Re-enrollment therefore rotates both tokens. The revoke scope is split by
  `runtime_kind` (#893): a `cloud_sandbox` enrollment revokes per-identity
  (`revoke_active_workers_for_identity`), but a `desktop` enrollment
  (`runtime_kind=='desktop'` with a non-null `desktop_install_id`) revokes
  EVERY non-revoked worker on the install regardless of owner, via
  `revoke_active_workers_for_desktop_install`. Rationale: a desktop install
  runs exactly one physical worker process, so a user switch on the same
  machine must retire the previous user's worker row (else it stays online) and
  its gateway token (else it stays a live server-side credential). Both revoke
  paths share the extracted helper `_revoke_workers_and_gateway_tokens`
  ([`server/proliferate/server/cloud/runtime_workers/service.py`](../../../server/proliferate/server/cloud/runtime_workers/service.py),
  [`server/proliferate/db/store/runtime_workers.py`](../../../server/proliferate/db/store/runtime_workers.py)).
- Heartbeat interval is 30s; a worker is `online` when its `last_seen_at` is
  within 90s, derived at read time (`RuntimeWorkerValue.online`); nothing
  writes `offline` eagerly and nothing gates on worker status.
- Destroying a cloud sandbox revokes its workers and gateway tokens
  ([`server/proliferate/server/cloud/cloud_sandboxes/service.py:77`](../../../server/proliferate/server/cloud/cloud_sandboxes/service.py)).

## Request Flows

### Cloud sandbox worker enrolls (sidecar boot)

1. `connect_ready_sandbox` launches AnyHarness directly (unchanged runtime
   path), then calls `launch_worker_sidecar`
   ([`server/proliferate/server/cloud/materialization/sandbox_io/connect.py:212`](../../../server/proliferate/server/cloud/materialization/sandbox_io/connect.py)).
2. `launch_worker_sidecar`
   ([`server/proliferate/server/cloud/materialization/sandbox_io/worker_sidecar.py`](../../../server/proliferate/server/cloud/materialization/sandbox_io/worker_sidecar.py))
   mints an enrollment in its own committed transaction (so the separate
   worker process can see it), writes the worker `config.toml` into the
   sandbox, and launches the binary detached behind a `test -x` guard (a
   stale template without the binary means no worker this run). Every failure
   is logged and swallowed: the sandbox is fully usable over its direct
   AnyHarness bearer without a worker.
3. Paths come from [`server/proliferate/server/cloud/runtime/bootstrap.py`](../../../server/proliferate/server/cloud/runtime/bootstrap.py):
   binary `~/.proliferate/bin/proliferate-worker`, config
   `~/.proliferate/worker/config.toml`, DB
   `~/.proliferate/worker/worker.sqlite3`, log `~/proliferate-worker.log`.
4. The worker ([`anyharness/crates/proliferate-worker/src/runtime.rs`](../anyharness/crates/proliferate-worker/src/runtime.rs)) takes a
   process lock on the DB path (relaunch is a no-op), loads or creates its
   identity via `ensure_enrolled`
   ([`anyharness/crates/proliferate-worker/src/identity/mod.rs`](../anyharness/crates/proliferate-worker/src/identity/mod.rs)): if the
   `identity` row exists it skips enrollment; otherwise it POSTs
   `/v1/cloud/worker/enroll` with the enrollment token
   ([`anyharness/crates/proliferate-worker/src/identity/enrollment.rs`](../anyharness/crates/proliferate-worker/src/identity/enrollment.rs),
   transport in [`anyharness/crates/proliferate-worker/src/cloud_client/auth.rs`](../anyharness/crates/proliferate-worker/src/cloud_client/auth.rs)),
   saves worker_id + worker_token to SQLite, scrubs the enrollment token from
   `config.toml`, and writes the gateway dotfile.
5. Server side, `enroll_worker`
   ([`server/proliferate/server/cloud/runtime_workers/service.py`](../../../server/proliferate/server/cloud/runtime_workers/service.py)) consumes
   the enrollment under `SELECT ... FOR UPDATE`, revokes the prior worker for
   the identity, creates worker + gateway token, and responds with
   `{workerId, workerToken, heartbeatIntervalSeconds, integrationGateway:
   {url, authorization}}`
   ([`server/proliferate/server/cloud/runtime_workers/models.py`](../../../server/proliferate/server/cloud/runtime_workers/models.py)). The gateway
   URL is `settings.cloud_worker_base_url` (falling back to `api_base_url`,
   [`server/proliferate/config.py:327`](../../../server/proliferate/config.py)) plus
   `CLOUD_INTEGRATION_GATEWAY_MCP_PATH`
   ([`server/proliferate/constants/cloud.py:325`](../../../server/proliferate/constants/cloud.py)).

### Desktop worker enrolls

1. The enrollment hook is no longer once-per-session and no longer mounted in
   `AuthenticatedAppHost`. `useDesktopWorkerEnrollment` is now mounted in
   `AppRuntime` ([`apps/desktop/src/App.tsx`](../../../apps/desktop/src/App.tsx),
   [`apps/desktop/src/hooks/cloud/lifecycle/use-desktop-worker-enrollment.ts`](../../../apps/desktop/src/hooks/cloud/lifecycle/use-desktop-worker-enrollment.ts))
   so it survives sign-out and can observe the authenticated->anonymous
   transition to tear the worker down (#893). The enrollment guard is re-keyed
   from a per-session bool to a module-level `enrolledIdentityKey` of
   `` `${userId}::${organizationId ?? ''}` `` (`identityKey`), so switching user
   OR active organization rotates the worker+gateway identity;
   `ensureDesktopWorker(organizationId)` takes the effect-captured org.
2. `ensureDesktopWorker`
   ([`apps/desktop/src/lib/workflows/cloud/ensure-desktop-worker.ts`](../../../apps/desktop/src/lib/workflows/cloud/ensure-desktop-worker.ts)) reads
   the persisted install UUID (created on first use by the Tauri command in
   [`apps/desktop/src-tauri/src/commands/desktop_identity.rs`](../../../apps/desktop/src-tauri/src/commands/desktop_identity.rs), TS wrapper
   [`apps/desktop/src/lib/access/tauri/desktop-install-id.ts`](../../../apps/desktop/src/lib/access/tauri/desktop-install-id.ts)), calls the
   user-authed `POST /v1/cloud/workers/desktop/enrollment` — now sending the
   effect-captured `organizationId` in the body
   ([`server/proliferate/server/cloud/runtime_workers/api.py`](../../../server/proliferate/server/cloud/runtime_workers/api.py), SDK
   [`cloud/sdk/src/client/desktop-workers.ts`](../cloud/sdk/src/client/desktop-workers.ts)), then invokes
   `ensure_desktop_dispatch_worker`
   ([`apps/desktop/src-tauri/src/commands/cloud_worker.rs`](../../../apps/desktop/src-tauri/src/commands/cloud_worker.rs), TS wrapper
   [`apps/desktop/src/lib/access/tauri/cloud-worker.ts`](../../../apps/desktop/src/lib/access/tauri/cloud-worker.ts)). Failures never block
   login; they go to telemetry.
3. The Tauri command keys the worker's config/DB dir by install id, sets
   `integration_gateway_home` to the AnyHarness runtime home so the dotfile
   lands where the local runtime reads it, deletes a stale `worker.sqlite3`
   when a fresh enrollment token arrives, and spawns the worker binary. The
   input field is still named `targetId` but carries the desktop install id
   (naming vestige). `ensure_desktop_dispatch_worker` now treats a supplied
   `enrollmentToken` as a rotation request (#893): if a live tracked child
   matches `target_id` it is `start_kill`ed and re-enrolled (previously it
   early-returned status `'running'` and silently dropped the new ticket,
   keeping the prior user's process/credentials). `ensureDesktopWorker` now
   returns a success boolean and never throws: on failure the guard is reset to
   null (only if it still holds the id we set) and a retry is scheduled after
   `ENROLLMENT_RETRY_DELAY_MS` (15s), so a silent enrollment failure no longer
   wedges the user out of a worker until sign-out/in.
4. Desktop enrollment now sends a client-declared `organizationId` in the
   `POST /v1/cloud/workers/desktop/enrollment` body
   (`DesktopWorkerEnrollmentRequest.organization_id: UUID|None`; #894).
   `create_desktop_enrollment` membership-validates a supplied org via
   `organization_store.get_active_membership` and 404s `organization_not_found`
   for non-members (which also prevents org-existence enumeration), then stamps
   `organization_id` on the enrollment (previously hardcoded None). Org-less
   users still enroll with `organization_id=None`. Documented v1 tradeoff (per
   `create_desktop_enrollment`'s docstring): the org scope is client-declared,
   so a member can obtain an org-less grant (no overlay, seeds-only) by omitting
   the id — gateway org policy is governance for org-scoped workers, not a hard
   boundary against a member
   ([`server/proliferate/server/cloud/runtime_workers/service.py`](../../../server/proliferate/server/cloud/runtime_workers/service.py)).

### Desktop worker teardown (sign-out / user switch)

The worker identity now follows auth (#893). On sign-out, `signOut`
orchestration calls `revokeDesktopWorkerServerSide()` BEFORE
`applyAnonymousState` clears the session (a later call would 401 against a
cleared token); this hits `POST /v1/cloud/workers/desktop/revoke`
([`apps/desktop/src/lib/integrations/auth/orchestration-provider-flow.ts`](../../../apps/desktop/src/lib/integrations/auth/orchestration-provider-flow.ts)).
Local cleanup is separate: `teardownDesktopWorker()` only stops the process and
deletes the `integration-gateway.json` dotfile, driven by the enrollment hook
observing the authenticated->anonymous transition. `ensureDesktopWorker` and
`teardownDesktopWorker` are serialized on a module-level `workerLifecycleChain`
promise chain
([`apps/desktop/src/lib/workflows/cloud/ensure-desktop-worker.ts`](../../../apps/desktop/src/lib/workflows/cloud/ensure-desktop-worker.ts)) so an
in-flight teardown from a quick sign-out cannot kill a worker that a subsequent
sign-in just ensured. `teardownDesktopWorker` invokes the new Tauri command
`stop_desktop_dispatch_worker` (registered in
[`apps/desktop/src-tauri/src/lib.rs`](../../../apps/desktop/src-tauri/src/lib.rs), implemented in
[`apps/desktop/src-tauri/src/commands/cloud_worker.rs`](../../../apps/desktop/src-tauri/src/commands/cloud_worker.rs), TS wrapper
[`apps/desktop/src/lib/access/tauri/cloud-worker.ts`](../../../apps/desktop/src/lib/access/tauri/cloud-worker.ts)); it returns
`{ stopped }`, `start_kill`s the tracked child and removes the dotfile.

### Desktop organization switch

Because the worker identity is now (user, org, install), an org->org switch is
semi-destructive and confirmed (#894). `useOrganizationSwitchAction`
([`apps/desktop/src/hooks/organizations/workflows/use-organization-switch-action.ts`](../../../apps/desktop/src/hooks/organizations/workflows/use-organization-switch-action.ts)):
on confirm it closes running local sessions (`collectRunningLocalSessionIds` /
`isLocalWorkspaceId` from
[`apps/desktop/src/lib/domain/sessions/running-local-sessions.ts`](../../../apps/desktop/src/lib/domain/sessions/running-local-sessions.ts), dismissed
one-by-one via the existing per-session dismiss action — no bulk close), tears
down the desktop worker, THEN records the new active org so the enrollment guard
re-enrolls under it. `OrganizationSwitchDialog`
([`apps/desktop/src/components/app/sidebar/OrganizationSwitchDialog.tsx`](../../../apps/desktop/src/components/app/sidebar/OrganizationSwitchDialog.tsx),
switcher in
[`apps/desktop/src/components/app/sidebar/SidebarAccountFooter.tsx`](../../../apps/desktop/src/components/app/sidebar/SidebarAccountFooter.tsx)) warns
"Switching organizations closes your running local sessions"; single-org users
never see it (clicking the active org is a no-op). Invitation-accept now routes
through `useJoinedOrganizationActivation`
([`apps/desktop/src/hooks/organizations/workflows/use-joined-organization-activation.ts`](../../../apps/desktop/src/hooks/organizations/workflows/use-joined-organization-activation.ts)):
first-org adoption (null->org) is in-place, org->org joins go through the same
switch flow. The enrollment guard in
[`apps/desktop/src/hooks/cloud/lifecycle/use-desktop-worker-enrollment.ts`](../../../apps/desktop/src/hooks/cloud/lifecycle/use-desktop-worker-enrollment.ts) is
keyed by (userId, orgId) and passes the effect-captured org into
`ensureDesktopWorker`; failed enrollments reset the guard for retry.

### Heartbeat

Worker loop ([`anyharness/crates/proliferate-worker/src/lifecycle/heartbeat.rs`](../anyharness/crates/proliferate-worker/src/lifecycle/heartbeat.rs))
POSTs `/v1/cloud/worker/heartbeat` with its worker bearer every
`heartbeat_interval_seconds` (floored at 10s;
[`anyharness/crates/proliferate-worker/src/config.rs`](../anyharness/crates/proliferate-worker/src/config.rs) defaults 30). Server
auth is `authenticate_worker`
([`server/proliferate/server/cloud/runtime_workers/auth.py`](../../../server/proliferate/server/cloud/runtime_workers/auth.py)). The handler now
reads `body.workerVersion`/`anyharnessVersion` and passes them to
`record_heartbeat` -> `touch_worker_heartbeat` (forward-only version stamping
alongside `last_seen_at` — an omitted field never clears a prior value)
([`server/proliferate/server/cloud/runtime_workers/api.py`](../../../server/proliferate/server/cloud/runtime_workers/api.py),
[`server/proliferate/server/cloud/runtime_workers/service.py`](../../../server/proliferate/server/cloud/runtime_workers/service.py)). The response is
no longer a bare ack: `WorkerHeartbeatResponse` now includes `desired_versions`
(`WorkerDesiredVersions`: worker pin via `worker_version_pin()`, anyharness via
`runtime_version()`). Ack parsing is in
[`anyharness/crates/proliferate-worker/src/cloud_client/heartbeat.rs`](../anyharness/crates/proliferate-worker/src/cloud_client/heartbeat.rs); the
worker loop hands the ack to `self_update` convergence (below). Only the
heartbeat `status` field remains dead on the wire.

### Sandbox worker self-swap

On each heartbeat the worker runtime loop calls `heartbeat_and_converge`
([`anyharness/crates/proliferate-worker/src/runtime.rs`](../anyharness/crates/proliferate-worker/src/runtime.rs)). `self_update::plan`
([`anyharness/crates/proliferate-worker/src/self_update.rs`](../anyharness/crates/proliferate-worker/src/self_update.rs)) returns an
`UpdatePlan` only when `self_update_enabled` is true, `desiredVersions.worker` is
present, differs from `versions::worker_version()` (`CARGO_PKG_VERSION`), and was
not already attempted (env marker `PROLIFERATE_WORKER_SELF_UPDATE_ATTEMPTED`).
`converge()`: GET the binary via `CloudClient::download_worker_artifact`
([`anyharness/crates/proliferate-worker/src/cloud_client/mod.rs`](../anyharness/crates/proliferate-worker/src/cloud_client/mod.rs)) -> server
302 to CDN; derive the `.sha256` URL by appending to the binary's *resolved*
post-redirect URL (not a second redirect) so binary+checksum share a version;
`verify_sha256`; stage a pid-suffixed sibling (`sweep_stale_staged` first);
preflight the staged `--version` must equal the pin (tolerating leading `v`)
else abort (prevents downgrade onto an unpinned stable fallback); atomic
`std::fs::rename` over `current_exe()`; then re-exec in place (the nohup sidecar
has no supervisor; the flock process lock rides the O_CLOEXEC boundary).
`--once` mode reports the pending update as a dry run. The gate is OFF by
default; `bootstrap.build_worker_config` writes `self_update_enabled=true` only
for the sandbox sidecar
([`server/proliferate/server/cloud/runtime/bootstrap.py`](../../../server/proliferate/server/cloud/runtime/bootstrap.py),
[`anyharness/crates/proliferate-worker/src/config.rs`](../anyharness/crates/proliferate-worker/src/config.rs),
[`anyharness/crates/proliferate-worker/src/versions.rs`](../anyharness/crates/proliferate-worker/src/versions.rs)). Desktop stays OFF —
the app bundle owns its binary. (`self_update.rs` supports Linux/macOS
x86_64/aarch64 only; `SelfUpdateUnsupported` otherwise.)

### AnyHarness injects the gateway MCP server

At session launch the `IntegrationGatewaySessionLaunchExtension`
([`anyharness/crates/anyharness-lib/src/domains/sessions/mcp_bindings/integration_gateway.rs`](../anyharness/crates/anyharness-lib/src/domains/sessions/mcp_bindings/integration_gateway.rs)),
registered in the session-extensions vec at
[`anyharness/crates/anyharness-lib/src/app/mod.rs:277`](../anyharness/crates/anyharness-lib/src/app/mod.rs), loads the dotfile via
the pure loader `IntegrationGatewayConfig::load`
([`anyharness/crates/anyharness-lib/src/integrations/integration_gateway.rs`](../anyharness/crates/anyharness-lib/src/integrations/integration_gateway.rs))
and injects `SessionMcpServer::Http` named `proliferate_integrations` with a
single `authorization` header. Missing/invalid dotfile is a silent no-op;
sessions with `SessionMcpBindingPolicy::InternalOnly` are skipped; logs carry
the gateway host only, never the URL path or the header value. Generic MCP
assembly stays with [mcp-runtime.md](../specs/codebase/primitives/mcp-runtime.md).

### Agent calls a virtual tool end to end

1. Agent POSTs MCP JSON-RPC to `/v1/cloud/integration-gateway/mcp`
   ([`server/proliferate/server/cloud/integration_gateway/api.py`](../../../server/proliferate/server/cloud/integration_gateway/api.py); GET answers
   405 with `Allow: POST` so streamable-HTTP clients stop re-opening the
   event stream; single and batch payloads are dispatched per message;
   notification-only input returns 202).
2. `require_integration_gateway_grant`
   ([`server/proliferate/server/cloud/integration_gateway/dependencies.py`](../../../server/proliferate/server/cloud/integration_gateway/dependencies.py))
   hashes the bearer under the gateway domain and resolves active token to
   non-revoked worker to `IntegrationGatewayGrant`. `get_grant_by_gateway_token_hash`
   no longer writes `last_used_at`/`updated_at` on this hot path (#895: no
   per-request row write + flush). After resolving the grant it re-validates
   active org membership for org-scoped grants on EVERY request via
   `organization_store.get_active_membership` and raises
   `integration_gateway_unauthorized` (401) if the owner has been removed from
   the org — so a long-lived worker stops serving immediately rather than at
   next re-enroll (#894). Org-less grants have no membership to check.
3. `handle_integration_gateway_json_rpc`
   ([`server/proliferate/server/cloud/integration_gateway/service.py`](../../../server/proliferate/server/cloud/integration_gateway/service.py)) handles
   `initialize` (protocol `2025-06-18`, server `proliferate_integrations`),
   `notifications/initialized` (no reply), `tools/list` (the three virtual
   tool definitions), and `tools/call`. Argument parsing lives in
   [`server/proliferate/server/cloud/integration_gateway/domain/tool_args.py`](../../../server/proliferate/server/cloud/integration_gateway/domain/tool_args.py),
   JSON-RPC envelope helpers in
   [`server/proliferate/server/cloud/integration_gateway/domain/json_rpc.py`](../../../server/proliferate/server/cloud/integration_gateway/domain/json_rpc.py).
4. Visibility: `ready_accounts_for_grant`
   ([`server/proliferate/server/cloud/integration_gateway/service.py`](../../../server/proliferate/server/cloud/integration_gateway/service.py)) now
   calls `list_ready_accounts_for_user(..., organization_id=grant.organization_id)`
   which returns `ReadyAccountRow` (account + definition + `org_policy_enabled`)
   via `_ready_accounts_stmt`
   ([`server/proliferate/db/store/integrations/accounts.py`](../../../server/proliferate/db/store/integrations/accounts.py); #894). Definition
   visibility mirrors the admin API: seeds are global; `org_custom` definitions
   are served only under their owning org's scope; an org-less grant collapses
   to seeds only. For org-scoped grants a LEFT JOIN on `cloud_integration_policy`
   supplies the overlay. Rows failing `_org_allows(grant, row)` (explicit policy
   row wins, else `definition.enabled_by_default`; org-less always allowed) are
   excluded from `list_providers`, and `account_for_provider` raises
   `integration_provider_disabled` (404) so `list_tools`/`call_tool` surface an
   in-band error for a policy-disabled provider. Org-less grants keep exact
   seeds-with-defaults behavior (no overlay) — a documented v1 tradeoff.
5. `integrations.call_tool` resolves the account
   (`integration_provider_not_found` 404 on a bad namespace), renders launch
   material via `resolve_launch`
   ([`server/proliferate/server/cloud/integrations/access.py`](../../../server/proliferate/server/cloud/integrations/access.py)), and proxies
   through the outbound MCP client
   ([`server/proliferate/integrations/mcp_remote.py`](../../../server/proliferate/integrations/mcp_remote.py)): initialize handshake,
   then `tools/call`; tolerant of both `application/json` and SSE response
   bodies; per-operation 45s overall deadline on top of httpx timeouts.
6. Tool-level failures (`CloudApiError`, `McpRemoteError`) return as MCP
   `isError` results, not transport errors, so agents can react and sibling
   batch entries still answer. Successful results are returned both as a JSON
   text content block and as `structuredContent`.
7. `integrations.list_tools` serves from
   `get_or_refresh_tool_cache`
   ([`server/proliferate/server/cloud/integrations/tools.py`](../../../server/proliferate/server/cloud/integrations/tools.py)): the cache is a
   hit only when `status=='ready'` AND `auth_version` matches AND `fetched_at`
   is within `CLOUD_INTEGRATION_TOOL_CACHE_TTL_SECONDS` (24h;
   [`server/proliferate/constants/cloud.py`](../../../server/proliferate/constants/cloud.py)); a TTL-expired or version-mismatched
   cache triggers a refetch (#895). New stale-while-error behavior: on a
   transient provider failure (`McpRemoteError`) with an existing
   version-matching cache, it logs and serves the stale cached schema instead of
   raising (records `status='error'` + `error_code` so the next call retries);
   auth/config failures (`CloudApiError`) still raise.

### Credential resolution (`ensure_provider_access`)

[`server/proliferate/server/cloud/integrations/access.py`](../../../server/proliferate/server/cloud/integrations/access.py):

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

Connection-hygiene refactor (#895): `ensure_provider_access` still takes `db`
but no longer touches it; the oauth2 path's `_refresh_oauth_bundle` now manages
its own short-lived sessions — it reads the OAuth client in one session that
closes before the provider token call, then commits the re-encrypted
`oauth-bundle-v1` in a fresh session afterward (guarded by the existing
`expected_auth_version` optimistic check). Effect: the caller's pooled DB
connection is no longer held across the provider token round-trip, and a rotated
refresh token persists independently of the surrounding request.

### User connects an integration (OAuth)

1. Desktop calls `POST /v1/cloud/integrations/authentications`
   ([`server/proliferate/server/cloud/integrations/api.py`](../../../server/proliferate/server/cloud/integrations/api.py)). For `none` the
   account is ready immediately; for `api_key` the key is stored under the
   definition's first secret field and the account is ready; for `oauth2` the
   account is upserted as `setup_required` and a flow starts
   ([`server/proliferate/server/cloud/integrations/service.py`](../../../server/proliferate/server/cloud/integrations/service.py)).
2. `start_oauth_flow`
   ([`server/proliferate/server/cloud/integrations/oauth/service.py`](../../../server/proliferate/server/cloud/integrations/oauth/service.py))
   discovers protected-resource + authorization-server metadata, resolves the
   OAuth client (DCR register-once-and-cache, or the static Slack client;
   [`server/proliferate/server/cloud/integrations/oauth/clients.py`](../../../server/proliferate/server/cloud/integrations/oauth/clients.py)), mints
   state + PKCE verifier, persists the flow (canceling any prior active flow
   for the user + definition), and returns the authorization URL. The
   discovery/DCR/token machinery lives in
   [`server/proliferate/integrations/integration_oauth/`](../../../server/proliferate/integrations/integration_oauth) (protocol-only, no DB
   access).
3. Browser returns to the shared callback
   `GET /v1/cloud/integrations/oauth/callback`. `complete_oauth_callback`
   claims the flow by state hash (single-use, `exchanging`), exchanges the
   code with PKCE, stores the encrypted `oauth-bundle-v1` on the account
   (status `ready`), and completes the flow. An `invalid_client` token error
   drops the cached DCR client so the next attempt re-registers.
4. The response surface depends on the flow: desktop flows render an HTML
   page that fires a `proliferate://` deep link
   ([`server/proliferate/server/cloud/integrations/pages.py`](../../../server/proliferate/server/cloud/integrations/pages.py)); web flows 303
   to the frontend completion path. The desktop pane polls
   `GET /v1/cloud/integrations/oauth/flows/{id}` (cancel via
   `POST .../cancel`) until terminal
   ([`apps/desktop/src/hooks/access/cloud/integrations/use-integration-oauth-flow.ts`](../../../apps/desktop/src/hooks/access/cloud/integrations/use-integration-oauth-flow.ts)).
5. Disconnect is `DELETE /v1/cloud/integrations/accounts/{id}` (owner only),
   which also drops the tool cache.

### Admin configures org integrations

Org-admin guarded routes under `/v1/cloud/integrations/admin`
([`server/proliferate/server/cloud/integrations/api.py`](../../../server/proliferate/server/cloud/integrations/api.py), enforcement in
[`server/proliferate/server/cloud/integrations/service.py`](../../../server/proliferate/server/cloud/integrations/service.py)):

- `GET /organizations/{org}/definitions`: seeds + that org's customs with
  policy overlay (`effective_enabled`).
- `POST /organizations/{org}/definitions`: create an org-custom HTTP MCP
  definition (namespace regex `^[a-z0-9][a-z0-9_-]{0,63}$`, http(s) URL
  validation), auto-enabling its policy. As of #902 the endpoint accepts an
  `authKind` body field (`auto` default | `none` | `oauth2`; validated in
  `create_admin_integration_definition`, other values -> `invalid_payload` 400).
  For `authKind='auto'` it calls `_probe_mcp_oauth(mcp_url)` — a 5s-bounded
  (`_OAUTH_PROBE_TIMEOUT_SECONDS`) best-effort probe that awaits
  `discover_protected_resource_metadata`
  ([`server/proliferate/integrations/integration_oauth/discovery.py`](../../../server/proliferate/integrations/integration_oauth/discovery.py); reusing the
  existing RFC 9728/8414 / WWW-Authenticate + auth-server discovery):
  `TimeoutError` -> `unreachable`, `IntegrationOAuthProviderError`/any other
  exception -> `none`, success -> `detected`. Resolved auth kind is `oauth2`
  when `authKind=='oauth2'` OR detection is `detected`, else `none`. An oauth2
  definition is created with `oauth_client_mode='dcr'` and a config carrying the
  `_OAUTH_BEARER_HEADER` `HeaderTemplate` (`Authorization: Bearer
  {secret.accessToken}`, optional) — the same shape `seeds.py`'s
  `_oauth_bearer_header` builds — so the generic DCR OAuth connect flow
  (`start_oauth_flow`/callback, above) works with no further wiring. The
  response carries `authDetection` (`detected`|`none`|`unreachable`|`forced`;
  `forced` when the admin picked an explicit non-auto kind). A probe timeout
  never blocks creation: the definition is saved auth-less with
  `authDetection='unreachable'`
  ([`server/proliferate/server/cloud/integrations/service.py`](../../../server/proliferate/server/cloud/integrations/service.py),
  [`server/proliferate/server/cloud/integrations/seeds.py`](../../../server/proliferate/server/cloud/integrations/seeds.py)).
- `PATCH .../definitions/{id}/enabled`: upsert the policy row. Disabling
  never deletes user credentials; it only flips visibility.

### Health

`GET /v1/cloud/integrations/health`
([`server/proliferate/server/cloud/integrations/health.py`](../../../server/proliferate/server/cloud/integrations/health.py)) returns one
verdict per visible definition: `ready`, `needs_auth`, `needs_reauth`,
`disabled_by_user`, `disabled_by_org`, or `error`, plus
`token_expires_at`, `tool_count` (from the cache), and `last_error_code`.
OAuth accounts claiming `ready` are actively probed via
`ensure_provider_access` so silently expired refresh tokens surface as
`needs_reauth` instead of failing mid-session. The probes now run concurrently
(#895): `list_integration_health` runs the per-account OAuth `ready` probes via
`asyncio.gather`, each on its own dedicated `AsyncSession`
(`session_ops.open_async_session`, because `AsyncSession` is not
concurrency-safe), bounded by a semaphore of `_PROBE_CONCURRENCY = 4`. Each
probe (`_probe_account_health`) is isolated: `CloudApiError` still maps to
`needs_reauth`/`error` verdicts, but any other exception (provider/network
timeout, `SQLAlchemyError`) is caught and returned as a generic
`(ERROR, 'probe_failed')` for that one account so it cannot 500 the whole
endpoint. Passing `organizationId` is membership-guarded (404 for non-members)
so org customs cannot be enumerated cross-tenant. `GET /v1/cloud/integrations/catalog` mirrors the same
visibility rules and exposes connect-time field schemas (metadata only, never
secret values or header templates).

## API Surface

Mounted in [`server/proliferate/server/cloud/api.py`](../../../server/proliferate/server/cloud/api.py) under `/v1/cloud`:

- Worker
  ([`server/proliferate/server/cloud/runtime_workers/api.py`](../../../server/proliferate/server/cloud/runtime_workers/api.py),
  [`server/proliferate/server/cloud/runtime_workers/models.py`](../../../server/proliferate/server/cloud/runtime_workers/models.py)):
  - `POST /worker/enroll` (public bearer flow).
  - `POST /worker/heartbeat` (worker bearer): request body now carries
    `workerVersion`/`anyharnessVersion` (max_length 64) and, on enroll,
    `machineFingerprint`(128)/`hostname`(255) — overlong values are a 422 at the
    edge, not a 500; the response now includes `desiredVersions {worker?,
    anyharness}` (#897).
  - `GET /worker/download/{target}/{asset}` (NEW, unauthenticated by design;
    #897): 302 to the pinned worker binary or its `.sha256` on the downloads CDN
    via `worker_artifact_redirect_url()`. `target` ∈ {`linux-x86_64`,
    `linux-aarch64`, `macos-x86_64`, `macos-aarch64`}, `asset` ∈
    {`proliferate-worker`, `proliferate-worker.sha256`}, else 404
    `cloud_worker_artifact_unknown`; falls back from `/worker/stable/{pin}/...`
    to `/worker/stable/...` when the pinned artifact is unpublished (and skips
    the pinned-path probe entirely when no pin).
  - `POST /workers/desktop/enrollment` (user-authed): body now includes an
    optional `organizationId` (`DesktopWorkerEnrollmentRequest`,
    membership-validated; non-member org id -> 404 `organization_not_found`;
    #894).
  - `POST /workers/desktop/revoke` (NEW, user-authed `current_product_user`;
    #893): body `DesktopWorkerRevokeRequest { desktopInstallId }` (1..255),
    response `DesktopWorkerRevokeResponse { revoked: bool }`; scoped to the
    caller's user id + install id; idempotent (returns `revoked:true` even when
    no active worker exists). Handler `revoke_desktop_worker_endpoint` delegates
    to service `revoke_desktop_worker`, which calls
    `store.revoke_active_workers_for_identity`.
  This is the entire worker API; command lease/delivery, events, exposures, and
  the rest of the old worker protocol were deleted in #823, to be rebuilt
  separately. `GET /meta` (`MetaResponse`) also gained a `workerVersion` field,
  sourced from `worker_version()` (#897).
- Gateway (gateway-token bearer): `GET|POST /integration-gateway/mcp`
  ([`server/proliferate/server/cloud/integration_gateway/api.py`](../../../server/proliferate/server/cloud/integration_gateway/api.py)).
- Integrations (user-authed): catalog, health, authentications, account
  delete, oauth flow status/cancel, oauth callback, admin definitions
  ([`server/proliferate/server/cloud/integrations/api.py`](../../../server/proliferate/server/cloud/integrations/api.py), response models in
  [`server/proliferate/server/cloud/integrations/models.py`](../../../server/proliferate/server/cloud/integrations/models.py)). The admin
  create request `CreateAdminIntegrationDefinitionRequest` gained
  `authKind: 'auto'|'none'|'oauth2'` (default `auto`) and the response
  `AdminIntegrationDefinitionResponse` gained
  `authDetection: 'detected'|'none'|'unreachable'|'forced' | null` (populated
  only on create; null on list; new `AuthDetection` Literal in models.py; #902).

SDK client modules: [`cloud/sdk/src/client/integrations.ts`](../cloud/sdk/src/client/integrations.ts) (gained
`CreateAdminIntegrationDefinitionRequest.authKind` +
`AdminIntegrationDefinition.authDetection` and the exported
`AdminIntegrationAuthDetection` type; #902) and
[`cloud/sdk/src/client/desktop-workers.ts`](../cloud/sdk/src/client/desktop-workers.ts) (gained
`revokeDesktopWorker(desktopInstallId)` alongside `enrollDesktopWorker`, whose
signature is now `enrollDesktopWorker(desktopInstallId, organizationId=null,
client)` sending `{ desktopInstallId, organizationId }`; #893/#894). The
generated types in [`cloud/sdk/src/generated/openapi.ts`](../cloud/sdk/src/generated/openapi.ts) were regenerated
to match (SDK generation now pins `TELEMETRY_MODE=local_dev` + `SINGLE_ORG_MODE=1`
for byte-reproducible output).

## Desktop UI Entry Points

Settings-only by locked decision: no sidebar item, no `/integrations` page.

- User settings pane:
  [`apps/desktop/src/components/settings/panes/UserIntegrationsPane.tsx`](../../../apps/desktop/src/components/settings/panes/UserIntegrationsPane.tsx)
  (connect/disconnect, health badges, OAuth return handling), with shared
  pieces in [`apps/desktop/src/components/settings/panes/integrations/`](../../../apps/desktop/src/components/settings/panes/integrations)
  (`IntegrationRow.tsx`, `IntegrationConnectDialog.tsx`,
  `IntegrationIcon.tsx`, `AddCustomIntegrationDialog.tsx`). The pane is now
  searchable (#905): a search `Input` appears only when the list exceeds
  `INTEGRATIONS_SEARCH_THRESHOLD` (6) rows via `integrationSearchState(itemCount,
  query)`, which derives `showSearch` and `activeQuery` together so a list
  shrinking below the threshold hides the input and resets filtering to empty in
  the same render (no phantom "No integrations found"); rows filter by
  `filterIntegrationsByQuery()` (case-insensitive substring on `displayName` or
  `namespace` via `integrationMatchesQuery`), with a "No integrations found"
  empty state
  ([`apps/desktop/src/lib/domain/settings/integrations-presentation.ts`](../../../apps/desktop/src/lib/domain/settings/integrations-presentation.ts)).
- Org admin pane:
  [`apps/desktop/src/components/settings/panes/OrganizationIntegrationsPane.tsx`](../../../apps/desktop/src/components/settings/panes/OrganizationIntegrationsPane.tsx)
  (policy switches + custom definition creation; same search behavior as the
  user pane). `AddCustomIntegrationDialog` now has an Authentication `Select`
  (Auto-detect / None / OAuth, options from `CUSTOM_INTEGRATION_AUTH_OPTIONS`)
  with helper copy describing the DCR model, passing `authKind` through
  `CustomIntegrationFormInput` (#902). The pane adds a per-row auth-kind column
  (`adminIntegrationAuthKindLabel`, grid widened to 5 columns) and the create
  toast uses `customIntegrationCreatedMessage(created)` to state the outcome
  (OAuth required -> "members connect from Settings", unreachable -> "saved
  without auth", else "No authentication required"); presentation helpers live
  in [`apps/desktop/src/lib/domain/settings/org-integrations-presentation.ts`](../../../apps/desktop/src/lib/domain/settings/org-integrations-presentation.ts).
- Data hooks: facade
  [`apps/desktop/src/hooks/cloud/facade/use-cloud-integrations.ts`](../../../apps/desktop/src/hooks/cloud/facade/use-cloud-integrations.ts) over the
  access hooks in [`apps/desktop/src/hooks/access/cloud/integrations/`](../../../apps/desktop/src/hooks/access/cloud/integrations)
  (`use-integration-catalog.ts`, `use-integration-health.ts`,
  `use-integration-actions.ts`, `use-integration-oauth-flow.ts`,
  `use-admin-integration-definitions.ts`).
- Proactive surfacing: the three-state `ComposerIntegrationsControl`
  [`apps/desktop/src/components/workspace/chat/input/ComposerIntegrationsControl.tsx`](../../../apps/desktop/src/components/workspace/chat/input/ComposerIntegrationsControl.tsx)
  (mounted in the trailing slot of
  [`apps/desktop/src/components/workspace/chat/input/ChatInputControlRow.tsx`](../../../apps/desktop/src/components/workspace/chat/input/ChatInputControlRow.tsx))
  replaced the single-purpose composer reauth chip (#905). Its mode comes from
  `deriveComposerIntegrationsModel()`
  ([`apps/desktop/src/lib/domain/cloud/composer-integrations.ts`](../../../apps/desktop/src/lib/domain/cloud/composer-integrations.ts)): `hidden`
  (no connected accounts — renders null), `quiet` (all connected integrations
  healthy — a muted Plug icon + connected-count), or `urgent` (>=1 connected
  account reports `needs_reauth` — adopts the old warning presentation and
  reuses `integrationReauthChipLabel` copy from
  [`apps/desktop/src/lib/domain/cloud/integration-reauth.ts`](../../../apps/desktop/src/lib/domain/cloud/integration-reauth.ts)). "Connected"
  means `accountId !== null` (never-connected catalog rows stay a settings
  concern). In every visible state a click opens a `PopoverButton` listing
  connected providers (reauth-needing sorted first via a stable sort) each with
  a health dot from `composerIntegrationHealthDot()`, a Reconnect button for
  `needs_reauth` rows, and a "Manage integrations" item; both Reconnect and
  Manage navigate to `buildSettingsHref({section:'integrations'})` — the control
  owns no connect/reconnect actions, only navigation. State comes from
  `useComposerIntegrationsState()`
  ([`apps/desktop/src/hooks/cloud/derived/use-composer-integrations-state.ts`](../../../apps/desktop/src/hooks/cloud/derived/use-composer-integrations-state.ts))
  which reads the shared `useIntegrationHealth` query (deduped with the settings
  pane, 5-minute refetchInterval, refetchOnWindowFocus, gated on `cloudActive`
  and keyed by `activeOrganizationId`).

## Boundaries

- **Agent auth / LLM gateway is a different primitive.** Harness credential
  selection, synced auth files, BYOK, and the agent gateway
  ([`server/proliferate/server/cloud/agent_gateway/`](../../../server/proliferate/server/cloud/agent_gateway)) belong to
  [agent-auth.md](../specs/codebase/primitives/agent-auth.md) and
  [agent-auth-bifrost-byok.md](../specs/codebase/primitives/agent-auth-bifrost-byok.md). "Gateway" in this
  spec always means the integration MCP gateway.
- **[`server/proliferate/integrations/`](../../../server/proliferate/integrations) is the server's vendor-client layer**,
  a structure with its own rules
  ([specs/codebase/structures/server/guides/integrations.md](../specs/codebase/structures/server/guides/integrations.md)):
  no DB access, protocol/vendor code only. This primitive's outbound pieces
  live there by that rule ([`server/proliferate/integrations/mcp_remote.py`](../../../server/proliferate/integrations/mcp_remote.py),
  [`server/proliferate/integrations/integration_oauth/`](../../../server/proliferate/integrations/integration_oauth)), but most of the
  primitive lives in [`server/proliferate/server/cloud/integrations/`](../../../server/proliferate/server/cloud/integrations) and
  siblings. Do not conflate the two directories.
- **Generic MCP session assembly belongs to
  [mcp-runtime.md](../specs/codebase/primitives/mcp-runtime.md).** This primitive contributes exactly one
  session extension and one pure dotfile loader on the Rust side; product
  MCP servers, bindings, and elicitation are out of scope here. The Rust
  boundary is enforced by shape checks: the extension lives in
  [`anyharness/crates/anyharness-lib/src/domains/sessions/mcp_bindings/`](../anyharness/crates/anyharness-lib/src/domains/sessions/mcp_bindings), the
  loader in [`anyharness/crates/anyharness-lib/src/integrations/`](../anyharness/crates/anyharness-lib/src/integrations) (which must
  not import domains).
- **The worker is not a command executor.** Everything the old worker did
  besides enroll/heartbeat/dotfile (command leases, tails, materialization,
  exposures) was deleted, and [cloud-commands.md](../specs/codebase/primitives/cloud-commands.md)
  describes the pre-deletion system; a clean command flow is a future
  workstream.

## Divergences From The Approved Plan

The landed code deviates from the 2026-07-01 plan in these places (code
wins; listed for the record):

- **Gateway-side org policy is now enforced, but org scope is client-declared.**
  The plan's call-time visibility rules landed (#894): `ready_accounts_for_grant`
  applies the org-policy overlay + definition-source visibility at the gateway,
  and membership is re-validated per request for org-scoped grants. The actual
  residual deviation is that the org scope is *declared by the desktop client at
  enrollment* (not server-derived), so a member can enroll org-less and get an
  overlay-free, seeds-only grant — an accepted v1 tradeoff, not a hard boundary
  ([`server/proliferate/server/cloud/integration_gateway/service.py`](../../../server/proliferate/server/cloud/integration_gateway/service.py),
  [`server/proliferate/server/cloud/runtime_workers/service.py`](../../../server/proliferate/server/cloud/runtime_workers/service.py)).
- **Gateway GET returns 405, not 204.** The MCP streamable-HTTP transport
  needs 405 + `Allow: POST` so clients stop re-opening the event stream.
- **PR shape changed.** Planned PR D (virtual tools) folded into the gateway
  endpoint PR (#832); the Rust runtime_config gutting + injection landed as
  a sibling (#837). The desktop UI landed later as #844 with a revised
  locked scope (settings-only panes + a proactive composer surface instead of
  the broader plan F chat surfacing); that composer surface has since become the
  three-state `ComposerIntegrationsControl` (#905).
- **Enroll/heartbeat metadata is now persisted; only `status` stays dead.**
  The worker's `machineFingerprint`/`hostname`/`workerVersion` on enroll and
  `workerVersion`/`anyharnessVersion` on heartbeat are no longer ignored — enroll
  writes `worker_version`/`hostname`/`machine_fingerprint` and heartbeat
  forward-only-updates `worker_version`/`anyharnessVersion` on
  `cloud_runtime_worker` (#895 added the columns; #897 wired the writes). Only
  the heartbeat `status` field remains accepted-and-ignored
  ([`server/proliferate/server/cloud/runtime_workers/service.py`](../../../server/proliferate/server/cloud/runtime_workers/service.py),
  [`server/proliferate/db/store/runtime_workers.py`](../../../server/proliferate/db/store/runtime_workers.py)).
- **Dotfile write happens only on a fresh enroll.** The plan said "rewritten
  on every (re)enroll"; the code matches that literally, but a worker that
  restarts with an intact identity does not rewrite the dotfile, so a
  deleted dotfile is not self-healed short of wiping `worker.sqlite3`.
- **Schema grew beyond the sketch.** `auth_version` + `content_hash` on the
  tool cache, `credential_format`/`token_expires_at` on accounts,
  `oauth_client_mode` on definitions, and the six-state OAuth flow status
  all exceed the plan's table sketches. `credential_format` is now
  nullable-no-default (#895) rather than the bogus `json-v1` default the plan
  never intended. The plan's FK+CASCADE sketch is now largely realized —
  migration `ab12cd34ef56` creates 21 FKs across the nine tables (#895; see
  The Data Model, End to End for the ondelete policy).
- **The old `gmail` stdio connector was not ported** (seed registry docstring
  marks it as follow-up; the stdio config types in
  [`server/proliferate/server/cloud/integrations/config.py`](../../../server/proliferate/server/cloud/integrations/config.py) are reserved but
  unused).

## Known Gaps And Follow-Ups

Two spec'd-but-not-yet-built items remain (everything else the plan listed and
the six follow-up PRs shipped now lives in the main body above):

- **(4) Version-contract hardening.** The convergence system shipped
  (`desiredVersions` in the heartbeat ack + sandbox self-swap) but the fuller
  spec is not built: a declared contract version, a hard-block version ceiling
  that refuses to serve too-old/too-new workers, a downgrade pointer, and the
  auth-screen backend/base-URL selector.
- **(5) Per-(server, org) profile homes.** The planned
  `~/.proliferate/profiles/<server>/<org>/...` layout — isolating worker
  config/DB/dotfile per (backend, org) so one install can hold several — is not
  yet implemented; the desktop worker still keys its home by install id only.

Verified-still-open vestiges and accepted-behavior notes (cleanup, not
spec regressions):

- `owner_scope='organization'` is allowed by the account CHECK but unimplemented
  (`personal` only today).
- Gateway org policy is *member-governance, not a security boundary*: org scope
  at desktop enrollment is client-declared, so a member can obtain an org-less
  (overlay-free, seeds-only) grant by omitting the id (#894). Membership is
  re-validated per gateway request for org-scoped grants only — org-less grants
  have no membership to check
  ([`server/proliferate/server/cloud/integration_gateway/dependencies.py`](../../../server/proliferate/server/cloud/integration_gateway/dependencies.py)).
- `anyharness_version` stays NULL for real workers until a launcher exports
  `PROLIFERATE_ANYHARNESS_VERSION` (documented follow-up in
  [`anyharness/crates/proliferate-worker/src/versions.rs`](../anyharness/crates/proliferate-worker/src/versions.rs)).
- When `WORKER_VERSION` is unstamped the server pins nothing
  (`worker_version_pin()` None) so sandbox workers never self-update —
  intentional ([`server/proliferate/server/version.py`](../../../server/proliferate/server/version.py)).
- A published worker artifact lagging the pin causes one download + aborted
  preflight per heartbeat until it publishes (self-heals;
  [`anyharness/crates/proliferate-worker/src/self_update.rs`](../anyharness/crates/proliferate-worker/src/self_update.rs)).
- Dead legacy constants `CLOUD_WORKER_TOKEN_DOMAIN` and
  `SUPPORTED_CLOUD_WORKER_STATUSES` remain in
  [`server/proliferate/constants/cloud.py:290`](../../../server/proliferate/constants/cloud.py) with no importers.
- Desktop Tauri input still names the install id `targetId`
  ([`apps/desktop/src-tauri/src/commands/cloud_worker.rs`](../../../apps/desktop/src-tauri/src/commands/cloud_worker.rs)); the worker
  launcher was extracted into a sibling module (`WorkerLauncher` in
  [`apps/desktop/src-tauri/src/commands/cloud_worker/launcher.rs`](../../../apps/desktop/src-tauri/src/commands/cloud_worker/launcher.rs)) — purely
  structural, no behavior change.
- Migration docstring headers carry stale revision ids (the `revision`
  variables are correct; the `Revision ID:` comment lines are not).
- stdio transport (and the gmail seed) unimplemented; API-key auth is still not
  supported for custom servers (only auto/none/oauth2), and the auto-probe is
  advisory only (an `unreachable` probe creates an auth-less definition rather
  than failing; #902).
- Adjacent, not owned here: `DirectAttachAuthConfig` in
  [`anyharness/crates/anyharness-lib/src/api/auth.rs`](../anyharness/crates/anyharness-lib/src/api/auth.rs) is test-only
  (keep-or-delete decision pending).

## Tests

- Worker enroll/heartbeat/desktop enrollment:
  [`server/tests/integration/test_cloud_runtime_workers_api.py`](../../../server/tests/integration/test_cloud_runtime_workers_api.py) (CI has no
  `.env`; enrollment tests monkeypatch `settings.cloud_worker_base_url`) — now
  covers the revoke endpoint (idempotent no-op, cross-user install-wide revoke
  at enrollment; #893), org-scoped enrollment + non-member 404 (#894), and
  overlong-metadata 422s + enrollment-token reuse after a rejected request
  (#897).
- Worker version convergence:
  [`server/tests/integration/test_cloud_runtime_worker_versions_api.py`](../../../server/tests/integration/test_cloud_runtime_worker_versions_api.py) (new;
  #897) covers the worker artifact redirect (pinned path, fallback, unknown
  target/asset 404, unstamped-pin skip) and heartbeat `desiredVersions`;
  [`server/tests/unit/test_meta_endpoint.py`](../../../server/tests/unit/test_meta_endpoint.py) covers the new `workerVersion`
  field.
- Gateway JSON-RPC + virtual tools + grant auth:
  [`server/tests/integration/test_cloud_integration_gateway_api.py`](../../../server/tests/integration/test_cloud_integration_gateway_api.py) (adds
  `last_used_at`-no-longer-stamped and tool-cache TTL / stale-while-error cases;
  #895); gateway org policy in
  [`server/tests/integration/test_cloud_integration_gateway_policy_api.py`](../../../server/tests/integration/test_cloud_integration_gateway_policy_api.py) (new;
  #894 — cross-org custom-definition hiding, policy overlay, membership
  re-validation).
- Management APIs / catalog / health:
  [`server/tests/integration/test_cloud_integrations_api.py`](../../../server/tests/integration/test_cloud_integrations_api.py) (updated for
  `credential_format`-nullable; admin-definition tests split out),
  [`server/tests/integration/test_cloud_integrations_admin_api.py`](../../../server/tests/integration/test_cloud_integrations_admin_api.py) (new; #902 —
  `authKind` override, probe detection outcomes, `authDetection` response),
  [`server/tests/integration/test_cloud_integration_catalog_api.py`](../../../server/tests/integration/test_cloud_integration_catalog_api.py),
  [`server/tests/integration/test_cloud_integration_health_api.py`](../../../server/tests/integration/test_cloud_integration_health_api.py) (adds
  concurrent per-probe-session and probe-failure-isolation cases; #895).
- Provider access / refresh / template rendering:
  [`server/tests/integration/test_integration_provider_access.py`](../../../server/tests/integration/test_integration_provider_access.py) (updated for
  the short-lived-session refresh behavior; #895),
  [`server/tests/unit/test_integration_config.py`](../../../server/tests/unit/test_integration_config.py).
- Schema:
  [`server/tests/integration/schema_migration_assertions.py`](../../../server/tests/integration/schema_migration_assertions.py) now asserts the 21
  FK constraints exist (#895).
- Rust: dotfile loader + extension tests in-module
  ([`anyharness/crates/anyharness-lib/src/integrations/integration_gateway.rs`](../anyharness/crates/anyharness-lib/src/integrations/integration_gateway.rs),
  [`anyharness/crates/anyharness-lib/src/domains/sessions/mcp_bindings/integration_gateway.rs`](../anyharness/crates/anyharness-lib/src/domains/sessions/mcp_bindings/integration_gateway.rs));
  worker crate tests run under `cargo test`. Self-update coverage (#897):
  [`anyharness/crates/proliferate-worker/src/config.rs`](../anyharness/crates/proliferate-worker/src/config.rs) has
  `self_update` default-off / opt-in parse tests;
  [`anyharness/crates/proliferate-worker/src/self_update.rs`](../anyharness/crates/proliferate-worker/src/self_update.rs) has in-module
  tests for `verify_sha256`, `plan_for_versions` (attempt marker), and
  `checksum_url_for`.
- Desktop: co-located `.test.tsx`/`.test.ts` next to the panes and hooks. The
  old `ComposerIntegrationReauthChip.test.tsx` and reauth-state hook test were
  deleted (#905); new/renamed co-located tests are
  `ComposerIntegrationsControl.test.tsx`, `use-composer-integrations-state.test.tsx`
  (renamed from the old reauth-state hook test), `composer-integrations.test.ts`
  (`deriveComposerIntegrationsModel` + health-dot exhaustiveness),
  `integrations-presentation.test.ts` (search predicate + `integrationSearchState`),
  and search-behavior cases added to `UserIntegrationsPane.test.tsx` /
  `OrganizationIntegrationsPane.test.tsx`. Also
  `use-desktop-worker-enrollment.test.tsx` (failure-then-retry and
  success-no-retry enrollment-guard paths; #893/#894),
  `OrganizationSwitchDialog.test.tsx` (success/failure), `running-local-sessions.test.ts`,
  `ensure-desktop-worker.test.ts` (#894), and
  `org-integrations-presentation.test.ts` + `AddCustomIntegrationDialog.test.tsx`
  (#902).
