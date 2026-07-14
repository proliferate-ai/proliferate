# 06 — Automations

Status: target

Current gap: this is not the deployed automation architecture, and its command,
exposure, and projection substrate is absent.

Date: 2026-05-20.

Depends on: [`sandbox-provisioning.md`](../../../platforms/product/sandbox-provisioning.md),
[`mcp-skills.md`](../../../platforms/product/mcp-skills.md),
[`agent-auth.md`](../../../platforms/product/agent-auth.md),
[`settings-admin-ia.md`](../settings/information-architecture.md),
[`claiming.md`](../../../platforms/product/claiming.md).

Automations are scheduled or manually-triggered work that uses the
same sandbox profile, runtime config, agent auth, command queue,
exposure/projection, and claim primitives as user-initiated work.
The system already exists; spec 06 aligns it to the new foundation:
team scope, reusable agent run configs, preflight with auto-cascade,
and shared_unclaimed exposure on team runs.

## 1. Purpose & Scope

In scope:

- Add `owner_scope` ∈ `{personal, organization}` to `Automation`.
  Personal automations create personal work; team automations
  create org-owned `shared_unclaimed` work that is claim-eligible.
- Replace inline `agent_kind / model_id / mode_id / reasoning_effort`
  columns with a `cloud_agent_run_config` row referenced by FK +
  per-run snapshot for audit.
- Rename `Automation.execution_target` → `Automation.target_mode`
  with values from spec 03 vocabulary:
  `local | personal_cloud | shared_cloud`.
- Route automation workspace/session creation through the new
  `managed_profile_launch` helper from spec 04. Profile and target
  are resolved through `ensure_*_sandbox_profile` and
  `ensure_primary_profile_target`.
- Per-run preflight: runtime config (spec 01) and agent auth
  (spec 02). Stale state triggers **auto-cascade** — enqueue
  `materialize_environment` and/or `refresh_agent_auth_config`
  first, then `start_session` depending on them. Cascade attempts
  bounded; terminal failure marks the run failed with a typed
  error.
- Exposure defaults: personal → `visibility='private'`,
  `commandable=true`; team → `visibility='shared_unclaimed'`,
  `commandable=true`. Spec 05's claim flow takes over from there.
- Team automation requires shared cloud readiness; fail-fast at
  enqueue if `ensure_organization_sandbox_profile` cannot
  complete or the org profile is `blocked`.
- Existing scheduler loop, RRULE cursor on `Automation.next_run_at`,
  and idempotent missed-tick handling stay as-is.

Out of scope:

- New trigger kinds beyond `scheduled` and `manual`. Repository-
  event triggers and webhook triggers are not in V1.
- Multi-tenant scheduling fairness (per-org or per-user rate limits).
- Automation-defined exposure overrides. The exposure default is
  fixed by `owner_scope`; admins cannot configure a team automation
  to produce `private` work, nor can a user produce
  `shared_unclaimed` work.
- A separate `automation_run` audit log table. Existing status +
  error fields + `cloud_commands` audit are sufficient.
- Slack-specific automation behaviour (→ spec 07). Spec 06 ensures
  Slack can reuse the same primitives.
- Local-automation execution semantics on Desktop beyond what
  exists today (Desktop worker scheduling). Spec 06 keeps the
  current local execution shape and only adjusts the `target_mode`
  enum.

## 2. Mental Model

```text
Automation                           a reusable definition
  owner_scope                        personal | organization
  target_mode                        local | personal_cloud | shared_cloud
  cloud_agent_run_config_id          how the agent should be run
  cloud_repo_config_id               which repo + env
  schedule_rrule / next_run_at       when (or null for manual-only)

AutomationRun                        one execution attempt
  trigger_kind                       scheduled | manual
  snapshots                          frozen-at-trigger metadata
  cloud_workspace_id                 the workspace created for the run
  sandbox_profile_id                 the profile the run resolved to
  exposure_id                        which exposure was created
  agent_run_config_snapshot_json     resolved values used by the run
  status                             queued -> ... -> dispatched | failed | cancelled

flow                                 reuse the same primitives:
  1. scheduler tick creates an automation_run row
  2. executor claims the run (existing executor lease)
  3. resolve owner -> sandbox_profile (ensure_personal / _organization)
  4. resolve primary target
  5. preflight runtime config; cascade if stale
  6. preflight agent auth; cascade if stale
  7. managed_profile_launch creates cloud_workspace + exposure
       personal -> visibility='private', commandable=true
       team     -> visibility='shared_unclaimed', commandable=true
  8. start_session command
  9. send_prompt command with the prompt snapshot
  10. wait for end-of-turn projection
  11. mark dispatched (or failed)
```

Rule: **no automation-specific MCP/auth/model surface.** Anything
an automation does for runtime config, agent auth, or workspace
launch is the same call any web/mobile/Slack/Desktop caller would
make. Spec 06 enforces this by routing every automation runner
side effect through the same `managed_profile_launch` and command
enqueue paths.

## 3. Dependencies

Hard:

- Spec 00: `sandbox_profile`, `ensure_personal_sandbox_profile`,
  `ensure_organization_sandbox_profile`,
  `ensure_primary_profile_target`,
  `sandbox_profile_target_state`.
- Spec 01: `sandbox_profile_runtime_config_current`,
  `materialize_environment` carrying the runtime config fragment.
- Spec 02: `sandbox_profile_agent_auth_revision`,
  `refresh_agent_auth_config`.
- Spec 04: `managed_profile_launch` helper,
  `cloud_workspace_exposure`, `cloud_session_projection` with
  exposure binding, runtime-config preflight (`_validate_runtime_config_preflight`),
  agent-auth preflight (`_validate_agent_auth_preflight`).
- Spec 05: `shared_unclaimed` claim eligibility; team-automation
  output is the canonical source of unclaimed shared work.

Soft:

- Spec 03: `AgentRunConfigSelector` UI primitive consumed by the
  automation editor; `useIsAdmin` gates team-automation creation.
- Spec 07: Slack uses the same `cloud_agent_run_config` row when
  configured by an admin.
- Spec 09: billing wake gate (spec 04) is consulted on every
  automation run; billing-blocked subjects fail the run with a
  typed error.

## 4. Current Repo State

Verified against `the current repository worktree` on 2026-05-20.

### 4.1 What is shipped

**`Automation` model** (`db/models/automations.py`):

```text
id, user_id, cloud_repo_config_id,
title, prompt, schedule_rrule, schedule_timezone, schedule_summary,
execution_target ENUM('cloud','local'),
cloud_target_id nullable FK,
cloud_target_kind_snapshot text nullable,
agent_kind, model_id, mode_id, reasoning_effort   -- inline agent config
enabled, paused_at, next_run_at, last_scheduled_at,
created_at, updated_at
```

**No owner_scope.** Automations are user-scoped only today.

**`AutomationRun` model**:

```text
id, automation_id, user_id,
trigger_kind ENUM('scheduled','manual'),
scheduled_for nullable (required for scheduled),
execution_target,
status ENUM(queued, claimed, creating_workspace,
            provisioning_workspace, creating_session,
            dispatching, dispatched, failed, cancelled),
title_snapshot, prompt_snapshot, git_*_snapshot,
agent_kind_snapshot, model_id_snapshot, mode_id_snapshot,
reasoning_effort_snapshot,
cloud_workspace_id nullable FK,
anyharness_workspace_id nullable, anyharness_session_id nullable,
executor_kind, executor_id, claim_id, claimed_at,
claim_expires_at, last_heartbeat_at,
dispatch_started_at, dispatched_at, failed_at, cancelled_at,
last_error_code, last_error_message
```

No `agent_run_config_id`. No `sandbox_profile_id`. No
`exposure_id`. No `agent_run_config_snapshot_json`.

**Execution pipeline**
(`server/automations/worker/cloud_execution/pipeline.py`):

```text
ordered stages:
  resolve_target
  ensure_git_identity
  materialize_workspace
  materialize_environment        (env files only today; no runtime config)
  start_session
  apply_session_config
  dispatch_prompt
```

Target resolution
(`stages/target.py`):
- if `cloud_target_id_snapshot` is set, load that target;
- else scan visible targets, pick first online `managed_cloud`
  with no archive.
- **Does NOT call `ensure_*_sandbox_profile`.**

Workspace creation
(`server/cloud/workspaces/service.py:create_cloud_workspace_for_automation_run`):
- Resolves via `_resolve_new_cloud_workspace_create`.
- Calls `_raise_org_cloud_not_ready` (which today blocks all
  org-scoped paths, including any hypothetical org automation).
- Inserts CloudWorkspace; attaches to `automation_run.cloud_workspace_id`.

**No runtime config preflight.** **No agent auth preflight.**

**Scheduler** (`worker/scheduler.py:run_scheduler_loop`):
- Polling interval from settings.
- `_resolve_due_schedule()` parses RRULE; advances
  `Automation.next_run_at`.
- UNIQUE constraint on `(automation_id, scheduled_for)` for
  scheduled runs prevents duplicate ticks.

**No `agent_run_config` or `cloud_agent_run_config` table exists.**

**Desktop UI**:

```text
apps/desktop/src/pages/AutomationsPage.tsx                  -> AutomationsScreen
apps/desktop/src/components/automations/
  screen/AutomationsScreen.tsx
  list/AutomationListContent.tsx, AutomationRow.tsx,
        AutomationSectionHeader.tsx, AutomationDetailContent.tsx
  timeline/AutomationRunTimeline.tsx
  editor/AutomationEditorModal.tsx, AutomationEditorControls.tsx
  controls/AutomationTargetPicker.tsx, AutomationModelPicker.tsx,
           AutomationModePicker.tsx

apps/desktop/src/hooks/access/cloud/automations/
  use-automations.ts, use-automation-mutations.ts,
  use-local-automation-run-claims.ts, query-keys.ts
```

No "personal / team" toggle. No `AgentRunConfigSelector` (spec 03
primitive).

### 4.2 Gaps spec 06 closes

- `Automation` has no `owner_scope`. Team automations cannot exist.
- Inline agent config columns block reuse; no
  `cloud_agent_run_config` row.
- Target resolution does not go through `ensure_*_sandbox_profile`;
  the automation runner does not depend on spec 00.
- No runtime config or agent auth preflight in the pipeline; runs
  silently launch on stale state.
- No auto-cascade on stale revisions; spec 04 ships fail-fast and
  defers cascade to here.
- Workspace creation does not set `cloud_workspace_exposure`;
  team-automation output is not claim-eligible today.
- `execution_target` ENUM is `cloud | local`; doesn't distinguish
  personal vs shared cloud.

## 5. Target Model

### 5.1 `Automation` model changes

Add columns:

```text
owner_scope            text   'personal' | 'organization'   NOT NULL
owner_user_id          uuid fk user.id                       NULL
organization_id        uuid fk organization.id               NULL
cloud_agent_run_config_id  uuid fk cloud_agent_run_config.id NOT NULL
created_by_user_id     uuid fk user.id                       NOT NULL
```

Rename column:

```text
execution_target  ->  target_mode
  enum: 'local' | 'personal_cloud' | 'shared_cloud'
```

Drop columns (replaced by `cloud_agent_run_config_id` + snapshot):

```text
agent_kind, model_id, mode_id, reasoning_effort
```

Drop column (derived at runtime):

```text
cloud_target_id        -- target resolved via sandbox_profile +
                          profile_target_role='primary'
```

`cloud_target_kind_snapshot` stays on AutomationRun for audit only.

Migration (one PR; no users):

```text
- add owner_scope / owner_user_id / organization_id, default
  ('personal', user_id, NULL) for existing rows
- add cloud_agent_run_config_id NOT NULL; migration creates a row
  per existing automation from the inline columns and points the
  FK at it
- drop inline agent config columns
- drop cloud_target_id
- rename execution_target -> target_mode; rewrite enum values
- rename user_id -> created_by_user_id
```

Constraints:

```text
CHECK ck_automation_owner_fields
  (owner_scope='personal' AND owner_user_id IS NOT NULL AND organization_id IS NULL)
  OR
  (owner_scope='organization' AND organization_id IS NOT NULL AND owner_user_id IS NULL)

CHECK ck_automation_target_mode_owner
  (owner_scope='personal'     AND target_mode IN ('local','personal_cloud'))
  OR
  (owner_scope='organization' AND target_mode = 'shared_cloud')

CHECK ck_automation_target_mode_enum
  target_mode IN ('local','personal_cloud','shared_cloud')
```

`Automation.next_run_at`, `last_scheduled_at`, `schedule_rrule`,
`schedule_timezone` keep their meanings.

### 5.2 `AutomationRun` model changes

Add columns:

```text
owner_scope                       text                                    NOT NULL
owner_user_id                     uuid                                    NULL
organization_id                   uuid                                    NULL
created_by_user_id                uuid fk user.id                         NOT NULL

sandbox_profile_id                uuid fk sandbox_profile.id              NULL
                                  -- filled by executor at runtime

cloud_workspace_exposure_id       uuid fk cloud_workspace_exposure.id     NULL
                                  -- filled at managed_profile_launch

agent_run_config_snapshot_json    jsonb                                   NULL
                                  -- captures resolved values used by
                                     this run; immutable after dispatch

cascade_attempt                   integer NOT NULL default 0
                                  -- incremented when the runner enqueues
                                     materialize_environment or
                                     refresh_agent_auth_config to recover
                                     from stale state
last_cascade_command_id           uuid                                    NULL
                                  -- last preflight cascade command id
                                     for diagnostics
last_cascade_reason               text                                    NULL
                                  'runtime_config_stale' |
                                  'agent_auth_stale' |
                                  'runtime_config_apply_failed' |
                                  'agent_auth_apply_failed'
```

Drop columns (replaced by snapshot json):

```text
agent_kind_snapshot, model_id_snapshot, mode_id_snapshot,
reasoning_effort_snapshot
```

Rename column:

```text
execution_target  ->  target_mode
```

Status enum: keep existing values. Cascade rounds are visible
through `cloud_commands` rows whose `result_json.parent_command_id`
points at the run's `start_session` / `send_prompt` command, not
through new states on the run itself. The run's status reflects the
end-to-end outcome.

### 5.3 `cloud_agent_run_config` — centralized agent configuration

This subsystem is consumed by every surface that starts agent work:
automations, Slack bot (spec 07), Desktop new-chat, Web/Mobile
new-chat (spec 08), Cowork API. Spec 06 owns the model because
automations are the first non-interactive consumer; downstream specs
reference this section.

**The catalog is the source of truth.** `catalogs/agents/v1/catalog.json`
(and adjacent code) defines which agent kinds exist, which models
exist per kind, and which launch/session controls each agent kind
accepts. In the current catalog shape that means:

```text
catalog.agents[] by kind
  session.models[]     -- valid model_id values
  session.controls[]   -- valid controls for settings / start / automation
```

Controls are agent-kind scoped today, not stored in a
`controls[agent_kind][model_id]` map. A `cloud_agent_run_config` row
stores one selected `model_id` plus a chosen subset of non-model
controls under a human-readable name. There is no separate "options"
or "validity" subsystem; the catalog itself answers both questions.

Schema:

```text
cloud_agent_run_config
  id                              uuid pk
  owner_scope                     text  'system' | 'personal' | 'organization'
  owner_user_id                   uuid fk user.id                 NULL
  organization_id                 uuid fk organization.id         NULL
  created_by_user_id              uuid fk user.id                 NOT NULL

  name                            text   NOT NULL
  agent_kind                      text   'claude' | 'codex' | 'opencode' | 'gemini' | 'cursor'
  model_id                        text   NOT NULL
  control_values_json             jsonb  NOT NULL default '{}'
                                  -- non-model controls only; the catalog
                                     "model" control is represented by model_id

  usable_in_personal_sandboxes    boolean NOT NULL default true
  usable_in_shared_sandboxes      boolean NOT NULL default false

  seed_key                        text NULL
                                  -- system rows only; stable deploy-time
                                     identity such as "default" or "fast"
  system_default_rank             integer NULL
                                  -- system rows only; lower wins for fallback

  status                          text   'active' | 'archived'
  created_at, updated_at, archived_at

  CHECK ck_cloud_agent_run_config_owner_fields
  CHECK ck_cloud_agent_run_config_status
  CHECK ck_cloud_agent_run_config_agent_kind
  CHECK ck_cloud_agent_run_config_seed_fields
  UNIQUE(agent_kind, seed_key)           WHERE owner_scope='system'
```

No `validation_status`. No `catalog_version_pinned_at`. No
`is_starter_preset`. No `revision`. Validity is a function of the
current catalog; if a row's `control_values_json` references a
control that no longer exists, that key is ignored at render time
and at run time (see below). No background reconciler.

**Validation:**

```text
At write time (POST / PATCH):
  find catalog_agent = catalog.agents.find(kind == agent_kind)
  validate model_id is an active catalog_agent.session.models[].id
  build allowed_controls from catalog_agent.session.controls[] where
    surfaces.settings or surfaces.automation is true
  exclude the catalog "model" control from control_values_json because
    model_id owns that value
  for each key in control_values_json:
    if key is not in allowed_controls: reject
    if control.valueSource == "inline" and value is not in control.values[].value:
      reject
    if control.valueSource is dynamic, validate with the owning catalog
      helper for that control; do not hard-code dynamic option rules here
  for missing controls:
    fill control.defaultValue when present
    if the catalog later adds required=true and no defaultValue exists:
      reject with field-level error

At read time (selector render):
  load current catalog
  resolve against catalog_agent.session.models[] and session.controls[]
  render only the intersection; ignore stale keys
  surface a small "Config has unused settings" badge if intersection
    is smaller than the row (purely informational)

At run time (use the config):
  intersect again with current catalog (catalog may have moved between
    selector render and dispatch)
  if agent_kind or model_id is no longer in catalog: fail caller with
    typed error agent_run_config_model_unavailable
  fill missing optional controls from current catalog defaults
  if a required control is missing and has no catalog default: fail with
    agent_run_config_missing_required
  otherwise: build the resolved snapshot and proceed
```

The selector and the run-time check share the same intersection
helper:

```text
server/proliferate/server/cloud/agent_run_config/domain/resolve.py
  resolve_runtime_values(catalog, config_row) -> ResolvedAgentRunConfig
  pure function; no I/O
```

**Defaults.** Do not use desktop-local preferences or a vague
organization settings blob for this server-side routing decision. Add
an explicit Cloud table:

```text
cloud_agent_run_config_default
  id                              uuid pk
  owner_scope                     text  'personal' | 'organization'
  owner_user_id                   uuid fk user.id             NULL
  organization_id                 uuid fk organization.id     NULL
  agent_kind                      text NOT NULL
  config_id                       uuid fk cloud_agent_run_config.id
  created_by_user_id              uuid fk user.id             NOT NULL
  created_at, updated_at

  CHECK ck_cloud_agent_run_config_default_owner_fields
  CHECK ck_cloud_agent_run_config_default_agent_kind
  UNIQUE(owner_user_id, agent_kind)      WHERE owner_scope='personal'
  UNIQUE(organization_id, agent_kind)    WHERE owner_scope='organization'
```

Service invariants:

```text
- personal defaults may point at system rows or rows owned by that user
  with usable_in_personal_sandboxes=true
- organization defaults may point at system rows or rows owned by that
  organization with usable_in_shared_sandboxes=true
- archived configs cannot be pinned as new defaults
- archiving a pinned config must either reject or atomically move the
  default to the deterministic system fallback
```

Resolution order when starting a session without an explicit
config_id:

```text
1. caller (e.g. automation) has agent_kind in mind
2. read cloud_agent_run_config_default for the owner:
   - personal owner when target_mode='personal_cloud'
   - organization owner when target_mode='shared_cloud'
3. if missing: fall back to the active system row for that agent_kind
   ordered by system_default_rank asc, then seed_key asc
4. if still missing: fail with agent_run_config_missing_default
```

**Starter presets** are just `cloud_agent_run_config` rows with
`owner_scope='system'` seeded at deploy time. No `is_starter_preset`
column; all active system rows are starter presets. `seed_key` gives
each preset stable deploy-time identity and `system_default_rank`
selects deterministic fallbacks. The selector displays them in a
"Starter presets" group. Operators of self-hosted deployments can edit
the seed list; hosted deployments edit it as part of Proliferate
releases.

**Snapshot pattern (cross-cutting):**

Every consumer that starts a run captures the resolved values at
trigger time. The snapshot is the audit record; later edits to the
config row do not affect in-flight or completed runs.

```text
agent_run_config_snapshot_json
  {
    "config_id":              "<uuid>",
    "config_name":            "ACME Codex review preset",
    "agent_kind":             "codex",
    "model_id":               "gpt-5.5",
    "control_values":         { "effort": "high", ... },   -- post-intersection
    "ignored_keys":           [],                          -- keys present on
                                                              row but absent
                                                              from catalog
    "owner_scope_at_snapshot": "organization",
    "snapshotted_at":         "..."
  }
```

Consumers that snapshot:

```text
automation_run.agent_run_config_snapshot_json             (spec 06)
slack_thread_work.agent_run_config_snapshot_json          (spec 07)
cloud_session_projection.agent_run_config_snapshot_json   (Desktop / Web / Mobile new-chat consumer; spec 04 §5.4)
```

Spec 06 ships the column on `automation_run`. Spec 07 ships the
column on its Slack thread work table. The new-chat path (Desktop /
Web / Mobile) lands the column on `cloud_session` when those flows
become Cloud-mediated — spec 08 or a future "new chat" spec owns
that addition.

API:

```text
GET    /v1/cloud/agent-run-configs
       ?owner_scope=personal|organization|system
       ?agent_kind=
       ?usable_in=personal_sandboxes|shared_sandboxes
       ?status=active|archived
POST   /v1/cloud/agent-run-configs                -- validates against catalog
GET    /v1/cloud/agent-run-configs/{id}
PATCH  /v1/cloud/agent-run-configs/{id}           -- re-validates
DELETE /v1/cloud/agent-run-configs/{id}           -- soft archive

GET    /v1/cloud/agent-run-configs/defaults       -- returns user's pinned defaults
PUT    /v1/cloud/agent-run-configs/defaults/{agent_kind}
       body: { config_id }                         -- pin personal default
GET    /v1/cloud/organizations/{org}/agent-run-configs/defaults
                                                    -- returns org pinned defaults
PUT    /v1/cloud/organizations/{org}/agent-run-configs/defaults/{agent_kind}
       body: { config_id }                         -- admin sets org default
```

Authorization:

```text
- create/edit/archive personal config: owner only
- create/edit/archive org config:      server requires active org role in
                                        organization_admin_roles()
- create/edit/archive system config:   not exposed via API; seed at deploy
- pin personal default:                user is owner
- pin org default:                     server requires active org role in
                                        organization_admin_roles()
```

UI integration (spec 03 §5.4 owns the primitive; spec 06 owns the
page content):

```text
spec 03 sidebar:
  Settings > Agents > Agent Defaults              (pin per agent_kind)
  Settings > Agents > Agent Run Configs           (CRUD list)
                                                  -- new page slot added
                                                     to spec 03 §5.1 alongside
                                                     Agent Defaults

primitive (spec 03 §5.4):
  AgentRunConfigSelector                          consumes this domain
```

Spec 03 IA gains an `agent-run-configs` page slot in the Agents
sidebar group, sibling to `agent-defaults`. Spec 06 fills both pages:

- **Agent Defaults** — per-agent_kind selector that pins which
  config is the user's (or org's) default. No CRUD here; just a
  picker per harness.
- **Agent Run Configs** — the library. Create / edit / archive
  named configs. Filter by owner_scope; show "Starter presets",
  "My configs", "Org configs" groupings. Edit modal shows the
  current catalog model list plus agent-scoped controls so the user
  sees what they're choosing.

The spec 03 IA update (adding the `agent-run-configs` page slot) is
documented here so spec 03 doesn't have to re-open. The row stays
hidden until spec 06 ships this functioning body; no empty pane shell,
stub card, or "coming soon" panel should render.


### 5.4 Scheduler + cursor

Scheduler stays as-is. The cursor pattern on `Automation.next_run_at`
+ UNIQUE `(automation_id, scheduled_for)` on AutomationRun handles
missed ticks idempotently.

Two additions:

```text
- _resolve_due_schedule() also honors automation.owner_scope when
  picking the next run's owner fields (so the AutomationRun row
  inherits owner_scope/user_id/org_id from the Automation).

- on creating an AutomationRun, the scheduler snapshots the
  resolved cloud_agent_run_config at trigger time into
  agent_run_config_snapshot_json. The snapshot is the source of
  truth for that run; later edits to the cloud_agent_run_config row
  do not affect in-flight runs.
```

Scheduled runs continue to require `scheduled_for IS NOT NULL`;
manual runs `scheduled_for IS NULL`.

### 5.5 Execution pipeline — preflight + cascade

The pipeline gets two new stages:

```text
ordered stages (after spec 06):
  resolve_owner_and_profile        (new; replaces resolve_target)
  ensure_git_identity
  preflight_runtime_config         (new)
  preflight_agent_auth             (new)
  materialize_workspace
  materialize_environment          (now carries the runtime config fragment per spec 01)
  start_session
  apply_session_config
  dispatch_prompt
  observe_end_of_turn              (existing)
```

Each new/changed stage:

```text
resolve_owner_and_profile
  if automation.owner_scope == 'personal':
      ensure_personal_sandbox_profile(automation.owner_user_id)
  else:
      ensure_organization_sandbox_profile(automation.organization_id)
      -- fail-fast if shared cloud isn't enabled or the org profile
         is blocked: mark the run failed with
         error_code='shared_cloud_not_ready'
  ensure_primary_profile_target(profile.id)
  set automation_run.sandbox_profile_id = profile.id
  set automation_run.cloud_target_kind_snapshot = target.kind

preflight_runtime_config
  load sandbox_profile_target_state for (profile, target)
  if applied_runtime_config_sequence < current_sequence:
      -- auto-cascade
      enqueue materialize_environment(target_id,
                                       cloud_workspace_id=null yet,
                                       runtime_config fragment)
      automation_run.cascade_attempt += 1
      automation_run.last_cascade_reason = 'runtime_config_stale'
      automation_run.last_cascade_command_id = <id>
      wait for the materialize_environment result
      if applied: continue
      if failed:
        cascade_attempt < max? retry; else fail run with
        error_code='runtime_config_apply_failed'

preflight_agent_auth
  same pattern. Stale -> enqueue refresh_agent_auth_config; wait;
  fail run with error_code='agent_auth_apply_failed' after max
  attempts.

materialize_workspace
  call managed_profile_launch with:
    sandbox_profile_id
    target_id (primary)
    normalized_repo_key
    branch (from repo config snapshot)
    origin='automation'
    visibility = (owner_scope=='personal' ? 'private' : 'shared_unclaimed')
    commandable = true
    default_projection_level = 'live'
    source_kind = 'automation'  (for spec 05 claim)
  set automation_run.cloud_workspace_id and
      automation_run.cloud_workspace_exposure_id from the response
```

Cascade attempt cap:

```text
MAX_CASCADE_ATTEMPTS_PER_RUN = 3       (configurable;
                                        settings.automation_run_cascade_max_attempts)
```

Each cascade enqueue:
- carries `parent_command_id` set to the originating run id (the
  AutomationRun id, not a command id) for audit grouping
- carries `cascade_reason` in the payload
- counts against `automation_run.cascade_attempt`

If the cascade itself fails (e.g. the `materialize_environment`
result is `failed`):

```text
- if cascade_attempt < MAX_CASCADE_ATTEMPTS_PER_RUN: retry with
  fresh revision pin (the desired revision may have moved on)
- else: fail the run with the appropriate
  *_apply_failed error code
```

Idempotency: the executor's claim lease ensures only one executor
processes a given automation_run at a time. Cascade enqueues
include the automation_run id in their idempotency key so retried
ticks collapse.

### 5.6 Workspace creation via `managed_profile_launch`

The current `create_cloud_workspace_for_automation_run` is replaced
by a call to `managed_profile_launch` (spec 04 §5.7) with
automation-specific arguments. The returned tuple carries:

```text
cloud_workspace_id
cloud_workspace_exposure_id
cloud_session_projection_id    (created when start_session arrives;
                                returned as null at workspace stage)
required_runtime_config_revision   pinned from profile current
required_agent_auth_revision       pinned from profile current
```

The automation_run row updates accordingly.

`_raise_org_cloud_not_ready` is no longer called from the
automation path. Org readiness is now resolved by
`ensure_organization_sandbox_profile`; failure surfaces as a typed
`shared_cloud_not_ready` error in the run.

### 5.7 Exposure defaults

```text
owner_scope='personal'   visibility='private',
                          commandable=true,
                          default_projection_level='live'

owner_scope='organization'  visibility='shared_unclaimed',
                             commandable=true,
                             default_projection_level='live'
```

A team automation's workspace lands as `shared_unclaimed`. Any org
member can claim via spec 05's `POST /v1/cloud/workspaces/{id}/claim`
endpoint. The claim is one-way; the spec-05 audit applies.

Note: spec 05's UI flow ("Claimed by Alice on Mar 12. To take over,
archive and recreate.") is the canonical recovery path if a team
member claims by accident.

### 5.8 Local automations

`target_mode='local'` automations:

- Allowed only when `owner_scope='personal'`.
- Execute on Desktop via the existing local executor service
  (`server/automations/local_executor.py` +
  `apps/desktop/src/hooks/access/cloud/automations/use-local-automation-run-claims.ts`).
- Do not call `ensure_personal_sandbox_profile` (no cloud profile
  involved) and do not preflight runtime config / agent auth (the
  local Desktop AnyHarness handles its own state).
- Still emit AutomationRun rows with the new `target_mode` enum
  value; the preflight stages are skipped via an early branch.

Org-scoped automations cannot be `target_mode='local'` (enforced by
the CHECK constraint in §5.1).

### 5.9 API surface

```text
Existing (renamed / parameter changes):
  GET    /v1/cloud/automations          -- supports
                                            ?owner_scope=personal|organization
                                            filter; org members see team
                                            automations even if not creator
  POST   /v1/cloud/automations          -- body adds owner_scope,
                                            cloud_agent_run_config_id,
                                            target_mode
  GET    /v1/cloud/automations/{id}
  PATCH  /v1/cloud/automations/{id}
  DELETE /v1/cloud/automations/{id}
  POST   /v1/cloud/automations/{id}/runs   -- manual trigger
  GET    /v1/cloud/automations/{id}/runs

New:
  GET    /v1/cloud/agent-run-configs
  POST   /v1/cloud/agent-run-configs
  GET    /v1/cloud/agent-run-configs/{id}
  PATCH  /v1/cloud/agent-run-configs/{id}
  DELETE /v1/cloud/agent-run-configs/{id}

Worker (unchanged):
  POST   /v1/cloud/worker/automation-claims/...  (existing executor lease;
                                                   unrelated to user claim
                                                   spec 05)
```

Authorization:

```text
- creating a personal automation: any authenticated user
- creating a team automation: useIsAdmin(org_id) only
  (per spec 03 admin gating)
- editing a team automation: same admin gate
- triggering a manual run of a team automation: any org member
  with org_role in {admin, member, owner}; reads existing
  membership table
```

## 6. Files To Change

Server (Python):

```text
server/proliferate/db/models/automations.py
  - Automation: add owner_scope, owner_user_id, organization_id,
                created_by_user_id, cloud_agent_run_config_id
  - Automation: drop agent_kind/model_id/mode_id/reasoning_effort,
                cloud_target_id
  - Automation: rename execution_target -> target_mode and update
                enum
  - AutomationRun: same ownership fields; add sandbox_profile_id,
                   cloud_workspace_exposure_id,
                   agent_run_config_snapshot_json,
                   cascade_attempt, last_cascade_command_id,
                   last_cascade_reason
  - AutomationRun: drop agent_*_snapshot columns
  - update CHECKs

server/proliferate/db/models/cloud/agent_run_config.py            (new)
  CloudAgentRunConfig

server/alembic/versions/<NEW>_automations_v2.py
  - all of the above; one-PR replacement

server/proliferate/db/store/automations.py
  - extend snapshot dataclasses
  - new helpers: load_automation_for_org, list_automations_for_owner

server/proliferate/db/store/cloud_agent_run_config.py            (new)

server/proliferate/server/automations/
  service.py            authorization + validation now branches on
                        owner_scope; create_team_automation gated by
                        useIsAdmin
  api.py                add owner_scope to request/response;
                        accept cloud_agent_run_config_id
  models.py             snapshot dataclasses
  domain/policy.py      pure invariants for owner_scope/target_mode
  domain/cascade.py     (new) cascade attempt math (pure)
  worker/scheduler.py   inherits owner fields onto AutomationRun;
                        snapshots agent_run_config at trigger
  worker/cloud_execution/pipeline.py
                        new stages: resolve_owner_and_profile,
                        preflight_runtime_config, preflight_agent_auth
  worker/cloud_execution/stages/profile.py    (new)
                        ensure_*_sandbox_profile,
                        ensure_primary_profile_target,
                        wraps spec-00 helpers
  worker/cloud_execution/stages/preflight_runtime_config.py (new)
                        cascade enqueue + wait + retry
  worker/cloud_execution/stages/preflight_agent_auth.py     (new)
                        same shape
  worker/cloud_execution/stages/target.py
                        thin: just resolve primary target from profile
  worker/cloud_execution/stages/workspace.py
                        call managed_profile_launch with
                        origin='automation', visibility derived from
                        owner_scope, source_kind='automation'
  worker/cloud_execution/commands.py
                        thread cloud_workspace_id, sandbox_profile_id,
                        required_*_revision into enqueued commands

server/proliferate/server/cloud/agent_run_config/                (new)
  api.py, service.py, models.py, access.py, domain/policy.py

server/proliferate/server/cloud/workspaces/service.py
  - delete or replace create_cloud_workspace_for_automation_run;
    automations call managed_profile_launch directly
  - delete _raise_org_cloud_not_ready (now handled by
    ensure_organization_sandbox_profile failure)

server/proliferate/config.py
  - automation_run_cascade_max_attempts  default 3
```

Desktop:

```text
apps/desktop/src/hooks/access/cloud/automations/
  use-automations.ts                              extend response shape
  use-automation-mutations.ts                     accept owner_scope +
                                                   cloud_agent_run_config_id

apps/desktop/src/hooks/access/cloud/agent-run-configs/  (new)
  use-agent-run-configs.ts
  use-agent-run-config-mutations.ts
  query-keys.ts

apps/desktop/src/components/automations/
  editor/AutomationEditorModal.tsx
    - new "Owner" toggle (Personal | Team), gated by useIsAdmin
    - replace AutomationModelPicker + AutomationModePicker with
      AgentRunConfigSelector primitive (spec 03 §5.4)
    - keep AutomationTargetPicker but reduce to target_mode toggle
      (local vs personal_cloud, or shared_cloud for team)
    - show RuntimeReadinessPanel (spec 03) for the resolved
      sandbox_profile when target_mode != 'local'
  detail/AutomationDetailContent.tsx
    - show owner_scope badge ("Team" / "Personal")
    - show last cascade reason if any
    - link to claim flow for shared_unclaimed runs (spec 05)
  timeline/AutomationRunTimeline.tsx
    - cascade rows collapsed under the parent start_session row
      using parent_command_id

apps/desktop/src/pages/AgentRunConfigsPage.tsx                        (new)
  list + edit + archive cloud_agent_run_config rows
  -- placement: nested under Settings > Agents > Agent Defaults
     (spec 03 §5.1)
```

SDK regeneration:

```text
cloud/sdk/src/client/automations.ts                              extend
cloud/sdk/src/client/agent-run-configs.ts                        (new)
cloud/sdk/src/types/generated.ts                                  regen
```

## 8. Acceptance Criteria

1. `Automation.owner_scope` exists with CHECK enforcing the
   personal vs organization mutex. Team automations require
   `organization_id`; personal require `owner_user_id`.
2. `Automation.target_mode` is `local | personal_cloud | shared_cloud`
   with CHECK enforcing personal-only for `local` and personal_cloud,
   and organization-only for `shared_cloud`.
3. `cloud_agent_run_config` table exists with owner_scope,
   usable_in_*_sandboxes, and CRUD endpoints.
4. `Automation.cloud_agent_run_config_id` is NOT NULL; inline
   agent config columns are removed.
5. `AutomationRun.sandbox_profile_id`,
   `cloud_workspace_exposure_id`,
   `agent_run_config_snapshot_json`, `cascade_attempt`,
   `last_cascade_command_id`, `last_cascade_reason` exist.
6. Executor pipeline calls `ensure_*_sandbox_profile` based on
   automation owner_scope, then `ensure_primary_profile_target`.
   Org-scoped runs fail-fast with `shared_cloud_not_ready` if the
   profile can't be ensured.
7. `preflight_runtime_config` cascades on stale: enqueues
   `materialize_environment`, waits for applied, retries up to
   `automation_run_cascade_max_attempts` (default 3), then fails
   the run with `runtime_config_apply_failed`.
8. `preflight_agent_auth` cascades on stale: enqueues
   `refresh_agent_auth_config`, same shape, fails with
   `agent_auth_apply_failed` after max attempts.
9. Cascade commands carry `parent_command_id` referencing the
   automation_run id (or the originating command id) and
   `cascade_reason` in their payload, for audit grouping.
10. Workspace creation calls `managed_profile_launch` (spec 04).
    `create_cloud_workspace_for_automation_run` and
    `_raise_org_cloud_not_ready` are deleted.
11. Personal-scope runs produce
    `cloud_workspace_exposure.visibility='private'`,
    `commandable=true`. Team-scope runs produce
    `visibility='shared_unclaimed'`, `commandable=true`. Both have
    `default_projection_level='live'`, `origin='automation'`,
    `source_kind='automation'`.
12. Team-automation creation requires admin (useIsAdmin gate);
    triggering a manual run of a team automation is open to any
    org member.
13. Scheduled runs snapshot `cloud_agent_run_config` at trigger
    time into `agent_run_config_snapshot_json`. Editing the
    underlying `cloud_agent_run_config` row does not affect
    in-flight runs.
14. `cloud_agent_run_config.usable_in_shared_sandboxes=false`
    blocks selection on team automations. The selector validates
    at write time; the server validates at run time.
15. `target_mode='local'` is permitted only when
    `owner_scope='personal'`. Validation in service.py.
16. Desktop `AutomationEditorModal` shows the Owner (Personal /
    Team) toggle. Team toggle is disabled with tooltip when
    `useIsAdmin` returns false.
17. Desktop `AutomationEditorModal` uses
    `AgentRunConfigSelector` (spec 03 primitive) instead of the
    legacy `AutomationModelPicker` + `AutomationModePicker`. Old
    pickers are deleted.
18. Desktop `AutomationRunTimeline` collapses cascade rows under
    the parent `start_session` row via `parent_command_id`.
19. Spec 04's `_validate_runtime_config_preflight` returns
    `runtime_config_stale` for automation-source commands; the
    automation runner catches this typed error and cascades
    (spec 04 fail-fast default still holds for other sources).
20. No automation-specific MCP/auth/model surface remains. A grep
    for legacy `automation_run.agent_kind_snapshot` etc. returns no
    hits.

## 9. Verification / Tests

Server:

```bash
cd server
uv run pytest -q
```

Targeted tests:

```text
server/tests/automations/test_owner_scope_check.py
server/tests/automations/test_target_mode_owner_check.py
server/tests/automations/test_team_automation_admin_gated.py
server/tests/automations/test_cloud_agent_run_config_crud.py
server/tests/automations/test_run_config_usable_in_shared_validation.py
server/tests/automations/test_scheduler_snapshots_agent_run_config.py
server/tests/automations/test_pipeline_resolve_owner_and_profile.py
server/tests/automations/test_pipeline_runtime_config_cascade.py
server/tests/automations/test_pipeline_agent_auth_cascade.py
server/tests/automations/test_cascade_attempt_capped.py
server/tests/automations/test_workspace_uses_managed_profile_launch.py
server/tests/automations/test_personal_run_creates_private_exposure.py
server/tests/automations/test_team_run_creates_shared_unclaimed_exposure.py
server/tests/automations/test_shared_cloud_not_ready_fails_fast.py
server/tests/automations/test_local_only_personal.py
server/tests/automations/test_run_inherits_owner_fields.py
server/tests/automations/test_cascade_commands_carry_parent_id.py
```

Desktop:

```bash
cd apps/desktop && pnpm test -- --run && pnpm typecheck
```

Targeted Desktop tests:

```text
apps/desktop/src/components/automations/editor/AutomationEditorModal.test.tsx
  - owner toggle visible; team disabled for non-admin
  - AgentRunConfigSelector renders configs
  - target_mode picker offers correct values per owner_scope
apps/desktop/src/components/automations/timeline/AutomationRunTimeline.test.tsx
  - cascade rows collapse under parent
apps/desktop/src/hooks/access/cloud/agent-run-configs/use-agent-run-configs.test.ts
apps/desktop/src/pages/AgentRunConfigsPage.test.tsx
```

Manual smoke:

```text
1. Personal automation with stale runtime config
   - user creates personal automation, target_mode='personal_cloud'
   - admin publishes a new MCP causing the profile's
     current runtime config sequence to advance
   - scheduler triggers the automation
   - run pipeline: resolve_owner_and_profile -> preflight_runtime_config
     observes stale -> cascade enqueues materialize_environment
   - materialize_environment succeeds
   - run proceeds to start_session; succeeds
   - run.cascade_attempt = 1; last_cascade_reason = 'runtime_config_stale'

2. Team automation with shared cloud not enabled
   - admin attempts to create a team automation, but
     ensure_organization_sandbox_profile fails (org has not enabled
     shared cloud; spec 00 invariant)
   - run pipeline fails immediately with
     error_code='shared_cloud_not_ready'

3. Team automation happy path
   - admin enables shared cloud
   - admin creates team automation with owner_scope=organization,
     target_mode=shared_cloud, cloud_agent_run_config_id pointing at
     a config with usable_in_shared_sandboxes=true
   - scheduler triggers; pipeline runs
   - workspace exposure: visibility='shared_unclaimed', commandable=true,
     origin='automation', source_kind='automation'
   - run dispatches successfully
   - any org member can claim via POST /workspaces/{id}/claim
   - after claim, the claimer can use Cloud-mediated APIs (or
     Desktop direct-attach per spec 05) to continue the work

4. Stale agent auth recovery
   - org rotates Bedrock pool; sandbox_profile_target_state
     applied_agent_auth_revision falls behind
   - next team automation tick: cascade enqueues
     refresh_agent_auth_config; succeeds; start_session proceeds

5. Cascade cap
   - simulate persistent materialize_environment failure
   - cascade_attempt increments 1, 2, 3
   - run fails with error_code='runtime_config_apply_failed'
   - subsequent ticks treat this run as terminal; next scheduled
     run triggers a fresh attempt

6. Local automation
   - personal automation, target_mode='local'
   - pipeline skips preflight stages (no managed cloud)
   - local executor picks up the run; runs against Desktop AnyHarness
```
