## High level notes / mental model broadly

Sandbox management is the foundation layer underneath cloud running, MCPs,
skills, plugins, agent auth, automations, Slack, claiming, and billing.

The core split is:

```text
sandbox profile
  Stable product/config identity.
  "Whose sandbox is this, and what should it be configured with?"

cloud target
  Addressable worker + AnyHarness runtime.
  "Where do commands go, and what runtime state has actually been applied?"

sandbox slot
  Managed compute/provider lifecycle.
  "What E2B sandbox/container backs this managed cloud target right now?"
```

These are separate because the product identity should survive runtime process
restarts, worker reenrollment, E2B pause/resume, and possibly provider sandbox
replacement.

The intended V1 invariant:

```text
personal cloud
  one normal managed-cloud sandbox profile per user

shared cloud
  one shared managed-cloud sandbox profile per organization
```

Workspaces, sessions, MCP/skill/plugin runtime config, agent auth, env files,
Slack runs, and automations all resolve through one of those sandbox profiles.

Do not model MCPs, skills, plugins, or agent auth as per-session state. They are
sandbox capability state. Workspaces and sessions inherit the current applied
state for the sandbox.

## Basic basic UX / high level

What is the relationship between sandboxes and people / orgs?

- A user can enable personal cloud.
- An organization admin can enable shared cloud.
- Personal cloud is the user's managed sandbox.
- Shared cloud is the organization's managed sandbox for team automations,
  Slack, and shared team work.
- Users should mostly see "Cloud".
- Admins should mostly see "Shared cloud" or "Team work".
- Avoid showing "sandbox profile" as product copy unless debugging or admin
  diagnostics require it.

What is created when?

```text
User signup
  no managed cloud compute by default

User clicks Enable Personal Cloud
  create personal sandbox profile if missing
  collect/check required config
  provision target/slot when needed or when setup completes

Org creation
  no shared managed cloud compute by default

Admin clicks Enable Shared Cloud
  create organization sandbox profile if missing
  guide admin through shared auth, public MCP/skills/plugins, repo/env config
  provision target/slot when needed or when setup completes
```

This keeps cloud enablement explicit and avoids creating managed compute for
users/orgs that never use it.

What is the relationship between workspace and the Cloud DB?

Cloud DB should have a durable row for every managed-cloud workspace we create
or expose. A paused sandbox should not make the workspace list disappear.

Cloud stores:

- which sandbox profile and target the workspace belongs to;
- repo identity, branch/base branch, path/worktree metadata;
- AnyHarness workspace id once known;
- status/lifecycle;
- exposure/claim state;
- required runtime config and agent auth revisions;
- session projections, summaries, and last known status.

Cloud does not store as source of truth:

- full git worktree contents;
- live process state;
- raw AnyHarness caches;
- raw MCP credential values;
- raw provider secrets.

AnyHarness/worker own live execution. Cloud owns durable product index,
readiness, orchestration, and access policy.

## Full DB models + schemas

### Cloud Targets Broadly

```text
cloud_sandbox_profile
  id
  owner_scope: personal | organization
  owner_user_id
  organization_id
  status: disabled | configuring | provisioning | ready | blocked | error

  desired_runtime_config_revision
  desired_agent_auth_revision

  created_at
  updated_at
```

Purpose:

- stable product/config identity;
- owns desired sandbox-level state;
- target for MCP/skills/plugins resolver;
- target for agent auth selection;
- target for shared/personal cloud readiness.

Invariants:

```text
personal
  owner_scope = personal
  owner_user_id is not null
  organization_id may be nullable or membership-context only
  unique active profile per owner_user_id

organization
  owner_scope = organization
  organization_id is not null
  owner_user_id is null
  unique active profile per organization_id
```

```text
cloud_target
  id
  sandbox_profile_id

  owner_scope: personal | organization
  owner_user_id
  organization_id

  target_kind: local | ssh | managed_cloud
  status: enrolling | online | offline | unhealthy | archived

  active_worker_id
  runtime_version
  last_heartbeat_at

  readiness_json
  inventory_json

  current_runtime_config_revision
  current_agent_auth_revision

  created_at
  updated_at
```

Purpose:

- addressable command destination;
- worker/AnyHarness runtime identity;
- stores applied runtime/auth revision facts;
- stores readiness/inventory from worker heartbeat.

For managed cloud V1, a profile should have one active managed-cloud target.
For local/SSH, target enrollment can still exist, but there may be no managed
sandbox slot.

```text
cloud_worker
  id
  target_id
  worker_version
  anyharness_version
  supported_command_kinds
  status
  last_seen_at
  inventory_json
```

Purpose:

- live worker process identity;
- command leasing and heartbeat;
- tells Cloud what the target can currently do.

### Managed Cloud Sandbox Slot

```text
cloud_sandbox_slot
  id
  sandbox_profile_id
  target_id

  provider: e2b
  provider_sandbox_id

  state: not_created | creating | running | pausing | paused | blocked |
    error | killed

  lifecycle_on_timeout: pause
  lifecycle_auto_resume: true
  provider_timeout_seconds

  running_started_at
  last_checked_at
  blocked_reason

  created_at
  updated_at
```

Purpose:

- provider-compute lifecycle row;
- tracks the actual E2B sandbox/container backing a managed cloud target;
- billing and wake/resume logic gate on this row.

This is not product config. This is not the workspace list. This is not the
AnyHarness target itself.

Example:

```text
Pablo's personal cloud
  cloud_sandbox_profile: Pablo's stable cloud config
  cloud_target: Pablo's worker/AnyHarness endpoint
  cloud_sandbox_slot: E2B sandbox abc123, currently paused
```

### Mapping Users To Cloud Targets

The primary mapping should be through `cloud_sandbox_profile`.

```text
user
  -> personal cloud_sandbox_profile
    -> active managed cloud_target
      -> active cloud_sandbox_slot

organization
  -> shared cloud_sandbox_profile
    -> active managed cloud_target
      -> active cloud_sandbox_slot
```

Useful uniqueness constraints:

```text
unique active personal cloud_sandbox_profile per owner_user_id
unique active organization cloud_sandbox_profile per organization_id
unique active managed_cloud cloud_target per sandbox_profile_id
unique active cloud_sandbox_slot per target_id
```

If we later support multiple named sandboxes per user/org, add a `name` or
`profile_kind` dimension explicitly. Do not accidentally create that complexity
through unbounded target rows in V1.

### All DB Models For Workspaces In A Cloud Target

```text
cloud_workspace
  id
  sandbox_profile_id
  target_id

  owner_scope: personal | organization
  owner_user_id
  organization_id

  repo_id
  repo_url
  git_owner
  git_repo_name

  anyharness_workspace_id
  worktree_path

  base_branch
  branch

  status: pending | materializing | active | paused | failed | archived

  required_runtime_config_revision
  required_agent_auth_revision

  last_activity_at
  created_at
  updated_at
```

Purpose:

- durable Cloud product row for "this workspace exists inside this cloud
  sandbox";
- survives E2B pause/resume and AnyHarness restart;
- lets Cloud/web/mobile/Desktop list cloud work without waking compute.

Invariants:

```text
managed-cloud workspace belongs to exactly one sandbox_profile_id
managed-cloud workspace belongs to exactly one target_id while active
anyharness_workspace_id may be null until worker materializes it
required revisions are copied from the profile at launch/materialization time
```

```text
cloud_session
  id
  cloud_workspace_id
  target_id
  anyharness_session_id

  agent_kind
  model
  mode_or_config_json
  agent_run_config_id
  agent_run_config_snapshot_json

  status
  current_turn_id
  last_event_seq

  required_runtime_config_revision
  required_agent_auth_revision

  created_at
  updated_at
```

Purpose:

- durable Cloud projection of a runtime session;
- stores enough state for sidebars/history/status without waking compute;
- records the runtime/auth revisions required for the session launch.

```text
cloud_workspace_exposure
  id
  target_id
  cloud_workspace_id
  anyharness_workspace_id

  owner_scope: personal | organization
  owner_user_id
  organization_id

  visibility: private | shared_unclaimed | claimed | archived
  claimed_by_user_id

  default_projection_level: index_only | session_summaries | transcript | live
  commandable

  status: active | paused | stale | revoked
  revision
  last_projected_at

  created_at
  updated_at
```

Purpose:

- answers who can see/control this workspace through Cloud;
- separates "workspace exists" from "who can view or command it";
- supports shared unclaimed work and later claiming.

```text
cloud_session_projection
  id
  exposure_id
  target_id
  cloud_workspace_id
  anyharness_workspace_id
  anyharness_session_id

  projection_level: session_summaries | transcript | live
  commandable

  status: pending_backfill | active | stale | paused | failed | ended
  last_uploaded_seq
  gap_state_json
  last_projected_at

  created_at
  updated_at
```

Purpose:

- durable Cloud-side projection of AnyHarness session events;
- worker updates it through event upload/backfill.

## End to end flows through the product

### Creating New User / Associated Sandbox

1. User signs up.
2. No managed compute is created by default.
3. User clicks Enable Personal Cloud, configures personal cloud auth, configures
   a repo for cloud, or starts first personal cloud workspace.
4. Cloud creates personal `cloud_sandbox_profile` if missing.
5. Cloud marks profile `configuring` until required setup is complete.
6. When compute is needed, Cloud creates managed `cloud_target` and
   `cloud_sandbox_slot`.
7. Compute boots supervisor, AnyHarness, and Proliferate Worker.
8. Worker enrolls and heartbeats.
9. Cloud marks target/profile ready once required readiness checks pass.

### Creating New Org / Associated Sandbox

1. Organization is created.
2. No shared managed compute is created by default.
3. Admin clicks Enable Shared Cloud.
4. Cloud creates organization `cloud_sandbox_profile` if missing.
5. Admin configures shared agent auth.
6. Admin marks MCPs/skills/plugins public to org.
7. Admin configures shared repo/env defaults.
8. Cloud provisions shared managed `cloud_target` and `cloud_sandbox_slot` when
   needed or after setup completes.
9. Worker enrolls.
10. Shared readiness becomes ready for automations, Slack, and shared cloud
    work once target, auth, runtime config, and repo/env checks are current.

### New Workspace On A Managed Cloud Sandbox

1. Client/automation/Slack asks Cloud to start work.
2. Cloud selects sandbox profile:
   - personal run -> user's personal profile;
   - team run -> organization's shared profile.
3. Cloud ensures profile has an active managed target.
4. Cloud ensures sandbox slot is running or wakes it.
5. Cloud creates `cloud_workspace` row before AnyHarness work starts.
6. Cloud creates or updates workspace exposure:
   - personal -> private/owner-visible;
   - team/Slack/automation -> shared_unclaimed or claimed policy.
7. Cloud queues worker commands:
   - `configure_git_identity` if needed;
   - `ensure_repo_checkout`;
   - `materialize_workspace`;
   - `materialize_environment`;
   - `materialize_environment_runtime_config`;
   - `refresh_agent_auth_config`;
   - `start_session` if a session is requested.
8. Worker resolves/creates the AnyHarness workspace.
9. Worker writes back `anyharness_workspace_id`, path, status, and applied
   revisions.
10. Cloud UI can show the workspace even if the E2B sandbox later pauses.

## Specific hooks

Profile hooks:

- Enable Personal Cloud -> create personal profile.
- Enable Shared Cloud -> create organization profile.
- Disable cloud -> mark profile disabled/blocked; decide separately whether to
  pause, archive, or delete provider compute.

Target hooks:

- Provision managed cloud -> create target and sandbox slot.
- Worker enroll -> attach worker to target.
- Worker heartbeat -> update target status, inventory, readiness, current
  runtime config revision, and current agent auth revision.

Workspace hooks:

- Start cloud workspace -> create `cloud_workspace` before worker command.
- Worker materialized workspace -> write AnyHarness id/path/status.
- Session event upload -> update session/projection rows.
- Archive/delete workspace -> update exposure/projection and later cleanup
  runtime state.

Readiness hooks:

- MCP/skill/plugin config changes -> bump desired runtime config revision on
  sandbox profile and queue runtime config materialization.
- Agent auth selection/credential changes -> bump desired agent auth revision
  on sandbox profile and queue auth refresh.
- Repo/env config changes -> queue environment materialization for affected
  workspaces/targets.

E2B hooks:

- Before command delivery -> ensure sandbox slot is runnable.
- Provider pause/resume/killed/error event -> update sandbox slot state.
- Billing block -> set sandbox slot blocked and fail wake-gated commands fast.

## Specific one offs

Should profiles be created at signup?

No. Create profiles lazily on explicit cloud intent. Managed compute should be
even later than profile creation.

Should target and sandbox slot be the same table?

No. `cloud_target` is our runtime command identity. `cloud_sandbox_slot` is the
provider compute lifecycle. Keeping them separate lets provider lifecycle
change without rewriting the product/runtime identity.

Should workspace creation pass MCP/skill ids?

No. Workspace creation should require a runtime config revision, not carry a
selection list. The sandbox profile owns desired MCP/skill/plugin state.

Can Cloud show workspaces while the sandbox is paused?

Yes. That is one of the main reasons `cloud_workspace`, exposure, session, and
projection rows exist. Passive UI should read Cloud DB, not wake compute.

What happens if the worker/AnyHarness restarts?

The target may become temporarily offline/unhealthy. The profile, slot, and
workspace rows remain. When the worker reenrolls/heartbeats, Cloud can resume
command delivery and reconcile applied revisions.

What happens if E2B sandbox is replaced?

The `cloud_sandbox_slot` provider fields change. The profile remains stable.
The target may remain stable if the worker identity is preserved or may be
reenrolled; workspace rows remain product state and are reconciled through
materialization/migration policy.

## Deeper concepts

### E2B

E2B is the managed compute provider for cloud sandbox slots.

The product should not expose raw E2B URLs, raw E2B credentials, or raw
AnyHarness URLs as durable user-facing surfaces. Every managed-cloud wake,
command, and billing decision should pass through Proliferate Cloud first.

Recommended lifecycle:

```text
onTimeout = pause
autoResume = true
timeout = short active window
```

Use auto-pause to stop paying while idle. Use auto-resume to make the sandbox
feel persistent. But product wake paths still need to:

1. persist the intended operation;
2. check billing/entitlements;
3. ensure slot is runnable;
4. wait for worker heartbeat/readiness;
5. deliver the command.

Do not just enqueue a command and hope the worker long-polls it. A paused E2B
sandbox has no active worker process.

### Profile vs Target vs Slot

```text
sandbox profile
  "what this personal/shared sandbox should be"

cloud target
  "where commands go"

sandbox slot
  "what managed compute backs the target"
```

Most product configuration should point at the profile.

Most worker commands should point at the target.

Most billing/provider lifecycle should point at the slot.

### Workspace Durability

Cloud-managed workspaces are durable product records. The runnable files and
processes live on the target, but the workspace row lets Cloud know the work
exists even when compute is asleep.

This is what makes web, mobile, Slack, automations, claiming, and passive
sidebars work without waking the sandbox just to list history.
