# Shared Sandbox Config And Admin UI Spec

Status: proposed workstream 2 implementation spec

Date: 2026-05-17

## Purpose

This spec defines the workstream 2 model for personal cloud sandbox
configuration, organization shared sandbox configuration, public MCP/skill
publication, and the admin/user UI that controls those settings.

Workstream 1 defines the runtime-facing target MCP/skill manifest and lazy
artifact/credential resolution. This spec defines the Cloud and Desktop product
model that decides which MCPs, skills, credentials, repo environment inputs, and
targets should feed that runtime manifest.

The core product shape is:

```text
personal sandbox profile       one per user
organization shared profile    one per organization
repo environment config        per owner scope + repo
public MCP/skill publication   org-visible projection of a private source
target runtime config          generated from the profile, then pushed to AnyHarness
```

AnyHarness still sees only target runtime config, MCP servers, skills, and
credential refs. It does not learn about plugins, publicization policy, admin
roles, or org membership.

## Assumptions

This spec assumes `docs/architecture/target-runtime-mcp-skills-config.md` is
implemented or being implemented as the runtime substrate:

- AnyHarness has target-scoped MCP/skill runtime config.
- Desktop and proliferate-worker can push runtime config refreshes.
- AnyHarness can emit lazy artifact and credential gap requests.
- AnyHarness remains inbound-only and never calls Proliferate Cloud.

This spec should not duplicate that protocol. It only defines the Cloud,
Desktop, and UI models that decide what the target runtime config contains and
which Cloud-side credential/artifact records a worker is allowed to fulfill.

## Docs Read For This Spec

This spec is cross-cutting and follows:

- `docs/README.md`
- `docs/architecture/cloud-work-launch-model-spec.md`
- `docs/architecture/target-runtime-mcp-skills-config.md`
- `docs/architecture/plugins-and-skills.md`
- `docs/frontend/README.md`
- `docs/frontend/guides/access.md`
- `docs/frontend/guides/components.md`
- `docs/frontend/guides/config.md`
- `docs/frontend/guides/copy.md`
- `docs/frontend/guides/hooks.md`
- `docs/frontend/guides/lib.md`
- `docs/frontend/guides/state.md`
- `docs/server/README.md`
- `docs/server/guides/auth.md`
- `docs/server/guides/database.md`
- `docs/server/guides/domains.md`
- `docs/server/guides/workers.md`
- `docs/anyharness/README.md`
- `docs/anyharness/guides/api.md`
- `docs/anyharness/guides/live-runtime.md`
- `docs/anyharness/guides/persistence.md`

## Scope

In scope for workstream 2:

- Define personal vs organization sandbox profiles.
- Make managed cloud sandbox cardinality explicit: one active personal managed
  cloud target per user and one active shared managed cloud target per org.
- Make repo environment config owner-scoped instead of only user-scoped.
- Add public MCP and public skill publication models.
- Feed public MCPs and public skills into organization shared sandboxes.
- Define agent credential refs and shared-sandbox credential source models,
  including synced-path, API-key, and future managed-gateway refs.
- Add admin UI for shared cloud setup, shared repo environments, shared agent
  credentials, and shared MCPs/skills.
- Update user UI for personal cloud setup and publicizing MCPs/skills.
- Ensure Desktop and proliferate-worker are the only components that resolve
  product policy and push target runtime config refreshes to AnyHarness.

Out of scope for workstream 2:

- AnyHarness shared-mode auth and session claiming. That is workstream 3.
- The AnyHarness lazy loading protocol itself. That is workstream 1.
- Billing enforcement changes.
- Full migration of existing session/workspace state between targets.
- New product surfaces that consume shared sandboxes. Those can use this
  substrate later, but they are not specified here.
- A generic credential gateway. Shared sandboxes still use direct MCP transport
  after Cloud/worker resolve the credential.

## Terminology

```text
CloudTarget
  Durable compute identity. Can be managed_cloud or ssh. Can be personal or
  organization-owned.

Managed cloud sandbox
  Ephemeral backing compute for a managed_cloud CloudTarget. It can be
  restarted or replaced without changing the target identity.

Sandbox profile
  Product-level owner configuration for a user's personal sandbox or an
  organization's shared sandbox.

Repo environment config
  Per-owner, per-repo setup inputs: default branch, setup script, run command,
  env vars, and tracked files.

Publication
  Org-visible projection of a private MCP connection or skill source. The
  product UI can expose this as a "Make public" boolean, but the durable record
  should be a separate publication row.

Selection
  A publication, credential source, repo config, or target chosen by a sandbox
  profile.

Claiming
  A later workstream 3 feature that allows a user identity to attach directly to
  an existing shared AnyHarness session. Workstream 2 prepares data ownership
  but does not enable direct access.
```

## Decisions

1. Owner scope is first-class everywhere this feature touches.

   Every shared-cloud object that can be personal or organization-owned should
   carry an explicit owner scope:

   ```text
   owner_scope = personal | organization
   owner_user_id
   organization_id
   created_by_user_id
   ```

   Personal rows use `owner_user_id` and no `organization_id`. Organization
   rows use `organization_id` and no `owner_user_id`.

2. Managed cloud target cardinality becomes one per owner.

   The end state is:

   ```text
   user personal cloud      -> one unarchived managed_cloud target
   organization shared cloud -> one unarchived managed_cloud target
   personal SSH targets     -> many allowed
   organization SSH targets -> many allowed
   ```

   Workspaces and repos are materialized under that owner target. A repo should
   not create a new managed cloud target by default.

3. Repo environment config remains repo-scoped, but becomes owner-scoped.

   Personal and shared sandboxes need different `.env`, tracked files, setup,
   and run commands. The same repo can therefore have:

   ```text
   personal repo config for user A
   personal repo config for user B
   organization repo config for org X
   ```

   Organization repo config is admin-managed and may include shared env files.

4. MCPs and skills are target-wide profile inputs.

   MCPs and skills are not per session and not per repo. A personal sandbox
   profile resolves to the user's enabled MCPs and skills. An organization
   shared profile resolves to the org's enabled public MCP and skill
   publications.

5. "Make public" is a UX boolean, not ownership transfer.

   A user can make a private MCP connection or skill available to organization
   shared sandboxes. The credential remains the user's credential. The
   org-visible thing is a
   publication record that points back to the private source.

   This avoids turning `CloudMcpConnection` into a mixed personal/org row and
   makes unpublishing, source deletion, and source auth expiry explicit.

6. Public publications are included in the shared sandbox by default.

   For V1, an enabled org publication is part of the org shared sandbox
   profile. Admins can disable or remove a publication from the shared profile,
   but there is no separate hidden eligibility layer.

7. Duplicate publicized MCPs do not silently collapse.

   If two people publish the same catalog MCP, both publications can exist. The
   shared runtime resolver namespaces generated server names by publication id
   or admin override. The admin UI must make duplicates obvious and allow admins
   to disable the unwanted one.

8. Shared credentials are selected by typed credential ref, not copied blindly.

   Admins can configure shared agent credentials by choosing a
   `cloud_agent_credential` ref:

   ```text
   synced_path      encrypted file/path payload synced from Desktop
   api_key          encrypted key material configured in Cloud/Desktop
   managed_gateway  future gateway-backed credential authority
   ```

   The shared sandbox source points at the ref. The ref points at a
   kind-specific backing record. If the backing credential is revoked, expired,
   or needs resync, shared cloud status becomes `needs_attention` instead of
   silently falling back.

9. Non-admins may see shared availability summaries but not secrets.

   Org members can see that GitHub, Linear, or a skill is available to shared
   sandboxes. They should not see env var values, tracked file contents,
   credential payloads, or the source user's secret material.

10. Config updates propagate by revision and refresh.

   Updating a personal or shared sandbox profile increments its runtime config
   revision. Cloud then enqueues target config materialization for affected
   targets. The worker applies repo/credential artifacts and pushes the
   workstream 1 target runtime config refresh to AnyHarness. Live sessions pick
   up the change at the next launch/restart boundary.

## Current State To Change

The repo already has useful substrate, but the ownership model is incomplete.

Targets:

- `CloudTarget` already has `owner_scope`, `owner_user_id`, and
  `organization_id`.
- SSH target enrollment can create organization-owned targets when the caller is
  an org admin.
- Managed cloud target registration is still tied to a runtime environment and
  currently creates personal targets.

Managed cloud cardinality:

- `CloudRuntimeEnvironment` is unique by user or org plus repo plus isolation
  policy.
- It has `active_sandbox_id` and `target_id`.
- That means the current managed cloud path is closer to one runtime
  environment and target per repo/policy than one sandbox per user or org.

Repo config:

- `CloudRepoConfig` is unique by `(user_id, git_owner, git_repo_name)`.
- `CloudRepoFile` hangs off that personal repo config.
- Organization cloud workspace repo config currently returns
  `org_cloud_not_ready`.

Target materialization:

- `CloudTargetConfig` already exists per target/repo and stores an encrypted
  payload plus summary/version fields.
- The current materialization service reads personal repo config, personal Git
  auth, personal cloud credentials, and user MCP connections.
- Its request still accepts direct `mcpConnectionIds`, which is not enough for
  shared sandbox profile resolution.

MCPs:

- `CloudMcpConnection` is user-owned.
- Its table includes `org_id`, but constraints currently require
  `user_id IS NOT NULL` and `org_id IS NULL`.
- There is no public flag and no publication model.

Agent credentials:

- `CloudCredential` is user-owned only.
- The current payload model is enough for personal sync, but it does not yet
  express shared-sandbox credential sources, selected source users, source
  readiness, or worker materialization status.
- Shared/org credential source selection does not exist.

Desktop UI:

- Settings has personal Cloud, Compute, Organization, and repo environment
  sections.
- The Cloud pane manages personal automatic sync, personal agent credential
  sync, and personal cloud environments.
- The repo pane configures personal repo environment inputs.
- The Organization pane manages membership, invitations, billing link, and org
  settings, but not shared cloud.

## Target Data Model

### Sandbox Profiles

Add a profile table for owner-level cloud configuration:

```text
cloud_sandbox_profile
  id
  owner_scope                  personal | organization
  owner_user_id                nullable for org rows
  organization_id              nullable for personal rows
  managed_target_id            nullable until cloud is enabled
  enabled
  runtime_config_revision
  default_workspace_root
  default_agent_kind
  default_model_id
  default_mode_id
  default_reasoning_effort
  created_by_user_id
  updated_by_user_id
  created_at
  updated_at
```

Constraints:

```text
personal row:
  owner_user_id is not null
  organization_id is null
  unique active row by owner_user_id

organization row:
  organization_id is not null
  owner_user_id is null
  unique active row by organization_id
```

The profile owns policy. `CloudTarget` owns durable compute identity. For
managed cloud, the profile points at the owner default managed target. For SSH,
the profile is still the source of MCP/skill/credential defaults, but a launch
may select a specific visible SSH target.

### Managed Cloud Targets

Use `CloudTarget` as the durable managed cloud target identity and add partial
uniqueness for unarchived managed targets:

```text
personal managed target:
  kind = managed_cloud
  owner_scope = personal
  owner_user_id = <user>
  organization_id = null
  unique where archived_at is null

organization managed target:
  kind = managed_cloud
  owner_scope = organization
  owner_user_id = null
  organization_id = <org>
  unique where archived_at is null
```

`CloudRuntimeEnvironment` should stop being the identity for managed cloud
cardinality. New launches should resolve:

```text
owner scope -> cloud_sandbox_profile -> managed CloudTarget -> active sandbox
```

Existing per-repo runtime environments can be migrated through compatibility
code during the PR, but the steady-state launch path should be target-first.

### 1:1 Sandbox Mapping Workflows

Personal managed cloud enablement:

```text
1. User enables personal cloud.
2. Server creates or loads the user's personal sandbox profile.
3. Server finds the user's canonical unarchived managed_cloud target.
4. If none exists, server creates one.
5. If multiple exist, server picks the canonical target and marks the rest for
   drain/archive after active work completes.
6. Profile.managed_target_id points at the canonical target.
7. Future personal cloud launches reuse that target identity.
```

Organization managed cloud enablement:

```text
1. Org owner/admin enables shared cloud.
2. Server creates or loads the organization's shared sandbox profile.
3. Server finds the org's canonical unarchived managed_cloud target.
4. If none exists, server creates one with owner_scope = organization.
5. Profile.managed_target_id points at that target.
6. Future org shared launches reuse that target identity.
```

Runtime sandboxes are replaceable. The 1:1 invariant is about durable target
identity, not one never-restarted container:

```text
owner profile 1:1 CloudTarget
CloudTarget 1:many CloudSandbox over time
CloudTarget 1:1 active CloudSandbox at a time
```

The compatibility path for existing repo-scoped `CloudRuntimeEnvironment` rows
should be explicit:

- New managed cloud work resolves through the owner profile and canonical
  target.
- Existing runtime environments may finish in place.
- Any code that creates a managed cloud target must call the same
  `ensure_owner_managed_cloud_target` service.
- Partial unique indexes enforce that a bug cannot create two active managed
  targets for the same user or organization.

### Owner-Scoped Repo Config

Evolve `cloud_repo_config` to owner scope:

```text
cloud_repo_config
  id
  owner_scope                  personal | organization
  owner_user_id                nullable for org rows
  organization_id              nullable for personal rows
  created_by_user_id
  git_owner
  git_repo_name
  configured
  configured_at
  default_branch
  env_vars_ciphertext
  env_vars_version
  setup_script
  setup_script_version
  run_command
  files_version
  created_at
  updated_at
```

`cloud_repo_file` can remain a child of `cloud_repo_config`.

Uniqueness should be partial rather than relying on nullable columns:

```text
unique personal repo config:
  owner_user_id, git_owner, git_repo_name
  where owner_scope = 'personal'

unique organization repo config:
  organization_id, git_owner, git_repo_name
  where owner_scope = 'organization'
```

Personal APIs keep the existing repo-config shape. Organization APIs use a new
org route and require admin membership for writes.

### Agent Credential Refs

Agent credential sync needs a typed reference model instead of treating all
payloads as one opaque personal blob. The shared sandbox path should not point
directly at "some encrypted payload." It should point at a specific credential
ref whose kind says how the worker should resolve and materialize it.

Use `cloud_agent_credential` as the common reference row. It identifies the
agent provider, credential kind, owner, status, and revision. It does not need
to inline every possible secret shape.

```text
cloud_agent_credential
  id
  owner_scope                  personal | organization
  owner_user_id                user who owns/synced/configured the credential
  organization_id              for org-owned API-key refs if needed
  provider                     codex | claude | ...
  credential_kind              synced_path | api_key | managed_gateway
  source_id                    id in the kind-specific backing table
  source_revision              revision of the backing record
  redacted_summary_json        filenames, key names, expiry, account label;
                               never secret values
  status                       ready | expired | revoked | invalid |
                               needs_resync | unsupported
  last_validated_at
  last_synced_at
  created_by_user_id
  updated_by_user_id
  created_at
  updated_at
```

Kind-specific backing records:

```text
cloud_agent_synced_path_credential
  id
  owner_user_id
  provider
  local_source_id              stable Desktop-side source id
  source_path                  local path label, redacted when needed
  destination_hint             where this should land in the sandbox
  payload_ciphertext           encrypted file or file bundle
  payload_format               agent-synced-path-v1
  payload_sha256
  revision
  status                       ready | expired | revoked | invalid |
                               needs_resync
  expires_at
  last_synced_at
  revoked_at
  last_error_code
  last_error_message
  created_at
  updated_at

cloud_agent_api_key_credential
  id
  owner_scope                  personal | organization
  owner_user_id
  organization_id
  provider
  key_schema                   provider-specific key shape
  payload_ciphertext           encrypted API key fields
  payload_format               agent-api-key-v1
  payload_sha256
  revision
  status                       ready | expired | revoked | invalid
  expires_at
  created_by_user_id
  updated_by_user_id
  created_at
  updated_at

cloud_agent_managed_gateway_credential
  id
  owner_scope                  personal | organization
  owner_user_id
  organization_id
  provider
  gateway_subject_id
  gateway_policy_id
  revision
  status                       unsupported until gateway exists
  created_by_user_id
  updated_by_user_id
  created_at
  updated_at
```

Rules:

- `synced_path` covers local auth files and directories synced from Desktop,
  including JSON credentials files. A single path can materialize to one file
  or a normalized file bundle.
- `api_key` covers one or more provider-specific secret values configured in
  Desktop or Cloud.
- `managed_gateway` is a reference-only future kind. It should be rejected as
  unsupported until the gateway exists.
- The common `cloud_agent_credential` row is the only id shared sandbox config
  should reference.
- The backing row owns the encrypted payload and source-specific validation.
- Updating a backing row increments both the backing revision and the common ref
  `source_revision`.

Cloud stores every payload encrypted at rest. UI and list endpoints return only
`redacted_summary_json`, status, provider, kind, revision, and timestamps.

### Shared Agent Credential Sources

Shared sandboxes do not copy a user's credential payload into an org-owned row
by default. They select a typed credential ref. That keeps source ownership,
expiry, and resync status clear.

```text
cloud_agent_credential_source
  id
  organization_id
  provider                     codex | claude | ...
  credential_ref_id            FK cloud_agent_credential.id
  credential_kind_snapshot     synced_path | api_key | managed_gateway
  materialization_mode         files | env | process | mixed
  enabled
  status                       ready | missing | expired | revoked |
                               needs_resync | invalid
  selected_revision            last credential revision selected/applied
  last_materialized_revision   last revision worker reported applied
  last_materialized_target_id
  last_materialized_at
  last_error_code
  last_error_message
  created_by_user_id
  updated_by_user_id
  created_at
  updated_at
```

Rules:

- The source resolves exactly one `cloud_agent_credential` ref.
- The ref can point at a personal `synced_path`, personal or organization
  `api_key`, or future `managed_gateway` backing record.
- `managed_gateway` is a reserved kind only if the code can safely reject it
  until gateway support exists.
- Shared target materialization fails clearly if a required source is not
  ready.
- When a credential ref revision changes, every organization source that
  references it becomes pending and the shared sandbox profile revision
  increments.
- When the backing record is revoked, deleted, or invalidated, the source
  becomes `needs_resync` or `revoked`; worker materialization must stop using
  the old payload on future refresh.

Credential sync workflow:

```text
1. Desktop detects supported local credentials.
2. Desktop normalizes each item into either a `synced_path` or `api_key`
   backing payload.
3. Desktop uploads the encrypted backing payload.
4. Cloud upserts the common `cloud_agent_credential` ref that points at that
   backing record.
5. Cloud increments the ref revision and updates redacted summary.
6. If an org source references that credential ref, Cloud marks the source
   pending and increments the org sandbox profile revision.
7. Cloud enqueues target materialization for the org shared target.
8. proliferate-worker leases the command and requests the credential payload
   for the target/profile revision.
9. Cloud verifies the worker target and source authorization, then returns the
   decrypted payload over the worker channel.
10. Worker writes files/env/process config into the sandbox, reports the applied
   revision, and pushes the target runtime config refresh to AnyHarness.
```

The worker should only persist credentials in the target locations required by
the selected agent. It should not write extra copies of decrypted credential
payloads to cache directories or logs.

### MCP Publications

Keep `CloudMcpConnection` private and user-owned. Add publication rows:

```text
cloud_mcp_publication
  id
  organization_id
  source_connection_id         FK cloud_mcp_connection.id
  published_by_user_id
  catalog_entry_id
  catalog_entry_version
  display_name
  server_name
  enabled
  status                       active | disabled | needs_reconnect |
                               source_disabled | source_deleted
  last_error_code
  last_error_message
  created_at
  updated_at
```

Constraints:

```text
unique organization + source_connection_id
index organization + enabled + status
```

The "Make public" toggle creates, enables, disables, or deletes this
publication. The private MCP connection remains owned by the original user.

When a source connection is disabled or its auth is not ready, the publication
status becomes non-active and the shared sandbox resolver excludes it or marks
the org shared profile as `needs_attention`.

### Skill Publications

Skills need the same org-visible projection, even if V1 skills mostly come from
plugin/catalog packages:

```text
cloud_skill_publication
  id
  organization_id
  source_kind                  catalog_skill | plugin_skill | user_skill
  source_id
  published_by_user_id
  skill_id
  display_name
  content_hash
  artifact_ref
  required_mcp_publication_ids
  enabled
  status                       active | disabled | artifact_missing |
                               source_deleted
  created_at
  updated_at
```

For V1, a plugin/package can publish its MCPs and derived skills together. The
runtime resolver still emits flat `mcpServers[]` and `skills[]`.

### Profile Runtime Selections

If V1 includes every enabled publication by default, a separate selection table
is optional. If the UI needs per-profile enablement without unpublishing, add
selection rows:

```text
cloud_sandbox_profile_mcp
  profile_id
  publication_id
  enabled
  server_name_override

cloud_sandbox_profile_skill
  profile_id
  publication_id
  enabled
```

Recommended V1 default:

- Publication `enabled = true` means selected.
- Add selection tables only if the UI needs "public but not used in shared
  sandbox" on day one.

## Runtime Resolution

The Cloud resolver builds a workstream 1 target runtime manifest from the
profile:

```text
personal profile:
  enabled user MCP connections
  enabled personal skills
  personal cloud agent credentials
  personal repo config for the selected repo

organization profile:
  active org MCP publications
  active org skill publications
  org credential sources
  organization repo config for the selected repo
```

Generated credential refs must not expose the raw user credential id to
AnyHarness. Use refs shaped around the resolver-owned object:

```text
credentialRef = cloud-mcp-publication:<publication_id>:auth
credentialRef = cloud-agent-credential-source:<source_id>:<credential_ref_id>
```

For agent credentials, Cloud resolves `credential_ref_id` through
`cloud_agent_credential.credential_kind` and then through the appropriate
kind-specific backing record.

The worker can use those refs to ask Cloud for credential payloads when
AnyHarness emits a workstream 1 credential gap. AnyHarness never calls Cloud.

## Gap Fill Responsibilities

Workstream 2 owns the product-side authorization behind workstream 1 lazy
loading. The runtime gap event is generic, but the caller must resolve it
against the right owner profile.

```text
AnyHarness gap:
  missing artifact <hash/ref>
  need credential <credentialRef>

Desktop local target:
  Desktop resolves the ref from local package/cache/cloud account state and
  fulfills the gap back to AnyHarness.

Cloud personal target:
  proliferate-worker reports the gap to Cloud with target identity.
  Cloud validates the target belongs to the user profile and resolves personal
  MCP/skill/credential sources.

Cloud organization target:
  proliferate-worker reports the gap to Cloud with target identity.
  Cloud validates the target belongs to the org shared profile and resolves
  only active public publications and shared credential sources.
```

Credential payload APIs must validate both:

- the worker is authenticated for the target; and
- the requested credential ref is present in the active or pending profile
  revision being materialized.

The worker can cache credential payloads only for the TTL allowed by the
workstream 1 credential model. It should not persist shared credential payloads
to disk.

## Refresh Flow

Every config-changing write should follow the same shape:

```text
1. Validate actor permission.
2. Write the product config row.
3. Increment sandbox profile runtime_config_revision.
4. Resolve affected targets.
5. Enqueue materialize_environment or target-runtime-config refresh command.
6. Worker materializes artifacts and pushes target runtime config to AnyHarness.
7. AnyHarness persists the manifest and lazily requests gaps when needed.
```

Refresh triggers:

- User enables/disables a personal MCP.
- User syncs or deletes a personal agent credential.
- User changes personal cloud repo config.
- User publicizes or unpublicizes an MCP or skill.
- Admin updates shared repo config.
- Admin updates shared credential source.
- Admin enables/disables a shared publication.
- Admin enables/disables the org shared managed target.
- Catalog/plugin package versions change.

Refresh should be idempotent by profile revision:

```text
target_runtime_config:<target_id>:profile_revision:<revision>
```

If the target is offline, Cloud records pending refresh state and the worker
applies it when it reconnects.

## Cloud API Shape

### Personal Sandbox

Existing personal routes can remain where practical, but responses should
start exposing the profile model:

```text
GET    /cloud/sandbox-profile
PATCH  /cloud/sandbox-profile
POST   /cloud/sandbox-profile/enable-managed
GET    /cloud/repo-configs
GET    /cloud/repo-configs/{owner}/{repo}
PUT    /cloud/repo-configs/{owner}/{repo}
```

Personal MCP/skill publicization:

```text
POST   /cloud/mcp-connections/{connectionId}/publications
PATCH  /cloud/mcp-connections/{connectionId}/publications/{publicationId}
DELETE /cloud/mcp-connections/{connectionId}/publications/{publicationId}

POST   /cloud/skills/{skillId}/publications
PATCH  /cloud/skills/{skillId}/publications/{publicationId}
DELETE /cloud/skills/{skillId}/publications/{publicationId}
```

These endpoints require the actor to own the source and belong to the target
organization.

### Organization Shared Sandbox

Add org routes for admin-managed shared config:

```text
GET    /cloud/organizations/{orgId}/sandbox-profile
PATCH  /cloud/organizations/{orgId}/sandbox-profile
POST   /cloud/organizations/{orgId}/sandbox-profile/enable-managed

GET    /cloud/organizations/{orgId}/repo-configs
GET    /cloud/organizations/{orgId}/repo-configs/{owner}/{repo}
PUT    /cloud/organizations/{orgId}/repo-configs/{owner}/{repo}

GET    /cloud/organizations/{orgId}/agent-credential-sources
PUT    /cloud/organizations/{orgId}/agent-credential-sources/{provider}
DELETE /cloud/organizations/{orgId}/agent-credential-sources/{provider}

GET    /cloud/organizations/{orgId}/mcp-publications
PATCH  /cloud/organizations/{orgId}/mcp-publications/{publicationId}

GET    /cloud/organizations/{orgId}/skill-publications
PATCH  /cloud/organizations/{orgId}/skill-publications/{publicationId}
```

Reads are available to org members with redacted summaries. Writes require
owner/admin membership.

Future product surfaces can read these profiles and summaries later. This spec
does not add APIs for those surfaces.

## Desktop UI Shape

Follow the existing frontend area rules:

- Components render UI only.
- Product rules and view models live under `lib/domain/**`.
- React behavior and remote-resource wiring live in hooks.
- Cloud endpoint access goes through `hooks/access/cloud/**` and the matching
  access boundary.

### Personal Cloud Page

The existing Settings `Cloud` pane becomes the personal sandbox page:

- Managed cloud enable/status.
- Automatic sync.
- Personal agent credentials.
- Personal MCPs and skills enabled for the personal sandbox.
- Personal repo environments.
- Links to repo-specific environment editors.

This page should not show organization shared secret values.

### Personal Repo Environment

The existing repo `Cloud environment` section remains the personal repo
environment editor:

- default branch
- run command
- setup script
- env vars
- tracked files

It writes personal owner-scoped repo config.

### Publicization Controls

Connector/plugin/skill detail UI gets an org-aware publicization control:

```text
Available to organization shared sandboxes
```

Rules:

- Only show when signed in and a current organization exists.
- The source owner can publish/unpublish their source.
- Copy must say the shared sandbox uses this source's credential.
- If the source auth is not ready, the control can create the publication but
  status should show that reconnect is required before shared use.

### Organization Shared Cloud Page

Add an admin surface under organization settings or a new settings section
named `Shared Cloud`. It should be visible to org members but editable only by
owners/admins.

Sections:

```text
Shared sandbox
  enable managed cloud
  target status
  default workspace root
  default agent/model/mode

Shared workspaces
  repo list
  default branch
  run command
  setup script
  shared env vars
  shared tracked files
  copy from my personal environment

Agent credentials
  provider
  source type: synced path | API key | managed gateway
  status
  last error

MCPs and skills
  public publications
  publisher
  status
  duplicate warnings
  enabled/off
```

The UI should keep operational pages dense and work-focused. Avoid a marketing
or landing-page layout inside settings.

### Compute Page

The existing Compute page should distinguish:

```text
Personal targets
Organization targets
```

Managed cloud targets are shown as the owner default managed target. SSH
targets can still be many. Organization SSH targets use the organization shared
profile when they run organization work.

## Backend Service Boundaries

Recommended server modules:

```text
server/cloud/sandbox_profiles/
  api.py
  models.py
  service.py
  domain/

server/cloud/shared_repo_config/
  api.py
  models.py
  service.py

server/cloud/mcp_publications/
  api.py
  models.py
  service.py

server/cloud/skill_publications/
  api.py
  models.py
  service.py

server/cloud/agent_credential_sources/
  api.py
  models.py
  service.py
```

Database access should follow `docs/server/guides/database.md`:

- ORM classes in `db/models/**`.
- Store functions in `db/store/**`.
- Stores return frozen dataclasses.
- Services compose stores and enforce permissions.
- API Pydantic models stay in server domain folders.

Do not put org permission checks in stores. Services should load membership and
apply policy helpers.

## Target Config Materialization Changes

`MaterializeTargetConfigRequest` should move from "caller supplies user MCP
ids" to "caller supplies owner scope/profile context":

```text
ownerScope
organizationId
gitProvider
gitOwner
gitRepoName
workspaceRoot
includeAgentCredentials
includeGitCredentials
source
idempotencyKey
```

The service resolves:

```text
profile
repo environment config
agent credential sources
MCP publications or personal connections
skill publications or personal skills
target runtime manifest
```

`CloudTargetConfig` should record:

```text
owner_scope
owner_user_id
organization_id
sandbox_profile_id
sandbox_profile_revision
```

The encrypted payload should include the workstream 1 target runtime manifest
or enough refs for the worker to request it before AnyHarness refresh.

## Access Control

Personal sandbox config:

- Owner can read/write.
- Other users cannot read.

Organization shared sandbox profile:

- Org members can read redacted summaries.
- Org owners/admins can write.

Organization repo config:

- Org members can see configured status, keys, counts, and last updated info.
- Org owners/admins can read/write secret values and tracked file contents.

Public MCP/skill publications:

- Source owner can create/update/delete their own publication.
- Org owners/admins can disable any org publication for shared sandbox use.
- Org members can list redacted publication summaries.

Agent credential sources:

- Org owners/admins can read/write.
- Org members can see provider/status summaries only.

## SSH And Non-Direct Access

Organization SSH targets should use the same shared profile resolver as the
organization managed cloud target. The selected target changes where work runs,
not which shared MCPs, skills, agent credentials, or repo environment config
apply.

Workstream 2 should not require Desktop to have direct SSH or direct
AnyHarness access to an organization target. Cloud commands and the worker
control channel remain the standard path. Workstream 3 can add claiming and
direct authenticated attachment after a session is created.

## Implementation Plan

Implement workstream 2 as one coherent PR with internal slices. The pieces are
coupled enough that landing separate backend/UI/runtime-policy PRs would leave
ambiguous product behavior between them.

Suggested slice order inside the PR:

1. Schema and stores.

   Add sandbox profiles, owner-scoped repo config columns/indexes, MCP
   publication rows, skill publication rows, and shared agent credential source
   rows. Backfill personal rows from current user-scoped records.

2. Server services and APIs.

   Add profile, org repo config, publication, and credential-source APIs. Move
   target config materialization to profile resolution.

3. Managed cloud target cardinality.

   Create or reuse one personal managed target per user and one organization
   managed target per org. Stop creating new managed targets per repo for new
   launches.

4. Runtime config refresh integration.

   Increment profile revisions on config writes, enqueue materialization, and
   connect the worker path to the workstream 1 target runtime config refresh.

5. Desktop access hooks and domain models.

   Add typed access hooks under `hooks/access/cloud/**`, domain view models
   under `lib/domain/**`, and copy/config helpers in the documented frontend
   locations.

6. Desktop UI.

   Update personal Cloud, repo environment, Compute, connector/plugin/skill
   publicization, and Organization Shared Cloud surfaces.

7. Migration and compatibility cleanup.

   Preserve old rows long enough to migrate existing data, but make new
   launches use the target/profile path. Do not leave permanent duplicate
   launch paths.

8. Tests and verification.

   Add focused store/service tests for permissions, publication behavior,
   duplicate MCP handling, owner-scoped repo config, agent credential source
   materialization, managed target uniqueness, and target materialization
   payloads. Add frontend tests for view models and core settings state
   transitions where existing test patterns support it.

## Migration Notes

Data backfill:

- Existing `CloudRepoConfig.user_id` rows become personal
  `owner_scope = personal` rows.
- Existing `CloudCredential` rows stay personal.
- Existing `CloudMcpConnection` rows stay private and unpublished.
- Existing managed cloud runtime environments can keep running, but new
  managed cloud launches should allocate through the personal profile target.

Managed cloud target migration:

- If a user already has managed cloud targets, pick the oldest unarchived
  online target as the personal profile target.
- Archive or drain extra managed targets after their existing work is complete.
- Organization profiles start disabled until an admin enables shared cloud.

Org repo config:

- Remove the `org_cloud_not_ready` behavior for org workspaces once the org
  repo config APIs exist.
- Shared env vars and tracked files must be encrypted at rest, same as personal
  repo config.

MCP publication:

- No MCP becomes public automatically.
- First publish action creates the publication row and increments the org
  shared profile revision.

## Acceptance Criteria

- A personal user can configure one cloud sandbox profile and repo
  environments, and new personal cloud work resolves through that profile.
- An org admin can enable a shared cloud profile and configure shared repo
  environment inputs.
- An org admin can configure shared agent credential sources and see readiness
  status.
- A user can make an MCP/skill public to an org without transferring ownership
  of the private source.
- The shared profile resolver includes enabled public MCPs/skills and excludes
  disabled or broken publications.
- Duplicate public MCPs are visible and namespaced, not silently deduped.
- Synced local agent credentials can be selected as shared credential sources
  and applied to the organization shared sandbox by proliferate-worker.
- Source credential revision changes trigger shared profile refresh and worker
  materialization.
- Target config materialization no longer depends on raw user
  `mcpConnectionIds` for organization work.
- Worker/AnyHarness refresh uses the workstream 1 target runtime config model.
- Non-admin org members cannot read shared secret values.

## Open Follow-Ups

- Whether publication selection tables are needed in V1, or whether
  publication `enabled` is enough.
- Exact UI placement for Shared Cloud: inside Organization vs a dedicated
  settings nav item.
