# MCP, Skills, And Plugins Product Runtime Implementation Spec

Status: proposed implementation spec

Date: 2026-05-20

## Purpose

This spec defines the concrete implementation target for configuring MCPs,
skills, and plugins across Desktop, personal cloud sandboxes, and organization
shared sandboxes.

It assumes the sandbox/target foundation has landed first. If it has not, this
spec is blocked on `reference/sandbox-systems/00-cloud-target-managed-sandbox-foundation.md`.
Do not implement profile-keyed runtime config APIs before this foundation
exists.

```text
sandbox_profile
  Product configuration owner.
  One personal profile per user.
  One shared profile per organization.

cloud_target
  Worker/AnyHarness runtime endpoint for a profile.
  Owns applied runtime config revision status.

cloud_sandbox_slot
  Managed compute lifecycle for a managed cloud target.
  One normal managed slot per user and one shared managed slot per org.
```

Given that foundation, MCPs, skills, and plugins do not need their own target
selection model. Product state resolves into a `sandbox_profile`; Cloud or
Desktop compiles that state into target runtime config; the worker applies it
to the profile's `cloud_target`; AnyHarness stores only the compiled runtime
projection.

Current repo note: as of this reference write-up, the repo still has
repo-scoped cloud runtime environments and `CloudTarget` owner fields rather
than a first-class `sandbox_profile` table. Implementation must either land the
foundation first or temporarily key desired/applied runtime config by the
actual `cloud_target_id` while preserving the same profile-shaped API boundary.

The desired end state is:

```text
User/admin changes product config
  -> bump affected sandbox_profile runtime config revision
  -> compile target runtime config
  -> enqueue/apply worker command for the profile's cloud_target
  -> AnyHarness stores compiled runtime manifest
  -> future workspace/session launches require that revision
```

## Docs Read For This Spec

This spec follows:

- `docs/README.md`
- `docs/architecture/target-runtime-mcp-skills-config.md`
- `docs/architecture/shared-sandbox-config-admin-ui-spec.md`
- `docs/architecture/plugins-and-skills.md`
- `docs/server/README.md`
- `docs/frontend/guides/access.md`
- `docs/anyharness/README.md`

## Scope

In scope:

- Cloud DB and API model for configured MCPs, skills, and plugins.
- Personal enablement and organization publicization.
- Resolver rules for personal and shared sandbox profiles.
- Runtime config compilation and target apply hooks.
- Worker and AnyHarness revision correctness hooks needed for reliable launch.
- Desktop hooks and optimistic UI behavior for enable/public toggles.
- Migration from session plugin bundles and per-request MCP ids.

Out of scope:

- Defining the sandbox/target/profile foundation itself.
- Agent LLM auth gateway implementation.
- Shared session claiming and direct user auth to shared AnyHarness targets.
- Billing.
- Per-workspace MCP/skill selection.
- Hot-swapping tool servers inside a live running actor.

## Decisions

1. MCPs, skills, and plugins are sandbox capability state.

   They are not workspace-scoped and not session-scoped in V1. Every workspace
   and session in a sandbox sees the same current MCP/skill set.

2. Workspaces do not send MCP ids or skill ids at launch.

   A workspace/session launch may require a runtime config revision, but it
   should not carry the product selection list. Cloud/Desktop must make the
   sandbox current before launch.

3. Cloud/Desktop are product source of truth.

   AnyHarness does not know publicization policy, org membership, plugin
   packages, admin roles, or catalog ownership. It receives a flat runtime
   manifest.

4. Plugins are product packaging only.

   A plugin can group MCPs, skills, defaults, credential requirements, and UI
   copy. Before runtime, it expands one way:

   ```text
   plugin -> MCP runtime entries + skill runtime entries
   ```

   AnyHarness must never need `plugin_id` to launch tools or serve skills.

5. V1 uses direct configured-item fields, not sandbox mount tables.

   Product rows carry `enabled` and `public_to_org` state. Resolver rules decide
   which rows feed personal or shared profiles. Do not add
   `sandbox_mcp_mount`, `sandbox_skill_mount`, or `sandbox_plugin_selection` in
   V1 unless a real per-profile exception model is required later.

   This intentionally supersedes the older publication-row shape in
   `docs/architecture/shared-sandbox-config-admin-ui-spec.md` for the first
   implementation slice. A publication table can still be extracted later if
   the UX needs per-org publicization history, owner consent workflows, or
   admin disable state that cannot live on the configured item.

6. "Public" is a UX boolean, but DB state must include the org.

   A naked `public: bool` is ambiguous for users who can belong to more than
   one organization. V1 should store:

   ```text
   public_to_org: bool
   public_organization_id: nullable UUID
   ```

   If multi-org publicization, heavy audit, or per-org revocation semantics
   become important, extract a small publication table later. Do not start with
   publication rows just to model a boolean.

   V1 publicization applies to personal-source rows exposed to an organization.
   Organization-owned configured rows are included in the organization shared
   resolver by `owner_scope = organization` and `enabled = true`; they do not
   need to be publicized back to their owning organization.

7. Eager apply is the normal path. Lazy resolution is repair only.

   On every config change, Cloud/Desktop should compile and apply the new
   runtime config to the sandbox target. Lazy resolution remains necessary only
   when AnyHarness already has a manifest but a referenced artifact is missing,
   a credential is missing/expired, or cache state was lost.

8. Launch fails closed on stale runtime config.

   If Cloud is about to launch a workspace/session that requires revision R,
   the target must have applied R or Cloud must queue/await the apply. If the
   apply cannot complete, do not launch and hope AnyHarness repairs it later.

## Concept Model

### Catalog Entry

Global definition of something that exists.

```text
mcp_catalog_entry
  what GitHub MCP is
  how it can be launched or connected
  what auth/settings schema it needs
  no user secrets

skill_catalog_entry
  what the skill is
  instruction artifact hash/source
  resource artifact hashes/sources
  required MCP refs

plugin_catalog_entry
  package metadata
  MCP refs
  skill refs
  default enabled children
```

Catalog can remain file-backed or code-backed where it is today. This spec does
not require catalog DB tables before they are otherwise useful.

### Configured Item

Owner-specific product state.

```text
cloud_mcp_connection
  "Pablo connected GitHub with these settings/auth"

cloud_skill_configured_item
  "Pablo enabled Fix CI"

cloud_plugin_configured_item
  "Pablo installed/enabled GitHub plugin"
```

Configured item rows answer:

- who owns this;
- whether it is enabled for the owner's personal sandbox;
- whether it is public to an org shared sandbox;
- which catalog/source version is selected;
- what settings/auth/source state should be used.

### Sandbox Profile

The product configuration target.

```text
personal sandbox profile
  resolves enabled personal configured items owned by that user

organization shared sandbox profile
  resolves configured items made public to that organization
```

The profile is the thing that has a desired runtime config revision. It is not
an AnyHarness concept.

### Runtime Config

Compiled output for AnyHarness.

```text
TargetRuntimeConfig
  revision
  mcp_servers[]
  mcp_binding_summaries[]
  skills[]
  artifacts[]
  source
```

Runtime config contains launch/connect templates, credential refs, skill
metadata, and artifact hashes. It does not contain plugin packages, org policy,
admin roles, OAuth refresh tokens, or raw long-lived secrets.

## Cloud DB Model

### Extend `cloud_mcp_connection`

Current file:

- `server/proliferate/db/models/cloud/mcp.py`

Current row already has:

```text
user_id
org_id
connection_id
catalog_entry_id
catalog_entry_version
server_name
enabled
settings_json
config_version
payload_ciphertext legacy
```

Required changes:

```text
cloud_mcp_connection
  id
  owner_scope: personal | organization
  owner_user_id
  organization_id

  connection_id
  catalog_entry_id
  catalog_entry_version
  server_name

  enabled
  public_to_org
  public_organization_id
  public_status: private | public | blocked | stale | revoked
  public_updated_at
  public_updated_by_user_id

  settings_json
  config_version
  created_at
  updated_at
  last_synced_at
```

V1 migration can keep existing `user_id`/`org_id` columns if the owning style is
not ready to rename, but the logical model should be owner-scoped. Remove the
current constraints that force `user_id IS NOT NULL` and `org_id IS NULL` once
organization-owned MCP configuration is implemented.

Auth remains separate:

```text
cloud_mcp_connection_auth
  connection_db_id
  auth_kind
  auth_status: ready | needs_reconnect | error
  payload_ciphertext
  auth_version
  token_expires_at
  last_error_code
```

Important invariants:

- A personal connection can be publicized only by an admin or by a user allowed
  to expose that connection to the org.
- `public_to_org = true` requires `public_organization_id`.
- `public_to_org = false` requires `public_organization_id IS NULL`.
- `auth_status != ready` excludes the connection from compiled runtime config
  or compiles it with a blocking warning, depending on product choice. Do not
  silently launch with a broken secret.
- Duplicate catalog MCPs may exist. Shared resolver must namespace server names
  deterministically instead of silently collapsing duplicates.

### Add `cloud_skill_configured_item`

New file:

- `server/proliferate/db/models/cloud/skills.py`

Conceptual schema:

```text
cloud_skill_configured_item
  id
  owner_scope: personal | organization
  owner_user_id
  organization_id

  skill_source_kind: catalog | plugin | user
  skill_id
  skill_version
  plugin_id
  plugin_version

  enabled

  public_to_org
  public_organization_id
  public_status: private | public | blocked | stale | revoked
  public_updated_at
  public_updated_by_user_id

  source_snapshot_json
  user_skill_payload_ref
  config_version
  created_at
  updated_at
```

Notes:

- For plugin-provided skills, `plugin_id`/`plugin_version` records provenance.
- Catalog/plugin-backed skills should not duplicate catalog display metadata,
  instruction hashes, resource hashes, or required MCP refs in the configured
  row unless the product deliberately snapshots a version. Store source ids and
  selected versions, then let the resolver load catalog/package metadata.
- `source_snapshot_json` is optional and should be used only when a stable
  snapshot is required for migration or audit.
- `user_skill_payload_ref` is for user-authored skills. Full markdown/resource
  bytes live in an artifact store or package cache, not inline in this row.

Important invariants:

- `enabled` means included in the owner's personal sandbox resolver.
- `public_to_org` means included in the org shared sandbox resolver.
- Public skill compilation must verify required MCPs are also resolvable in the
  target profile, or emit a blocking warning that prevents launch.

### Add `cloud_plugin_configured_item`

New file:

- `server/proliferate/db/models/cloud/plugins.py`

Conceptual schema:

```text
cloud_plugin_configured_item
  id
  owner_scope: personal | organization
  owner_user_id
  organization_id

  plugin_id
  plugin_version
  enabled

  public_to_org
  public_organization_id
  public_status: private | public | blocked | stale | revoked
  public_updated_at
  public_updated_by_user_id

  config_version
  created_at
  updated_at
```

This table is a convenience/product grouping row. Runtime must not depend on it
directly.

Resolver behavior:

```text
enabled plugin
  -> include default enabled plugin MCP connections where configured/auth ready
  -> include default enabled plugin skills

public plugin
  -> include its publicizable child MCPs/skills in shared profile
  -> if a child requires auth that is not public/ready, produce a blocking
     warning for that child
```

If the product chooses not to persist plugin configured rows in V1, plugin
enablement can instead create/update the underlying MCP and skill configured
rows immediately. That is also acceptable. The runtime compiler must still see
only MCP/skill configured rows.

### Runtime Config Tables

The target-runtime spec owns AnyHarness-facing schema. Product compilation
needs Cloud-side revision rows keyed by target/profile.

Do not conflate this with the existing repo-scoped `CloudTargetConfig`.
`CloudTargetConfig` is the environment/repo materialization bridge keyed by
target plus repo/workspace inputs. Runtime MCP/skill config is target/profile
state and needs its own tables/stores.

New files:

- `server/proliferate/db/models/cloud/runtime_config.py`
- `server/proliferate/db/store/cloud_runtime_config/revisions.py`
- `server/proliferate/db/store/cloud_runtime_config/current.py`
- `server/proliferate/db/store/cloud_runtime_config/artifacts.py`
- `server/proliferate/server/cloud/runtime_config/models.py`
- `server/proliferate/server/cloud/runtime_config/service.py`
- `server/proliferate/server/cloud/runtime_config/api.py`

Required logical rows:

```text
cloud_target_runtime_config_revision
  id
  sandbox_profile_id
  target_id
  sequence
  content_hash
  manifest_json
  warnings_json
  created_at

cloud_target_runtime_config_current
  sandbox_profile_id
  target_id
  desired_revision_id
  desired_sequence
  applied_revision_id
  applied_sequence
  status: pending | queued | materializing | applied | failed
  stale_reason
  last_command_id
  last_error_code
  updated_at

cloud_target_runtime_config_artifact
  revision_id
  artifact_hash
  content_type
  byte_size
  payload_ciphertext
```

If the sandbox foundation stores desired/applied revision fields directly on
`cloud_target.readiness_json`, that is fine for V1. The invariant is what
matters:

```text
desired_revision is Cloud's intended MCP/skill manifest
applied_revision is what the worker/AnyHarness reports as installed
launch requires applied_revision_id == required_revision_id
```

If the implementation also stores monotonic sequence numbers, those are for
ordering and stale-command detection. Use revision id/content hash equality for
the launch preflight; do not compare opaque revision ids with `>=`.

## Resolver Rules

Add a pure resolver module:

- `server/proliferate/server/cloud/runtime_config/domain/resolver.py`

Inputs:

```text
sandbox_profile
cloud_mcp_connection snapshots
cloud_mcp_connection_auth snapshots
cloud_skill_configured_item snapshots
cloud_plugin_configured_item snapshots
catalog package data
artifact refs
```

Outputs:

```text
ResolvedRuntimeConfigPlan
  mcp_servers[]
  mcp_binding_summaries[]
  skills[]
  artifacts[]
  warnings[]
  blocking_errors[]
  source_row_refs[]
```

Personal profile resolver:

```text
include user's enabled MCP connections with auth_status ready
include user's enabled skill configured items
include user's enabled plugin expansions
do not include public-only items from other users
optionally include org/system items explicitly marked usable in personal
```

Shared organization profile resolver:

```text
include MCP connections where:
  public_to_org = true
  public_organization_id = profile.organization_id
  enabled = true
  auth_status = ready

include skills where:
  public_to_org = true
  public_organization_id = profile.organization_id
  enabled = true

include plugins where:
  public_to_org = true
  public_organization_id = profile.organization_id
  enabled = true

expand plugins to MCPs/skills before compile
namespace duplicate MCP server names deterministically
```

Blocking cases:

```text
public MCP auth_status needs_reconnect/error
skill requires an MCP that is not resolvable in the same profile
artifact payload missing in Cloud artifact store
duplicate server name cannot be namespaced safely
catalog version missing or disabled
```

Domain purity:

```text
service.py
  loads store dataclasses, catalog package data, and artifact metadata
  calls pure resolver/compiler functions
  translates blockers into Cloud API errors or readiness status

domain/runtime_config_resolver.py
  accepts frozen dataclasses/enums only
  imports no ORM, stores, FastAPI, integrations, or async I/O
  returns warnings/blockers as values

domain/runtime_config_manifest.py
  builds manifest values only
  performs no DB or network access
```

Runtime server naming:

```text
preferred:
  use configured server_name when unique

duplicate:
  server_name + "__" + short_public_or_connection_id

UI:
  show duplicates clearly and allow admin/user to rename or disable one
```

## Runtime Compiler

Add orchestration in:

- `server/proliferate/server/cloud/runtime_config/service.py`

Pure construction should live in:

- `server/proliferate/server/cloud/runtime_config/domain/manifest.py`

The compiler converts resolver output into the target-runtime manifest:

```text
RuntimeMcpServer
  id
  server_name
  transport
  launch/connect template
  non-secret settings
  credential_refs
  source_ref

RuntimeSkill
  id
  display_name
  description
  instruction_artifact
  resource_artifacts
  required_mcp_server_ids
  source_ref

RuntimeArtifactRef
  hash
  content_type
  byte_size
  source_ref
```

Credential fulfillment remains caller-owned:

```text
Cloud stores refresh token/secret material encrypted.
Worker fetches materialization/fulfillment payload using worker auth.
AnyHarness receives only runtime credential values with expiry.
AnyHarness does not own OAuth refresh tokens.
```

Content hash:

```text
content_hash = hash(canonical manifest_json + artifact hashes + credential ref versions)
```

If a config change compiles to the same hash, do not enqueue duplicate worker
commands. Update status/idempotency only.

## Refresh And Load Hooks

Normal path:

```text
configured item changed
  -> resolve affected sandbox profiles
  -> compile runtime config revision
  -> store desired revision
  -> enqueue materialize_environment with runtime config payload
  -> worker applies to AnyHarness
  -> worker reports applied revision
```

Hook every write that changes runtime meaning:

MCP connections:

- create connection
- patch settings
- toggle `enabled`
- toggle `public_to_org`
- secret auth update
- OAuth callback success
- OAuth refresh success/failure
- reconnect required
- delete connection

Skills:

- enable/disable skill
- publicize/unpublicize skill
- skill source/version changed
- artifact changed
- required MCP refs changed

Plugins:

- install/uninstall plugin
- enable/disable plugin
- publicize/unpublicize plugin
- plugin catalog version changes and resolver selects the new version

Worker/target:

- target comes online
- worker reports missing/stale revision
- launch requires newer revision than applied
- local artifact cache is lost

Implementation target:

```text
server/proliferate/server/cloud/target_config/service.py
  request_profile_runtime_config_refresh(...)
  compile_profile_runtime_config(...)
  enqueue_runtime_config_materialization(...)

server/proliferate/server/cloud/target_config/reconciler.py
  scans pending/stale profile target states
  re-enqueues idempotently
```

The write-side services should call the request function inside the same DB
transaction when possible, or write a durable pending row that the reconciler
will process. Do not rely on in-memory callbacks only.

## Lazy Resolution Fallback

Lazy resolution is still required, but it is not the product synchronization
model.

AnyHarness may say:

```text
runtime config revision R references artifact abc but it is missing
runtime config revision R references credential ref github:token but it is missing
runtime config revision R references credential ref github:token but it is expired
```

Worker/Desktop then:

```text
read AnyHarness resolution request
fetch artifact or credential from Cloud/Desktop authority
fulfill request into AnyHarness
retry prefetch/launch
```

Cloud worker endpoints should be explicit and worker-auth-only:

```text
GET  /v1/cloud/worker/runtime-configs/{revision_id}/artifacts/{artifact_hash}
POST /v1/cloud/worker/runtime-configs/{revision_id}/credentials/materialize
POST /v1/cloud/worker/runtime-configs/{revision_id}/status
```

Do not let AnyHarness call these endpoints directly.

## OAuth And Credential Expiry

MCP credential expiry handling:

```text
proactive:
  during runtime config apply, refresh token if access token is near expiry

optional smoother path:
  background Cloud job refreshes tokens before affected profile readiness stales

lazy launch fallback:
  if AnyHarness reports credential missing/expired, worker asks Cloud to refresh
  and fulfill the credential

reactive tool-use fallback:
  if an MCP reports auth expired during use, runtime marks the credential stale
  and Cloud/worker refreshes for the next launch or remount
```

Rules:

- AnyHarness never owns OAuth refresh tokens.
- Failed refresh sets `auth_status = needs_reconnect` and makes affected
  profiles not ready.
- Shared sandbox status must show which public item needs attention without
  exposing secret payloads.
- HTTP MCPs may support best-effort live credential retry.
- Stdio MCPs should be restarted/remounted unless the specific server supports
  reload.

## Server File Plan

DB models:

```text
server/proliferate/db/models/cloud/mcp.py
server/proliferate/db/models/cloud/skills.py
server/proliferate/db/models/cloud/plugins.py
server/proliferate/db/models/cloud/runtime_config.py
server/proliferate/db/models/cloud/__init__.py
server/proliferate/db/migrations/versions/<revision>_mcp_skill_plugin_product_state.py
```

Stores:

```text
server/proliferate/db/store/cloud_mcp/connections.py
server/proliferate/db/store/cloud_mcp/auth.py
server/proliferate/db/store/cloud_skills/configured_items.py
server/proliferate/db/store/cloud_plugins/configured_items.py
server/proliferate/db/store/cloud_runtime_config/revisions.py
server/proliferate/db/store/cloud_runtime_config/current.py
server/proliferate/db/store/cloud_runtime_config/artifacts.py
```

Cloud domains:

```text
server/proliferate/server/cloud/mcp_connections/api.py
server/proliferate/server/cloud/mcp_connections/models.py
server/proliferate/server/cloud/mcp_connections/service.py
server/proliferate/server/cloud/mcp_connections/access.py

server/proliferate/server/cloud/skills/api.py
server/proliferate/server/cloud/skills/models.py
server/proliferate/server/cloud/skills/service.py
server/proliferate/server/cloud/skills/access.py

server/proliferate/server/cloud/plugins/api.py
server/proliferate/server/cloud/plugins/models.py
server/proliferate/server/cloud/plugins/service.py

server/proliferate/server/cloud/runtime_config/service.py
server/proliferate/server/cloud/runtime_config/reconciler.py
server/proliferate/server/cloud/runtime_config/models.py
server/proliferate/server/cloud/runtime_config/api.py
server/proliferate/server/cloud/runtime_config/domain/resolver.py
server/proliferate/server/cloud/runtime_config/domain/manifest.py
server/proliferate/server/cloud/runtime_config/domain/policy.py
```

Cloud API router:

```text
server/proliferate/server/cloud/api.py
```

SDK:

```text
server/openapi.json
cloud/sdk/src/generated/openapi.ts
cloud/sdk/src/types/generated.ts
cloud/sdk/src/client/mcp-connections.ts
cloud/sdk/src/client/skills.ts
cloud/sdk/src/client/plugins.ts
cloud/sdk/src/client/target-configs.ts
cloud/sdk/src/client/index.ts
```

Follow server rules:

- `api.py` is transport only.
- `service.py` owns orchestration and transactions.
- `db/store/**` owns SQL.
- `domain/**` stays pure: resolver, policy, manifest planning, and diffing only.
- External artifact/package fetching stays behind the existing catalog/package
  access boundary or `integrations/**` if it becomes external I/O.

## AnyHarness And Worker File Plan

This spec depends on the target-runtime substrate. The relevant files are:

```text
anyharness/crates/anyharness-contract/src/v1/runtime_config.rs
anyharness/crates/anyharness-contract/src/v1/sessions.rs
anyharness/crates/anyharness-lib/src/api/http/runtime_config.rs
anyharness/crates/anyharness-lib/src/api/router.rs
anyharness/crates/anyharness-lib/src/domains/runtime_config/**
anyharness/crates/anyharness-lib/src/sessions/runtime/**
anyharness/crates/anyharness-lib/src/sessions/mcp_bindings/assembly.rs
anyharness/crates/anyharness-lib/src/live/sessions/connection/start.rs
anyharness/crates/anyharness-lib/src/live/sessions/connection/process.rs

anyharness/crates/proliferate-worker/src/cloud_client/commands.rs
anyharness/crates/proliferate-worker/src/commands/dispatcher.rs
anyharness/crates/proliferate-worker/src/commands/mapping.rs
anyharness/crates/proliferate-worker/src/materialization/**
```

`domains/sessions/**` is the target AnyHarness topology, but current session
runtime code still lives under top-level `sessions/**`. Implement against the
current owner paths and leave topology-only moves to the AnyHarness cleanup
workstream.

Required behavior:

- `PUT /v1/runtime-config` installs the manifest for a target.
- `POST /v1/runtime-config/prefetch` warms required artifacts/credentials where
  possible.
- `GET /v1/runtime-config/resolution-requests` lets worker/Desktop observe
  missing artifact/credential gaps.
- Worker fulfills or rejects resolution requests.
- Create/resume/prompt paths can carry `expectedRuntimeConfigRevision` after
  the AnyHarness contract and SDKs are regenerated.
- Session launch checks expected revision before starting the actor, or Cloud
  and Desktop perform the equivalent preflight before sending launch.
- Missing/stale expected revision fails as readiness/config stale, not as a
  generic MCP resolution error.

Cloud command:

```text
materialize_environment
  target_id
  sandbox_profile_id
  revision_id
  expected_content_hash
  artifact_fulfillment_refs
  credential_fulfillment_refs
```

V1 should extend the existing `materialize_environment` command and
`TargetConfigMaterializationPlan` unless we intentionally choose to add a
dedicated command. A dedicated `materialize_environment_runtime_config` command
is a later optimization and requires the full migration: server enum, active
and default command-kind sets, DB/check constraints, command validators, worker
supported kinds, dispatcher handling, SDK command types, and version gating.

Worker result:

```text
applied_revision_id
applied_content_hash
status: materializing | applied | failed
missing_artifacts[]
missing_credentials[]
superseded_by_revision_id
stale_reason
error_code
```

Keep target runtime config apply status aligned with the current
`pending | queued | materializing | applied | failed` target-config status
shape unless the implementation explicitly migrates the enum/checks/API/UI.
Use command status `superseded` or structured result fields for stale no-ops;
do not invent a target-config status that the current API rejects.

Launch preflight enforcement:

```text
Cloud-managed launch:
  Cloud compares required runtime revision to target applied revision before
  enqueueing start_session/send_prompt. If stale, queue/await environment
  materialization first or fail with a readiness error.

Desktop local launch:
  Desktop refreshes local AnyHarness runtime config and checks the applied
  revision before optimistic session creation.

AnyHarness contract:
  Add expectedRuntimeConfigRevision to create/resume/prompt only when we also
  regenerate OpenAPI, SDK, and SDK React bindings. Until then, Cloud/Desktop
  preflight is the enforcement point.

CloudCommand preconditions:
  Current command validation rejects preconditions. Do not rely on command
  preconditions unless that contract is changed and worker min-version gating is
  added.
```

SDK regeneration for AnyHarness contract changes:

```text
anyharness/crates/anyharness-contract/src/v1/runtime_config.rs
anyharness/crates/anyharness-contract/src/v1/sessions.rs
anyharness/sdk/generated/openapi.json
anyharness/sdk/src/generated/openapi.ts
anyharness/sdk/src/client/runtime-config.ts
anyharness/sdk/src/types/runtime-config.ts
anyharness/sdk/src/index.ts
anyharness/sdk-react/src/**
```

Generated OpenAPI and TypeScript files are checked-in generated artifacts.
Regenerate them from Rust contract types; do not hand-edit generated output.

## Desktop File Plan

MCP connector access:

```text
desktop/src/hooks/access/mcp/connectors/query-keys.ts
desktop/src/hooks/access/mcp/connectors/use-connectors.ts
desktop/src/hooks/access/mcp/connectors/use-connector-mutations.ts
```

MCP workflows:

```text
desktop/src/hooks/mcp/workflows/use-connector-catalog-actions.ts
desktop/src/hooks/mcp/workflows/use-installed-connector-actions.ts
desktop/src/hooks/mcp/workflows/use-toggle-connector.ts
desktop/src/lib/workflows/mcp/connector-persistence.ts
desktop/src/lib/workflows/mcp/runtime-config-refresh.ts
desktop/src/lib/workflows/mcp/runtime-config-resolution.ts
```

Plugin and catalog UI:

```text
desktop/src/pages/PluginsPage.tsx
desktop/src/components/plugins/catalog/PluginsScreen.tsx
desktop/src/components/plugins/catalog/ConnectorCatalogPage.tsx
desktop/src/components/plugins/catalog/PluginPackageRow.tsx
desktop/src/components/plugins/detail/ConnectorDetailModal.tsx
desktop/src/components/plugins/detail/ConnectorToolsTab.tsx
desktop/src/lib/domain/mcp/types.ts
desktop/src/lib/domain/mcp/connector-catalog-view-model.ts
desktop/src/lib/domain/plugins/plugin-package-view-model.ts
```

Cloud target config status:

```text
desktop/src/hooks/access/cloud/target-configs/query-keys.ts
desktop/src/hooks/access/cloud/target-configs/use-cloud-target-configs.ts
desktop/src/hooks/access/cloud/target-configs/use-cloud-target-config-mutations.ts
```

Session launch and retry:

```text
desktop/src/hooks/sessions/use-session-creation-actions.ts  # transitional caller only
desktop/src/hooks/sessions/workflows/use-session-runtime-config-preflight.ts
desktop/src/lib/workflows/sessions/session-runtime.ts
desktop/src/lib/access/anyharness/sessions.ts
desktop/src/lib/access/anyharness/runtime-config.ts
```

UI behavior:

- The Plugins page remains the primary product page for MCPs, skills, and
  plugins.
- Rows expose:
  - enabled for personal cloud/local;
  - public to org, admin-only where applicable;
  - auth status;
  - last runtime apply status.
- Mutations optimistically update the row with `onMutate`, snapshot the previous
  query data, roll back on `onError`, and invalidate on `onSettled`.
- Publicize/unpublicize mutations must also invalidate target config status for
  the affected shared sandbox profile.
- Settings pages should show sandbox readiness and link back to Plugins, not
  duplicate the full plugin marketplace.
- Runtime-config launch failures must integrate with the existing projected
  session rollback/preserve-failed-shell behavior instead of creating orphaned
  optimistic sessions.

Frontend access rules:

- Raw Cloud helpers belong in `cloud/sdk/src/client/**`.
- Desktop-specific Cloud setup belongs in `desktop/src/lib/access/cloud/**`.
- React Query wrappers belong in `desktop/src/hooks/access/cloud/**`.
- MCP connector cache stays under `desktop/src/hooks/access/mcp/connectors/**`
  because it intentionally coordinates local/Desktop and Cloud connector state.

## API Surface

Extend MCP connection responses:

```text
CloudMcpConnectionResponse
  id
  connectionId
  catalogEntryId
  catalogEntryVersion
  serverName
  enabled
  publicToOrg
  publicOrganizationId
  publicStatus
  authKind
  authStatus
  configVersion
  runtimeApplyStatus
```

Extend MCP patch:

```text
PATCH /v1/cloud/mcp/connections/{connection_id}
  settings?
  enabled?
  publicToOrg?
  publicOrganizationId?
```

Skill APIs:

```text
GET   /v1/cloud/skills
POST  /v1/cloud/skills
PATCH /v1/cloud/skills/{skill_configured_item_id}
DELETE /v1/cloud/skills/{skill_configured_item_id}
```

Plugin APIs:

```text
GET   /v1/cloud/plugins
POST  /v1/cloud/plugins/{plugin_id}/install
PATCH /v1/cloud/plugins/{configured_plugin_id}
DELETE /v1/cloud/plugins/{configured_plugin_id}
```

Target config status APIs:

```text
GET /v1/cloud/sandbox-profiles/{sandbox_profile_id}/runtime-config
POST /v1/cloud/sandbox-profiles/{sandbox_profile_id}/runtime-config/refresh
```

Worker-only APIs:

```text
GET  /v1/cloud/worker/runtime-configs/{revision_id}/materialization
POST /v1/cloud/worker/runtime-configs/{revision_id}/status
GET  /v1/cloud/worker/runtime-configs/{revision_id}/artifacts/{artifact_hash}
POST /v1/cloud/worker/runtime-configs/{revision_id}/credentials/materialize
```

Naming can follow existing route conventions, but keep the resource ownership
the same: product users mutate configured items; workers fetch/apply compiled
runtime config.

## End-To-End Flows

### User Enables Personal MCP

```text
1. User toggles GitHub MCP enabled in Plugins page.
2. Desktop mutation patches cloud_mcp_connection.enabled = true.
3. Server updates row and bumps user's personal sandbox_profile runtime config.
4. Server compiles runtime config revision for the profile target.
5. Server enqueues materialize_environment with runtime config payload.
6. Worker applies manifest to AnyHarness and reports applied revision.
7. Readiness UI shows the personal sandbox as current.
8. Next workspace/session launches requiring the applied revision.
```

Local Desktop target:

```text
1. Desktop also compiles/pushes local runtime config to local AnyHarness.
2. Local target does not need Cloud worker delivery.
```

### Admin Publicizes MCP For Shared Sandbox

```text
1. Admin toggles publicToOrg for a connection.
2. Server validates admin/org permission and source auth readiness.
3. Server writes public_to_org/public_organization_id on the source row.
4. Server bumps the organization shared sandbox_profile runtime config.
5. Shared resolver includes the public connection.
6. Compiler namespaces server name if needed.
7. Worker applies the new runtime config to the shared cloud target.
8. Team automations, Slack, and shared cloud work inherit the updated config.
```

### User Enables Skill

```text
1. User enables a skill or a plugin-provided skill.
2. Server writes cloud_skill_configured_item.enabled = true.
3. Resolver checks required MCP refs against the profile's MCP set.
4. Compiler writes instruction/resource artifact refs into runtime config.
5. Worker applies manifest and prefetches skill artifacts.
6. AnyHarness skills MCP serves compact skill index and lazy content loading.
```

### Admin Publicizes Plugin

```text
1. Admin toggles publicToOrg on configured plugin.
2. Resolver expands plugin into child MCP/skill entries.
3. Child entries that are missing auth/settings produce blocking warnings.
4. Valid children compile into shared runtime config.
5. Shared readiness UI shows applied, partial, or needs attention.
```

### OAuth Expires

```text
1. Runtime config apply sees token near expiry and asks Cloud to refresh.
2. If refresh succeeds, auth_version increments and affected profiles refresh.
3. If refresh fails, auth_status becomes needs_reconnect.
4. Personal/shared readiness becomes needs attention.
5. Launch requiring that MCP fails closed until reconnected or disabled.
```

### Target Comes Online After Being Paused

```text
1. Worker heartbeats with current applied runtime revision.
2. Cloud compares desired vs applied revision.
3. If stale, Cloud enqueues materialize_environment with runtime config payload.
4. Worker applies before any launch command requiring the newer revision.
```

## Migration Plan

### Phase 0: Runtime Substrate Hardening

Goal: make target-runtime config reliable enough to build product state on top.

Tasks:

- Ensure AnyHarness runtime config modules compile.
- Extend `materialize_environment`/`TargetConfigMaterializationPlan` to carry
  runtime config in V1, or explicitly choose and fully migrate a dedicated
  command kind.
- Add Cloud/Desktop fail-closed revision preflight before launch.
- Add `expectedRuntimeConfigRevision` to create/resume/prompt launch paths only
  with AnyHarness contract + SDK regeneration.
- Add worker materialization result reporting.

Acceptance:

- Worker can apply a target runtime config to AnyHarness.
- Launch fails clearly if the target is missing/stale for the required revision.
- Lazy artifact/credential requests can be fulfilled by Desktop/worker.

### Phase 1: Product Schema And Stores

Goal: store MCP/skill/plugin configured state in Cloud.

Tasks:

- Extend `cloud_mcp_connection` with owner/public fields.
- Add `cloud_skill_configured_item`.
- Add `cloud_plugin_configured_item` if plugin grouping is persisted.
- Add target runtime config revision/current/artifact rows if not already
  present.
- Backfill existing MCP connections as personal enabled items with
  `public_to_org = false`.
- Use a multi-step migration for existing MCP constraints:
  - add nullable owner/public columns;
  - backfill from `user_id`;
  - dual-read/write logical owner fields;
  - add partial unique indexes and check constraints;
  - update duplicate catalog/server-name rules;
  - only then remove the old `user_id IS NOT NULL` and `org_id IS NULL`
    constraints.

Acceptance:

- Existing users keep their enabled personal MCPs.
- No existing connection becomes public by default.
- Store functions return dataclasses, not ORM.

### Phase 2: Resolver And Compiler

Goal: compile personal/shared sandbox product state into runtime config.

Tasks:

- Add pure resolver module.
- Add pure manifest compiler module.
- Wire `runtime_config/service.py` to compile by `sandbox_profile_id`, or by
  `cloud_target_id` as a temporary bridge before the foundation lands.
- Store content-hashed revisions idempotently.
- Surface blocking warnings for auth/missing required MCP/artifact failures.

Acceptance:

- Personal profile resolves user's enabled items.
- Shared profile resolves public org items.
- Runtime manifest contains no plugin package state and no long-lived secrets.

### Phase 3: Refresh Hooks And Worker Apply

Goal: every relevant config write refreshes the affected sandbox target.

Tasks:

- Hook MCP create/patch/auth/delete.
- Hook skill enable/public/source changes.
- Hook plugin install/enable/public changes.
- Add reconciler for pending/stale runtime config states.
- Worker fetches materialization payloads and reports status.

Acceptance:

- Changing an MCP/skill/plugin updates desired revision.
- Online targets apply without requiring a workspace launch.
- Offline/paused targets apply on wake before launch.

### Phase 4: Desktop Product UI

Goal: expose simple controls with status.

Tasks:

- Add publicize fields to connector/domain types.
- Add optimistic mutations for enable/public toggles.
- Add skills/plugin configured item access hooks.
- Add target config status hooks.
- Show runtime apply status in Plugins and shared readiness settings.

Acceptance:

- User can enable/disable personal items.
- Admin can publicize/unpublicize org items.
- UI shows pending/applied/failed status without exposing secrets.

### Phase 5: Shared Sandbox Enablement

Goal: shared org sandbox consumes public MCP/skill/plugin state.

Tasks:

- Remove `org_cloud_not_ready` blockers only after profile/target/slot exists.
- Create organization shared profile and target on shared cloud enable.
- Compile shared profile from public org items.
- Team automation and Slack launch paths require shared runtime config revision.

Acceptance:

- Public items are available to shared cloud work.
- Non-public personal items are not included.
- Duplicate public MCPs are visible and namespaced.

### Phase 6: Legacy Cleanup

Goal: remove duplicate runtime paths.

Tasks:

- Stop passing plugin bundles in create/resume requests.
- Delete or deprecate session plugin bundle registry paths.
- Stop using per-request `mcpConnectionIds` for normal cloud launches.
- Keep legacy bridge only behind explicit migration compatibility gates.

Acceptance:

- Runtime path is target-scoped runtime config.
- AnyHarness no longer needs plugin package concepts.
- Cloud/Desktop product resolvers own all plugin expansion.

## Verification

Server:

```bash
cd server
uv run pytest -q
```

Targeted server tests to add:

```text
tests/server/cloud/test_mcp_connection_public_state.py
tests/server/cloud/test_skill_configured_items.py
tests/server/cloud/test_plugin_configured_items.py
tests/server/cloud/test_target_runtime_config_resolver.py
tests/server/cloud/test_runtime_config_refresh_hooks.py
```

AnyHarness and worker:

```bash
cargo test -p anyharness-contract
cargo test -p anyharness-lib runtime_config
cargo test -p proliferate-worker runtime_config
```

AnyHarness SDK:

```bash
cd anyharness/sdk
pnpm run generate
pnpm run build
```

Desktop:

```bash
cd desktop
pnpm test -- --run
pnpm typecheck
```

Manual cases:

- Enable personal MCP, observe personal target applied revision.
- Disable personal MCP, confirm launch no longer exposes it.
- Publicize MCP, observe shared target applied revision.
- Revoke/expire MCP OAuth, confirm shared readiness fails closed.
- Enable skill requiring missing MCP, confirm blocking warning.
- Publicize duplicate GitHub MCPs, confirm deterministic server names.
- Pause/wake managed target, confirm stale revision applies before launch.

## Open Questions

1. Should V1 persist `cloud_plugin_configured_item`, or should plugin enablement
   immediately materialize child MCP/skill configured rows and skip plugin
   configured state?

   Bias: persist plugin rows only if the product needs a durable "plugin is
   installed/enabled" concept independent of child state.

2. Are personal cloud sandboxes global per user or per user plus organization?

   This should already be decided by the sandbox/target foundation. This spec
   assumes one normal personal profile per user.

3. Do organization-owned MCP connections exist in V1?

   The model supports them. Hosted UI can start with user-owned connections
   made public to org, then add org-owned connection creation later.

4. Is `public_to_org` enough for audit?

   For V1, yes if every row records `public_updated_by_user_id` and
   `public_updated_at`. If audit/revocation gets heavier, extract a publication
   table.

5. How aggressively should OAuth refresh run in the background?

   Minimum: refresh during runtime config apply and lazy launch fallback.
   Better UX: add a Cloud reconciler that refreshes near-expiry public/personal
   MCP credentials before users hit launch.

## Non-Negotiable Invariants

- AnyHarness never calls Cloud.
- AnyHarness never stores plugin packages as runtime state.
- AnyHarness never owns OAuth refresh tokens.
- Workspace/session launch does not carry MCP/skill selection lists.
- Shared sandbox includes only public org items.
- Runtime launch fails closed if required config cannot be applied.
- Secrets never appear in logs, worker result payloads, status JSON, or UI.
- Product changes are durable before worker commands are queued.
- Worker commands are idempotent by profile/target/revision.
