## High level notes / mental model broadly

Dispatch and migration are different product primitives.

```text
Dispatch / remote access
  make an existing workspace/session visible and controllable through Cloud
  without moving runtime state.

Migration / move
  transfer runnable workspace/session state to another target.
```

Do not call both things "sync." Sync is an implementation detail and currently
means too many things.

The runtime ownership split:

```text
AnyHarness
  execution truth: workspace/session SQLite, event ordering, prompt queue,
  local tools, filesystem, agent processes.

Proliferate Worker
  target-side bridge: leases Cloud commands, calls local AnyHarness, tails
  events, uploads projections, applies target materialization.

Cloud
  product/control truth: access policy, exposure/projection admission,
  command queue, snapshots, audit, claims, migration jobs.
```

Every target that Cloud can control should have a worker:

```text
managed cloud sandbox
SSH target
desktop dispatch target
shared sandbox
```

Desktop can still keep the fast local path:

```text
Desktop -> AnyHarness directly
```

Cloud/mobile/web/Slack use the Cloud path:

```text
Client -> Cloud -> Worker -> AnyHarness
```

If a workspace/session is exposed, both paths can coexist:

```text
Desktop sends prompt directly.
Cloud sends prompt through worker.
Both reach the same AnyHarness session queue.
Worker projects resulting events back to Cloud.
```

There is no second conversation and no copy. AnyHarness defines accepted command
order.

## Basic UX / high level

Product verbs:

```text
Continue remotely
  expose this workspace/session to Cloud, upgrade projection to live, and allow
  Cloud commands if policy allows.

Disable remote access
  pause/revoke exposure or commandability. Do not delete local runtime state.

Open on mobile
  requires active exposure/projection. If missing, create exposure first.

Share with team
  expose as org-visible work, usually shared_unclaimed until claimed.

Claim
  assign shared work to one user and narrow control. Projection mechanics do
  not change.

Move
  transfer runnable state to another target and usually make the source
  read-only/archived after success.
```

Do not support "copy to" as a normal UX. If users want the work elsewhere, they
move it. If they only want remote control, they expose it.

Default visibility:

```text
Local Desktop-only workspace
  not visible to Cloud by default

Desktop workspace with Continue remotely enabled
  visible/control-ready through Cloud while worker is online

Personal cloud workspace
  exposed by default to the owner

Slack/team/automation workspace
  exposed by default as shared_unclaimed org work

Claimed shared workspace
  visible/control-ready for claimed user, admin audit/manage, and direct
  Desktop attach only through scoped claim token
```

## Workspace UI facts and actions

The UI should show workspace/session facts as separate axes. Do not compress
these into one overloaded workspace type.

Facts to expose:

```text
Origin
  manual_desktop | manual_web | manual_mobile | automation | slack | api

Runtime location
  local_desktop | personal_managed_cloud | shared_managed_cloud | ssh_target

Runtime target
  target_id
  target_display_name
  target_owner_scope: personal | organization
  target_online_state: online | offline | starting | stopping | unknown

Remote access
  not_exposed | viewable | controllable | paused | stale | failed

Ownership / access
  personal | shared_unclaimed | claimed | admin_managed | archived

Claim
  claimed_by_user_id
  claimed_at

Lifecycle
  normal | moving | source_cleanup_pending | repair_required |
  archived | deleted

Activity
  created_at
  last_active_at
  last_projected_at
```

Origin must survive claiming. Claiming changes access/control, not provenance.

Examples:

```text
Slack-created shared workspace before claim
  origin = slack
  runtime location = shared_managed_cloud
  ownership/access = shared_unclaimed
  remote access = controllable

Slack-created shared workspace after claim
  origin = slack
  runtime location = shared_managed_cloud
  ownership/access = claimed
  claim = claimed_by_user_id + claimed_at
  remote access = controllable for claimer, policy-limited for others

Desktop workspace made available to web/mobile
  origin = manual_desktop
  runtime location = local_desktop
  remote access = controllable

iOS-created workspace
  origin = manual_mobile
  runtime location = personal_managed_cloud or selected target
  remote access = controllable from creation
```

Operations to expose:

```text
Enable remote access
  create or resume Cloud exposure/projection for this workspace/session.

Disable remote access
  pause/revoke exposure or commandability. Do not delete runtime state.

Open remotely
  open web/mobile view if exposure exists; otherwise prompt to enable remote
  access first.

Claim workspace
  assign shared_unclaimed work to the current user and narrow control.

Move workspace
  export/import runnable state to another accessible target.

Archive workspace
  hide from active lists but retain projection/history according to policy.

Delete workspace
  delete runtime state and Cloud rows where policy allows.

Repair move / retry cleanup
  only visible when lifecycle is repair_required or source_cleanup_pending.
```

Operations should be gated by facts:

```text
Enable remote access
  requires target has enrolled worker and user has permission.

Disable remote access
  requires user can manage exposure.

Claim workspace
  requires shared_unclaimed org work and eligible current user.

Move workspace
  requires source ownership/control, destination target access, no active turn,
  and AnyHarness export/import compatibility.

Delete workspace
  requires lifecycle is not moving unless using explicit repair cleanup.
```

Suggested surfaces, not final UX:

```text
Workspace header/status area
  origin, runtime target, remote access state, claim state

Workspace/session menu
  enable/disable remote access, open remotely, claim, move, archive/delete

Details popover or inspector
  exact target, provenance, created/last active/projected timestamps, current
  move/cleanup warnings
```

## Migration editor / UI

Migration needs a first-class editor because "move runnable state" is riskier
than "continue remotely."

Entry points:

```text
Workspace menu
  Move to another target
  Continue remotely
  Disable remote access

Session header
  Move this conversation/workspace
  Open remotely

Claimed shared work
  Move to my local Desktop
  Move to my personal cloud

Target/workspace settings
  Default move destination
  Retention after move
```

The migration editor should ask only for:

```text
destination target
  local Desktop | personal cloud | shared cloud if allowed | SSH target

scope
  whole workspace, including sessions
  current session only if we later support session-only export

source handling
  archive source after success
  keep source read-only for N days
  delete source after verified move, only where policy allows

remote access after move
  expose destination to Cloud
  make destination read-only from Cloud
  keep destination local/private
```

The editor should not expose implementation choices like export format,
artifact bucket, event cursor, or raw AnyHarness DB details.

Before starting, show a validation preview:

```text
Source
  target online/offline
  active turn? pending interaction?
  uncommitted git changes?
  unsaved files?
  sessions included
  approximate size

Destination
  target online/available
  repo access
  disk/storage availability
  agent auth readiness
  MCP/skill runtime config readiness
  branch/worktree conflict status

Policy
  user allowed to move this work?
  claimed/shared work restrictions
  billing/retention impact
```

Default behavior:

```text
active turn running
  do not move by default
  offer "wait for turn" or "cancel then move"

pending user interaction
  allow move only if pending request can be transferred
  otherwise require resolve/cancel first

dirty git state
  preserve it
  never require user to manually commit/stash just to move

source cleanup
  only after destination verifies successfully
```

Progress UI:

```text
Planning
Preparing source
Saving git/worktree state
Exporting runtime state
Transferring
Preparing destination
Importing
Verifying
Switching over
Done
```

Failure UI should be explicit:

```text
failed before switchover
  source remains usable
  show retry / cancel / view details

failed after destination import but before source revoke
  both states may exist temporarily
  user can retry verification or choose which side remains active

failed after source revoke
  rare, high-severity state
  show recovery action and support/debug bundle
```

The editor should name the product operation as "Move", not "Copy" or "Sync".

## Migration runtime contract

The migration primitive is:

```text
source AnyHarness target exports
destination AnyHarness target imports
Cloud records the operation and cleanup obligations
source is deleted only after destination import verifies
```

Cloud is not one of the two runtime targets. The runtime targets are:

```text
source_target_id + source_anyharness_workspace_id
destination_target_id + destination_anyharness_workspace_id
```

Desktop, or eventually a local worker, can execute the move when it can connect
to both targets. Cloud remains the durable ledger and UI truth.

Do not assume AnyHarness workspace IDs stay the same. The same product
workspace may have different runtime workspace IDs before and after move.

AnyHarness archive contents:

```text
workspace git delta relative to HEAD
deleted workspace paths
session rows
session event/transcript rows
live config snapshot
pending config changes
pending prompts
prompt attachments
subagent links/completions/wake schedules
agent-native artifacts
```

Agent-native artifacts are the files needed for native agent continuation, for
example Claude project JSONL files and Codex rollout/session files.

The archive does not move sandbox-scoped capability state:

```text
MCP runtime config
skills
agent auth config
credential caches
terminal processes/history
Cloud projection rows
```

Those belong to the destination sandbox/target. The destination target must
already have the right MCPs, skills, and agent auth configured.

Destination workspace creation is separate from archive import:

```text
1. prepare empty destination workspace at same repo/base commit
2. import archive into that workspace
```

Import must fail closed if the destination is not safe:

```text
destination HEAD does not equal archive base commit
destination already has sessions
destination has active terminals
destination setup is still running
session IDs collide
archive paths are unsafe
subagent graph is partial
archive is over size limits
```

Product preflight can stay optimistic. The UI only needs to disable obvious bad
cases such as active turns, pending interactions, unreachable targets, or an
existing move. AnyHarness import/export still owns the hard correctness checks.

## Full DB models + schemas

Cloud-owned exposure:

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

Cloud-owned session projection:

```text
cloud_session_projection
  id
  exposure_id
  target_id
  cloud_workspace_id
  anyharness_workspace_id
  cloud_session_id
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

Worker local cursor, not policy:

```text
worker_projection_cursor
  exposure_id
  session_projection_id
  anyharness_workspace_id
  anyharness_session_id
  projection_level
  last_uploaded_seq
  last_ack_seq
  status
```

Cloud command routing additions:

```text
cloud_command
  id
  target_id
  workspace_id
  session_id
  exposure_id
  session_projection_id
  exposure_revision
  required_projection_level
  kind
  payload_json
  status
  result_json
```

Migration / move job:

```text
workspace_move
  id
  source_target_id
  source_cloud_workspace_id
  source_anyharness_workspace_id
  destination_target_id
  destination_cloud_workspace_id
  destination_anyharness_workspace_id
  requested_by_user_id
  executor_kind: desktop | worker
  executor_instance_id
  lease_expires_at
  last_heartbeat_at
  owner_scope: personal | organization
  organization_id
  move_kind: local_to_cloud | cloud_to_local | target_to_target | shared_to_personal
  status: created | preflighted | source_frozen | destination_prepared |
          import_committed | cutover_committed | source_cleanup_pending |
          completed | failed | repair_required | cancelled
  canonical_side: source | destination
  source_exposure_id
  destination_exposure_id
  source_archive_summary_json
  destination_import_summary_json
  error_code
  error_message
  created_at
  started_at
  completed_at
```

Move cleanup obligations:

```text
workspace_move_cleanup_item
  id
  workspace_move_id
  item_kind: anyharness_workspace | cloud_workspace | cloud_exposure |
             cloud_session_projection | cloud_transcript_projection
  target_id
  object_id
  status: pending | completed | failed
  attempt_count
  error_code
  error_message
  started_at
  completed_at
```

Important distinction:

```text
cloud_workspace_exposure / cloud_session_projection
  visibility/control/read model

workspace_move
  runnable state transfer
```

Move states mean:

```text
created
  Cloud recorded intent; no runtime mutation yet.

preflighted
  source/destination look reachable and allowed.

source_frozen
  source AnyHarness rejects new mutable work for this workspace.

destination_prepared
  destination empty workspace exists at the expected base commit.

import_committed
  destination AnyHarness successfully installed the archive.
  There may now be two valid runtime copies.

cutover_committed
  Cloud product ownership/projection now points at destination.
  Destination is canonical.

source_cleanup_pending
  move succeeded; old source/deprecated Cloud rows still need deletion.

completed
  destination canonical and all required cleanup finished.

failed
  move failed before cutover; source is canonical or was restored.

repair_required
  executor disappeared or cleanup/import reached an ambiguous checkpoint.
  User/system must resume, roll back, or clean up explicitly.
```

`canonical_side` must stay `source` until `cutover_committed`. After
`cutover_committed`, `canonical_side` must stay `destination`; source cleanup
is no longer allowed to roll the move back silently.

## End to end flows through the product

Continue a local Desktop chat remotely:

1. User clicks Continue remotely in Desktop.
2. Desktop/Cloud ensures local worker is enrolled as a desktop dispatch target.
3. Cloud creates `cloud_workspace_exposure`.
4. Cloud creates or upgrades `cloud_session_projection` to `live`.
5. Worker backfills bounded workspace/session metadata and transcript events.
6. Web/mobile opens the Cloud projection.
7. Desktop can keep using direct AnyHarness.
8. Web/mobile can send prompts through Cloud if `commandable = true`.
9. Worker uploads all AnyHarness events for that active projection.

Open a cloud-created workspace from mobile:

1. Cloud-created personal/team work already has exposure by default.
2. Mobile loads the Cloud workspace/session projection.
3. Mobile sends prompt through Cloud command.
4. Worker applies prompt to AnyHarness.
5. Worker projects events back to Cloud.

Desktop and Cloud both send prompts:

1. Session projection is `live` and commandable.
2. Desktop sends prompt directly to AnyHarness.
3. Web/mobile sends prompt through Cloud command.
4. AnyHarness accepts/rejects/queues each prompt in runtime order.
5. Worker uploads resulting events.
6. Cloud and Desktop eventually show the same ordered transcript.

Disable remote access:

1. User disables remote access.
2. Cloud pauses/revokes exposure or sets `commandable = false`.
3. Worker stops tailing after it observes revoked/paused projection.
4. Cloud remains with retained snapshots according to retention policy.
5. AnyHarness local workspace/session continues unchanged.

Move local -> managed cloud:

1. User chooses Move to managed cloud.
2. Cloud creates `workspace_move`.
3. Executor heartbeats with `executor_instance_id`.
4. Source AnyHarness basic preflight passes.
5. Cloud marks `preflighted`.
6. Source AnyHarness runtime state is set to frozen.
7. Cloud marks `source_frozen`.
8. Destination target prepares an empty workspace at the same repo/base commit.
9. Cloud creates destination `cloud_workspace` row if needed.
10. Cloud marks `destination_prepared`.
11. Source AnyHarness exports the workspace archive.
12. Destination AnyHarness imports the archive.
13. Cloud marks `import_committed` and records import summary.
14. Cloud performs cutover:
    - destination becomes canonical;
    - destination exposure/projection is created or activated;
    - old source Cloud exposure/projection rows become cleanup obligations.
15. Cloud marks `cutover_committed`.
16. Source AnyHarness destroys the old source workspace.
17. Cloud deletes old Cloud workspace/exposure/projection/transcript rows where
    they represented the old location.
18. Cloud marks `completed`.

Move cloud/shared -> local:

1. User must have permission:
   - personal owner, or
   - claimed shared work, or
   - admin-approved transfer.
2. Cloud creates `workspace_move`.
3. Source AnyHarness freezes the cloud/shared workspace.
4. Destination local target prepares an empty workspace at the same repo/base
   commit.
5. Source AnyHarness exports the archive.
6. Local AnyHarness imports the archive.
7. Cloud marks destination canonical.
8. Old cloud/shared exposure/projection rows are deleted, archived, or narrowed
   according to claim/share policy.
9. Source cloud/shared workspace is destroyed if policy allows.

Failure handling:

```text
before source_frozen
  mark failed; no runtime cleanup needed.

after source_frozen, before destination_prepared
  unfreeze source; delete partial destination if created; mark failed.

after destination_prepared, before import_committed
  source remains canonical; delete partial destination; unfreeze source.

during import
  source remains canonical; destination is disposable unless import succeeded
  idempotently for the same operation id.

after import_committed, before cutover_committed
  two runtime copies may exist; source is still canonical unless cutover happens.
  retry cutover or explicitly roll back by deleting destination.

after cutover_committed
  destination is canonical. Do not silently roll back.
  retry source/Cloud cleanup until complete.

source cleanup failure
  move is user-successful but cleanup is pending/failed.
  show cleanup repair, not generic move failure.

executor lease expires
  mark repair_required. Do not let a different Desktop resume blindly unless
  user chooses resume/rollback/cleanup.
```

Cloud projections are not the migration source of truth. The canonical imported
chat history comes from AnyHarness `session_events` in the archive. Existing
Cloud message/projection rows for the old source are cleanup/reprojection data.

Shared work claim:

1. Slack/team/automation creates shared_unclaimed exposure.
2. Any org member can view/control through Cloud before claim if policy allows.
3. User claims it.
4. Cloud updates exposure visibility/control to claimed.
5. Projection continues.
6. Desktop direct attach requires scoped claim token.

## Specific hooks

Cloud APIs:

```text
POST /cloud/workspaces/{workspace_id}/exposure
PATCH /cloud/workspace-exposures/{exposure_id}
POST /cloud/sessions/{session_id}/projection
POST /cloud/commands
POST /cloud/workspaces/{workspace_id}/move
GET  /cloud/workspace-moves/{move_id}
```

Worker commands:

```text
backfill_exposed_workspace
  current implementation may still be named sync_existing_workspace

materialize_workspace
  create/resolve target-side AnyHarness workspace identity

start_session / send_prompt / resolve_interaction / update_session_config
  normal Cloud-mediated control

export_workspace_state
  future migration command

import_workspace_state
  future migration command
```

AnyHarness APIs used by worker:

```text
GET  /v1/workspaces
GET  /v1/sessions?workspace_id=...
GET  /v1/sessions/{session_id}/events?after_seq=...
POST /v1/sessions/{session_id}/prompt
POST /v1/workspaces/resolve
POST /v1/workspaces/worktrees
PUT  /v1/workspaces/{workspace_id}/mobility/runtime-state
POST /v1/workspaces/{workspace_id}/mobility/export
POST /v1/workspaces/{workspace_id}/mobility/install
POST /v1/workspaces/{workspace_id}/mobility/destroy-source
```

Existing AnyHarness mobility APIs are the core. Future work should harden or
rename them only if the contract becomes target-to-target rather than
Desktop-driven:

```text
POST /v1/repo-roots/{repo_root_id}/mobility/prepare-destination
POST /v1/workspaces/{workspace_id}/mobility/preflight
```

Do not infer migration by scraping local SQLite from outside AnyHarness.
AnyHarness owns export/import of its runtime database.

## Specific one offs

- No exposure means no worker projection.
- No worker sync-all as a user-facing path.
- Projection is not a backup of the whole runtime database.
- Projection can be read-only.
- Commandability requires active exposure and active projection.
- Desktop direct access is allowed for local-owned work, or for shared claimed
  work with a scoped direct-access token.
- Web/mobile never receive direct AnyHarness tokens.
- Cloud must not call AnyHarness directly on private targets.
- Moving state should leave absolutely nothing important behind when possible:
  transcript, git state, worktree state, pending interactions, and enough
  runtime state to continue.
- Move failure should leave the source usable unless the final revoke/source
  cleanup step has already completed.
- MCPs, skills, and agent auth are sandbox/target configuration. They are not
  migrated with the workspace archive.
- If the old workspace was Cloud-visible, the move must delete or rewrite its
  old Cloud exposure/projection rows after cutover.
- If the old workspace was not Cloud-visible, no Cloud projection cleanup is
  required.
- Import/export should use an operation id so destination import is idempotent
  for retries.

## Deeper concepts

Exposure answers:

```text
Should Cloud know this workspace/session exists?
```

Projection answers:

```text
How much of it should Cloud store/render?
```

Commandability answers:

```text
Can Cloud-mediated clients act on it?
```

Claiming answers:

```text
Which user controls shared work?
```

Migration answers:

```text
Where does the runnable workspace/session live now?
```

These must remain separate or the product becomes confusing and unsafe. The
main mistake to avoid is making worker discovery the admission model:

```text
bad:
  worker sees workspace -> uploads it

good:
  Cloud exposure exists -> worker projects it
```
