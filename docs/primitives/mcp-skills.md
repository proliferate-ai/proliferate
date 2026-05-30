# 01 — MCP / Skills / Plugins

Status: implementation-ready spec.

Date: 2026-05-20.

Depends on: [`sandbox-provisioning.md`](sandbox-provisioning.md).

This spec defines how MCPs, skills, and plugins become sandbox-scoped runtime
config: how they are configured, compiled into a manifest, applied to a
managed target, and consumed by AnyHarness without it ever needing to know
about plugin packaging, organization policy, or admin roles.

## 1. Purpose & Scope

In scope:

- Cloud DB and API for MCP connections, skill configured items, plugin
  configured items, owned by a `sandbox_profile`.
- `public_to_org` semantics on configured items (admin publicization of
  personal-source rows; org-owned rows are public by ownership).
- Profile-scoped runtime config revision, current-applied, and artifact
  tables.
- A pure resolver that turns configured items + catalog data into a flat
  runtime manifest.
- A pure manifest compiler that converts resolver output into the AnyHarness
  contract types.
- Worker materialization carrying runtime config via the existing
  `materialize_environment` command (extended, not replaced) until the
  contract change to introduce a dedicated command kind is justified.
- AnyHarness runtime config contract: `PUT /v1/runtime-config`,
  `GET /v1/runtime-config`, prefetch, resolution-requests, resolve/reject.
- Session launch preflight that compares `requiredRuntimeConfigRevision`
  against the applied revision.
- Lazy artifact/credential resolution path used only for repair, not as the
  product synchronization model.
- Plugins UI integration (basic enable/disable + publicize + readiness).

Out of scope:

- Catalog ownership change. MCP and plugin catalogs remain code-backed in
  `server/proliferate/server/cloud/mcp_catalog/` and
  `server/proliferate/server/cloud/plugins/catalog/`. Spec 01 does not
  introduce DB catalog tables.
- Agent LLM auth (spec 02).
- Workspace-level or session-level MCP/skill selection. V1 invariant:
  workspaces and sessions inherit sandbox state.
- Hot-swapping MCP servers inside a live actor. Changes apply at the next
  launch boundary.
- Shared sandbox claim/access policy beyond `public_to_org` filtering
  (spec 05).
- Settings/Admin IA placement (spec 03).

## 2. Mental Model

Three layers, each with its own ownership:

```text
Catalog entry            "What GitHub MCP is, how it can be launched."
                         File/code-backed. Global. No user secrets.
                         Owners: server/proliferate/server/cloud/mcp_catalog/
                                 server/proliferate/server/cloud/plugins/catalog/

Configured item          "Pablo connected GitHub with these settings/auth."
                         "Pablo enabled Fix CI skill."
                         "Pablo installed GitHub plugin."
                         Owned by a user or organization.
                         DB-backed. Carries enabled + public_to_org.

Runtime manifest         "These are the MCP servers, skills, and artifact
                         refs the sandbox should be configured with."
                         Compiled from configured items + catalog data.
                         Versioned per sandbox_profile + target.
                         Owned by Cloud server; pushed to AnyHarness via
                         the worker.
```

Resolution direction:

```text
config write
  -> compile runtime manifest revision
  -> store sandbox_profile_runtime_config_revision + current
  -> enqueue materialize_environment with runtime config payload
  -> worker applies manifest to AnyHarness via PUT /v1/runtime-config
  -> AnyHarness stores compiled manifest
  -> next workspace/session launch checks applied >= required revision
```

**Eager apply is the normal path.** Lazy resolution is repair only:
AnyHarness already has a manifest but a referenced artifact is missing, a
credential is missing/expired, or local cache was lost. Worker/Desktop fetch
the gap from Cloud and fulfill it back.

**Plugins do not cross the AnyHarness boundary.** A plugin is product/UX
packaging. Before runtime, plugin expands one way:

```text
plugin -> default-enabled MCP server entries + default-enabled skill entries
```

AnyHarness never needs `plugin_id` to launch tools or serve skills.

**Workspaces and sessions do not send MCP ids or skill ids at launch.** They
may carry a `requiredRuntimeConfigRevision`. Cloud/Desktop make the sandbox
current before launch.

## 3. Dependencies

Hard:

- [`sandbox-provisioning.md`](sandbox-provisioning.md) — `sandbox_profile`,
  `cloud_targets` with `profile_target_role`, `sandbox_profile_target_state`
  with `applied_runtime_config_*` columns, worker contract carrying
  `cloud_workspace_id` and `sandbox_profile_id`.

Soft:

- [`agent-auth.md`](agent-auth.md) — MCP credentials are different
  from agent LLM auth, but the worker fulfillment endpoints reuse the same
  pattern.
- [`billing.md`](billing.md) — runtime config readiness affects
  launch-preflight; billing readiness is checked alongside it.

## 4. Current Repo State

Verified against the current repository worktree on 2026-05-20.

### 4.1 What already exists

**`cloud_mcp_connection` table** (`db/models/cloud/mcp.py`):

```text
id                  uuid pk
user_id             uuid fk user.id   NOT NULL  -- CHECK enforces this
org_id              uuid              NULL      -- CHECK enforces this
connection_id       text
catalog_entry_id    text
catalog_entry_version integer default 1
server_name         text default ""
enabled             boolean default true
settings_json       text default "{}"
config_version      integer default 1
payload_ciphertext  text NULL    -- legacy/deprecated
payload_format      text default "json-v1"
created_at, updated_at, last_synced_at

UNIQUE (user_id, connection_id)
CHECK user_id IS NOT NULL
CHECK org_id IS NULL          -- BLOCKS organization-owned connections today
```

**Personal-only by CHECK.** No `public_to_org`, no `owner_scope`, no
`public_status`, no `public_organization_id`. Spec 01 relaxes both CHECKs and
adds the public fields.

**`cloud_mcp_connection_auth` table** — sibling row keyed by
`connection_db_id` (unique), with `auth_kind`, `auth_status` (string),
`payload_ciphertext`, `payload_format`, `auth_version`, `token_expires_at`,
`last_error_code`.

**MCP catalog** is code-backed:

```text
server/proliferate/server/cloud/mcp_catalog/catalog.py        BASE_CONNECTOR_CATALOG
server/proliferate/server/cloud/mcp_catalog/domain/types.py   CatalogEntry, HttpLaunchTemplate, …
server/proliferate/server/cloud/mcp_catalog/api.py            GET /v1/cloud/mcp/catalog
server/proliferate/server/cloud/mcp_catalog/domain/hosted_connectors.py
```

A `CatalogEntry` carries id/version/name/transport/auth_kind/secret_fields/
settings_fields/launch templates plus `availability` and
`cloud_secret_sync`. There is **no DB catalog table**.

**Plugin catalog** is code-backed:

```text
server/proliferate/server/cloud/plugins/catalog/service.py
server/proliferate/server/cloud/plugins/catalog/domain/types.py
  PluginPackage, PluginSkill, PluginSkillResource, PluginSkillProvenance
server/proliferate/server/cloud/plugins/catalog/first_party.py
server/proliferate/server/cloud/plugins/catalog/first_party/<connector>/<skill>.md
```

`first_party_package_for_catalog_entry(entry)` derives one `PluginPackage`
per visible connector entry; skills are loaded from `.md` files. No DB
table for plugin packages.

**No `cloud_skill_configured_item` table.** Skill enablement is implicit
today: when an MCP connector is connected, its plugin's `default_enabled =
true` skills get included in the `SessionPluginBundle` that Desktop
assembles per session.

**No `cloud_plugin_configured_item` table.** Plugin enablement is implicit
in the MCP connection being applied.

**`cloud_target_configs` table** (`db/models/cloud/target_config.py`) —
**repo-scoped** target materialization:

```text
target_id, user_id, organization_id NULL
git_provider, git_owner, git_repo_name, workspace_root
config_version
env_vars_version, files_version, credential_snapshot_version,
mcp_materialization_version
materialization_status
payload_ciphertext, summary_json
last_command_id, last_materialized_at, last_error_code, last_error_message

UNIQUE (target_id, git_provider, git_owner, git_repo_name)
```

This stays as the repo/env/files materialization bridge. **It is not the
home for profile-scoped MCP/skill runtime config**; the spec adds new
profile-scoped tables.

**`TargetConfigMaterializationPlan`** (in `target_config/models.py`)
already carries `mcp: Optional[Dict[str, Any]]` and `skills:
List[Dict[str, Any]]` as untyped dicts. Worker writes them to disk:

```text
anyharness/crates/proliferate-worker/src/materialization/mcp.rs
  write_mcp_materialization(workspace_root, mcp) -> .proliferate/mcp/materialization.json

anyharness/crates/proliferate-worker/src/materialization/skills.rs
  write_skill_refs(workspace_root, skills) -> .proliferate/skills/refs.json
```

**No `PUT /v1/runtime-config` endpoint exists in AnyHarness.** Sessions are
launched with `mcp_servers`, `mcp_binding_summaries`, and `plugin_bundle`
inline on `CreateSessionRequest` (`anyharness-contract/src/v1/sessions.rs`
lines ~169–173). The skills MCP server (`proliferate_skills`) is mounted
from the in-memory `PluginBundleRegistry` via the session launch extension.

**No `RuntimeMcpServer` / `RuntimeSkill` / `RuntimeArtifactRef` types in
the contract.** No `runtime_config_current` table in AnyHarness SQLite.

**No `expectedRuntimeConfigRevision` / `required_runtime_config_revision`
in any session create/resume contract.** Only
`required_agent_auth_revision` exists.

**Desktop session-plugin-bundle builder** in
`apps/desktop/src/lib/domain/plugins/session-plugin-bundle.ts` is the current
runtime path. It assembles per-session bundles from applied MCP bindings.
Spec 01 phases this out (Phase 5 — legacy cleanup).

### 4.2 Gaps the spec closes

- `cloud_mcp_connection` is personal-only and has no public fields.
- Skill/plugin configured state lives only in Desktop's session-bundle
  builder. There is no shared sandbox view.
- No profile-scoped runtime config revision tables. Spec 00 added the
  desired/applied sequence columns on `sandbox_profile_target_state`, but
  no revision body store.
- No AnyHarness durable manifest. Sessions pass everything inline at
  create/resume.
- No resolver/compiler boundary; Desktop conflates resolution and bundle
  assembly.
- No launch preflight against runtime config.
- No worker apply path that produces a manifest from configured items.
- Lazy resolution is unsupported.
- Multi-org `public_to_org` semantics are undefined.

## 5. Target Model

### 5.1 Concept model

```text
catalog entry            (file/code, unchanged in V1)
configured item          (DB-owned, with public_to_org)
sandbox profile target   (already in 00; carries desired/applied sequence)
runtime config revision  (compiled manifest body, content-hashed)
runtime config current   (desired vs applied for the profile target)
runtime artifact         (artifact body keyed by hash)
```

V1 stores `enabled` and `public_to_org` directly on the configured item.
**Do not add `sandbox_mcp_mount` / `sandbox_skill_mount` /
`sandbox_plugin_selection` tables in V1.** Per-profile exception semantics
can be extracted later if real product need emerges.

`public_to_org` is paired with `public_organization_id` to disambiguate
multi-org users. Org-owned configured items (`owner_scope='organization'`)
are public to that org by ownership and do not need re-publicization.

### 5.2 `cloud_mcp_connection` (extend)

Schema after the spec:

```text
cloud_mcp_connection
  id                            uuid pk
  owner_scope                   text NOT NULL    'personal' | 'organization'
  owner_user_id                 uuid fk user.id NULL
  organization_id               uuid fk organization.id NULL

  connection_id                 text NOT NULL
  catalog_entry_id              text NOT NULL
  catalog_entry_version         integer NOT NULL default 1
  server_name                   text NOT NULL default ''

  enabled                       boolean NOT NULL default true

  public_to_org                 boolean NOT NULL default false
  public_organization_id        uuid fk organization.id NULL
  public_status                 text NOT NULL default 'private'
                                   'private' | 'public' | 'blocked' | 'stale' | 'revoked'
  public_updated_at             timestamptz NULL
  public_updated_by_user_id     uuid fk user.id NULL

  settings_json                 text NOT NULL default '{}'
  config_version                integer NOT NULL default 1

  created_at, updated_at, last_synced_at

  CHECK ck_cloud_mcp_connection_owner_fields:
    (owner_scope='personal' AND owner_user_id IS NOT NULL AND organization_id IS NULL)
    OR
    (owner_scope='organization' AND organization_id IS NOT NULL AND owner_user_id IS NULL)

  CHECK ck_cloud_mcp_connection_public:
    (public_to_org = false AND public_organization_id IS NULL)
    OR
    (public_to_org = true  AND public_organization_id IS NOT NULL)

  UNIQUE (owner_user_id, connection_id)        WHERE owner_scope='personal'
  UNIQUE (organization_id, connection_id)      WHERE owner_scope='organization'
```

**Migration (one PR, no users to preserve):**

```text
- rename user_id -> owner_user_id, org_id -> organization_id
- drop CHECK user_id IS NOT NULL and CHECK org_id IS NULL
- add owner_scope, public_to_org, public_organization_id,
  public_status, public_updated_at, public_updated_by_user_id
- add CHECK ck_cloud_mcp_connection_owner_fields
- add CHECK ck_cloud_mcp_connection_public
- replace UNIQUE (user_id, connection_id) with the two partial unique
  indexes above
- existing rows are mapped owner_scope='personal' in the migration
```

Important invariants:

- A personal connection can be publicized by an admin of any org the owner
  belongs to (or by the owner themselves, depending on org policy spec — V1
  default: admin only).
- `auth_status != 'ready'` excludes the connection from compiled manifests
  with a blocking warning. Spec 01 does not silently launch with a broken
  secret.
- Duplicate catalog MCPs publicized into the same org get deterministic
  server-name namespacing in the resolver (see 5.6). UI shows duplicates so
  admins can rename/disable.

`cloud_mcp_connection_auth` remains unchanged. Its `auth_status` enum is
referenced by the resolver.

### 5.3 `cloud_skill_configured_item` (new)

```text
cloud_skill_configured_item
  id                              uuid pk
  owner_scope                     text NOT NULL    'personal' | 'organization'
  owner_user_id                   uuid fk user.id NULL
  organization_id                 uuid fk organization.id NULL

  skill_source_kind               text NOT NULL    'catalog' | 'plugin' | 'user'
  skill_id                        text NOT NULL    catalog or plugin skill id
  skill_version                   text NULL
  plugin_id                       text NULL        provenance, when source='plugin'
  plugin_version                  text NULL

  enabled                         boolean NOT NULL default true

  public_to_org                   boolean NOT NULL default false
  public_organization_id          uuid fk organization.id NULL
  public_status                   text NOT NULL default 'private'
  public_updated_at               timestamptz NULL
  public_updated_by_user_id       uuid fk user.id NULL

  user_skill_payload_ref          text NULL    -- artifact store ref for user-authored skills
  source_snapshot_json            text NULL    -- optional immutable snapshot for audit/migration
  config_version                  integer NOT NULL default 1
  created_at, updated_at

  CHECK ck_skill_configured_owner_fields           -- same shape as MCP
  CHECK ck_skill_configured_public                 -- same shape as MCP
  CHECK ck_skill_configured_source_kind:
    skill_source_kind IN ('catalog','plugin','user')

  UNIQUE (owner_user_id, skill_source_kind, skill_id, COALESCE(plugin_id,''))
    WHERE owner_scope='personal'
  UNIQUE (organization_id, skill_source_kind, skill_id, COALESCE(plugin_id,''))
    WHERE owner_scope='organization'
```

Notes:

- Skill catalog metadata (display name, instruction artifact hash, resource
  hashes, required MCP refs) is **not duplicated** into the configured row.
  The resolver loads catalog metadata at compile time by `skill_id` +
  `skill_version`. Use `source_snapshot_json` only when the product
  deliberately needs a version snapshot for audit.
- `user_skill_payload_ref` is reserved for future user-authored skills.
  Bytes live in an artifact store, not inline.

### 5.4 `cloud_plugin_configured_item` (new)

```text
cloud_plugin_configured_item
  id                              uuid pk
  owner_scope                     text NOT NULL
  owner_user_id                   uuid NULL
  organization_id                 uuid NULL

  plugin_id                       text NOT NULL
  plugin_version                  text NULL
  enabled                         boolean NOT NULL default true

  public_to_org                   boolean NOT NULL default false
  public_organization_id          uuid fk organization.id NULL
  public_status                   text NOT NULL default 'private'
  public_updated_at               timestamptz NULL
  public_updated_by_user_id       uuid fk user.id NULL

  config_version                  integer NOT NULL default 1
  created_at, updated_at

  CHECK ck_plugin_configured_owner_fields
  CHECK ck_plugin_configured_public

  UNIQUE (owner_user_id, plugin_id)    WHERE owner_scope='personal'
  UNIQUE (organization_id, plugin_id)  WHERE owner_scope='organization'
```

V1 keeps the plugin row as a thin grouping marker. It does **not** drive
runtime expansion by itself. The resolver expands plugins one way:

```text
enabled plugin
  -> include plugin's default-enabled child MCP connections (if owner has
     them connected and ready)
  -> include plugin's default-enabled child skills (auto-create
     cloud_skill_configured_item rows on plugin install if absent)

public plugin
  -> publicize its publicizable child MCPs/skills via the same resolver
```

In practice, "install GitHub plugin" UX writes:

```text
cloud_plugin_configured_item   (owner, plugin_id=github, enabled=true)
cloud_mcp_connection           (one per plugin-required MCP, enabled=true)
cloud_skill_configured_item    (one per plugin's default-enabled skill)
```

The plugin row is not optional in V1. It is the parent/audit row that lets the
product show "Pablo enabled GitHub" and re-expand future default child items
deterministically. Child MCP/skill rows are still the runtime source, but the
plugin row remains the product source for the package-level toggle.

### 5.5 Runtime config revision + current + artifact tables (new)

Profile-scoped runtime config storage. **These are different from
`cloud_target_configs`**, which is the repo/env/files materialization
bridge. Naming uses `sandbox_profile_runtime_config_*` because desired
runtime config is profile-scoped; applied state is target-scoped through
`sandbox_profile_target_state`.

```text
sandbox_profile_runtime_config_revision
  id                          uuid pk
  sandbox_profile_id          uuid fk sandbox_profile.id NOT NULL
  sequence                    integer NOT NULL                -- monotonic per profile
  content_hash                text NOT NULL                   -- hash of canonical manifest
  manifest_json               bytea / text NOT NULL           -- redacted manifest body
  warnings_json               text NULL
  source                      text NOT NULL default 'server'  -- 'server' | 'desktop'
  generated_by_user_id        uuid fk user.id NULL
  created_at                  timestamptz NOT NULL

  UNIQUE (sandbox_profile_id, sequence)
  UNIQUE (sandbox_profile_id, content_hash)   -- idempotency on repeat compile

sandbox_profile_runtime_config_current
  sandbox_profile_id          uuid PRIMARY KEY fk sandbox_profile.id
  current_sequence            integer NOT NULL default 0
  current_revision_id         uuid fk sandbox_profile_runtime_config_revision.id NULL
  updated_at                  timestamptz NOT NULL

sandbox_profile_runtime_config_artifact
  revision_id                 uuid fk sandbox_profile_runtime_config_revision.id NOT NULL
  artifact_hash               text NOT NULL
  content_type                text NOT NULL
  byte_size                   integer NOT NULL
  payload_ciphertext          bytea NOT NULL                  -- encrypted body
  created_at                  timestamptz NOT NULL

  PRIMARY KEY (revision_id, artifact_hash)
```

Notes:

- `manifest_json` is the canonical compiled manifest used to compute
  `content_hash`. It contains MCP server entries with `credential_refs`,
  skill entries with `instruction_artifact` refs, and `artifacts[]`
  metadata. **It does not contain secret credential values or full
  artifact bodies.**
- `sandbox_profile_runtime_config_artifact` holds bodies. Worker fetches
  them on demand. Bodies are encrypted at rest using the existing Cloud
  artifact cipher.
- `current_revision_id` is the desired revision for **all** primary
  targets of that profile. In V1 there is one primary target per profile;
  the same model survives a future multi-target world.
- Per-`(profile, target)` applied state lives on
  `sandbox_profile_target_state.applied_runtime_config_sequence` /
  `applied_runtime_config_revision_id` (added by spec 00). Desired vs
  applied comparison happens there.

### 5.6 Resolver (pure)

New module:

```text
server/proliferate/server/cloud/runtime_config/domain/resolver.py
```

Inputs are frozen dataclasses:

```text
ResolverInput
  sandbox_profile              SandboxProfileSnapshot
  mcp_connections              list[CloudMcpConnectionSnapshot]
  mcp_connection_auths         list[CloudMcpConnectionAuthSnapshot]
  skill_configured_items       list[CloudSkillConfiguredItemSnapshot]
  plugin_configured_items      list[CloudPluginConfiguredItemSnapshot]
  catalog                      McpCatalogSnapshot          (from mcp_catalog)
  plugin_packages              list[PluginPackageSnapshot] (from plugins.catalog)
  user_skill_artifacts         dict[skill_id -> ArtifactRef]  -- optional
```

Outputs:

```text
ResolvedRuntimeConfigPlan
  mcp_servers                  list[ResolvedMcpServer]
  mcp_binding_summaries        list[ResolvedMcpBinding]
  skills                       list[ResolvedSkill]
  artifacts                    list[ResolvedArtifactRef]
  warnings                     list[ResolverWarning]
  blocking_errors              list[ResolverBlocker]
  source_row_refs              list[SourceRowRef]  -- for UI "where used"
```

Personal profile resolution:

```text
include cloud_mcp_connection rows where
  owner_scope='personal' AND owner_user_id = profile.owner_user_id
  AND enabled = true
  AND auth_status = 'ready' (else warning OR blocker depending on policy)

include cloud_skill_configured_item rows where
  owner_scope='personal' AND owner_user_id = profile.owner_user_id
  AND enabled = true

include cloud_plugin_configured_item rows where (same scope) AND enabled = true
  expand to default-enabled child MCPs/skills that pass their own checks
```

Organization shared profile resolution:

```text
include cloud_mcp_connection rows where
  ( owner_scope='organization' AND organization_id = profile.organization_id )
  OR
  ( public_to_org = true AND public_organization_id = profile.organization_id
    AND public_status = 'public' )
  AND enabled = true
  AND auth_status = 'ready'

same shape for skills and plugins
```

Personal items publicized into the org are included via the
`public_to_org` branch. Items the org owns directly are included by
ownership.

Determinism rules:

```text
duplicate server_name (e.g. two GitHub MCPs publicized by different users)
  preferred server_name when unique;
  on collision: server_name + '__' + short(connection_id_8)
  emit a warning describing the rename and source

skill required_mcp_refs that resolve to no included MCP
  emit blocking_error (skill is excluded with reason)

plugin child whose child MCP is missing required auth
  emit warning, exclude that child; do not block the whole plugin
```

Domain purity:

```text
- imports only stdlib + dataclasses + Cloud snapshot types
- no SQLAlchemy, no FastAPI, no stores, no integrations, no async I/O
- returns warnings/blockers as values, never raises product errors
```

### 5.7 Manifest compiler (pure)

New module:

```text
server/proliferate/server/cloud/runtime_config/domain/manifest.py
```

Takes a `ResolvedRuntimeConfigPlan` and emits the canonical manifest +
content hash. The compiler is responsible for shaping `credential_refs`
correctly:

```text
HTTP MCP Authorization header   -> RuntimeMcpValue.credential(credentialRef)
stdio API_KEY env var           -> RuntimeMcpValue.credential(credentialRef)
URL, command path, plain args   -> RuntimeMcpValue.literal(str)
```

Output:

```text
CompiledManifest
  revision (sequence, content_hash)
  mcp_servers[]
  mcp_binding_summaries[]
  skills[]
  artifacts[]
  warnings[]
  source = 'server'
```

`content_hash` is `hash(canonical_json(manifest_without_revision))` so the
hash is stable across re-compiles. Repeat compiles producing the same hash
short-circuit: the existing revision id is reused, no new revision row is
written, but the worker apply path is still triggered if the applied
revision is behind.

### 5.8 Worker materialization command (extend existing)

V1 carries runtime config through the **existing** `materialize_environment`
command. Reasons:

- `TargetConfigMaterializationPlan` already has `mcp: Optional[Dict]` and
  `skills: List[Dict]` fields that the worker writes to disk verbatim.
  Spec 01 strongly types those fields and adds revision metadata.
- Introducing a new command kind (`materialize_environment_runtime_config`)
  requires the full migration chain: contract type, server constant,
  default + active command-kind sets, DB CHECK constraints, command
  validator, worker supported_kinds, dispatcher handler, SDK regen, plus
  worker min-version gating. Spec 00 deliberately defers this.

After this spec, `TargetConfigMaterializationPlan` carries:

```text
runtime_config: RuntimeConfigMaterializationFragment | None
  revision_id           uuid
  sequence              integer
  content_hash          text
  manifest_json         JSON (typed in Rust as RuntimeConfigManifest)
  artifact_refs         list of { hash, content_type, byte_size, source_url }
  credential_refs       list of credential reference metadata, no secrets
```

The raw `mcp` and `skills` dict fields are dropped in this spec. The
worker handlers `write_mcp_materialization` and `write_skill_refs` are
removed; AnyHarness reads runtime config via the new
`/v1/runtime-config` endpoints. `runtime_config` is `Optional` only
because non-managed targets (SSH, local through Desktop) may apply
manifests through a different caller path.

Worker materialization handler:

```text
anyharness/crates/proliferate-worker/src/materialization/runtime_config.rs  (new)

apply_runtime_config(plan_fragment) {
  fetch missing artifact bodies from
    GET /v1/cloud/worker/runtime-configs/{revision_id}/artifacts/{hash}
  resolve credential refs from
    POST /v1/cloud/worker/runtime-configs/{revision_id}/credentials/materialize
  build ApplyRuntimeConfigRequest
  PUT /v1/runtime-config to AnyHarness
  POST /v1/cloud/worker/runtime-configs/{revision_id}/status
       with applied | failed + applied_revision_id + missing_*
}
```

Result echo to Cloud carries:

```text
applied_revision_id, applied_content_hash, status, missing_artifacts[],
missing_credentials[], stale_reason, error_code
```

A dedicated `materialize_environment_runtime_config` command kind can be
added later if performance or independent retry semantics demand it. Spec
01 explicitly does **not** add it.

### 5.9 AnyHarness runtime config contract and storage

New AnyHarness domain:

```text
anyharness/crates/anyharness-lib/src/domains/runtime_config/
  mod.rs
  model.rs
  store.rs
  service.rs
  artifact_cache.rs
  credentials.rs
  resolution.rs
```

Contract additions (`anyharness/crates/anyharness-contract/src/v1/runtime_config.rs`,
new file):

```rust
pub struct ApplyRuntimeConfigRequest {
    pub revision: RuntimeConfigRevision,
    pub manifest: RuntimeConfigManifest,
    pub source: RuntimeConfigSource,         // Desktop | Worker | Test
}

pub struct RuntimeConfigRevision {
    pub id: String,
    pub sequence: i64,
    pub content_hash: String,
    pub external_scope: Option<RuntimeConfigExternalScope>,
}

pub struct RuntimeConfigExternalScope {
    pub provider: String,        // "proliferate-cloud"
    pub id: String,              // sandbox_profile_id
    pub target_id: Option<String>,
}

pub struct RuntimeConfigManifest {
    pub mcp_servers: Vec<RuntimeMcpServer>,
    pub mcp_binding_summaries: Vec<SessionMcpBindingSummary>,
    pub skills: Vec<RuntimeSkill>,
    pub artifacts: Vec<RuntimeArtifactRef>,
}

pub struct RuntimeMcpServer {
    pub id: String,
    pub connection_id: String,
    pub catalog_entry_id: Option<String>,
    pub server_name: String,
    pub transport: RuntimeMcpTransport,         // Http | Stdio
    pub launch: RuntimeMcpLaunch,
    pub credential_refs: Vec<RuntimeCredentialRef>,
}

pub struct RuntimeSkill {
    pub id: String,
    pub source_kind: RuntimeSkillSourceKind,    // Catalog | Plugin | User
    pub display_name: String,
    pub description: String,
    pub instruction_artifact: RuntimeArtifactRef,
    pub resources: Vec<RuntimeSkillResource>,
    pub required_mcp_server_ids: Vec<String>,
    pub credential_refs: Vec<String>,
}

pub struct RuntimeArtifactRef {
    pub hash: String,
    pub content_type: String,
    pub byte_size: i64,
    pub source_ref: Option<String>,
}

pub struct RuntimeCredentialRef {
    pub credential_ref: String,
    pub used_in: RuntimeCredentialUse,           // McpLaunch | SkillBinding
    pub mcp_server_id: Option<String>,
    pub field_name: String,
}

pub enum RuntimeMcpValue {
    Literal(String),
    Credential(RuntimeCredentialRef),
}
```

API endpoints:

```text
GET  /v1/runtime-config
PUT  /v1/runtime-config
POST /v1/runtime-config/prefetch
GET  /v1/runtime-config/resolution-requests
POST /v1/runtime-config/resolution-requests/{request_id}/resolve
POST /v1/runtime-config/resolution-requests/{request_id}/reject
GET  /v1/runtime-config/status
```

Auth: existing AnyHarness runtime bearer token. Direct user tokens (claim
tokens from spec 05) do not have permission to apply runtime config.

SQLite durable state:

```text
runtime_config_current
  scope_provider          text NOT NULL
  scope_id                text NOT NULL
  target_id               text NULL
  revision_id             text NOT NULL
  sequence                integer NOT NULL
  content_hash            text NOT NULL
  manifest_json           text NOT NULL          -- redacted manifest
  source                  text NOT NULL
  applied_at              datetime NOT NULL

  PRIMARY KEY (scope_provider, scope_id, COALESCE(target_id,''))

runtime_artifact_cache
  artifact_hash           text PRIMARY KEY
  content_type            text NOT NULL
  byte_size               integer NOT NULL
  cache_path              text NOT NULL
  created_at              datetime NOT NULL
  last_used_at            datetime NOT NULL
```

In-memory only:

```text
credential_cache         credential_ref -> { values, expires_at, revision_id }
pending_resolution_requests
  request_id -> RuntimeResolutionRequest with kind, waiters, status
```

Storage rules:

```text
manifest_json is REDACTED. No bearer tokens, API keys, OAuth tokens,
stdio secret env values, or full skill bodies appear in manifest_json.
Credentials live in memory only; restart recomputes resolution requests.
Artifacts live on disk under runtime_artifact_cache, addressed by hash.
```

### 5.10 Session launch preflight

Contract change (`anyharness-contract/src/v1/sessions.rs`):

```text
CreateSessionRequest
  + expected_runtime_config_revision: Option<RuntimeConfigRevisionExpectation>

ResumeSessionRequest
  + expected_runtime_config_revision: Option<RuntimeConfigRevisionExpectation>

RuntimeConfigRevisionExpectation
  revision_id: String
  content_hash: String
  external_scope: Option<RuntimeConfigExternalScope>
```

AnyHarness behavior at launch:

```text
if expected_runtime_config_revision is present:
  load current runtime_config_current for the scope
  if missing OR revision_id != expected:
    return RUNTIME_CONFIG_RESOLUTION_REQUIRED with stale | missing reason
  for each MCP credential ref required by the manifest:
    if not in credential_cache or expired:
      add resolution request; return RUNTIME_CONFIG_RESOLUTION_REQUIRED
  build session MCP servers from the manifest (not from pluginBundle)
  proceed with session creation

if expected_runtime_config_revision is absent:
  allowed only for explicitly local/test callers. Managed Cloud and Desktop
  runtime-config launches fail closed rather than falling back to legacy
  mcp_servers/plugin_bundle payloads.
```

Cloud-side preflight (before enqueueing `start_session` or `send_prompt`):

```text
load sandbox_profile_target_state for (profile, target)
load sandbox_profile_runtime_config_current for profile

if applied_runtime_config_sequence < current_sequence:
  enqueue materialize_environment with runtime_config fragment
  block start_session until that command succeeds, or fail with
  RUNTIME_CONFIG_NOT_APPLIED

stamp the command payload with
  requiredRuntimeConfigSequence = current_sequence
  requiredRuntimeConfigRevisionId = current_revision_id
  requiredRuntimeConfigContentHash = current content hash
```

Desktop-side preflight (for local target):

```text
Desktop compiles/pushes local runtime config to local AnyHarness before
optimistic session create. The same expected_runtime_config_revision is
attached.
```

Required content-hash equality is the canonical match. Sequence numbers
are for ordering and stale-command detection, not equality.

### 5.11 Refresh hooks

Every write that affects runtime meaning triggers a refresh:

MCP connections:

```text
create / patch settings / toggle enabled / toggle public_to_org /
secret auth update / OAuth callback success / OAuth refresh / reconnect /
delete connection
```

Skills:

```text
enable / disable / publicize / unpublicize / source version change /
artifact change / required MCP refs change
```

Plugins:

```text
install / uninstall / enable / disable / publicize / unpublicize /
plugin catalog version change picked up by resolver
```

Target/worker side:

```text
target comes online with stale applied revision /
worker reports missing/stale revision /
launch requires newer revision than applied /
local artifact cache lost
```

Refresh path:

```text
config write commits its transaction
  -> identify affected sandbox profile(s)
  -> schedule runtime_config.reconciler for each affected profile
  -> reconciler handler:
       compile runtime config revision
       upsert sandbox_profile_runtime_config_current
       enqueue materialize_environment with runtime_config fragment
       command targets the profile's primary target (or any target if a
         future multi-target world exists)
```

Implementation files:

```text
server/proliferate/server/cloud/runtime_config/service.py
  schedule_profile_runtime_config_refresh(sandbox_profile_id, reason, actor)
  compile_profile_runtime_config(sandbox_profile_id)
  enqueue_runtime_config_materialization(sandbox_profile_id, target_id)

server/proliferate/server/cloud/runtime_config/reconciler.py
  scans rows whose applied < current, re-enqueues idempotently
```

Hook write sites (MCP):

```text
server/proliferate/server/cloud/mcp_connections/service.py
server/proliferate/server/cloud/mcp_oauth/service.py
server/proliferate/server/cloud/mcp_materialization/**
```

Hook write sites (skills/plugins):

```text
server/proliferate/server/cloud/skills/service.py        (new)
server/proliferate/server/cloud/plugins/service.py       (extend; the
  catalog/ subtree stays; add a sibling configured_items module)
```

### 5.12 Lazy resolution path (repair only)

Worker endpoints (worker token only):

```text
GET  /v1/cloud/worker/runtime-configs/{revision_id}/materialization
POST /v1/cloud/worker/runtime-configs/{revision_id}/status
GET  /v1/cloud/worker/runtime-configs/{revision_id}/artifacts/{hash}
POST /v1/cloud/worker/runtime-configs/{revision_id}/credentials/materialize
```

Flow when AnyHarness reports a gap:

```text
1. AnyHarness GET /v1/runtime-config/resolution-requests
2. worker reads pending requests
3. for each artifact request:
     fetch from /v1/cloud/worker/runtime-configs/{revision_id}/artifacts/{hash}
     POST /v1/runtime-config/resolution-requests/{id}/resolve with bytes/path
4. for each credential request:
     POST /v1/cloud/worker/runtime-configs/{revision_id}/credentials/materialize
       with credential refs
     POST /v1/runtime-config/resolution-requests/{id}/resolve with values + expires_at
5. retry session/MCP launch
6. if fulfillment fails (e.g. needs_reconnect), AnyHarness fails closed
   with RUNTIME_CONFIG_RESOLUTION_REQUIRED + ids
```

Desktop fills these gaps for the local target; worker fills them for the
managed cloud target. AnyHarness never calls Cloud directly.

### 5.13 OAuth and credential expiry

```text
proactive:
  during runtime config apply, refresh access tokens near expiry
  before they age out of the worker's materialize call

optional background:
  Cloud reconciler refreshes near-expiry tokens for connections used by
  active sandbox profiles (deferred to a follow-up; not blocking V1)

lazy launch:
  AnyHarness signals expired credential -> worker requests refresh ->
  POST /credentials/materialize returns new values

reactive tool-use:
  MCP returns auth-expired during use -> runtime marks credential stale ->
  next launch or remount fulfills fresh credential
```

Rules:

- AnyHarness never owns OAuth refresh tokens.
- Failed refresh -> `cloud_mcp_connection_auth.auth_status = 'needs_reconnect'`
  -> affected profiles re-resolved -> the MCP excluded with a blocking
  warning OR included with a degraded mode (V1: excluded).
- HTTP MCPs may support a best-effort live retry. Stdio MCPs need restart
  or remount unless the server documents a reload path.

### 5.14 Removing the SessionPluginBundle path

The legacy `SessionPluginBundle` path is removed in the same PR that
ships this spec. No dual-path window.

```text
Desktop:
  apps/desktop/src/lib/domain/plugins/session-plugin-bundle.ts          deleted
  callers of buildSessionPluginBundle                              rewritten
                                                                   to use
                                                                   runtime-config
                                                                   preflight

AnyHarness contract (anyharness-contract/src/v1/sessions.rs):
  CreateSessionRequest.plugin_bundle                               removed
  CreateSessionRequest.mcp_servers                                 removed
  CreateSessionRequest.mcp_binding_summaries                       removed
  same fields on ResumeSessionRequest                              removed

AnyHarness runtime:
  PluginBundleRegistry                                             deleted
  PluginSessionLaunchExtension                                     replaced
                                                                   by
                                                                   runtime_config
                                                                   loader
  proliferate_skills MCP server reads from runtime_config_current
```

`expected_runtime_config_revision` is the only path. Sessions without
runtime config (e.g. a target that has no MCPs configured) carry the
revision but the manifest is empty.

### 5.15 API surface

User/admin Cloud APIs (`/v1/cloud`):

```text
GET    /mcp/connections
POST   /mcp/connections
PATCH  /mcp/connections/{connection_id}                -- enabled, public_to_org, settings
DELETE /mcp/connections/{connection_id}
POST   /mcp/connections/{connection_id}/publicize      -- optional convenience
POST   /mcp/connections/{connection_id}/unpublicize
PUT    /mcp/connections/{connection_id}/auth/secret    -- existing
POST   /mcp/connections/{connection_id}/oauth/start    -- existing

GET    /skills
POST   /skills                                          -- create configured item
PATCH  /skills/{configured_item_id}
DELETE /skills/{configured_item_id}

GET    /plugins                                         -- catalog (existing) + configured state
POST   /plugins/{plugin_id}/install                     -- writes configured items
PATCH  /plugins/{configured_item_id}
DELETE /plugins/{configured_item_id}

GET    /sandbox-profiles/{sandbox_profile_id}/runtime-config
       returns desired/current/applied summary, warnings, where-used graph
POST   /sandbox-profiles/{sandbox_profile_id}/runtime-config/refresh
       forces a recompile (no change to enabled state; useful for repair)
```

Worker APIs (`/v1/cloud/worker`, worker token):

```text
GET  /runtime-configs/{revision_id}/materialization
POST /runtime-configs/{revision_id}/status
GET  /runtime-configs/{revision_id}/artifacts/{hash}
POST /runtime-configs/{revision_id}/credentials/materialize
```

`/runtime-config/refresh` is the user-facing trigger. It enqueues the
background compile + apply chain. It does not block on the apply.

## 6. Files To Change

Server DB models:

```text
server/proliferate/db/models/cloud/mcp.py
  - extend cloud_mcp_connection with owner_scope / public_* fields
  - rename user_id -> owner_user_id, org_id -> organization_id
  - replace personal-only CHECKs with owner-fields CHECK + public CHECK
  - add partial unique indexes
  - cloud_mcp_connection_auth unchanged

server/proliferate/db/models/cloud/skills.py       (new)
  CloudSkillConfiguredItem

server/proliferate/db/models/cloud/plugins.py      (new)
  CloudPluginConfiguredItem

server/proliferate/db/models/cloud/runtime_config.py    (new)
  SandboxProfileRuntimeConfigRevision
  SandboxProfileRuntimeConfigCurrent
  SandboxProfileRuntimeConfigArtifact

server/proliferate/db/models/cloud/__init__.py
  export new classes

server/alembic/versions/<NEW>_mcp_skill_plugin_runtime_config.py
  alembic migration adding everything above + relaxing/renaming MCP cols
```

Stores:

```text
server/proliferate/db/store/cloud_mcp/connections.py
  extend snapshot dataclasses with owner_scope, public_*
  load_personal_connections_for_owner, load_org_public_connections, etc.

server/proliferate/db/store/cloud_mcp/auth.py
  unchanged

server/proliferate/db/store/cloud_skills/configured_items.py     (new)

server/proliferate/db/store/cloud_plugins/configured_items.py    (new)

server/proliferate/db/store/cloud_runtime_config/revisions.py    (new)
server/proliferate/db/store/cloud_runtime_config/current.py      (new)
server/proliferate/db/store/cloud_runtime_config/artifacts.py    (new)

server/proliferate/db/store/cloud_sync/target_config.py
  extend TargetConfigMaterializationPlan persistence to include runtime
  config fragment when present
```

Services / APIs:

```text
server/proliferate/server/cloud/mcp_connections/
  api.py        add publicize/unpublicize endpoints and public/owner fields
                in responses
  service.py    hook write sites to call schedule_profile_runtime_config_refresh
  models.py     add owner_scope, public_*, runtime_apply_status fields
  access.py     admin gate on publicize for personal-source rows

server/proliferate/server/cloud/skills/                          (new)
  api.py, service.py, models.py, access.py, domain/policy.py

server/proliferate/server/cloud/plugins/                         (extend)
  catalog/                       unchanged file-backed catalog
  configured_items/api.py        (new) CRUD over CloudPluginConfiguredItem
  configured_items/service.py    (new) install/uninstall expands to children
  service.py                     orchestration

server/proliferate/server/cloud/runtime_config/                  (new)
  api.py                         user + worker endpoints
  service.py                     compile, refresh, enqueue materialize
  reconciler.py                  re-enqueue stale apply
  models.py                      pydantic
  access.py
  domain/resolver.py             pure
  domain/manifest.py             pure
  domain/policy.py               pure

server/proliferate/server/cloud/mcp_oauth/service.py
  on token refresh / reconnect / failure: request runtime config refresh

server/proliferate/server/cloud/mcp_materialization/**
  retire managed-cloud writers that produced raw mcp dicts on the legacy
  plan; new path is runtime_config service. Leave the legacy field set
  empty when the new runtime_config fragment is set.

server/proliferate/server/cloud/target_config/service.py
  extend the materialize_environment payload builder to include
  runtime_config when the profile has a current revision and the target
  is the primary managed-cloud target
```

Worker / contract (Rust):

```text
anyharness/crates/anyharness-contract/src/v1/runtime_config.rs   (new file)
anyharness/crates/anyharness-contract/src/v1/sessions.rs
  add expected_runtime_config_revision to CreateSessionRequest +
  ResumeSessionRequest

anyharness/crates/anyharness-lib/src/api/http/runtime_config.rs  (new)
anyharness/crates/anyharness-lib/src/api/router.rs               wire routes
anyharness/crates/anyharness-lib/src/domains/runtime_config/**   (new)
  model.rs, store.rs, service.rs, artifact_cache.rs, credentials.rs,
  resolution.rs
anyharness/crates/anyharness-lib/src/sessions/runtime/creation.rs
  if expected_runtime_config_revision present: build mcp_servers from
  runtime_config_current; if absent, permit only explicit local/test legacy
  callers
anyharness/crates/anyharness-lib/src/sessions/mcp_bindings/assembly.rs
  branch on runtime_config vs legacy bundle
anyharness/crates/anyharness-lib/src/live/sessions/connection/start.rs
  apply same preflight to live session start

anyharness/crates/anyharness-lib/src/domains/plugins/skills.rs
  SKILLS_MCP_SERVER serves from runtime_config skills index when
  expected_runtime_config_revision is in scope; explicit local/test callers
  without runtime config may use inline test fixtures until the migration is
  done

anyharness/crates/proliferate-worker/src/materialization/runtime_config.rs (new)
  apply_runtime_config(plan_fragment) handler
anyharness/crates/proliferate-worker/src/materialization/mod.rs
  invoke runtime_config handler when fragment is present;
  skip legacy mcp/skills raw writes when runtime_config takes precedence
anyharness/crates/proliferate-worker/src/commands/dispatcher.rs
  thread runtime_config result fields back to Cloud
anyharness/crates/proliferate-worker/src/cloud_client/commands.rs
  worker endpoints for fetching plan fragment, artifacts, credentials,
  posting status
```

SDK regeneration:

```text
anyharness/sdk/generated/openapi.json   regenerated
anyharness/sdk/src/generated/*.ts       regenerated
anyharness/sdk/src/client/runtime-config.ts        (new)
anyharness/sdk/src/types/runtime-config.ts         (new)
anyharness/sdk/src/index.ts                        exports

cloud/sdk/src/client/mcp-connections.ts            extend
cloud/sdk/src/client/skills.ts                     (new)
cloud/sdk/src/client/plugins.ts                    extend
cloud/sdk/src/client/runtime-config.ts             (new)
cloud/sdk/src/client/index.ts                      exports
cloud/sdk/src/types/generated.ts                   regenerated
server/openapi.json                                 regenerated
```

Desktop:

```text
apps/desktop/src/hooks/access/cloud/mcp-connections/
  use-connectors.ts                                extend with public_*
  use-connector-mutations.ts                       optimistic public toggle

apps/desktop/src/hooks/access/cloud/skills/             (new)
  use-skills.ts, use-skill-mutations.ts

apps/desktop/src/hooks/access/cloud/runtime-config/     (new)
  use-runtime-config-status.ts, use-refresh-runtime-config.ts

apps/desktop/src/lib/workflows/mcp/runtime-config-refresh.ts          (new)
apps/desktop/src/lib/workflows/mcp/runtime-config-resolution.ts       (new)
apps/desktop/src/hooks/sessions/workflows/use-session-runtime-config-preflight.ts (new)

apps/desktop/src/pages/PluginsPage.tsx
apps/desktop/src/components/plugins/catalog/*           augment rows with
  enabled, public_to_org, auth_status, runtime_apply_status badges
apps/desktop/src/components/plugins/detail/ConnectorDetailModal.tsx
  show where-used and admin publicize toggle

apps/desktop/src/lib/domain/plugins/session-plugin-bundle.ts
  deleted in this PR

apps/desktop/src/lib/access/anyharness/runtime-config.ts              (new)
apps/desktop/src/lib/access/anyharness/sessions.ts
  carry expected_runtime_config_revision when known
```

## 7. Implementation Phases

The runtime substrate must be reliable before product state is layered on.
Phases are ordered to keep launches fail-closed at each step.

Preferred implementation is one PR per spec. Chunks are review checkpoints inside that PR and may be split only when the split does not leave duplicate models, dead paths, partially wired security checks, or visible inert UI. Phases here describe build-order inside that
PR, not staged rollout.

```text
Chunk A  Runtime substrate
  - AnyHarness domains/runtime_config domain (model/store/service/
    artifact_cache/credentials/resolution)
  - api/http/runtime_config.rs handlers; wire router
  - SQLite tables runtime_config_current, runtime_artifact_cache
  - resolution requests in-memory
  - worker materialization/runtime_config.rs handler
  - extend TargetConfigMaterializationPlan with runtime_config fragment;
    drop raw mcp/skills dict fields and their write handlers
  - AnyHarness contract: add expected_runtime_config_revision to
    CreateSessionRequest/ResumeSessionRequest; remove plugin_bundle,
    mcp_servers, mcp_binding_summaries from those requests
  - SDK regen (anyharness/sdk, cloud/sdk)

Chunk B  Cloud product schema
  - migration: cloud_mcp_connection broadened (owner_scope, public_*,
    rename user_id/org_id, partial unique indexes)
  - migration: cloud_skill_configured_item
  - migration: cloud_plugin_configured_item
  - migration: sandbox_profile_runtime_config_revision/_current/_artifact
  - stores returning frozen dataclass snapshots

Chunk C  Resolver + compiler + write services
  - domain/resolver.py and domain/manifest.py (pure)
  - service.py compile + idempotent revision upsert by content_hash
  - hook write sites (MCP create/patch/auth/oauth/delete, skill enable/
    public, plugin install/enable/public)
  - reconciler tick

Chunk D  Worker apply + Cloud-side preflight
  - worker applies runtime_config; reports applied/failed
  - target_config.service builds plans with runtime_config fragment
  - Cloud-side preflight before enqueueing start_session/send_prompt
  - Desktop local target preflight before optimistic session create

Chunk E  Legacy removal
  - delete apps/desktop/src/lib/domain/plugins/session-plugin-bundle.ts
  - delete AnyHarness PluginBundleRegistry and
    PluginSessionLaunchExtension
  - rewrite all callers of buildSessionPluginBundle to use the new
    runtime-config preflight workflow
  - proliferate_skills MCP server reads from runtime_config_current,
    not from the in-memory bundle registry

Chunk F  Product UI
  - Plugins page rows: enabled, public_to_org, auth_status, runtime apply
  - admin publicize toggle (gated by access.py)
  - skills page integrated per spec 03 placement
  - readiness panel reads /sandbox-profiles/{id}/runtime-config

OAuth proactive refresh (optional follow-up after this PR)
  - Cloud reconciler refreshes near-expiry tokens before apply
```

## 8. Acceptance Criteria

1. `cloud_mcp_connection` supports `owner_scope='personal'` and
   `owner_scope='organization'`. Personal-only CHECKs are removed.
2. `cloud_mcp_connection.public_to_org` requires
   `public_organization_id`; the inverse is also true. Enforced by
   CHECK.
3. `cloud_skill_configured_item` and `cloud_plugin_configured_item`
   share the same owner-fields and public CHECKs.
4. Catalog (MCP + plugin) stays code-backed in
   `server/proliferate/server/cloud/mcp_catalog/` and
   `server/proliferate/server/cloud/plugins/catalog/`. The spec adds no
   catalog DB tables.
5. `sandbox_profile_runtime_config_revision` is keyed by
   `(sandbox_profile_id, sequence)` and idempotent on `content_hash`:
   re-compiling the same manifest does not write a new revision row.
6. The resolver and compiler are pure: their modules import no SQLAlchemy,
   no FastAPI, no async I/O, and no integrations.
7. Personal profile resolver returns only the user's enabled items + their
   org's items they have access to. Public items from other users are
   excluded.
8. Organization profile resolver returns org-owned items + personal items
   publicized to that org (`public_to_org=true AND
   public_organization_id=org`). Public items from other orgs are
   excluded.
9. Duplicate MCP server names from multi-source publicization are renamed
   deterministically (`<server_name>__<short_id>`); the warning is
   visible in the UI.
10. `cloud_mcp_connection_auth.auth_status != 'ready'` excludes the MCP
    from the compiled manifest with a blocker (or warning, per V1
    policy); launches requiring that MCP fail closed.
11. The `materialize_environment` worker command carries a strongly-typed
    `runtime_config` fragment. When the fragment is set, the worker
    skips the legacy raw `mcp` / `skills` writes.
12. `materialize_environment_runtime_config` command kind is **not**
    introduced in this spec.
13. AnyHarness exposes `PUT /v1/runtime-config`, `GET /v1/runtime-config`,
    `POST /v1/runtime-config/prefetch`,
    `GET /v1/runtime-config/resolution-requests`,
    `POST /v1/runtime-config/resolution-requests/{id}/resolve` and
    `…/reject`, all worker-token-only.
14. AnyHarness `manifest_json` redacts secret credential values, OAuth
    refresh tokens, stdio secret env values, and full skill bodies.
15. `CreateSessionRequest.expected_runtime_config_revision` is honored:
    AnyHarness builds session MCP servers from the runtime config when
    set, and returns `RUNTIME_CONFIG_RESOLUTION_REQUIRED` when missing
    or stale.
16. Cloud-side preflight blocks `start_session` / `send_prompt` when
    `applied_runtime_config_sequence < current_sequence`. The
    enqueued `materialize_environment` runs first; the launch resumes
    when applied catches up.
17. Workspaces and sessions do not carry MCP ids or skill ids at launch
    in any managed-cloud or Cloud-mediated path.
18. Lazy resolution endpoints succeed for missing artifacts and
    credentials. AnyHarness reports
    `RUNTIME_CONFIG_RESOLUTION_REQUIRED` with `resolution_request_ids`
    when fulfillment is required.
19. `apps/desktop/src/lib/domain/plugins/session-plugin-bundle.ts` is deleted.
    `plugin_bundle`, `mcp_servers`, and `mcp_binding_summaries` are
    removed from `CreateSessionRequest` / `ResumeSessionRequest` in the
    AnyHarness contract. `PluginBundleRegistry` and
    `PluginSessionLaunchExtension` are deleted from AnyHarness. There
    is no dual-path window.
20. OAuth refresh failures set `auth_status = 'needs_reconnect'` and
    cause the next refresh hook to mark the profile's runtime config
    `blocked` for affected MCPs until reconnected.
21. The Plugins UI shows per-row badges: `enabled`, `public_to_org`,
    `auth_status`, `runtime_apply_status`. Mutations are optimistic with
    rollback on error and invalidate target-config status on settle.

## 9. Verification / Tests

Server:

```bash
cd server
uv run pytest -q
```

Targeted server tests:

```text
server/tests/cloud/mcp_connections/test_owner_scope_publicize.py
server/tests/cloud/mcp_connections/test_personal_only_check_removed.py
server/tests/cloud/skills/test_skill_configured_items_crud.py
server/tests/cloud/skills/test_skill_publicize_admin_gate.py
server/tests/cloud/plugins/test_install_writes_children.py
server/tests/cloud/runtime_config/test_resolver_personal_profile.py
server/tests/cloud/runtime_config/test_resolver_org_profile.py
server/tests/cloud/runtime_config/test_resolver_duplicate_server_name.py
server/tests/cloud/runtime_config/test_resolver_missing_required_mcp.py
server/tests/cloud/runtime_config/test_manifest_content_hash_idempotent.py
server/tests/cloud/runtime_config/test_revision_upsert_no_duplicate.py
server/tests/cloud/runtime_config/test_refresh_hooks_mcp.py
server/tests/cloud/runtime_config/test_refresh_hooks_skill.py
server/tests/cloud/runtime_config/test_refresh_hooks_plugin.py
server/tests/cloud/runtime_config/test_worker_runtime_config_endpoints.py
server/tests/cloud/runtime_config/test_launch_preflight_blocks_stale.py
server/tests/cloud/runtime_config/test_oauth_refresh_failure_blocks.py
server/tests/cloud/mcp_materialization/test_legacy_mcp_field_empty_when_runtime_config_set.py
```

AnyHarness:

```bash
cargo test -p anyharness-contract
cargo test -p anyharness-lib runtime_config
cargo test -p proliferate-worker runtime_config
```

Targeted Rust tests:

```text
anyharness/crates/anyharness-contract/src/v1/runtime_config.rs#tests
  - manifest round-trip
  - redacted manifest does not contain secret-bearing values

anyharness/crates/anyharness-lib/src/domains/runtime_config/store.rs#tests
  - PUT new manifest sets current
  - PUT same content_hash is idempotent
  - resolution requests created on prefetch
  - resolve persists credentials in memory only
  - restart loses credential_cache; recomputes requests

anyharness/crates/anyharness-lib/src/sessions/runtime/creation.rs#tests
  - expected_runtime_config_revision present + applied -> session launches
    with manifest-built MCP servers
  - expected_runtime_config_revision stale -> RUNTIME_CONFIG_RESOLUTION_REQUIRED
  - expected_runtime_config_revision absent on Managed Cloud/Desktop -> fail
    closed; explicit local/test legacy caller remains allowed

anyharness/crates/proliferate-worker/src/materialization/runtime_config.rs#tests
  - apply_runtime_config fetches missing artifacts
  - apply_runtime_config materializes credentials
  - status report includes applied/missing
```

SDK regeneration:

```bash
cd anyharness/sdk && pnpm run generate && pnpm run build
cd cloud/sdk && pnpm run generate && pnpm run build
```

Desktop:

```bash
cd apps/desktop && pnpm test -- --run && pnpm typecheck
```

Targeted Desktop tests:

```text
apps/desktop/src/hooks/access/cloud/mcp-connections/use-connectors.test.ts
apps/desktop/src/lib/workflows/mcp/runtime-config-refresh.test.ts
apps/desktop/src/hooks/sessions/workflows/use-session-runtime-config-preflight.test.ts
```

Manual smoke cases:

```text
1. Enable personal MCP
     -> cloud_mcp_connection.enabled=true
     -> sandbox_profile_runtime_config_current sequence bumped
     -> compile produces a new revision; current updated
     -> worker materializes; sandbox_profile_target_state applied catches up
     -> next session launches with MCP available

2. Disable personal MCP
     -> compile produces a revision without the MCP
     -> worker applies; next session launches without it

3. Admin publicizes MCP to org
     -> cloud_mcp_connection.public_to_org=true, public_organization_id=org
     -> org's shared sandbox_profile re-resolves and recompiles
     -> shared cloud target applies; shared automations/Slack see the MCP

4. Publicize MCP whose auth becomes needs_reconnect
     -> auth_status=needs_reconnect; resolver excludes with blocking warning
     -> shared readiness UI shows attention needed
     -> launch requiring that MCP fails RUNTIME_CONFIG_RESOLUTION_REQUIRED

5. Enable skill requiring missing MCP
     -> resolver emits blocking_error for that skill
     -> compiled manifest excludes the skill
     -> UI shows the blocking reason

6. Install GitHub plugin
     -> writes cloud_plugin_configured_item plus
        cloud_mcp_connection + cloud_skill_configured_item for default-enabled
        children
     -> single recompile produces one revision with all children

7. Two users publicize GitHub MCP into the same org
     -> resolver renames the second one to e.g. "github__a1b2c3d4"
     -> UI shows the rename + source

8. Worker offline, then back online
     -> Cloud's desired runtime config is current; applied is stale
     -> on heartbeat with stale revision, reconciler enqueues materialize
     -> apply completes before any wake-gated session launch

9. AnyHarness reports missing artifact
     -> worker fetches /artifacts/{hash} from Cloud
     -> POST /resolve into AnyHarness
     -> session launches successfully
```

## 10. Final Decisions / Deferred Questions

1. **Persist `cloud_plugin_configured_item` in V1, or always materialize
   into child MCPs/skills only?**

   Decision: ship the table, but treat it as a thin grouping marker. Reasons:
   - "Plugin installed" is a real product concept (Settings/Admin IA wants
     a Plugins list).
   - Uninstall/re-enable is cleaner when there is a parent row.
   - Audit and `public_status` on the plugin row are useful.
   The cost is a tiny extra table. Pros outweigh.

2. **MCP `auth_status != 'ready'` — blocker or warning by default?**

   Decision: blocker for personal profile if the user explicitly enabled the
   MCP (it cannot do its job without auth). Warning for org profile
   public-to-org cases when the source has not been reconnected (avoids
   blocking the whole shared sandbox on one bad connection). Make it
   configurable per plan or admin policy in a later spec.

3. **Should runtime config storage be profile-scoped or
   `(profile, target)`-scoped?**

   Decision: profile-scoped. One revision per profile applies to all of
   the profile's targets (one target in V1). Per-`(profile, target)`
   applied state already lives on `sandbox_profile_target_state` (spec
   00) and is sufficient for fencing.

4. **Should the spec add `materialize_environment_runtime_config` as a
   dedicated command kind?**

   Decision: no in V1. Extending `materialize_environment` is correct cost
   for the benefit. Revisit when independent retry or independent
   metering of runtime-config applies becomes important.

5. **Where should the Settings UI live for skills?**

   Decision: as a section inside the Plugins page (so plugin-provided skills
   live next to their plugin) plus a top-level "Skills" tab for
   user-authored skills. Spec 03 (Settings/Admin IA) makes the final
   call.

6. **Should user-authored skills land in V1?**

   Decision: no. `cloud_skill_configured_item.skill_source_kind='user'` and
   `user_skill_payload_ref` are reserved for future use. Phase 5 UI
   does not expose creation; it shows catalog and plugin-provided skills
   only.

7. **Live MCP remount inside a running actor?**

   Out of scope. Changes apply at the next launch boundary. The
   architecture spec already calls this out; spec 01 sticks with it.
