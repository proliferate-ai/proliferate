# 10 — Migration / Move Runnable State

Status: implementation-ready spec.

Date: 2026-05-20.

Depends on: [`00-sandbox-foundation.md`](00-sandbox-foundation.md),
[`04-cloud-running-alignment.md`](04-cloud-running-alignment.md),
[`05-claiming.md`](05-claiming.md),
[`08-web-mobile-dispatch.md`](08-web-mobile-dispatch.md).

Migration moves runnable workspace/session state between targets.
Cloud is the durable ledger, not one of the runtime targets;
AnyHarness on each side owns export and import. A partial system
already ships for local↔cloud. Spec 10 generalizes the directions,
adds explicit cleanup tracking and a `repair_required` state, wires
the move into the spec 04 exposure model, and exposes a Desktop
"Move to another target" verb.

## 1. Purpose & Scope

In scope:

- Generalize `CloudWorkspaceHandoffOp.direction` beyond
  `local_to_cloud` / `cloud_to_local` to also support
  `shared_to_personal` (claimed shared cloud work → personal
  cloud / local), `shared_to_local`, `personal_to_shared` (where
  product policy allows), and `cloud_to_cloud` (e.g. personal
  cloud → SSH target).
- New `cloud_workspace_move_cleanup_item` table: one row per
  cleanup obligation (delete source AnyHarness workspace,
  archive old `cloud_workspace`, revoke old
  `cloud_workspace_exposure`, etc.). Retryable. Per-item
  status + audit.
- Explicit `canonical_side` invariant via a new column on
  `CloudWorkspaceHandoffOp`. After cutover (`finalize`),
  source cleanup cannot roll the move back silently.
- `repair_required` lifecycle state for moves whose executor
  lease expired mid-flight or whose cleanup reached an ambiguous
  checkpoint. UI surfaces a "Repair move" action.
- Wire move into spec 04's exposure model: source exposure is
  archived; destination exposure is created with the original
  visibility (`private` for personal moves; if claimed shared
  work is moved, the destination inherits `private` because
  claim doesn't transfer).
- Desktop "Move to another target" verb in the workspace context
  menu (spec 08 deferred this; spec 10 turns it on).
- Migration editor UI: destination picker + risk/preflight
  summary + progress + failure UX.
- Cleanup of old Cloud rows after cutover (workspace, exposure,
  projection) — today the mobility flow does not touch them.
- Direct-attach JWT (spec 05) used for source/destination when
  the move involves a shared-cloud sandbox the user isn't local
  to.

Out of scope:

- Worker-driven migration without a Desktop executor in the
  loop. V1 requires the user's Desktop to be online to drive
  the move; "headless" migration (e.g. admin moves a workspace
  while no user is online) is deferred. Spec 10 does not add
  worker command kinds for export/import.
- Cross-organization moves. Workspaces stay within their
  organization. Cross-org transfer is a different operation
  (re-create) and not on the V1 roadmap.
- Multi-claimer team-session sharing or move-to-shared by a
  non-admin. Spec 05's claim is single-user and irreversible;
  spec 10 honors that.
- Snapshot/fork migrations. Spec 10 moves runnable state;
  snapshot/fork is rollback/branching and out of scope.
- MCP/skill runtime config or agent auth as part of the move
  archive. The destination target is the source of truth for
  capability state. Archive carries workspace + session
  runnable state only.
- "Move" by Slack reaction or other in-context surface. The
  verb lands in Desktop context menu in V1; web/mobile show
  a read-only badge if a move is in flight.

## 2. Mental Model

```text
CloudWorkspaceMobility               logical workspace identity
                                     (user_id, repo, branch)
                                     stays through moves

CloudWorkspaceHandoffOp              one move operation
  direction                          local_to_cloud | cloud_to_local |
                                     shared_to_personal |
                                     shared_to_local |
                                     personal_to_shared |
                                     cloud_to_cloud
  phase                              start_requested -> source_frozen
                                     -> destination_ready
                                     -> install_succeeded
                                     -> cleanup_pending -> completed
                                     (handoff_failed | cleanup_failed
                                      | repair_required terminal-ish)
  canonical_side                     'source' | 'destination'
                                     -- flips from source to destination
                                        atomically inside finalize

cloud_workspace_move_cleanup_item    obligations to clean up source
                                     after canonical_side flips to
                                     destination. Per-item retry.
```

The flow:

```text
1. Desktop initiates: POST /handoffs/start
   Cloud validates preconditions; reserves destination cloud_workspace
   row if needed; sets handoff_op.canonical_side='source',
   phase='start_requested'.

2. Desktop freezes source via AnyHarness:
   PUT /v1/workspaces/{source}/mobility/runtime-state
     mode='frozen_for_handoff'
   Desktop notifies Cloud: phase='source_frozen'

3. Desktop prepares destination:
   - local target: POST /v1/repo-roots/{id}/mobility/prepare-destination
   - cloud target: Cloud already provisioned cloud_workspace; ensure
     destination AnyHarness exists (managed_profile_launch per spec 04)
   Desktop notifies Cloud: phase='destination_ready'

4. Desktop exports from source AnyHarness:
   POST /v1/workspaces/{source}/mobility/export
   Receives WorkspaceMobilityArchive (in-memory; not persisted by Cloud)

5. Desktop installs into destination AnyHarness:
   POST /v1/workspaces/{destination}/mobility/install
   Desktop notifies Cloud: phase='install_succeeded'

6. Desktop notifies Cloud: phase='cutover_committed' (NEW)
   -- Cloud atomically flips canonical_side to 'destination',
      writes cleanup_items into cloud_workspace_move_cleanup_item.
   -- After this point: source cleanup failures do NOT roll back the
      move; the user retries cleanup.

7. Desktop runs source-side runtime-state set:
   PUT /v1/workspaces/{source}/mobility/runtime-state
     mode='remote_owned'
   Desktop notifies Cloud: phase='cleanup_pending'

8. Cleanup loop (Desktop drives; Cloud tracks per-item status):
   - destroy source AnyHarness workspace
     POST /v1/workspaces/{source}/mobility/destroy-source
   - archive old cloud_workspace row (status='archived')
   - archive old cloud_workspace_exposure (status='archived')
   - drop old cloud_session_projection rows for the old
     anyharness_session_ids
   - remove old worker_projection_cursor on the source worker
     (worker reconciles on next tick; the projection rows are
     gone, the cursor self-cleans)

9. When all cleanup_items succeed:
   phase='completed'
   handoff_op.cleanup_completed_at = now
   mobility row's owner/lifecycle_state reflect the new canonical side
```

Rules:

- **Cloud is not a runtime target.** AnyHarness on each side
  owns export and import.
- **Desktop is the V1 executor.** A move requires Desktop to be
  online and able to reach both the source and destination
  AnyHarness instances (via local for local; via direct-attach
  JWT for managed cloud; via SSH tunnel for SSH targets).
- **canonical_side is one-way after cutover_committed.** Source
  cleanup can fail and be retried, but cannot roll the move
  back. Failure modes after cutover surface as
  `repair_required`, not "move failed."
- **Workspace identity (`CloudWorkspaceMobility`) survives the
  move.** AnyHarness workspace ids may differ before vs after.
- **Capability state (MCP/skill/agent auth) is NOT moved.**
  Destination target's existing capability state applies.

## 3. Dependencies

Hard:

- Spec 00: `cloud_workspace.target_id` and `sandbox_profile_id`
  drive destination selection.
- Spec 04: `cloud_workspace_exposure` model. Spec 10's cleanup
  items table references exposures the move needs to archive.
  `managed_profile_launch` is called to ensure the destination
  exists.
- Spec 05: direct-attach JWT for cross-user / shared cloud
  source/destination access. Desktop fetches a token for the
  shared sandbox AnyHarness as part of `prepare-destination`
  or `export`.
- Spec 08: workspace sidebar verb wiring + deep links.

Soft:

- Spec 09: billing wake gate applies if the destination is a
  managed cloud sandbox that's paused. The wake fires as part
  of `managed_profile_launch`.

## 4. Current Repo State

Verified against the current repository worktree on 2026-05-20.

### 4.1 What is shipped

**Tables** (`server/proliferate/db/models/cloud/mobility.py`):

```text
cloud_workspace_mobility
  id, user_id, display_name, git_provider, git_owner,
  git_repo_name, git_branch,
  owner                 'local' | 'cloud'
  lifecycle_state       local_active | cloud_active |
                        moving_to_cloud | moving_to_local |
                        handoff_failed | cleanup_failed
  status_detail, last_error,
  cloud_workspace_id    fk cloud_workspace.id ON DELETE SET NULL
  active_handoff_op_id, last_handoff_op_id,
  cloud_lost_at, cloud_lost_reason,
  created_at, updated_at
  UNIQUE (user_id, git_provider, git_owner, git_repo_name, git_branch)

cloud_workspace_handoff_op
  id, mobility_workspace_id (fk; CASCADE), user_id,
  direction             'local_to_cloud' | 'cloud_to_local'
  source_owner, target_owner,
  phase                 start_requested | source_frozen |
                        destination_ready | install_succeeded |
                        cleanup_pending | completed |
                        handoff_failed | cleanup_failed
  requested_branch, requested_base_sha,
  exclude_paths_json,
  failure_code, failure_detail,
  started_at, heartbeat_at,
  finalized_at, cleanup_completed_at,
  created_at, updated_at
```

No `canonical_side`. No `cloud_workspace_move_cleanup_item` table.

**Server mobility service**
(`server/proliferate/server/cloud/mobility/`):

```text
api.py, service.py, models.py, domain/lifecycle.py

endpoints under /mobility:
  GET    /workspaces
  POST   /workspaces/ensure
  GET    /workspaces/{id}
  POST   /workspaces/{id}/preflight
  POST   /workspaces/{id}/handoffs/start
  POST   /workspaces/{id}/handoffs/{op_id}/heartbeat
  POST   /workspaces/{id}/handoffs/{op_id}/phase
  POST   /workspaces/{id}/handoffs/{op_id}/finalize
  POST   /workspaces/{id}/handoffs/{op_id}/cleanup-complete
  POST   /workspaces/{id}/handoffs/{op_id}/fail
```

**AnyHarness mobility contract**
(`anyharness/crates/anyharness-contract/src/v1/mobility.rs`,
`anyharness-lib/src/api/http/mobility.rs`):

```text
POST /v1/workspaces/{id}/mobility/preflight
PUT  /v1/workspaces/{id}/mobility/runtime-state
       modes: normal | frozen_for_handoff | remote_owned |
              repair_blocked    (repair_blocked exists but unused)
POST /v1/workspaces/{id}/mobility/export
POST /v1/workspaces/{id}/mobility/install
POST /v1/workspaces/{id}/mobility/destroy-source
POST /v1/repo-roots/{id}/mobility/prepare-destination
```

**Archive contents** (`WorkspaceMobilityArchive`):

```text
source_workspace_path, repo_root_path, branch_name?,
base_commit_sha
files[]                git-tracked delta + excluded list
deleted_paths[]
sessions[]
  session: MobilitySessionRecord
  live_config_snapshot?
  pending_config_changes[]
  pending_prompts[] (with content_parts + attachments)
  prompt_attachments[]
  events[]                  full transcript
  raw_notifications[]
  agent_artifacts[]         Claude project JSONL, Codex rollouts
session_links[], session_link_completions[],
session_link_wake_schedules[]

NOT in archive: MCP bindings, agent auth, runtime config caches,
                terminal state, Cloud projection rows
```

`mcp_bindings_ciphertext` and `mcp_binding_summaries_json` are
explicitly dropped on import; sessions rebind MCP after handoff
via spec 01 runtime config.

**Desktop UI** (`desktop/src/hooks/workspaces/mobility/` (15 files)
+ `desktop/src/lib/domain/workspaces/mobility/` (11 files)):

```text
WorkspaceMobilityOverlay.tsx     blocking overlay during move
WorkspaceMobilityFooterRow.tsx   footer status row
WorkspaceMobilityLocationPopover.tsx   initiator
```

Desktop drives the entire flow. No worker command kind exists
for mobility (`CloudCommandKind` has no `export_workspace_state`
or `import_workspace_state`).

**Stale heartbeat detection**: 120s timeout in `service.py`. No
`repair_required` lifecycle state; stale handoffs fail with
`handoff_failed` or `cleanup_failed`.

**Cleanup tracking**: two columns on `CloudWorkspaceHandoffOp`
(`finalized_at`, `cleanup_completed_at`). No per-item table.

**No move involving claimed shared work**: direction enum only
supports `local_to_cloud` / `cloud_to_local`. A user who claimed
a Slack-created workspace cannot move it to their personal cloud
today.

**No cleanup of old Cloud rows on cutover**: the
`cloud_workspace` row, `cloud_workspace_exposure` (when spec 04
ships), and `cloud_session_projection` rows from the source side
remain. Mobility updates `cloud_workspace_mobility.cloud_workspace_id`
to the new destination but doesn't archive the source row.

### 4.2 Gaps spec 10 closes

- Only two directions supported; need `shared_to_personal`,
  `shared_to_local`, `cloud_to_cloud`,
  `personal_to_shared`.
- No `canonical_side` invariant; flips happen implicitly during
  `finalize`, with no explicit one-way fence.
- No `cloud_workspace_move_cleanup_item` table; cleanup is two
  timestamps.
- No `repair_required` UX path; `repair_blocked` AnyHarness
  mode is defined but never set.
- No source-side Cloud row cleanup on cutover.
- No spec 04 exposure integration: source `cloud_workspace_exposure`
  is not archived; destination exposure is not created.
- No spec 05 direct-attach integration for shared-cloud
  source/destination.
- Desktop "Move to another target" verb is NOT in the workspace
  context menu (spec 08 §10 #20 deferred this to spec 10).

## 5. Target Model

### 5.1 Generalize direction enum

Extend `CloudWorkspaceHandoffOp.direction` enum:

```text
direction enum (after spec 10):
  local_to_cloud           Desktop -> user's personal cloud (existing)
  cloud_to_local           user's personal cloud -> Desktop (existing)
  shared_to_personal       claimed shared cloud work -> claimer's
                           personal cloud
  shared_to_local          claimed shared cloud work -> Desktop
  personal_to_shared       admin promotes a personal workspace to
                           the org's shared cloud (rare; not in V1)
  cloud_to_cloud           personal cloud -> SSH target, or
                           SSH -> personal cloud (V1 supported only
                           when both have a CloudTarget row reachable
                           from Desktop)
```

Migration to schema:

```text
ALTER cloud_workspace_handoff_op:
  drop existing direction CHECK
  add new CHECK with extended enum

source_owner / target_owner values extended to:
  'local' | 'personal_cloud' | 'shared_cloud' | 'ssh'
  (uses spec 03 §5.3 vocabulary)
```

Per-direction execution responsibility (V1):

```text
direction              executor   source connect       destination connect
---------------------  ---------  -------------------  ----------------------
local_to_cloud         Desktop    localhost            cloud (managed_profile_launch + JWT?)
                                                      NB: this is the user's own personal cloud;
                                                      no JWT needed; existing CloudWorkspaceConnection
                                                      access_token pattern continues until that
                                                      is replaced by spec 04/05 cleanup.
cloud_to_local         Desktop    cloud               localhost
shared_to_personal     Desktop    direct-attach JWT   user's personal cloud
                                  (spec 05)
shared_to_local        Desktop    direct-attach JWT   localhost
                                  (spec 05)
personal_to_shared     Desktop    user's personal     admin's shared cloud
                                  cloud               (requires useIsAdmin)
cloud_to_cloud         Desktop    direct-attach JWT   direct-attach JWT
                       (online)   or SSH tunnel       or SSH tunnel
```

For `shared_*` directions, the user must be the active claimer
(spec 05); their direct-attach JWT scope covers the source
workspace.

The mobility row's `owner` column gains values:

```text
owner enum (after spec 10):
  'local' | 'personal_cloud' | 'shared_cloud' | 'ssh'
  (V1 backfill: existing 'cloud' rows -> 'personal_cloud')
```

### 5.2 `canonical_side` invariant

Add to `cloud_workspace_handoff_op`:

```text
ALTER cloud_workspace_handoff_op:
  ADD COLUMN canonical_side text NOT NULL default 'source'
             'source' | 'destination'

  CHECK ck_handoff_canonical_side
  CHECK ck_handoff_canonical_side_post_install
    -- canonical_side = 'destination' implies phase IN
    --   ('cleanup_pending','completed','repair_required',
    --    'cleanup_failed')
```

New phase `cutover_committed` inserted between
`install_succeeded` and `cleanup_pending`:

```text
phase enum (after spec 10):
  start_requested -> source_frozen -> destination_ready
    -> install_succeeded -> cutover_committed -> cleanup_pending
    -> completed
  + handoff_failed (pre-cutover terminal)
  + cleanup_failed (post-cutover terminal-ish; UI offers retry)
  + repair_required (executor lease lost in ambiguous state)
```

The `cutover_committed` phase transition atomically:

```text
set canonical_side = 'destination'
set cloud_workspace_mobility.owner = handoff_op.target_owner
set cloud_workspace_mobility.cloud_workspace_id = destination_workspace_id
                                                   (for *_to_cloud variants;
                                                    NULL for *_to_local)
INSERT cloud_workspace_move_cleanup_item rows (see 5.3) for every
  cleanup obligation
```

After `cutover_committed`, **source cleanup failures cannot
revert the move.** They mark `cleanup_failed`. The user retries
cleanup or accepts the post-cutover state.

Failure before `install_succeeded` rolls the move back: Desktop
unfreezes the source via
`PUT /mobility/runtime-state { mode: 'normal' }`, deletes any
partial destination workspace, and the mobility row stays at
the original owner.

### 5.3 `cloud_workspace_move_cleanup_item` (new)

One row per cleanup obligation, created at `cutover_committed`.

```text
cloud_workspace_move_cleanup_item
  id                                uuid pk
  handoff_op_id                     uuid fk cloud_workspace_handoff_op.id
                                            ON DELETE CASCADE   NOT NULL

  item_kind                         text
                                    'anyharness_workspace' |
                                    'cloud_workspace' |
                                    'cloud_exposure' |
                                    'cloud_session_projection' |
                                    'cloud_transcript_projection' |
                                    'worker_projection_cursor'

  target_id                         uuid fk cloud_targets.id    nullable
                                    -- target where the cleanup runs
                                       (source side)
  anyharness_workspace_id           text                        nullable
                                    -- when item_kind = 'anyharness_workspace'
  object_id                         uuid                        nullable
                                    -- cloud_workspace.id /
                                       cloud_workspace_exposure.id /
                                       cloud_session_projection.id

  status                            text NOT NULL default 'pending'
                                    'pending' | 'in_progress' |
                                    'completed' | 'failed'

  attempt_count                     integer NOT NULL default 0
  next_attempt_at                   timestamptz NOT NULL
  error_code                        text                        nullable
  error_message                     text                        nullable

  started_at                        timestamptz                 nullable
  completed_at                      timestamptz                 nullable
  created_at                        timestamptz                 NOT NULL

  CHECK ck_cleanup_item_status
  CHECK ck_cleanup_item_kind

  INDEX (handoff_op_id, status)
  INDEX (next_attempt_at) WHERE status IN ('pending','failed')
```

Items are inserted at `cutover_committed`. The Desktop executor
walks pending items, performs each, and reports per-item success
via:

```text
POST /v1/cloud/mobility/workspaces/{id}/handoffs/{op_id}/cleanup-items/{item_id}/complete
POST /v1/cloud/mobility/workspaces/{id}/handoffs/{op_id}/cleanup-items/{item_id}/fail
```

When all items reach `completed`, the handoff transitions to
`phase='completed'`. If any item is `failed` with
`attempt_count >= MAX_CLEANUP_ATTEMPTS`, the handoff transitions
to `phase='cleanup_failed'` and UI surfaces retry.

`MAX_CLEANUP_ATTEMPTS` = 5 (configurable via
`settings.workspace_move_cleanup_max_attempts`).

Server reconciler (every 5 minutes) re-picks failed items past
their `next_attempt_at` with bounded exponential backoff. The
reconciler does NOT itself execute the cleanup (Desktop does);
it surfaces stale items in the Desktop UI so the user can
retry.

### 5.4 Spec 04 exposure cleanup integration

When the cleanup item kind is `cloud_exposure` or
`cloud_session_projection`:

```text
item_kind='cloud_exposure'
  cloud_workspace_exposure.status='archived'
  cloud_workspace_exposure.archived_at=now
  cloud_workspace_exposure.commandable=false
  publish_session_patch on any active projection of this exposure
    so live clients see the exposure go away

item_kind='cloud_session_projection'
  cloud_session_projection.status='ended' for the old session ids
  cloud_session_event rows are NOT deleted (retention; spec 04
    retention policy applies)

item_kind='worker_projection_cursor'
  the worker on the source side reconciles its cursor list on
  next GET /v1/cloud/worker/exposures (spec 04 §5.5) and
  detects the exposure is archived; cursor drops naturally.
  the cleanup item is marked completed when the next worker
  reconciliation tick confirms the cursor is gone (Cloud knows
  this via a heartbeat round-trip).
```

On `cutover_committed`, a fresh exposure for the destination is
created with the same `visibility` as the source's
pre-move exposure — EXCEPT for `shared_to_*` directions:
**claimed shared work moved to personal/local becomes
`visibility='private'`.** Claim does not transfer; the moved
workspace is personal property at the destination.

```text
shared_to_personal       destination exposure visibility='private'
shared_to_local          destination has no exposure
                         (local Desktop work is not auto-exposed)
local_to_cloud           destination exposure visibility='private'
                         + commandable=true + default_projection_level='live'
cloud_to_local           destination has no exposure
personal_to_shared       destination exposure visibility='shared_unclaimed'
                         (admin-driven; rare; useIsAdmin)
cloud_to_cloud           destination inherits source visibility
                         (typically 'private')
```

### 5.5 Direct-attach for cross-target moves

For `shared_*` directions, Desktop fetches a spec 05 direct-attach
JWT for the source AnyHarness before export. The token's scope
must cover the workspace; the request includes
`X-Client-Kind: desktop`.

```text
Desktop:
  load active claim for the workspace (spec 05)
  call POST /v1/cloud/workspaces/{id}/direct-access-token
    body: { permissions: ['read', 'control'], ... }
  use the returned JWT to call:
    PUT /v1/workspaces/{anyharness_id}/mobility/runtime-state
        mode=frozen_for_handoff
    POST /v1/workspaces/{anyharness_id}/mobility/export
    POST /v1/workspaces/{anyharness_id}/mobility/destroy-source
```

For `cloud_to_cloud` where the user owns both sides, Desktop
authenticates with the existing CloudWorkspaceConnection access
token on the source AND uses a direct-attach JWT for the
destination (if destination is a shared cloud the user claims) or
the same access-token pattern (if destination is the user's own
personal cloud).

For SSH targets, the existing SSH tunnel path is reused; no
direct-attach JWT.

### 5.6 `repair_required` state and UI

If the executor's heartbeat lapses past
`settings.workspace_move_executor_heartbeat_timeout_seconds`
(default 120s), the handoff transitions to a new phase based on
the current `canonical_side`:

```text
heartbeat lapse + canonical_side='source':
  -> phase='handoff_failed'
     source mode restored to 'normal' if the executor never set
     'frozen_for_handoff', else AnyHarness still has the source
     frozen — Desktop needs to unfreeze on re-open
     (next session resume sets mode='normal')

heartbeat lapse + canonical_side='destination':
  -> phase='repair_required'
     -- The move has cutover but cleanup is ambiguous. Source
        AnyHarness may still have the old workspace; destination
        has the imported state. The user must explicitly resume
        cleanup or roll back individual cleanup items.
```

UI for `repair_required`:

```text
Desktop WorkspaceMobilityOverlay:
  shows "Move needs repair"
  buttons:
    "Resume cleanup"    -> Desktop re-runs pending cleanup items
                          from cloud_workspace_move_cleanup_item
    "Mark complete"     -> user attests cleanup is done outside
                          the system (rare); marks remaining items
                          as completed manually with an audit note
    "View details"      -> shows per-item status with retry per item
```

The `repair_blocked` AnyHarness mode (already defined; never set
today) is now set on the source by the executor when entering
the `repair_required` state. AnyHarness rejects subsequent
mutations on the source workspace except a `runtime-state`
PUT that unfreezes or `destroy-source`.

### 5.7 Desktop "Move to another target" verb

Spec 08 §6 deferred this verb pending spec 10. Spec 10 turns it
on:

```text
desktop/src/components/workspace/shell/sidebar/
  use-workspace-sidebar-native-context-menu.ts
    add "Move to another target..." item
    visible when:
      - workspace.target.kind in ('local','managed_cloud','ssh')
      - workspace.exposure.visibility not in ('shared_unclaimed','admin_managed','archived')
      - active claim is by current user (if claimed)
      - no active CloudWorkspaceHandoffOp
      - no active session turn / pending interaction
```

The verb opens a migration editor modal (§5.8).

### 5.8 Migration editor UI

```text
desktop/src/components/mobility/MigrationEditorModal.tsx       (new)

sections:
  Source                  workspace name, target, sandbox_type
                          (read-only)
  Destination             SourceTargetPicker (filtered by allowed
                          directions for source type)
  Scope                   "Move whole workspace" (default; only V1
                          option). Session-only export deferred.
  Source handling         (radio buttons; default: archive)
    - Archive source after success                                                    (default)
    - Keep source read-only for 7 days                                                (then delete)
    - Delete source immediately after destination verifies                            (advanced; warning)
  Remote access at destination
                          (only when destination is a cloud target)
    - Expose to my Cloud (private)                                                     (default)
    - Make destination read-only from Cloud
    - Keep destination local/private (no Cloud exposure)                              (cloud_to_local only)
  Preflight summary       (computed by calling /preflight on both sides)
    Source readiness:
      - target online
      - no active turn / no pending interaction
      - uncommitted git changes count
      - approximate archive size
      - sessions included
    Destination readiness:
      - target online
      - repo access (clones successfully if needed)
      - disk/storage availability
      - agent auth readiness (sandbox profile current revision applied)
      - MCP/skill runtime config readiness (current revision applied)
      - no branch/worktree conflict
    Policy:
      - user allowed to move (claim active if shared source)
      - billing not blocked at destination

actions:
  "Start move"            (disabled while preflight has any blocker)
  "Cancel"                (closes modal)

progress phase:
  state machine view shows:
    Planning -> Preparing source -> Saving git state ->
    Exporting -> Transferring -> Preparing destination ->
    Importing -> Cutover -> Cleanup -> Done
  each step has a state badge: pending / in_progress /
                               completed / failed

failure UX:
  failed before cutover_committed:
    "Move failed"; "Source remains usable"; buttons:
      Retry / View details / Cancel
  failed after cutover_committed:
    "Move cutover complete; cleanup pending"; buttons:
      Resume cleanup / View details / Mark complete
  repair_required:
    "Move needs repair"; same buttons as cleanup_failed

  Failure details show the per-item status from
  cloud_workspace_move_cleanup_item.
```

### 5.9 Cloud row cleanup after cutover

For `*_to_cloud` and `cloud_to_cloud` moves (destination has a
cloud_workspace row), `cutover_committed` writes these cleanup
items:

```text
item_kind='anyharness_workspace'         target=source_target
                                         anyharness_workspace_id=source_ahid
  Desktop calls POST /v1/workspaces/{source_ahid}/mobility/destroy-source

item_kind='cloud_exposure'               target=source_target
                                         object_id=source_exposure_id
  Cloud server archives the exposure (no Desktop call needed)

item_kind='cloud_session_projection'     target=source_target
                                         object_id=source_projection_id
  Cloud server ends the projection (per session)

item_kind='cloud_workspace'              target=source_target
                                         object_id=source_cloud_workspace_id
  Cloud server archives the old cloud_workspace row
  (status='archived'; archived_at=now)

item_kind='worker_projection_cursor'     target=source_target
  Cloud confirms next worker reconciliation has removed the cursor
```

For `*_to_local` moves (destination has no cloud_workspace), the
same items apply on the source side; additionally the mobility
row's `cloud_workspace_id` clears to `NULL` and `owner`
transitions to `local`.

`cloud_workspace.status='archived'` is the existing terminal state;
spec 10 does not introduce a new state. The archived workspace is
hidden from default listings (`scope=my`/`scope=exposed` filter
it out); spec 05 `scope=org-all` (admin) still shows it for audit.

`cloud_session_event` rows are NOT deleted (retention policy).
The session projection is ended but events remain queryable for
audit.

### 5.10 API surface

```text
POST /v1/cloud/mobility/workspaces/{id}/handoffs/start
       body: { direction, requested_branch?, requested_base_sha?,
               exclude_paths?, destination_target_id?,
               source_handling, destination_exposure_intent }
       returns: { handoff_op_id, cleanup_items: [] }
                 (cleanup_items empty until cutover_committed)

POST /v1/cloud/mobility/workspaces/{id}/handoffs/{op_id}/phase
       body: { phase, cloud_workspace_id? }
       phases server enforces in order;
       cutover_committed atomically writes cleanup_items

POST /v1/cloud/mobility/workspaces/{id}/handoffs/{op_id}/cleanup-items/{item_id}/start
POST .../cleanup-items/{item_id}/complete
POST .../cleanup-items/{item_id}/fail
       Desktop reports per-item status

POST /v1/cloud/mobility/workspaces/{id}/handoffs/{op_id}/repair
       transitions out of repair_required:
       body: { action: 'resume_cleanup' | 'mark_complete' }
       audit row written

GET  /v1/cloud/mobility/workspaces/{id}/handoffs/{op_id}/cleanup-items
       returns: list of items + status

POST /v1/cloud/mobility/workspaces/{id}/preflight
       extended response includes:
       - destination target readiness (calls spec 00
         sandbox_profile_target_state for managed cloud)
       - agent auth + runtime config preflight (spec 02 + spec 01)
       - billing readiness at destination (spec 09
         authorize_sandbox_start dry run)
```

Existing endpoints (heartbeat, finalize, cleanup-complete, fail)
stay for backwards-compat call sites; spec 10 deprecates
`cleanup-complete` in favor of per-item completion. New code
calls per-item endpoints.

## 6. Files To Change

Server (Python):

```text
server/proliferate/db/models/cloud/mobility.py
  + canonical_side column on cloud_workspace_handoff_op
  + extend direction enum
  + extend owner / source_owner / target_owner enums
  + cutover_committed and repair_required phases

server/proliferate/db/models/cloud/mobility_cleanup_items.py     (new)
  CloudWorkspaceMoveCleanupItem

server/proliferate/db/migrations/versions/<NEW>_mobility_v2.py
  - schema additions
  - extend enum CHECK constraints
  - data migration: existing 'cloud' owner values -> 'personal_cloud'

server/proliferate/db/store/cloud_mobility.py
  + insert_cleanup_items_for_handoff(op_id, items)
  + load_cleanup_items_for_handoff(op_id)
  + update_cleanup_item_status(item_id, status, error?)
  + load_pending_items_due(now)        for reconciler

server/proliferate/server/cloud/mobility/api.py
  + per-item endpoints (start, complete, fail)
  + repair endpoint
  + extended preflight

server/proliferate/server/cloud/mobility/service.py
  + cutover_committed phase handler (atomic update +
    insert_cleanup_items_for_handoff)
  + repair_required transitions on stale heartbeat with
    canonical_side='destination'
  + per-item completion semantics

server/proliferate/server/cloud/mobility/cleanup_executor.py    (new)
  cloud-side server-executed items (cloud_workspace,
  cloud_exposure, cloud_session_projection,
  worker_projection_cursor confirmation)
  invoked by Desktop's POST .../cleanup-items/{id}/start when
  the item is Cloud-side; AnyHarness-side items (e.g.
  anyharness_workspace) are executed by Desktop directly via
  AnyHarness mobility endpoints, with Cloud only tracking status.

server/proliferate/server/cloud/mobility/reconciler.py          (new)
  every 5min: find items past next_attempt_at; surface to UI

server/proliferate/server/cloud/mobility/domain/lifecycle.py
  + canonical_side rules
  + new phase transitions
  + repair_required logic
  + direction-to-source-owner mapping

server/proliferate/config.py
  + workspace_move_cleanup_max_attempts                default 5
  + workspace_move_executor_heartbeat_timeout_seconds  default 120
  + workspace_move_cleanup_reconciler_interval_seconds default 300
```

Worker (Rust): no changes. Worker has no mobility commands.

AnyHarness (Rust): no contract changes — existing mobility
contract is sufficient. The `repair_blocked` mode is now set by
the executor; AnyHarness already enforces it (existing logic).

Cloud SDK:

```text
cloud/sdk/src/client/mobility.ts                        extend
  + cleanupItemEndpoints
  + repairEndpoint
  + extended preflight response shape
cloud/sdk/src/types/generated.ts                        regen
```

Desktop:

```text
desktop/src/components/mobility/MigrationEditorModal.tsx       (new)
desktop/src/components/mobility/WorkspaceMobilityOverlay.tsx
  + handle repair_required state with explicit buttons
desktop/src/components/mobility/PerItemCleanupStatus.tsx       (new)

desktop/src/hooks/workspaces/mobility/
  use-start-handoff.ts                            extend with direction
  use-execute-cleanup-items.ts                    (new) drives per-item
  use-mobility-repair.ts                          (new)
  use-shared-source-direct-attach.ts              (new) integrates spec 05

desktop/src/lib/domain/workspaces/mobility/
  mobility-state-machine.ts                       add cutover_committed +
                                                  repair_required transitions
  cleanup-item-runner.ts                          (new) per-item execution
  destination-target-picker.ts                    (new) policy + filters

desktop/src/components/workspace/shell/sidebar/
  use-workspace-sidebar-native-context-menu.ts    + "Move to another target..."
```

## 7. Implementation Chunks

```text
Chunk A  Schema + canonical_side
  - migration adds canonical_side, extends enums, adds
    cutover_committed + repair_required phases
  - lifecycle.py updates
  - all existing flows continue to work; direction defaults to
    local_to_cloud / cloud_to_local as before; canonical_side
    defaults to 'source'

Chunk B  cloud_workspace_move_cleanup_item
  - new model + migration
  - store helpers
  - cutover_committed phase handler atomically inserts items
  - per-item endpoints

Chunk C  Cloud-side cleanup executor
  - cleanup_executor.py for Cloud-side items
    (cloud_workspace, cloud_exposure, cloud_session_projection,
     worker_projection_cursor)
  - integration with spec 04 exposure status
  - reconciler tick re-surfaces failed items

Chunk D  New directions (shared_to_*, personal_to_shared,
                         cloud_to_cloud)
  - lifecycle policy: allowed direction matrix
  - direction selector in MigrationEditorModal
  - shared_to_* fetches direct-attach JWT (spec 05)
  - cloud_to_cloud preflight on both sides

Chunk E  repair_required state + UI
  - stale heartbeat handler with canonical_side branch
  - repair endpoint
  - WorkspaceMobilityOverlay branch for repair_required
  - per-item retry UI

Chunk F  Migration editor
  - MigrationEditorModal sections
  - destination target picker
  - extended preflight call
  - progress state machine view
  - failure UX

Chunk G  Desktop "Move to another target" verb
  - context menu item with visibility gates
  - opens MigrationEditorModal

Chunk H  Tests + smoke
```

All chunks land in one PR.

## 8. Acceptance Criteria

1. `cloud_workspace_handoff_op.direction` accepts
   `local_to_cloud | cloud_to_local | shared_to_personal |
   shared_to_local | personal_to_shared | cloud_to_cloud`.
2. `cloud_workspace_handoff_op.canonical_side` exists with
   default `'source'` and CHECK preventing
   `canonical_side='destination'` outside of
   `cleanup_pending | completed | repair_required | cleanup_failed`
   phases.
3. New phase `cutover_committed` exists. The phase transition
   handler atomically updates canonical_side AND writes
   `cloud_workspace_move_cleanup_item` rows for every cleanup
   obligation.
4. `cloud_workspace_move_cleanup_item` exists with the documented
   schema. Per-item status transitions: pending → in_progress
   → completed | failed. Failed items retry up to
   `workspace_move_cleanup_max_attempts`.
5. `cleanup_failed` phase requires at least one item with
   `status='failed'` AND `attempt_count >= max`.
   `completed` phase requires all items `status='completed'`.
6. `repair_required` phase is set when the executor heartbeat
   times out AND `canonical_side='destination'`. UI exposes
   "Resume cleanup", "Mark complete", "View details" actions.
7. Cleanup item kinds executed correctly:
   - `anyharness_workspace`: Desktop calls `destroy-source`
   - `cloud_workspace`: server archives row
   - `cloud_exposure`: server archives exposure (spec 04)
   - `cloud_session_projection`: server ends projection
   - `worker_projection_cursor`: server confirms next worker
     reconciliation removed the cursor
8. After `cutover_committed`, the source-side cleanup CANNOT
   roll the move back. `cleanup_failed` transitions are
   terminal until user resumes; the destination is canonical.
9. For `shared_to_*` directions, the destination's
   `cloud_workspace_exposure` is created with
   `visibility='private'`. Claim does NOT transfer.
10. For `*_to_cloud` directions, destination exposure is
    created with `visibility='private'`,
    `commandable=true`, `default_projection_level='live'`,
    `origin='manual_desktop'` (the user moved the work).
11. For `*_to_local` directions, no destination exposure is
    created automatically.
12. `personal_to_shared` requires `useIsAdmin(org)`. Desktop
    context menu hides the option for non-admins.
13. Desktop fetches a direct-attach JWT (spec 05) for the
    source workspace when direction is `shared_to_*`.
14. `MigrationEditorModal` exists with all sections from §5.8.
    The "Start move" button is disabled while any preflight
    blocker is present.
15. Desktop context menu shows "Move to another target..." with
    the visibility gates from §5.7. The verb does NOT appear
    when an active handoff_op exists for this workspace.
16. `cloud_session_event` rows are NOT deleted on cleanup;
    retention policy applies.
17. `cloud_workspace_move_cleanup_item` reconciler runs every
    `workspace_move_cleanup_reconciler_interval_seconds`
    seconds. Failed items past `next_attempt_at` are surfaced
    in the Desktop UI; the reconciler does not itself execute
    cleanup.
18. AnyHarness `repair_blocked` mode is set on the source
    workspace when the handoff enters `repair_required`. The
    mode is cleared when the user resumes cleanup or marks
    complete.
19. Existing `local_to_cloud` and `cloud_to_local` flows
    continue to work end-to-end after the schema migration. No
    regression on the shipped flow.
20. Cleanup of old `cloud_workspace`, `cloud_workspace_exposure`,
    and `cloud_session_projection` rows happens via cleanup
    items at the source side. After successful completion, a
    grep verifies no orphan rows for the old cloud_workspace_id.

## 9. Verification / Tests

Server:

```bash
cd server
uv run pytest -q
```

Targeted tests:

```text
tests/server/cloud/mobility/test_direction_enum_extended.py
tests/server/cloud/mobility/test_canonical_side_invariant.py
tests/server/cloud/mobility/test_cutover_committed_atomic.py
  - phase transition writes canonical_side AND cleanup_items
    in a single transaction
tests/server/cloud/mobility/test_cleanup_item_per_item_status.py
tests/server/cloud/mobility/test_cleanup_item_retry_cap.py
tests/server/cloud/mobility/test_cleanup_failed_terminal.py
tests/server/cloud/mobility/test_repair_required_on_stale_heartbeat.py
tests/server/cloud/mobility/test_repair_required_only_post_cutover.py
tests/server/cloud/mobility/test_shared_to_personal_visibility_resets.py
  - destination exposure.visibility='private' regardless of source
tests/server/cloud/mobility/test_personal_to_shared_admin_gate.py
tests/server/cloud/mobility/test_cleanup_items_for_shared_to_personal.py
  - cleanup includes source exposure archive +
    cloud_session_projection end
tests/server/cloud/mobility/test_destination_preflight_runs_billing_check.py
tests/server/cloud/mobility/test_cleanup_executor_archives_exposure.py
tests/server/cloud/mobility/test_cleanup_reconciler_surfaces_failed.py
tests/server/cloud/mobility/test_existing_local_cloud_flow_no_regression.py
```

Desktop:

```bash
cd desktop && pnpm test -- --run && pnpm typecheck
```

Targeted Desktop tests:

```text
desktop/src/components/mobility/MigrationEditorModal.test.tsx
  - preflight blockers disable Start move
  - direction selector filters by source owner
  - destination exposure intent radio respects direction
desktop/src/lib/domain/workspaces/mobility/cleanup-item-runner.test.ts
  - per-item execution + status reporting
desktop/src/hooks/workspaces/mobility/use-execute-cleanup-items.test.ts
desktop/src/hooks/workspaces/mobility/use-mobility-repair.test.ts
desktop/src/hooks/workspaces/mobility/use-shared-source-direct-attach.test.ts
desktop/src/components/workspace/shell/sidebar/use-workspace-sidebar-native-context-menu.test.ts
  - "Move to another target..." visibility gates
```

Manual smoke:

```text
1. local_to_cloud happy path (existing flow regression)
   - user starts move from Desktop local workspace to personal cloud
   - phases progress through cutover_committed -> cleanup_pending
     -> completed
   - cleanup items: anyharness_workspace, cloud_workspace (source
     was null; no item), cloud_exposure (source had none),
     cloud_session_projection (none), worker_projection_cursor (none)
   - effectively the existing flow with explicit cutover_committed

2. shared_to_personal end-to-end
   - Slack creates shared_unclaimed work
   - user claims (spec 05)
   - user opens Desktop; "Move to another target..." shows
     "personal cloud" as a destination
   - migration editor: destination exposure intent locked to
     "Expose to my Cloud (private)" for cloud destinations
   - Desktop fetches direct-attach JWT for source
   - export from shared cloud AnyHarness via JWT
   - install into personal cloud AnyHarness
   - cutover_committed flips canonical_side
   - cleanup items archive source exposure, end source
     projection, archive source cloud_workspace
   - completed
   - workspace now lives in user's personal cloud as private

3. cleanup item failure + reconciler
   - simulate destroy-source failing on AnyHarness
   - cleanup_item attempts increment; status='failed'
   - reconciler surfaces failed item
   - user opens Desktop overlay; clicks "Retry"
   - item succeeds; phase advances to completed

4. repair_required
   - executor (Desktop) crashes after cutover_committed
   - heartbeat times out after 120s
   - phase transitions to repair_required
   - source AnyHarness set to repair_blocked mode
   - user reopens Desktop; overlay shows "Move needs repair"
   - user clicks "Resume cleanup"
   - remaining cleanup items execute; phase -> completed
   - source unfrozen / destroyed correctly

5. preflight blocks unsupported moves
   - non-admin tries personal_to_shared
   - "Move to another target..." doesn't list shared cloud as a
     destination
   - even if forced, server rejects with not_admin_for_shared

6. claimed source moved away — claim row stays for audit
   - shared_to_personal completes
   - cloud_workspace_claim row remains active in audit (spec 05
     §5.1: claim is one-way; spec 10 does not touch the claim row)
   - the moved workspace at the destination has no claim row
     (it's a personal workspace now)

7. cloud_to_local with active session
   - user has active session at destination after move
   - export captures pending prompts and live config snapshot
   - install applies them in destination
   - on first session resume at destination, the live config
     matches the source
```

## 10. Open Questions

1. **Should `cleanup_failed` permit "Mark complete" without
   actually running the cleanup?**

   Bias: yes, with audit. Sometimes the source environment is
   permanently unreachable (machine destroyed, account deleted).
   The user attests; the items get marked completed manually
   with `error_code='manual_resolution'` + an audit note. The
   move's canonical side stays at destination.

2. **`cloud_to_cloud` between two managed cloud targets the user
   does NOT have direct-attach to.**

   V1 limitation: Desktop must have direct-attach to both sides.
   If a user has personal cloud A and personal cloud B but is
   only direct-attached to A, the move fails. Acceptable for V1
   because V1 has one personal cloud per user. Multi-personal-cloud
   is not on the roadmap.

3. **`personal_to_shared` for admin promoting a personal
   workspace.**

   V1 supports the model but the UX rarely makes sense (the
   workspace contents are still authored by one person; the
   "share with team" use case is better served by re-running
   the work in the shared sandbox). Bias: keep the direction
   in the enum + admin gate, but do not promote it in the UI
   beyond an advanced "Move to shared cloud" option that
   requires admin.

4. **Session-only export** (move one session out of a workspace
   that has multiple).

   The archive contains all sessions; AnyHarness doesn't
   currently support exporting a subset. Spec 10 V1: whole
   workspace only. Session-only export is a future capability
   that needs AnyHarness contract support first.

5. **Backward-compat with existing `lifecycle_state`
   ('moving_to_cloud'/'moving_to_local').**

   These values are kept for the two original directions. New
   directions get new lifecycle_state values:
   `moving_to_shared_personal`, `moving_to_shared_local`,
   `moving_personal_to_shared`, `moving_cloud_to_cloud`. Or we
   could collapse to a single `moving` state with phase as the
   detail. Bias: collapse to `moving` and rely on `phase` +
   `direction` for granularity. Reduces enum sprawl.

6. **Should we worker-drive headless moves?**

   When neither side has Desktop online (e.g. admin schedules a
   move while user is offline), no V1 path. The infrastructure
   exists (Cloud holds state; AnyHarness mobility endpoints work
   over the worker JWT path); but the orchestration logic is
   complex. Bias: defer to V2; spec 10 explicitly does not add
   `export_workspace_state` / `import_workspace_state` worker
   command kinds.

7. **Cleanup item ordering.**

   Some items have dependencies: `anyharness_workspace` destroy
   should happen before `cloud_workspace` archive (the AH side
   needs to confirm the workspace is gone before the Cloud row
   is archived, otherwise lookup-by-anyharness_workspace_id
   breaks). Bias: cleanup_executor.py runs items in a fixed
   order:
     1. anyharness_workspace (destroy source AH)
     2. cloud_session_projection (end source projections)
     3. cloud_exposure (archive source exposure)
     4. worker_projection_cursor (confirm)
     5. cloud_workspace (archive)
   Each gates on the previous succeeding. Failed item blocks
   subsequent items.
