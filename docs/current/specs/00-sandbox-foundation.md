# 00 — Sandbox Foundation

Status: implementation-ready spec.

Date: 2026-05-20.

Depends on: nothing. This is the foundation.

This spec replaces the repo-scoped `CloudRuntimeEnvironment` root for managed
cloud with a sandbox-profile / target / slot model. Every other spec in this
pack assumes the foundation is in place.

## 1. Purpose & Scope

In scope:

- One stable managed cloud sandbox profile per user (personal) and per
  organization (shared).
- One primary managed cloud target per profile.
- One active managed compute slot per `(sandbox_profile_id, target_id)`.
- Durable `cloud_workspace` rows keyed by profile and target, created before
  worker materialization.
- Worker enrollment, heartbeat, command leasing, result ingest, and event
  ingest fenced by an active slot id and `slot_generation`.
- Target-scoped runtime access state (AnyHarness base URL, runtime token,
  data key) moved off of `CloudRuntimeEnvironment` / `CloudWorkspace`.
- Profile/target applied-state row that both MCP/skill runtime config (spec
  01) and agent auth (spec 02) can hang their preflight off.
- `org_cloud_not_ready` block removed only after the shared profile/target/
  slot path can actually launch.

Out of scope:

- Compiling or applying MCP/skill/plugin runtime config (spec 01).
- Agent auth credential model, gateway routing, or selection UI (spec 02).
- Settings/Admin IA placement of any of these surfaces (spec 03).
- Cloud command queue cleanup beyond carrying `cloud_workspace_id` and slot
  identity (spec 04).
- Claiming, automations, Slack, web/mobile, billing, migration.

## 2. Mental Model

Three different objects, kept deliberately separate:

```text
sandbox profile
  Stable product/config identity.
  Owns "what this personal/shared sandbox should be configured with."
  Survives target re-enrollment and slot replacement.

cloud target
  Addressable worker + AnyHarness runtime endpoint.
  Owns "where commands go" and "what runtime state has actually been applied."
  Stable across slot replacement when the worker identity is preserved.

cloud sandbox slot
  Managed compute/provider lifecycle row.
  Owns "what E2B sandbox backs this managed cloud target right now."
  Replaced (not edited) when E2B issues a new provider sandbox.
```

V1 invariant:

```text
user
  -> one personal sandbox_profile
    -> one primary cloud_target where profile_target_role = 'primary'
      -> one active cloud_sandbox slot per (sandbox_profile_id, target_id)

organization
  -> one shared sandbox_profile
    -> one primary cloud_target where profile_target_role = 'primary'
      -> one active cloud_sandbox slot per (sandbox_profile_id, target_id)
```

Profiles are created lazily on explicit cloud intent. Compute is created even
later.

After this foundation lands, downstream specs say:

```text
spec 01  configure sandbox profile desired runtime config
spec 02  configure sandbox profile desired agent auth
spec 04  workspace/session launch requires applied current revisions
spec 09  every wake-gated command requires billing_subject not blocked
```

### 2.1 Lifecycle and synchronicity

Profile, target, and slot are created lazily at different latencies. The API
returns as soon as a Cloud DB row exists; provisioning that touches E2B or
waits on worker enrollment runs in the background.

**Synchronous (returns inside the request):**

```text
ensure_personal_sandbox_profile(user_id)
  INSERT sandbox_profile (status='configuring')
  ensure_personal_billing_subject and stamp billing_subject_id
  return SandboxProfileSnapshot

ensure_organization_sandbox_profile(organization_id)
  same, owner_scope='organization', no owner_user_id

ensure_primary_profile_target(sandbox_profile_id)
  INSERT cloud_targets (profile_target_role='primary', kind='managed_cloud',
                        status='enrolling')
  mint enrollment token carrying (sandbox_profile_id, will-be-cloud_sandbox_id,
                                  will-be-slot_generation)
  return CloudTargetSnapshot

The two "ensure profile" helpers may also create the primary target in the
same request if the caller is an explicit enable-cloud action. The behaviour
must be idempotent under concurrency.
```

**Background (enqueued, polled or pushed):**

```text
provision_profile_slot(sandbox_profile_id, target_id)
  INSERT cloud_sandbox (status='creating', slot_generation = max(prev)+1)
  call E2B SDK to create the provider sandbox; record external_sandbox_id
  boot supervisor + worker inside; wait for first enrollment + heartbeat
  cloud_target_runtime_access populated from enrollment payload
  cloud_sandbox.status -> 'running'
  cloud_targets.status -> 'online'
  cloud_target_status / inventory updated from heartbeat
  on failure: cloud_sandbox.status='error', blocked_reason set,
              sandbox_profile.status='blocked' or 'error'
              reconciler retries with bounded backoff

reconcile_sandbox_profile_target(sandbox_profile_id, target_id)
  scans (profile, target) pairs whose desired state has not converged:
    - missing/expired runtime access
    - desired runtime_config_sequence > applied
    - desired agent_auth_revision > applied
  re-enqueues materialize_environment / refresh_agent_auth_config
```

**Profile status state machine:**

```text
configuring   profile row exists, no primary target yet
              -- transition: ensure_primary_profile_target succeeds

provisioning  target exists; slot creation is in flight
              -- transition: provision_profile_slot success -> active
              --             provision_profile_slot failure -> blocked/error

active        at least one slot reached 'running' for the primary target;
              runtime access populated; profile is usable

blocked       billing/policy says no compute is allowed right now;
              cleared by spec 09 / spec 02 reconcilers

error         provisioning failed in a way the reconciler cannot self-heal;
              admin/owner action required

disabled      explicit user/admin action; reactivatable
```

`sandbox_profile.status` describes enablement, not runtime readiness. Whether
the target is reachable lives on `cloud_targets.status`,
`cloud_sandbox.status`, and `sandbox_profile_target_state`. UI composes
"sandbox ready?" by joining all three.

**Polling / push expectations:**

```text
GET /v1/cloud/sandbox-profiles/{id}                profile + status
GET /v1/cloud/sandbox-profiles/{id}/target-state   runtime + auth + slot readiness
GET /v1/cloud/sandbox-profiles/{id}/events         optional SSE for cheap UI updates
                                                   (defer to spec 04 if not trivial)
```

Cloud-intent actions that ought to trigger profile creation in the
background (no explicit "Enable Cloud" click required):

```text
personal:
  user opens personal cloud settings for the first time
  user adds first personal MCP / skill / plugin
  user selects personal agent auth
  user tries to start work on personal cloud
  user configures a repo for personal cloud

organization:
  admin opens shared cloud settings for the first time
  admin publicizes first MCP / skill / plugin to the org
  admin selects shared agent auth
  admin creates first team automation requiring shared cloud
  admin installs Slack
  admin creates first shared workspace
```

Explicit "Enable Personal/Shared Cloud" buttons remain available as a
discoverability surface, but they are convenience wrappers around the same
ensure helpers, not a required gate.

## 3. Dependencies

None.

## 4. Current Repo State

Verified against the current repository worktree on 2026-05-20.

### 4.1 What already exists

**`sandbox_profile` table** (in `db/models/cloud/agent_auth.py`).
Existing columns:

```text
id                 uuid pk
owner_scope        text indexed: 'personal' | 'organization'
owner_user_id      uuid fk user.id cascade nullable
organization_id    uuid fk organization.id cascade nullable
managed_target_id  uuid fk cloud_targets.id set_null nullable
agent_auth_revision  integer default 0
status             text default 'active' indexed
created_at         timestamptz
updated_at         timestamptz
deleted_at         timestamptz nullable

CHECK ck_sandbox_profile_owner_scope
CHECK ck_sandbox_profile_owner_fields   (personal vs organization mutex)
CHECK ck_sandbox_profile_status         (status in SUPPORTED_SANDBOX_PROFILE_STATUSES)
UNIQUE PARTIAL uq_sandbox_profile_active_personal_user
  (owner_user_id WHERE owner_scope='personal' AND deleted_at IS NULL AND status='active')
UNIQUE PARTIAL uq_sandbox_profile_active_organization
  (organization_id WHERE owner_scope='organization' AND deleted_at IS NULL AND status='active')
```

This is the existing foundation. It already enforces "one active profile per
user / per organization." The foundation work broadens it; it does not
re-create it.

**`sandbox_profile_agent_auth_revision` table** — append-only revision history
for agent auth changes, keyed by `(sandbox_profile_id, revision)`.

**`sandbox_profile_agent_auth_target_state` table** — per `(target_id,
sandbox_profile_id)` agent-auth apply status:

```text
desired_revision, applied_revision, status, force_restart_required,
last_command_id, last_worker_id, last_attempted_at, last_applied_at,
last_error_code, last_error_message
```

This is narrow — agent-auth-only. The foundation generalizes it (see 5.6).

**`cloud_targets` table** (in `db/models/cloud/targets.py`). Has
`owner_user_id`, `organization_id`, `owner_scope`, `kind`, `status`,
`archived_at`, `display_name`, `created_by_user_id`. **No `sandbox_profile_id`.
No `profile_target_role`.**

**`cloud_sandbox` table** (in `db/models/cloud/sandboxes.py`). Has
`runtime_environment_id` (FK CloudRuntimeEnvironment, CASCADE),
`cloud_workspace_id` (nullable index — comment says "compatibility-only during
migration away from workspace-owned sandboxes"), `provider`,
`external_sandbox_id` (unique), `status`, `template_version`,
`last_provider_event_at`/`_kind`, `started_at`, `stopped_at`,
`last_heartbeat_at`. **No `sandbox_profile_id`, `target_id`,
`billing_subject_id`, `slot_generation`, supersession fields.**

**`cloud_runtime_environment` table** — currently the managed-cloud root.
Unique by `(user_id|organization_id, git_provider, git_owner_norm,
git_repo_name_norm, isolation_policy)`. Holds `target_id` (FK CloudTarget SET
NULL), `active_sandbox_id` (text), `status`, `runtime_url`,
`runtime_token_ciphertext`, `anyharness_data_key_ciphertext`,
`billing_subject_id`.

**`cloud_workspace` table**. Has `owner_user_id`, `organization_id`,
`owner_scope`, `runtime_environment_id` (FK CloudRuntimeEnvironment, CASCADE),
`active_sandbox_id`, `runtime_url`, `runtime_token_ciphertext`,
`anyharness_workspace_id`, `status`, `display_name`, git fields. **No
`sandbox_profile_id`, `target_id`, `materialized_slot_generation`,
required-revision fields.**

**`cloud_commands` table**. Has `target_id` (FK CloudTarget, CASCADE),
`organization_id` (nullable), `actor_user_id` (nullable), `leased_by_worker_id`
(nullable), `workspace_id` (text, nullable — "anyharness workspace id
materialized at creation"), `session_id` (text, nullable), `kind`, `status`,
`lease_id`, `lease_expires_at`, `attempt_count`, `payload_json`,
`authorization_context_json`. **No `cloud_workspace_id`,
`leased_cloud_sandbox_id`, `leased_slot_generation`.**

**`cloud_workers`, `cloud_target_enrollments`** — none currently carry
`cloud_sandbox_id` or `slot_generation`.

**`org_cloud_not_ready` block** — implemented in:

```text
server/proliferate/server/cloud/runtime/provision.py
server/proliferate/server/cloud/workspaces/service.py
server/proliferate/server/cloud/repo_config/service.py
```

It raises 409 when `workspace.owner_scope == "organization"`.

**`cloud_runtime_environment` is the managed-cloud root**. Every managed cloud
provisioning path goes through `server/proliferate/server/cloud/runtime/`
(files: `ensure_running.py`, `provision.py`, `bootstrap.py`,
`credential_freshness.py`, `anyharness_api.py`, `credentials.py`,
`sandbox_exec.py`, `git_operations.py`, `repo_config_apply.py`,
`setup_monitor.py`, `target_registration.py`, `worktree_policy_sync.py`,
`service.py`, `scheduler.py`, `data_key.py`).

**Worker contract** (`anyharness/crates/anyharness-contract/src/v1/`) and
`proliferate-worker/src/cloud_client/commands.rs`:

```text
CloudCommandEnvelope
  command_id, idempotency_key, target_id, workspace_id (AnyHarness id),
  session_id, kind, payload, observed_event_seq, preconditions, lease_id,
  lease_expires_at

CommandResultRequest
  lease_id, status, error_code, error_message, result

CommandDeliveryRequest
  lease_id, status, error_code, error_message

EnrollResponse
  target_id, worker_id, worker_token, heartbeat_interval_seconds

HeartbeatResponse
  target_id, worker_id, status, server_time, desired_versions

Supported kinds today:
  start_session, configure_git_identity, ensure_repo_checkout,
  materialize_workspace, materialize_environment,
  refresh_agent_auth_config, send_prompt, resolve_interaction,
  update_session_config, cancel_turn, close_session,
  sync_existing_workspace
```

No envelope/result carries `cloudWorkspaceId`, `sandboxProfileId`, or
`slotGeneration`. **No `materialize_environment_runtime_config` command exists
today.**

**Agent auth runtime already exists** (PRs #254-#258). The worker carries
`refresh_agent_auth_config` with payload `{ sandbox_profile_id, revision,
reason, force_restart }`. AnyHarness already supports
`AgentAuthExternalScope { provider, id, target_id }` and
`required_agent_auth_revision` on `CreateSessionRequest`. The worker passes
`provider = "proliferate-cloud"`, `id = sandbox_profile_id`, `target_id =
target_id`.

### 4.2 Gaps the foundation closes

Stated as plain facts to fix:

- `sandbox_profile` exists but does not own `billing_subject_id` or
  `created_by_user_id`.
- `cloud_targets` does not point to a profile; managed-cloud target identity
  is derived through `cloud_runtime_environment.target_id`.
- `cloud_sandbox` is a provider-lifecycle row keyed off of
  `cloud_runtime_environment`, not off of a profile/target pair.
- There is no concept of `slot_generation`; stale workers across slot
  replacement cannot be fenced.
- `cloud_target_runtime_access` does not exist. Runtime URL/token/data key
  live on `cloud_runtime_environment` and on `cloud_workspace`.
- `cloud_workspace.sandbox_profile_id` and `cloud_workspace.target_id` do
  not exist. Managed-cloud workspaces are addressed through
  `cloud_workspace.runtime_environment_id`.
- `cloud_commands` cannot correlate a worker result with a Cloud product
  workspace before AnyHarness has materialized one.
- `sandbox_profile_agent_auth_target_state` only tracks agent auth. Runtime
  config has no peer table.
- `materialize_environment_runtime_config` command is referenced in
  planning notes but does not exist in the worker contract.

## 5. Target Model

### 5.1 Naming conventions for the foundation PR

To minimize churn, the foundation PR **keeps the existing physical table
names** wherever possible:

```text
sandbox_profile                            (broaden; do not rename)
cloud_targets                              (extend; do not rename)
cloud_sandbox                              (extend; slot semantics)
cloud_workers, cloud_target_enrollments    (extend with slot/profile fences)
cloud_workspace                            (extend with profile/target/required-revision)
cloud_commands                             (extend with cloud_workspace_id and slot fencing)
```

New tables added by this PR:

```text
cloud_target_runtime_access                (per-target AnyHarness URL/token/data key)
sandbox_profile_target_state               (per-(profile,target) applied state; see 5.6)
```

`sandbox_profile_target_state` is a **rename and broaden** of the existing
`sandbox_profile_agent_auth_target_state`. Migration drops the old name and
creates the new one with the same primary identity columns plus new
runtime-config and slot-fencing columns. See 5.6 for the exact shape and FK
updates.

`cloud_runtime_environment` is dropped in this PR. Every existing caller
is classified during implementation; managed-cloud callers are rewritten
around `sandbox_profile` + `cloud_targets` + `cloud_target_runtime_access`,
and any non-managed callers are either rewritten to the new model or
deleted as dead code. See §6 for the call-site map.

### 5.2 `sandbox_profile` (extend)

Add columns:

```text
billing_subject_id   uuid fk billing_subject.id   not null
                     ensured at profile creation through ensure_personal_billing_subject /
                     ensure_organization_billing_subject

created_by_user_id   uuid fk user.id set null nullable

archived_at          timestamptz nullable
                     replaces deleted_at semantically; new code reads archived_at
```

Rename column:

```text
agent_auth_revision  ->  desired_agent_auth_revision
```

The append-only revision row remains `sandbox_profile_agent_auth_revision`.
All readers (`server/proliferate/server/cloud/agent_auth/**`,
`server/proliferate/db/store/cloud_agent_auth/**`) are updated in this PR.

Drop column:

```text
managed_target_id     primary target derived from
                      cloud_targets.sandbox_profile_id +
                      profile_target_role = 'primary'
```

Status widening (see §2.1 for the full state machine):

```text
SUPPORTED_SANDBOX_PROFILE_STATUSES becomes:
  configuring | provisioning | active | disabled | blocked | error

  configuring   row exists, no primary target yet (sync ensure succeeded)
  provisioning  primary target exists, slot creation is in flight (background)
  active        at least one slot reached 'running'; profile usable
  disabled      explicit user/admin disable
  blocked       billing/policy block; reactivatable when cleared
  error         provisioning failed in a way the reconciler cannot self-heal

Use the shipped enum name `active`; do not introduce a DB value named
`enabled`. Product copy can still say a sandbox is "enabled".
```

Invariants (unchanged):

```text
one active profile per owner_user_id where owner_scope='personal'
one active profile per organization_id where owner_scope='organization'
personal: owner_user_id NOT NULL, organization_id NULL
organization: organization_id NOT NULL, owner_user_id NULL
```

### 5.3 `cloud_targets` (extend)

Add columns:

```text
sandbox_profile_id        uuid fk sandbox_profile.id  nullable
profile_target_role       text not null default 'none'   ('primary' | 'none')
```

Existing `owner_user_id` is currently NOT NULL. The foundation **relaxes
`cloud_targets.owner_user_id` to nullable** so that organization-owned managed
targets are not represented as an admin user's personal target. Creator
identity moves to `created_by_user_id` (already exists).

Add constraints:

```text
CHECK ck_cloud_target_owner_fields:
  (owner_scope='personal'      AND owner_user_id IS NOT NULL AND organization_id IS NULL)
  OR
  (owner_scope='organization'  AND organization_id IS NOT NULL AND owner_user_id IS NULL)

CHECK ck_cloud_target_profile_role:
  profile_target_role IN ('primary','none')

CHECK ck_cloud_target_primary_requires_profile:
  profile_target_role != 'primary'
  OR (kind = 'managed_cloud' AND sandbox_profile_id IS NOT NULL)

UNIQUE PARTIAL ux_cloud_target_primary_per_profile:
  (sandbox_profile_id) WHERE profile_target_role = 'primary' AND archived_at IS NULL
```

Service-level guards (not DB):

- The owner fields of a `primary` target must match the referenced profile's
  owner fields.
- Setting `profile_target_role = 'primary'` requires `kind = 'managed_cloud'`.

### 5.4 `cloud_sandbox` (extend) — semantically the "slot"

Add columns:

```text
sandbox_profile_id           uuid fk sandbox_profile.id   nullable
target_id                    uuid fk cloud_targets.id     nullable
billing_subject_id           uuid fk billing_subject.id   nullable

slot_generation              integer nullable
superseded_by_sandbox_id     uuid fk cloud_sandbox.id     nullable
superseded_at                timestamptz                  nullable

lifecycle_on_timeout         text  default 'pause'
lifecycle_auto_resume        boolean default true
provider_timeout_seconds     integer nullable
blocked_reason               text nullable
```

New rows for managed cloud **MUST** set `sandbox_profile_id`, `target_id`,
`billing_subject_id`, and `slot_generation`.

Active-slot uniqueness:

```text
UNIQUE PARTIAL ux_cloud_sandbox_active_slot_per_profile_target:
  (sandbox_profile_id, target_id)
  WHERE superseded_at IS NULL
    AND status IN ('creating','running','paused','blocked')
```

Slot replacement rule:

```text
1. Mark old slot superseded_at = now and (if not already terminal) status = 'killed' / 'error'.
2. Insert new slot with bumped slot_generation (max(old)+1) and the same
   sandbox_profile_id/target_id/billing_subject_id.
3. Old slot rows remain for audit/billing.
```

`runtime_environment_id` on `cloud_sandbox` is removed in this PR.
Managed-cloud slot lookup uses `(sandbox_profile_id, target_id) WHERE
superseded_at IS NULL`.

`cloud_sandbox.cloud_workspace_id` is removed in this PR. Slots belong to
a target, not to a workspace.

### 5.5 `cloud_target_runtime_access` (new)

One row per managed cloud target. Owns the direct AnyHarness connection
state that used to live on `CloudRuntimeEnvironment` and `CloudWorkspace`.

```text
cloud_target_runtime_access
  id                              uuid pk
  target_id                       uuid fk cloud_targets.id        unique not null
  sandbox_profile_id              uuid fk sandbox_profile.id      not null
  active_sandbox_id               uuid fk cloud_sandbox.id        nullable
  slot_generation                 integer                         nullable

  anyharness_base_url             text
  runtime_token_ciphertext        bytea / text
  anyharness_data_key_ciphertext  bytea / text

  last_worker_id                  uuid fk cloud_workers.id        nullable
  last_heartbeat_at               timestamptz
  created_at                      timestamptz
  updated_at                      timestamptz

  CHECK active slot fields are either both null or both not null
  CHECK if active_sandbox_id is set, slot_generation matches the slot row
        (enforced by service before write)
```

Update rule:

- Worker enrollment / heartbeat reports `target_id`, `sandbox_profile_id`,
  `cloud_sandbox_id`, `slot_generation`.
- Server compare-and-set updates `cloud_target_runtime_access` only if the
  reported `(active_sandbox_id, slot_generation)` matches the current active
  slot.
- Stale reports are rejected and the worker is marked stale.

Boundary:

```text
cloud_target_runtime_access is for:
  managed provisioning bootstrap
  allowlisted health checks
  diagnostics

production Cloud -> AnyHarness mutations go through:
  cloud_commands -> proliferate-worker -> AnyHarness

Do not add new direct Cloud -> AnyHarness mutation paths against this table.
```

Encrypted-at-rest fields (`runtime_token_ciphertext`,
`anyharness_data_key_ciphertext`) must never appear in logs, command
payloads, worker result payloads, or status JSON.

### 5.6 `sandbox_profile_target_state` (rename + broaden)

The existing `sandbox_profile_agent_auth_target_state` is renamed to
`sandbox_profile_target_state` and broadened to carry both runtime-config
and agent-auth apply state, plus active slot identity for fencing.

Schema:

```text
sandbox_profile_target_state
  sandbox_profile_id    uuid fk sandbox_profile.id   not null
  target_id             uuid fk cloud_targets.id     not null

  active_sandbox_id     uuid fk cloud_sandbox.id     nullable
  slot_generation       integer                      nullable

  -- agent-auth axis (existing columns, kept verbatim under new table name)
  desired_agent_auth_revision     integer
  applied_agent_auth_revision     integer nullable
  agent_auth_status               text default 'pending'
                                  ('pending'|'materializing'|'applied'|'failed'|'superseded')
  agent_auth_force_restart_required  boolean default false
  last_agent_auth_command_id      uuid fk cloud_commands.id nullable
  last_agent_auth_worker_id       uuid fk cloud_workers.id nullable
  last_agent_auth_attempted_at    timestamptz nullable
  last_agent_auth_applied_at      timestamptz nullable
  last_agent_auth_error_code      text nullable
  last_agent_auth_error_message   text nullable

  -- runtime-config axis (new columns; spec 01 owns desired revisions)
  applied_runtime_config_sequence       integer not null default 0
  applied_runtime_config_revision_id    text nullable
  runtime_config_status                 text default 'pending'
  last_runtime_config_command_id        uuid fk cloud_commands.id nullable
  last_runtime_config_worker_id         uuid fk cloud_workers.id nullable
  last_runtime_config_attempted_at      timestamptz nullable
  last_runtime_config_applied_at        timestamptz nullable
  last_runtime_config_error_code        text nullable
  last_runtime_config_error_message     text nullable

  updated_at            timestamptz

  UNIQUE (sandbox_profile_id, target_id)
```

Migration plan:

```text
1. Create sandbox_profile_target_state with the new columns.
2. Copy rows from sandbox_profile_agent_auth_target_state, mapping:
     desired_revision -> desired_agent_auth_revision
     applied_revision -> applied_agent_auth_revision
     status           -> agent_auth_status
     force_restart_required -> agent_auth_force_restart_required
     last_command_id   -> last_agent_auth_command_id
     last_worker_id    -> last_agent_auth_worker_id
     last_attempted_at -> last_agent_auth_attempted_at
     last_applied_at   -> last_agent_auth_applied_at
     last_error_code   -> last_agent_auth_error_code
     last_error_message -> last_agent_auth_error_message
3. Update FKs:
     server/proliferate/db/store/cloud_agent_auth/**
     server/proliferate/server/cloud/agent_auth/service.py
     server/proliferate/db/models/cloud/agent_auth.py SandboxProfileAgentAuthTargetState class -> SandboxProfileTargetState
4. Drop sandbox_profile_agent_auth_target_state.
```

Launch-preflight validity:

```text
applied_runtime_config_sequence  is valid only if
  sandbox_profile_target_state.active_sandbox_id matches the current
  cloud_sandbox active slot AND
  sandbox_profile_target_state.slot_generation matches the slot's generation

applied_agent_auth_revision      is valid under the same fence

slot replacement resets applied_* on the affected row until the new slot
reports materialization
```

### 5.7 `cloud_workspace` (extend)

Add columns:

```text
sandbox_profile_id                  uuid fk sandbox_profile.id   nullable
target_id                           uuid fk cloud_targets.id     nullable
normalized_repo_key                 text  -- e.g. "github.com/proliferate-ai/proliferate"
worktree_path                       text
materialized_slot_generation        integer nullable

required_runtime_config_sequence    integer nullable
required_runtime_config_revision_id text    nullable
required_agent_auth_revision        integer nullable
```

Drop columns (managed-cloud runtime access moves to
`cloud_target_runtime_access`):

```text
cloud_workspace.runtime_environment_id
cloud_workspace.active_sandbox_id
cloud_workspace.runtime_url
cloud_workspace.runtime_token_ciphertext
cloud_workspace.anyharness_data_key_ciphertext
```

Managed-cloud writes:

```text
managed cloud_workspace rows MUST set:
  sandbox_profile_id, target_id, normalized_repo_key

billing_subject_id (already present on cloud_workspace) MUST equal
sandbox_profile.billing_subject_id at write time
```

Ownership invariant:

```text
managed cloud_workspace.owner_user_id    matches profile.owner_user_id     (personal)
managed cloud_workspace.organization_id  matches profile.organization_id   (organization)
managed cloud_workspace.owner_scope      matches profile.owner_scope
managed cloud_workspace.created_by_user_id  records the actor
```

`user_id` (if present on the table as a legacy ownership column) is **not**
the managed-ownership field. The foundation makes the existing
`owner_user_id`/`organization_id`/`owner_scope` the authoritative owners.

Uniqueness:

```text
UNIQUE PARTIAL ux_cloud_workspace_active_per_branch:
  (sandbox_profile_id, target_id, normalized_repo_key, git_branch)
  WHERE archived_at IS NULL

UNIQUE PARTIAL ux_cloud_workspace_active_worktree_path:
  (target_id, worktree_path)
  WHERE archived_at IS NULL
```

The existing `cloud_runtime_environment` uniqueness key keys per-repo identity
into the root. Replacing it requires the new key to include normalized repo
identity; branch alone is not unique across repos.

`materialized_slot_generation` rule:

```text
cloud_workspace.anyharness_workspace_id  is runnable only if
  cloud_workspace.materialized_slot_generation == active slot's slot_generation
  for that (sandbox_profile_id, target_id).

slot replacement clears materialized_slot_generation on managed workspaces
and marks them rematerialization-required (use existing status enum or add
'needs_rematerialization'; do not overload 'failed').
```

### 5.8 `cloud_commands` (extend)

Add columns:

```text
cloud_workspace_id        uuid fk cloud_workspace.id   nullable
leased_cloud_sandbox_id   uuid fk cloud_sandbox.id     nullable
leased_slot_generation    integer                      nullable
```

Field semantics:

```text
cloud_commands.workspace_id           text, AnyHarness workspace id
  unset before materialization (no AnyHarness id exists yet);
  set after materialization for commands that route to an existing AnyHarness workspace.

cloud_commands.cloud_workspace_id     uuid
  always set for managed-cloud commands that operate on a workspace;
  the durable Cloud product row id;
  the join key for results that need to update product state.

cloud_commands.target_id              uuid
  always set; the worker destination.

cloud_commands.leased_cloud_sandbox_id + leased_slot_generation
  filled by command leasing; identifies the slot the worker leased from.
```

Fencing rules:

```text
command leasing requires:
  worker.target_id = command.target_id
  worker.cloud_sandbox_id = active slot id for the target
  worker.slot_generation  = active slot's slot_generation

result / delivery / event ingest requires:
  command.leased_cloud_sandbox_id = active slot id at result time
  command.leased_slot_generation  = active slot's slot_generation
  worker.cloud_sandbox_id         = command.leased_cloud_sandbox_id
  worker.slot_generation          = command.leased_slot_generation

stale slot reports do NOT update workspace, session, runtime access,
profile-target state, or billing readiness. They mark the worker stale and
the affected command stale/superseded.
```

### 5.9 `cloud_workers` and `cloud_target_enrollments` (extend)

Add columns:

```text
cloud_workers.cloud_sandbox_id              uuid fk cloud_sandbox.id  nullable
cloud_workers.slot_generation               integer                   nullable

cloud_target_enrollments.sandbox_profile_id uuid fk sandbox_profile.id nullable
cloud_target_enrollments.cloud_sandbox_id   uuid fk cloud_sandbox.id  nullable
cloud_target_enrollments.slot_generation    integer                   nullable
```

The enrollment row is the seed that ties a fresh worker process to the
profile/slot it is supposed to serve. Cloud assigns the worker's
`cloud_sandbox_id`/`slot_generation` from the consumed enrollment token and
must not trust arbitrary fields in heartbeat payloads to choose a slot.

### 5.10 Worker wire contract additions

Update `anyharness/crates/anyharness-contract/src/v1/`:

```text
CloudCommandEnvelope
  + cloud_workspace_id    Option<Uuid>
  + sandbox_profile_id    Option<Uuid>
  + slot_generation       Option<i64>

CommandResultRequest
  + cloud_workspace_id    Option<Uuid>
  + slot_generation       Option<i64>
  + anyharness_workspace_id  Option<String>     -- echoed for materialization results

CommandDeliveryRequest
  + cloud_workspace_id    Option<Uuid>
  + slot_generation       Option<i64>

EnrollRequest
  + sandbox_profile_id    Option<Uuid>
  + cloud_sandbox_id      Option<Uuid>
  + slot_generation       Option<i64>

EnrollResponse
  + sandbox_profile_id    Option<Uuid>
  + cloud_sandbox_id      Option<Uuid>
  + slot_generation       Option<i64>

HeartbeatRequest
  + sandbox_profile_id    Option<Uuid>
  + cloud_sandbox_id      Option<Uuid>
  + slot_generation       Option<i64>
```

`workspace_id` (the AnyHarness workspace id) keeps its current meaning: a
runtime-side id that is unset until the worker has materialized it.

For `materialize_workspace` results, the worker MUST echo
`cloud_workspace_id` and, on success, the `anyharness_workspace_id` it
created. The server verifies:

```text
result.cloud_workspace_id  = cloud_commands.cloud_workspace_id
result.cloud_workspace_id  refers to an existing cloud_workspace row
result target_id           = cloud_workspace.target_id
result slot id / generation = active slot id / generation
```

Only then may the server update `cloud_workspace.anyharness_workspace_id`,
`cloud_workspace.materialized_slot_generation`, workspace status, session
projection rows, or profile-target applied state.

**Worker results never auto-create `cloud_workspace`.** A result whose
`cloud_workspace_id` does not match an existing Cloud row is rejected with
a structured `cloud_workspace_not_found` error and marked the command stale.
This preserves the invariant that **Cloud creates the workspace row before
AnyHarness materialization begins** (acceptance #8) and prevents orphan
AnyHarness workspaces from inserting themselves into the Cloud product
ledger.

`sync_existing_workspace` is the only command kind that legitimately creates
a `cloud_workspace` row from a runtime that existed first. Spec 08
(dispatch/remote access) owns its admission policy.

### 5.11 Future command kinds — out of scope for this PR

`materialize_environment_runtime_config` is referenced in planning notes but
does not exist in the worker contract today. The foundation does **not** add
it. Spec 01 introduces the canonical apply path (extend
`materialize_environment` or add a dedicated kind) and lands the full chain
in one PR: contract type, server constant, default and active command-kind
sets, DB check constraints, command validator, worker supported kinds,
dispatcher handler, SDK regeneration.

`refresh_agent_auth_config` already exists. The foundation rebinds it
indirectly through the renamed `sandbox_profile_target_state` table; the
command payload and worker handler are unchanged.

### 5.12 API surface added by the foundation

User/admin:

```text
POST   /v1/cloud/sandbox-profiles/personal
POST   /v1/cloud/organizations/{organization_id}/sandbox-profile
GET    /v1/cloud/sandbox-profiles/{sandbox_profile_id}
GET    /v1/cloud/sandbox-profiles/{sandbox_profile_id}/target-state

POST   /v1/cloud/sandbox-profiles/{sandbox_profile_id}/enable-cloud
       -- explicit "Enable Personal/Shared Cloud" trigger
       -- creates primary target and ensures slot when invoked
```

Worker (already exists for agent auth; ensure they accept the new envelope
fields):

```text
POST /v1/cloud/worker/commands/lease
POST /v1/cloud/worker/commands/{command_id}/result
POST /v1/cloud/worker/commands/{command_id}/delivery
POST /v1/cloud/worker/heartbeat
POST /v1/cloud/worker/enroll
```

The foundation does **not** add user-facing dispatch APIs. Spec 04 owns
those.

### 5.13 Provisioning lifecycle and background jobs

The foundation introduces two background jobs and one reconciler. They are
the home for any work that touches E2B or waits on worker enrollment.

**`provision_profile_slot` (background)**:

```text
trigger
  ensure_profile_slot enqueues this when no active slot exists for
  (sandbox_profile_id, target_id) and the profile is not blocked

steps
  1. Lock (sandbox_profile_id, target_id). Reload active slot. Abort if one
     already exists (idempotent).
  2. Resolve template + compute shape from sandbox_profile + plan/entitlement
     (spec 09 owns entitlement check; foundation defaults to "personal free
     shape").
  3. INSERT cloud_sandbox status='creating', slot_generation=max(prev)+1,
     billing_subject_id copied from profile, lifecycle_on_timeout='pause',
     lifecycle_auto_resume=true, provider_timeout_seconds=<short window>.
  4. Call E2B SDK to create provider sandbox with Proliferate metadata
     (sandbox_profile_id, target_id, cloud_sandbox_id, slot_generation,
     billing_subject_id). Record external_sandbox_id and started_at.
  5. Wait for worker enrollment (bounded poll + heartbeat callback path)
     identified by the enrollment token minted at target ensure time.
  6. UPSERT cloud_target_runtime_access with compare-and-set on
     (active_sandbox_id, slot_generation).
  7. cloud_sandbox.status -> 'running'; cloud_targets.status -> 'online';
     sandbox_profile.status -> 'active' if this is the first slot.

failure
  on bounded retry exhaustion:
    cloud_sandbox.status -> 'error', blocked_reason set
    sandbox_profile.status -> 'error' (admin/owner-actionable) or
                              'blocked' (billing-cleared)
  the reconciler picks up sandbox_profile.status='provisioning' rows whose
  slot is older than the provisioning timeout and retries.
```

**`reconcile_sandbox_profile_target` (reconciler tick)**:

```text
trigger
  periodic timer (1-5 minutes); also enqueued by sandbox_profile_target_state
  writes that mark desired > applied.

steps
  for each (sandbox_profile_id, target_id) row whose
    sandbox_profile_target_state.applied_* < desired_* OR
    cloud_target_runtime_access is missing/stale:
      verify slot is still active
      enqueue materialize_environment (runtime config) if applicable
      enqueue refresh_agent_auth_config if applicable
      bump last_attempted_at; record errors

idempotent. Re-enqueues commands by content_hash / revision_id so duplicates
collapse server-side.
```

**`reconcile_paused_sandbox_for_wake_required_command` (later — flagged for
spec 09)**: when a wake-required command targets a paused slot, the spec-09
billing gate decides whether to resume. The foundation only models the slot
state and `lifecycle_auto_resume` flag.

Both jobs live in the existing Cloud runtime scheduler area:

```text
server/proliferate/server/cloud/runtime/provision.py
  provision_profile_slot(...) handler

server/proliferate/server/cloud/runtime/reconciler.py        (new)
  reconcile_sandbox_profile_target(...) handler

server/proliferate/server/cloud/runtime/scheduler.py
  schedule_profile_slot_provision(...) uses the same in-process task pattern
  as the existing workspace provisioning scheduler.
```

**Synchronicity rule (enforceable):**

```text
ALLOWED in sync request
  INSERT into sandbox_profile, cloud_targets
  reads of existing rows
  enrollment token mint
  billing_subject ensure helpers
  validation that pre-conditions are met

NOT ALLOWED in sync request for managed cloud
  any E2B SDK call (create/resume/pause/kill/list)
  waiting on worker enrollment / heartbeat
  worker command execution

Code review hook: any new managed-cloud server module that imports the E2B
SDK must live under server/proliferate/server/cloud/runtime/ and only be
called from background handlers.
```

### 5.14 Org creation invariant

```text
Organization creation does NOT write sandbox_profile.

Existing org creation paths
  server/proliferate/server/organizations/**
  server/proliferate/db/store/organizations.py
remain unchanged by this spec. No new fields, no new side effects.

Shared cloud is a separate opt-in. ensure_organization_sandbox_profile is
called by:
  - the explicit "Enable Shared Cloud" action (if shown in settings), or
  - the first shared cloud-intent action the admin takes
    (publicize MCP, create team automation, install Slack, configure
     shared agent auth, create shared workspace).

This decoupling matters because:
  - org creation today is broad (members, invitations, billing subject
    for paid plans, default settings). Adding sandbox compute provisioning
    to that flow makes it slower, harder to roll back, and tightly couples
    two unrelated lifecycles.
  - many orgs will never use shared cloud. Lazy creation avoids
    half-provisioned compute for those orgs.
  - the org admin who enables shared cloud may not be the same admin who
    created the org. created_by_user_id on sandbox_profile records the
    enabling actor, separate from organization.created_by_user_id.
```

Spec 04 / spec 06 / spec 07 each name the precise call sites where they
trigger `ensure_organization_sandbox_profile` from their respective
admin/automation/Slack flows.

### 5.15 Required runtime-grant / billing notes

```text
sandbox_profile.billing_subject_id   sourced from
  ensure_personal_billing_subject(owner_user_id)
  ensure_organization_billing_subject(organization_id)

These helpers exist today; the foundation just wires the FK on profile
creation. Slot/workspace creation copies the profile's billing_subject_id
to the slot/workspace row, never re-derives it.
```

Billing/quota code (spec 09) must be able to count active slots without
joining through `cloud_runtime_environment`. The slot's `billing_subject_id`
is the direct path.

## 6. Files To Change

Server (Python):

```text
server/proliferate/db/models/cloud/agent_auth.py
  Broaden SandboxProfile columns (add billing_subject_id,
    created_by_user_id, archived_at).
  Drop SandboxProfile.managed_target_id.
  Rename SandboxProfileAgentAuthTargetState -> SandboxProfileTargetState and
    add runtime-config + slot-fencing columns.

server/proliferate/db/models/cloud/targets.py
  Add sandbox_profile_id, profile_target_role to CloudTarget.
  Relax owner_user_id nullable; add owner-fields check.
  Add ux_cloud_target_primary_per_profile partial unique index.
  Add cloud_workers.cloud_sandbox_id, slot_generation.
  Add cloud_target_enrollments.sandbox_profile_id, cloud_sandbox_id,
    slot_generation.

server/proliferate/db/models/cloud/sandboxes.py
  Add sandbox_profile_id, target_id, billing_subject_id, slot_generation,
    superseded_by_sandbox_id, superseded_at, lifecycle_*, blocked_reason.
  Add ux_cloud_sandbox_active_slot_per_profile_target.
  Drop cloud_workspace_id.

server/proliferate/db/models/cloud/cloud_target_runtime_access.py   (new)
  Define CloudTargetRuntimeAccess.

server/proliferate/db/models/cloud/workspaces.py
  Add sandbox_profile_id, target_id, normalized_repo_key, worktree_path,
    materialized_slot_generation, required_runtime_config_*,
    required_agent_auth_revision.
  Add ux_cloud_workspace_active_per_branch and active worktree-path index.

server/proliferate/db/models/cloud/commands.py
  Add cloud_workspace_id, leased_cloud_sandbox_id, leased_slot_generation.

server/proliferate/db/models/cloud/__init__.py
  Export new classes; remove SandboxProfileAgentAuthTargetState.

server/alembic/versions/<NEW>_sandbox_profile_foundation.py
  One replacement migration that:
    - extends sandbox_profile;
    - drops sandbox_profile.managed_target_id;
    - adds cloud_targets fields and indexes;
    - adds cloud_sandbox fields and indexes;
    - creates cloud_target_runtime_access;
    - creates sandbox_profile_target_state with data copy from
      sandbox_profile_agent_auth_target_state, then drops the old table;
    - adds cloud_workspace fields and indexes;
    - adds cloud_commands fields;
    - extends cloud_workers and cloud_target_enrollments.
```

Stores:

```text
server/proliferate/db/store/cloud_sandbox_profiles.py      (new)
  ensure_personal_sandbox_profile(user_id) -> SandboxProfileSnapshot
  ensure_organization_sandbox_profile(organization_id) -> SandboxProfileSnapshot
  load_sandbox_profile_by_id, list_active_sandbox_profiles_for_organization, etc.
  Returns frozen dataclasses. AsyncSession injected.

server/proliferate/db/store/cloud_sync/targets.py
  Add ensure_primary_profile_target(sandbox_profile_id) helper.
  Add update_target_runtime_access (compare-and-set on active slot id+generation).
  Add load_active_runtime_access_for_target.

server/proliferate/db/store/cloud_sandboxes.py             (rename from inline use)
  ensure_profile_slot(sandbox_profile_id, target_id) -> SlotSnapshot
  supersede_slot, load_active_slot_for_profile_target.

server/proliferate/db/store/cloud_workspaces.py
  Add create_managed_cloud_workspace_for_profile(...) that writes
  sandbox_profile_id, target_id, normalized_repo_key, billing_subject_id.
  Remove managed-cloud creation paths that go through runtime_environment_id.

server/proliferate/db/store/cloud_sync/sandbox_profile_target_state.py  (new file)
  load_state_for_profile_target,
  record_runtime_config_apply_attempt/success/failure,
  record_agent_auth_apply_attempt/success/failure (moved from cloud_agent_auth store),
  invalidate_applied_on_slot_replacement(sandbox_profile_id, target_id).

server/proliferate/db/store/cloud_agent_auth/**
  Update FKs to sandbox_profile_target_state; remove the old narrow store.

server/proliferate/db/store/cloud_runtime_environments.py
  Mark managed-cloud functions deprecated; remove managed-cloud writers.
```

Services / APIs:

```text
server/proliferate/server/cloud/sandbox_profiles/                          (new)
  api.py        thin transport
  service.py    ensure_personal, ensure_organization, enable_cloud
  models.py     pydantic request/response
  access.py     auth gates (owner/admin)
  domain/policy.py     pure invariant checks

server/proliferate/server/cloud/runtime/
  ensure_running.py        rewrite around (sandbox_profile_id, target_id);
                            no CloudRuntimeEnvironment reads/writes for managed.
                            sync portion only: row existence checks; defers
                            E2B work to provision.py background handler.
  provision.py             owns the provision_profile_slot background job.
                            ensure_primary_profile_target (sync) +
                            provision_profile_slot (background) +
                            record_target_runtime_access.
  reconciler.py            (new) reconcile_sandbox_profile_target tick.
  bootstrap.py / sandbox_exec.py / data_key.py
                            update to write cloud_target_runtime_access
                            and feed slot identity into enrollment tokens.

server/proliferate/server/cloud/workspaces/service.py
  Rewrite managed workspace creation to use the profile launch service.
  Remove _raise_org_cloud_not_ready once shared launch path is implemented
  and acceptance tests pass; keep it until then but route through
  ensure_organization_sandbox_profile to fail before partial provisioning.

server/proliferate/server/cloud/commands/service.py
  Carry cloud_workspace_id on every managed-cloud command.
  Stamp leased_cloud_sandbox_id + leased_slot_generation on lease.
  Verify result correlation by cloud_workspace_id + slot fence.

server/proliferate/server/cloud/runtime/target_registration.py
  Issue enrollment tokens carrying sandbox_profile_id + cloud_sandbox_id +
  slot_generation; assign these fields on the new worker row.

server/proliferate/server/cloud/agent_auth/service.py
  Replace SandboxProfileAgentAuthTargetState references with
  SandboxProfileTargetState. Derive primary target from
  cloud_targets.sandbox_profile_id + profile_target_role rather than
  SandboxProfile.managed_target_id.

server/proliferate/server/cloud/repo_config/service.py
  Update _raise_org_cloud_not_ready guard to defer to spec-09 readiness
  once shared cloud is launchable; remove inline duplicate.
```

Worker / contract (Rust):

```text
server/proliferate/server/cloud/commands/models.py
  Extend enqueue payload models with cloudWorkspaceId,
  sandboxProfileId, slotGeneration, leasedCloudSandboxId.

server/proliferate/server/cloud/worker/models.py
  Extend worker lease / result / delivery / enrollment / heartbeat models
  with cloud_workspace_id, sandbox_profile_id, cloud_sandbox_id,
  slot_generation.

anyharness/crates/proliferate-worker/src/cloud_client/commands.rs
  Send/echo new fields.

anyharness/crates/proliferate-worker/src/cloud_client/mod.rs
  Persist (sandbox_profile_id, cloud_sandbox_id, slot_generation) from
  EnrollResponse and feed them into every subsequent request.

anyharness/crates/proliferate-worker/src/enrollment.rs
  Consume enrollment response fields and persist slot/profile identity.

anyharness/crates/proliferate-worker/src/commands/dispatcher.rs
  Pass cloud_workspace_id into materialization results; surface
  AnyHarness workspace id back to Cloud through CommandResultRequest.

anyharness/crates/proliferate-worker/src/materialization/mod.rs
  No internal logic change beyond carrying the new fields through.

anyharness/sdk regeneration
  cd anyharness/sdk && pnpm run generate
  Verify cloud/sdk equivalents.
```

SDK / OpenAPI:

```text
server/openapi.json                              (regenerated)
cloud/sdk/src/generated/openapi.ts
cloud/sdk/src/types/generated.ts
cloud/sdk/src/client/sandbox-profiles.ts         (new)
cloud/sdk/src/client/index.ts                    (export)

anyharness/sdk/generated/openapi.json
anyharness/sdk/src/generated/openapi.ts
anyharness/sdk/src/index.ts
```

Desktop (minimal in this PR — spec 03 owns the broad redesign):

```text
desktop/src/hooks/access/cloud/sandbox-profiles/                          (new)
  query-keys.ts, use-sandbox-profile.ts, use-sandbox-profile-mutations.ts

desktop/src/hooks/access/cloud/target-runtime-access/                     (new)
  query-keys.ts, use-target-runtime-access.ts   -- diagnostics only

desktop/src/lib/access/cloud/sandbox-profiles.ts                          (new)
```

Tests follow files listed in §8.

## 7. Implementation Phases / Chunks

Because the foundation has no production users to migrate, it ships as one
replacement PR with sequenced chunks. Do not split into a multi-PR additive
migration with fallback reads.

```text
Chunk 1  DB models + Alembic migration
  - sandbox_profile broaden + drop managed_target_id
  - cloud_targets sandbox_profile_id / profile_target_role
  - cloud_sandbox slot fields and active-slot index
  - cloud_target_runtime_access creation
  - sandbox_profile_target_state rename + broaden with data copy
  - cloud_workspace profile/target/normalized_repo_key/required_*
  - cloud_commands cloud_workspace_id + leased_*
  - cloud_workers / cloud_target_enrollments slot fences
  - update __init__.py exports
  - migration tests verify shape and copy

Chunk 2  Sandbox profile store + service
  - ensure_personal_sandbox_profile, ensure_organization_sandbox_profile
  - billing_subject_id wiring via existing ensure helpers
  - status state machine: configuring -> active
  - sandbox_profile_target_state store split from cloud_agent_auth store

Chunk 3a  Sync target lifecycle around profiles
  - ensure_primary_profile_target (idempotent with unique-index retry)
  - mint enrollment token carrying (sandbox_profile_id, slot placeholders)
  - sync API returns immediately with status='configuring' or
    status='provisioning'; no E2B call inside the request

Chunk 3b  Background slot provisioning + reconciler
  - provision_profile_slot background handler (E2B create, worker boot,
    enrollment wait, cloud_target_runtime_access write, status transitions)
  - reconcile_sandbox_profile_target tick (re-enqueue stale apply commands,
    retry stuck provisioning, mark error after bounded retries)
  - register handlers with whichever scheduler/queue primitive the repo
    already uses; do not invent a parallel queue
  - manual smoke that a profile transitions configuring -> provisioning ->
    active without the originating API request blocking

Chunk 4  Worker wire contract
  - extend envelope, result, delivery, enroll, heartbeat
  - regenerate anyharness/sdk
  - new fields are Option<T> only because non-managed targets (SSH,
    local) have no sandbox_profile_id / cloud_sandbox_id / slot_generation
    to send; managed-cloud commands MUST set them

Chunk 5  Managed workspace creation rewrite
  - cloud_workspace creation under (sandbox_profile_id, target_id) BEFORE
    enqueueing materialize_workspace
  - cloud_commands carry cloud_workspace_id
  - worker echoes cloud_workspace_id + anyharness_workspace_id on result
  - update cloud_workspace.anyharness_workspace_id +
    materialized_slot_generation only on slot-fence-correct results

Chunk 6  Agent auth rebind
  - agent_auth service writes through SandboxProfileTargetState
  - drop SandboxProfile.managed_target_id readers
  - refresh_agent_auth_config preflight uses sandbox_profile_target_state

Chunk 7  Delete dead managed-cloud runtime_environment code paths
  - rg "CloudRuntimeEnvironment|runtime_environment_id" remaining hits
  - classify each as non-managed / test fixture / diagnostic / dead;
    delete dead, isolate the rest

Chunk 8  Org shared path
  - ensure_organization_sandbox_profile + primary target + slot for
    organization owner_scope
  - either remove _raise_org_cloud_not_ready and pass acceptance tests, or
    keep as explicit block that calls ensure_organization_sandbox_profile
    BEFORE failing so we never half-provision

Chunk 9  Fixtures / dev data updated
  - dev seed scripts create profiles + primary targets through the new
    ensure helpers; no CloudRuntimeEnvironment shortcut

Chunk 10 Acceptance test sweep (see §8)
```

Inside the PR, chunks 1-3 are atomic. Chunks 4-10 may land as commits in the
same branch but must all be present before the PR is mergeable.

## 8. Acceptance Criteria

Single-PR acceptance:

1. `sandbox_profile` is the managed-cloud product/config root.
2. Personal cloud enablement creates or reuses exactly one personal
   `sandbox_profile`, exactly one primary `cloud_target`, and at most one
   active `cloud_sandbox` slot.
3. Organization cloud enablement creates or reuses exactly one organization
   `sandbox_profile`; the shared launch path either provisions an
   organization-owned `cloud_workspace` or fails explicitly before creating
   profile/target/slot/workspace rows.
4. `cloud_targets.sandbox_profile_id + profile_target_role = 'primary'` is the
   sole authoritative relationship for the profile's primary managed target.
   `sandbox_profile.managed_target_id` does not exist.
5. Exactly one active managed slot exists per `(sandbox_profile_id,
   target_id)` (active = `superseded_at IS NULL` AND status IN
   `('creating','running','paused','blocked')`).
6. Worker enrollment, heartbeat, command leasing, delivery, result ingest,
   event ingest, runtime-access writes, and readiness updates are fenced by
   active slot id and `slot_generation`. Stale slot reports do not mutate
   workspace/session/runtime-access/profile-target/billing readiness state.
7. `cloud_target_runtime_access` exists; runtime URL/token/data key are not
   read from `cloud_runtime_environment` or `cloud_workspace` in the managed
   path.
8. Managed `cloud_workspace` rows are created before AnyHarness
   materialization and carry `sandbox_profile_id` and `target_id`.
9. Managed workspace uniqueness includes profile, target, normalized repo,
   and branch; active worktree paths are unique per target.
10. `cloud_workspace.anyharness_workspace_id` is valid only when
    `materialized_slot_generation` equals the active slot's `slot_generation`.
11. `cloud_commands` carry `cloud_workspace_id` for managed-cloud commands;
    materialization results correlate by `cloud_workspace_id` before any
    AnyHarness workspace id exists.
12. Managed `cloud_sandbox` slot rows carry `sandbox_profile_id`, `target_id`,
    and `billing_subject_id`. Billing/quota code counts active slots without
    joining through `cloud_runtime_environment`.
13. `sandbox_profile_target_state` is the single per-`(profile, target)` apply
    row carrying both runtime-config and agent-auth axes plus active-slot
    fence. `sandbox_profile_agent_auth_target_state` does not exist after the
    migration.
14. Managed-cloud workspace/slot/provisioning code does not require
    `CloudRuntimeEnvironment`. `rg
    "CloudRuntimeEnvironment|runtime_environment_id" server/proliferate` has
    every remaining hit classified as non-managed, test/fixture, diagnostic,
    or dead.
15. Concurrent profile/target creation returns one profile and one primary
    target.
16. Automations call the same `managed_profile_launch` service (or whatever
    the foundation names it) or fail before partial provisioning.
17. Worker contract carries `cloud_workspace_id`, `sandbox_profile_id`,
    `slot_generation` on envelope, result, delivery, enrollment, and
    heartbeat. `anyharness/sdk` and `cloud/sdk` are regenerated.
18. `materialize_environment_runtime_config` is **not** enqueued anywhere.
19. Desired/current runtime/auth sequence placeholders exist and default to a
    passing `0 / 0` state.
20. `refresh_agent_auth_config` continues to work against the renamed
    `SandboxProfileTargetState`.
21. **Sandbox profile creation does not block on E2B provisioning.** The
    sync API returns with `status='configuring'` (or `'provisioning'` if
    `ensure_primary_profile_target` was also called) before any E2B SDK
    operation runs. Slot provisioning runs in `provision_profile_slot` in
    the background; status transitions `configuring -> provisioning ->
    active` are observable via `GET /v1/cloud/sandbox-profiles/{id}` and
    `…/target-state`.
22. **Organization creation does not write `sandbox_profile`.** Existing
    org creation paths (`server/proliferate/server/organizations/**`) are
    not touched by this spec. `ensure_organization_sandbox_profile` is
    called only from shared cloud-intent actions.
23. **Worker results never auto-create `cloud_workspace`.** Results whose
    `cloud_workspace_id` is absent or does not match an existing row are
    rejected (`cloud_workspace_not_found`) and the command is marked stale.
    The only path that creates a `cloud_workspace` row from existing runtime
    state is `sync_existing_workspace` (admission owned by spec 08).
24. The reconciler tick re-enqueues stale apply commands by `revision_id /
    content_hash` so duplicates collapse server-side. Retrying a failed
    `provision_profile_slot` does not create duplicate slot rows.

## 9. Verification / Tests

Server:

```bash
cd server
uv run pytest -q
```

Targeted server tests to add:

```text
server/tests/cloud/sandbox_profiles/test_ensure_personal.py
server/tests/cloud/sandbox_profiles/test_ensure_organization.py
server/tests/cloud/sandbox_profiles/test_profile_idempotency_concurrent.py
server/tests/cloud/sandbox_profiles/test_billing_subject_wired.py
server/tests/cloud/runtime/test_ensure_primary_profile_target.py
server/tests/cloud/runtime/test_primary_target_uniqueness.py
server/tests/cloud/runtime/test_slot_generation_supersession.py
server/tests/cloud/runtime/test_target_runtime_access_cas.py
server/tests/cloud/runtime/test_runtime_access_stale_reject.py
server/tests/cloud/workspaces/test_managed_workspace_profile_target_links.py
server/tests/cloud/workspaces/test_workspace_uniqueness_repo_branch.py
server/tests/cloud/workspaces/test_workspace_worktree_path_unique.py
server/tests/cloud/workspaces/test_materialized_slot_generation_invalidation.py
server/tests/cloud/commands/test_cloud_workspace_id_correlation.py
server/tests/cloud/commands/test_slot_fence_on_lease.py
server/tests/cloud/commands/test_slot_fence_on_result.py
server/tests/cloud/agent_auth/test_target_state_rebind.py
server/tests/cloud/agent_auth/test_refresh_agent_auth_config_against_new_table.py
server/tests/cloud/runtime/test_no_runtime_environment_reads_in_managed_path.py
server/tests/cloud/migrations/test_sandbox_profile_foundation_migration.py
server/tests/cloud/runtime/test_org_cloud_explicit_failure_before_partial_provision.py
server/tests/automations/test_cloud_execution_uses_profile_launch.py
```

Worker / AnyHarness:

```bash
cargo test -p anyharness-contract
cargo test -p proliferate-worker
```

Targeted Rust tests to add:

```text
anyharness/crates/proliferate-worker/src/cloud_client/commands.rs#tests
  - command result echoes cloud_workspace_id and anyharness_workspace_id

anyharness/crates/proliferate-worker/src/cloud_client/mod.rs#tests
  - enrollment persists sandbox_profile_id + cloud_sandbox_id +
    slot_generation; heartbeat carries them
```

SDK regeneration:

```bash
cd anyharness/sdk && pnpm run generate && pnpm run build
cd cloud/sdk && pnpm run generate && pnpm run build
```

Manual smoke:

```text
1. Enable personal cloud (synchronous part)
     -> sandbox_profile row INSERTed with billing_subject_id set,
        status='configuring'
     -> API returns inside the request; no E2B call yet
     -> primary cloud_target created on the first explicit cloud-intent
        action; profile status moves to 'provisioning'
     -> provision_profile_slot background job runs:
          E2B sandbox created
          worker boots, enrolls, heartbeats
          cloud_target_runtime_access populated
          cloud_sandbox.status='running'
          sandbox_profile.status='active'
     -> GET /sandbox-profiles/{id} observed to transition without the
        original API request blocking
     -> sandbox_profile_target_state shows runtime_config_status='applied'
        at 0/0 and agent_auth_status accordingly

2. Create a managed cloud workspace
     -> cloud_workspace row exists before AnyHarness materialization
     -> materialize_workspace command carries cloud_workspace_id
     -> worker echoes cloud_workspace_id + anyharness_workspace_id
     -> cloud_workspace.anyharness_workspace_id filled from worker result
     -> simulating a worker result with unknown cloud_workspace_id
        is rejected with cloud_workspace_not_found

3. Pause provider sandbox
     -> Cloud lists workspaces/sessions without waking
     -> cloud_target_runtime_access remains current with the paused slot id
     -> next wake-required command resumes through Proliferate-owned path

4. Replace provider sandbox
     -> old cloud_sandbox.superseded_at set; status terminal
     -> new cloud_sandbox row with slot_generation = old + 1
     -> sandbox_profile_target_state applied_* cleared
     -> cloud_workspace.materialized_slot_generation invalidated
     -> next start_session fails preflight until rematerialization
     -> stale worker (old slot_generation) is fenced out

5. Enable shared cloud as admin (implicit trigger)
     -> admin publicizes first MCP to org
     -> ensure_organization_sandbox_profile runs in background;
        no org creation flow touched
     -> primary target / slot provisioned through provision_profile_slot
     -> _raise_org_cloud_not_ready either gone or routes through
        ensure_organization_sandbox_profile before failing
     -> ensure_personal_sandbox_profile is NOT called for this admin's
        personal account just because they enabled shared cloud

6. Run automation against shared cloud
     -> automation calls managed_profile_launch with owner_scope=organization
     -> cloud_workspace.owner_scope=organization; billing_subject_id matches
        organization billing_subject
     -> if launch is not ready, fails before creating partial rows

7. Provision retry on transient failure
     -> simulate E2B failure during provision_profile_slot
     -> sandbox_profile.status='error' or 'blocked', not 'provisioning'
     -> reconciler retries with bounded backoff; no duplicate slot rows
     -> on success, status moves to 'active'; existing sandbox_profile row
        is reused, not duplicated
```

## 10. Final Decisions / Deferred Questions

1. **Should we model "ssh / desktop_dispatch / self_hosted_cloud" targets as
   also having a profile?**

   Decision: no. The foundation keeps non-managed targets target-first with
   `profile_target_role = 'none'`. A later spec can add an explicit
   `cloud_target.policy_profile_id` if non-managed targets need shared
   policy defaults.

2. **Which queue/scheduler does `provision_profile_slot` run on?**

   Decision: use `server/proliferate/server/cloud/runtime/scheduler.py` and
   mirror the existing in-process workspace provisioning task pattern. Do not
   route profile-slot provisioning through automation scheduling.

3. **Does the foundation add a profile-events SSE stream, or just polling?**

   Polling (`GET /sandbox-profiles/{id}` + `…/target-state`) is sufficient
   for V1. SSE is a UX-latency improvement and may already be available
   through the existing cloud events fanout (spec 04). The foundation does
   not add a new SSE channel; spec 04 can fold profile/slot events into
   the existing channel if it exists.

4. **Should `ensure_*_sandbox_profile` always also call
   `ensure_primary_profile_target`?**

   Two shapes:
     (a) "ensure profile" creates only the profile row. The caller (or a
         later cloud-intent action) calls `ensure_primary_profile_target`
         when compute is actually needed.
     (b) "ensure profile" also ensures the primary target so the profile is
         immediately ready to receive a slot the first time
         `provision_profile_slot` runs.

   Decision: (b). The target row is free; the slot is the expensive part. (b)
   also makes the enrollment-token mint and `cloud_target_runtime_access`
   placeholder available earlier so the background slot job has less to do
   in its critical path.
