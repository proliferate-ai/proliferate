# 04 — Cloud Running Alignment

Status: implementation-ready spec.

Date: 2026-06-05 (collapsed-identity revision; command leasing/results
correlate by `target_id`, no slot fence).

Depends on: [`sandbox-provisioning.md`](sandbox-provisioning.md),
[`mcp-skills.md`](mcp-skills.md),
[`agent-auth.md`](agent-auth.md).

The cloud command queue, worker dispatcher, event tail, and session
projection substrate is mostly shipped. This spec is cleanup and
alignment: thread the spec 00 fields through, add the runtime-config
preflight peer of the existing agent-auth preflight, fill in the
missing exposure/projection admission model, add a wake gate, and
strip the direct-access reads from `cloud_workspace`.

## 1. Purpose & Scope

In scope:

- Thread `cloud_workspace_id` and `sandbox_profile_id`
  through cloud_commands, the worker wire contract, command leasing,
  delivery, result ingest, and event ingest.
- Correlate command leasing and result ingest by `target_id` per spec 00 §5.8
  (no slot id, no `slot_generation`, no fence — `target_id` is the epoch).
- `_validate_runtime_config_preflight()` peer of the existing
  `_validate_agent_auth_preflight()` (per spec 01).
- Worker dispatcher synthesizes `AgentAuthExternalScope` from
  `sandboxProfileId` on `start_session` (per spec 02 §5.2).
- New `cloud_workspace_exposure` table; existing
  `cloud_session_projection` (table name: `cloud_sessions`) extended
  with `exposure_id`, `projection_level`, `commandable`,
  `gap_state_json`, `last_uploaded_seq`.
- Worker `worker_projection_cursor` SQLite mirror; worker tail is
  exposure-gated.
- Wake gate before delivery for wake-required command kinds. Cloud
  performs the Proliferate-owned E2B operation; worker never wakes
  itself.
- Workspace `origin` made an explicit column (kept narrow to the
  spec-03 vocabulary). `exposure_state` and `sandbox_type` are
  derived, not stored.
- Remove all managed-cloud reads of `cloud_workspace.runtime_url`,
  `runtime_token_ciphertext`, `active_sandbox_id` (spec 00 dropped
  the columns; spec 04 closes the call sites at
  `config_sync/repo_config.py`, `liveness/ensure_running.py`, and
  runtime `service.py`; AnyHarness protocol calls live under
  `integrations/anyharness/**`).
- "Passive UI" invariant: list workspace/session/transcript state
  from Cloud DB without waking the sandbox. Enforced by review +
  tests.

Out of scope:

- Claim policy and claimable lists (→ spec 05). Spec 04 lays the
  `cloud_workspace_exposure.visibility = 'shared_unclaimed'`
  scaffolding but spec 05 owns the claim API and claim tokens.
- Slack inbound webhook handling (→ spec 07). Spec 04's command
  source enum already has `'slack'`; spec 07 wires the producer.
- Automation runner internals (→ spec 06). Spec 04 ensures the
  existing automation cloud-execution caller carries the new
  envelope fields, but the automation lifecycle is owned by spec 06.
- Web/mobile UI shells (→ spec 08).
- Billing wake-gate decisions (→ spec 09). Spec 04 defines the wake
  hook; spec 09 owns "is this billing subject allowed to wake right
  now?".
- Migration / move (→ spec 10).

## 2. Mental Model

```text
client (Desktop / Web / Mobile / Slack / Automation / API)
  -> Cloud control plane
       enqueue_command (preflight + idempotency + auth gate)
       persist cloud_workspace + cloud_workspace_exposure +
       cloud_session_projection rows BEFORE worker dispatch
       wake the target's sandbox if the command requires it
  -> Proliferate Worker
       leases command (correlated by target_id)
       preflights local runtime state
       calls local AnyHarness
       reports result + echoes cloud_workspace_id
  -> AnyHarness
       runs session
  -> Worker tailer (exposure-gated)
       uploads events for active exposures only
  -> Cloud event ingest
       writes cloud_session_event, updates projection rows
  -> clients
       read from Cloud DB; no E2B wake required for passive views
```

The invariant set:

```text
1. Cloud creates cloud_workspace + (where relevant) exposure +
   projection rows BEFORE worker dispatch.
2. Wake-required commands wake the target's sandbox through Proliferate,
   not through raw E2B URLs.
3. Command leasing, delivery, and result ingest correlate by `target_id`;
   reports from an archived (replaced) target are inert.
4. Worker results never auto-create cloud_workspace rows (spec 00
   acceptance #23 echoed here).
5. Workspace materialization results must echo cloud_workspace_id.
6. Worker event tailer projects only sessions with active exposure +
   projection. No exposure -> no upload.
7. Passive UI reads come from Cloud DB only. Mutation/launch reads go
   through Cloud commands.
```

## 3. Dependencies

Hard:

- Spec 00: `sandbox_profile`, `cloud_targets.profile_target_role`,
  the ephemeral managed target (= sandbox), `sandbox_profile_target_state`,
  `cloud_target_runtime_access`, plus the new envelope/result wire
  fields.
- Spec 01: `sandbox_profile_runtime_config_current.current_sequence`
  and `current_revision_id`; the
  `applied_runtime_config_sequence`/`applied_runtime_config_revision_id`
  columns on `sandbox_profile_target_state`. The `materialize_environment`
  command carrying a `runtime_config` fragment.
- Spec 02: agent-auth preflight already shipped; spec 04 doesn't
  redo it, but the dispatcher synthesizes `AgentAuthExternalScope`
  per spec 02 §5.2.

Soft:

- Spec 05 (claiming) and spec 06 (automations) consume the exposure
  / projection model defined here.
- Spec 09 (billing) owns the actual wake-allow check inside the
  wake hook.

## 4. Current Repo State

Verified against the current repository worktree on 2026-05-20.

### 4.1 What is shipped

**`cloud_commands` table** (`db/models/cloud/commands.py`):

```text
id, target_id (fk), organization_id, actor_user_id,
actor_kind        user | automation | slack | api_key | system
source            web | mobile | slack | api | automation | desktop_cloud_view
workspace_id      text (AnyHarness id), nullable
session_id        text, nullable
kind              command kind enum
payload_json
observed_event_seq
preconditions_json
authorization_context_json    { actorUserId, targetOwnerScope,
                                targetOrganizationId, cloudWorkspaceId }
status            queued | leased | delivered | accepted |
                  accepted_but_queued | rejected | expired |
                  superseded | failed_delivery
lease_id, leased_by_worker_id, lease_expires_at, attempt_count
delivered_at, accepted_at, rejected_at, expired_at
error_code, error_message, result_json
```

`authorization_context_json` already carries `cloudWorkspaceId`. Spec
00 promotes it to a first-class column.

**Command service** (`server/proliferate/server/cloud/commands/service.py`):

```text
enqueue_command(...)
  - idempotency scope key: org/user : target : workspace : session : kind
  - validates target status, kind, payload shape
  - calls _validate_agent_auth_preflight()
  - stores authorization_context_json

_validate_agent_auth_preflight(...)
  - reads sandboxProfileId + requiredAgentAuthRevision from payload
  - loads sandbox_profile_agent_auth_target_state for (profile, target)
  - rejects if profile missing / belongs to other target / applied <
    required
```

**Command API**:

```text
POST /v1/cloud/commands              enqueue_command_endpoint
GET  /v1/cloud/commands/{command_id} get_command_status_endpoint

POST /v1/cloud/worker/commands/lease
POST /v1/cloud/worker/commands/{command_id}/result
POST /v1/cloud/worker/commands/{command_id}/delivery
```

**Worker dispatcher**
(`anyharness/crates/proliferate-worker/src/commands/dispatcher.rs`):

```text
run_loop()
  flush_pending_command_results()
  lease_command(supported_kinds)
  process_command(envelope)

process_command branches per kind:
  configure_git_identity, ensure_repo_checkout, materialize_environment,
  sync_existing_workspace, refresh_agent_auth_config,
  + everything else routed via dispatch_anyharness() after
    map_cloud_command(envelope).

Preconditions: validated server-side at enqueue; worker honors
observed_event_seq if the precondition payload demands it.
```

**Session projection / event upload** (`db/models/cloud/sync.py`):

```text
cloud_session_events
  id, target_id, session_id, anyharness_seq (uniq per session),
  event_type, payload_json, payload_hash (dedup), payload_ref,
  payload_size_bytes, created_at

cloud_event_ingest_state
  target_id, session_id, last_contiguous_seq, updated_at

cloud_synced_workspaces
  target_id, cloud_workspace_id (fk), workspace_id (AnyHarness)

cloud_sessions       (the table is named cloud_sessions, model
                      class is CloudSessionProjection)
  id, target_id, session_id, cloud_workspace_id (nullable),
  workspace_id (AnyHarness), status, phase, live_config_json,
  last_event_seq, last_event_at, started_at, ended_at

cloud_transcript_items
  target_id, session_id, item_id, turn_id, kind, status,
  first_seq, last_seq, completed_seq, timestamps

cloud_pending_interactions
  target_id, session_id, request_id, kind, status, requested_seq,
  resolved_seq, timestamps
```

**Event upload endpoint**:

```text
POST /v1/cloud/worker/events/batches    worker_event_batch_endpoint
  body: WorkerEventBatchRequest with list of WorkerSessionEventEnvelope
  resp: { accepted_events, duplicate_events, live_only_events,
          session_acks: [{ session_id, last_contiguous_seq }] }
  dedup: UNIQUE (target_id, session_id, anyharness_seq) + payload_hash
```

**Worker tailer**
(`anyharness/crates/proliferate-worker/src/sync/tailer.rs`):

```text
run_loop()  every 500ms
  for each session in store.list_sync_sessions():
    fetch list_session_events(session_id, last_uploaded_seq)
    POST /worker/events/batches
    update local cursor on session_acks
```

`store.list_sync_sessions()` returns every session the worker knows
about. **It is not exposure-gated today.**

**`cloud_workspace.origin_json`** is nullable and free-form. Used
informally by automation runners. There is no enum-typed `origin`
column today.

**Direct-access reads on `cloud_workspace`** (call sites today):

```text
cloud_workspace.active_sandbox_id   server/cloud/runtime/config_sync/repo_config.py
cloud_workspace.runtime_url         server/cloud/runtime/service.py,
                                    server/cloud/runtime/liveness/ensure_running.py
cloud_workspace.runtime_token_ciphertext  server/cloud/runtime/service.py
cloud_workspace/runtime_environment direct-access fields are also read
  through db/store/cloud_workspaces.py, runtime/liveness/ensure_running.py,
  repo_config/service.py, runtime/provision.py, and runtime/setup_monitor.py.

Raw AnyHarness protocol access is not owned by these product paths; it lives
under server/proliferate/integrations/anyharness/**.
```

These columns are dropped by spec 00. Spec 04 closes the call sites
by routing through `cloud_target_runtime_access`.

**Callers of `POST /v1/cloud/commands`**:

```text
Desktop                 source = desktop_cloud_view
Web                     source = web (via cloud-sdk-react useEnqueueCloudCommand)
Mobile                  source = mobile (same SDK)
Automation              source = automation (cloud_executor_commands.py)
API                     source = api (agent_auth service)
Slack                   no caller in repo yet (spec 07 adds)
```

### 4.2 Gaps spec 04 closes

- `cloud_commands.cloud_workspace_id` is in
  `authorization_context_json` but not a column. Spec 00 promotes it.
  Spec 04 makes every caller stamp it and every reader use it.
- Command leasing correlates only by `target_id`; spec 00 removed the slot
  fence, so there are no `leased_cloud_sandbox_id`/`leased_slot_generation`
  columns to implement.
- `_validate_runtime_config_preflight()` does not exist; spec 04 adds
  it as the peer of `_validate_agent_auth_preflight()`.
- Worker dispatcher does not synthesize `AgentAuthExternalScope` from
  `sandboxProfileId`; spec 04 wires it per spec 02 §5.2.
- `cloud_workspace_exposure` table does not exist; spec 04 creates it.
- `cloud_sessions` (the projection table) does not carry
  `exposure_id`, `projection_level`, `commandable`, `gap_state_json`,
  `last_uploaded_seq`. Spec 04 adds them.
- `worker_projection_cursor` does not exist locally on the worker.
  Spec 04 adds it.
- Worker tailer is not exposure-gated. Spec 04 gates it.
- Wake-on-command logic does not exist. Spec 04 adds the wake hook
  inside `enqueue_command` (or a sibling delivery-time gate).
- No `origin` enum column on `cloud_workspace`. Spec 04 adds one
  using the spec-03 vocabulary.

## 5. Target Model

### 5.1 Command envelope, result, and lease — wire the spec-00 fields

Server (`cloud_commands` table) — already extended by spec 00:

```text
cloud_workspace_id        uuid fk cloud_workspace.id   nullable
```

There are no `leased_cloud_sandbox_id` / `leased_slot_generation` columns —
leasing correlates by `target_id` alone (spec 00 §5.8).

Spec 04 enforces:

```text
enqueue_command writes:
  cloud_workspace_id  (always set for managed-cloud commands; null
                       for non-managed targets like SSH/local)

lease / result / delivery / event ingest correlate by target_id:
  worker.target_id MUST equal command.target_id, and the command's target
  MUST NOT be archived. If the target was replaced (archived):
    - the report is inert; no projection / workspace / billing state is
      updated from a retired target
    - the command is marked superseded (status = 'superseded')
  target_id is the epoch — there is no slot id or slot_generation to compare,
  and no "mark worker stale" step: a replaced sandbox is a brand-new target
  with a brand-new worker that never shared identity with the old one.
```

Worker wire (already added by spec 00 contract change):

```text
CloudCommandEnvelope:
  cloud_workspace_id    Option<Uuid>
  sandbox_profile_id    Option<Uuid>

CommandResultRequest:
  cloud_workspace_id        Option<Uuid>
  anyharness_workspace_id   Option<String>    -- echoed on materialize

CommandDeliveryRequest:
  cloud_workspace_id    Option<Uuid>
```

No `slot_generation` on any of these — `target_id` (already present) is the
identity.

Where the worker fills in these fields:

```text
On materialize_workspace result:
  - echo cloud_workspace_id from the inbound envelope
  - on success: set anyharness_workspace_id = the created/resolved
    AnyHarness workspace id
  - server verifies cloud_workspace_id resolves to a row + matches
    the command's cloud_workspace_id, and the command's target is the
    active (non-archived) primary; then updates
    cloud_workspace.anyharness_workspace_id + materialized_target_id

On every other command result:
  - echo cloud_workspace_id when known
```

### 5.2 Runtime config preflight

New peer of `_validate_agent_auth_preflight()`:

```text
server/proliferate/server/cloud/commands/service.py

_validate_runtime_config_preflight(db, payload, target, profile):
  required_seq      = payload.get('requiredRuntimeConfigSequence')
  required_rev_id   = payload.get('requiredRuntimeConfigRevisionId')
  if both None:
    return  # caller did not assert any preflight
  state = load sandbox_profile_target_state(profile.id, target.id)
  if state is None:
    reject 'runtime_config_not_applied'
  if state.applied_runtime_config_sequence < required_seq:
    reject 'runtime_config_stale'
  if required_rev_id and state.applied_runtime_config_revision_id != required_rev_id:
    reject 'runtime_config_revision_mismatch'
  # validity is per active target: the state row is loaded for the profile's
  # active primary target. A replaced target gets a fresh state row, so there
  # is no slot generation to compare.
```

Called from `enqueue_command` for kinds that require it:

```text
start_session, send_prompt, resolve_interaction, update_session_config,
materialize_workspace (target-applied check before re-materializing
                       on a slot whose runtime config is behind)
```

`materialize_environment` is the apply command itself, not gated by
this preflight. It carries the new revision; the preflight gates
*subsequent* commands.

When preflight fails with `runtime_config_stale` (the common case),
the caller's choice is either:

```text
(a) auto-cascade
    enqueue materialize_environment first with the current revision,
    and enqueue the requested command after that. The server stitches
    them with idempotency keys so a retry collapses.
(b) fail fast
    return the stale error to the caller; caller re-fetches state and
    decides what to do.
```

V1 default: **fail fast**. The "configure your sandbox before launching"
flow is the user-visible contract. Auto-cascade is added as a follow-up
once the UI shows the materialize step explicitly.

### 5.3 Exposure model

New table:

```text
cloud_workspace_exposure
  id                              uuid pk
  target_id                       uuid fk cloud_targets.id            not null
  cloud_workspace_id              uuid fk cloud_workspace.id          not null
  anyharness_workspace_id         text                                nullable

  owner_scope                     text   'personal' | 'organization'
  owner_user_id                   uuid fk user.id                     nullable
  organization_id                 uuid fk organization.id             nullable

  visibility                      text   'private' | 'shared_unclaimed'
                                          | 'claimed' | 'archived'
  claimed_by_user_id              uuid fk user.id                     nullable

  default_projection_level        text   'index_only' | 'session_summaries'
                                          | 'transcript' | 'live'
  commandable                     boolean                             not null default true

  status                          text   'active' | 'paused' | 'stale' | 'revoked'
  revision                        integer                             not null default 1
  last_projected_at               timestamptz                         nullable

  origin                          text                                nullable
                                  (matches spec-03 Origin vocabulary)

  created_at, updated_at, archived_at

  CHECK ck_cloud_workspace_exposure_owner_fields
  CHECK ck_cloud_workspace_exposure_visibility
  CHECK ck_cloud_workspace_exposure_projection_level
  CHECK ck_cloud_workspace_exposure_claimed_user
    (claimed_by_user_id IS NOT NULL -> visibility = 'claimed')
    -- visibility='claimed' may have claimed_by_user_id NULL after user
       deletion; spec 05 treats that as orphan-claimed audit state.

  UNIQUE PARTIAL ux_cloud_workspace_exposure_active
    (target_id, cloud_workspace_id) WHERE archived_at IS NULL
```

A workspace has at most one active exposure at a time. Archiving an
exposure does not delete the workspace; it just stops Cloud from
projecting/commanding.

### 5.4 Session projection extension

Extend the existing `cloud_sessions` table (model class
`CloudSessionProjection`):

```text
ADD COLUMN exposure_id           uuid fk cloud_workspace_exposure.id   nullable
ADD COLUMN projection_level      text                                  not null default 'live'
                                 'session_summaries' | 'transcript' | 'live'
ADD COLUMN commandable           boolean                               not null default true
ADD COLUMN gap_state_json        text                                  nullable
                                 { last_gap_seq, last_repair_attempt_at, kind }
ADD COLUMN last_uploaded_seq     integer                               nullable
                                 mirror of cloud_event_ingest_state for fast reads
ADD COLUMN agent_run_config_snapshot_json  jsonb                       nullable
                                 -- resolved cloud_agent_run_config
                                    values at session-creation time;
                                    spec 06 §5.3 snapshot pattern.
                                    Set by the launch caller (Desktop /
                                    web / mobile / cowork) on
                                    start_session; immutable thereafter.

backfill:
  default projection_level = 'live'
  default commandable      = true
  exposure_id              = NULL until exposure rows exist; populated
                             as exposures are created by spec 04's
                             managed_profile_launch service
```

Behavior:

```text
projection_level = 'session_summaries'
  -> Cloud lists session, status, title; does not store transcript rows
  -> commandable = false typically; not enforced by DB

projection_level = 'transcript'
  -> Cloud stores cloud_transcript_item, cloud_pending_interaction rows
  -> commandable may be true (read+write) or false (read-only)

projection_level = 'live'
  -> as transcript, plus live-fanout SSE / websocket feed
```

`gap_state_json` is set when event ingest detects a sequence gap (a
missing `anyharness_seq`). The worker tailer's
`backfill_exposed_workspace` command kind re-fetches the missing seq
range; on success, `gap_state_json` is cleared.

### 5.5 Worker projection cursor

New worker SQLite table:

```text
worker_projection_cursor
  session_projection_id    text primary key
  exposure_id              text                  not null
  anyharness_workspace_id  text                  not null
  anyharness_session_id    text                  not null
  projection_level         text                  not null
  commandable              boolean               not null
  last_uploaded_seq        integer               not null default 0
  last_ack_seq             integer               not null default 0
  status                   text                  not null default 'active'
  gap_state_json           text                  nullable
  updated_at               text                  not null
```

The cursor is keyed by `session_projection_id`, not `exposure_id`. One
workspace exposure can have multiple sessions; keying by exposure would
silently collapse all but one active session. Worker responses may also
include workspace-only exposure rows with no session projection; those
rows are status/readiness input only and are not stored as tail cursors.

Worker tailer reconciliation:

```text
worker pulls active exposures + projections from Cloud:
  GET /v1/cloud/worker/exposures      (worker-token-only)
  -> list of { exposure_id, target_id, cloud_workspace_id,
               anyharness_workspace_id, anyharness_session_id,
               projection_level, commandable, status, revision,
               last_uploaded_seq }

worker upserts worker_projection_cursor rows for active session projections.
worker removes rows for revoked/paused exposures (or marks them
inactive).

tailer.run_loop iterates only over active worker_projection_cursor
rows. Sessions outside the active set are NOT tailed.
```

When a new session starts on the worker side (e.g. `start_session`
arrives, the AnyHarness session id is known after creation), the
worker reports it back to Cloud via the command result; Cloud
upserts the corresponding `cloud_session_projection` row and worker
re-fetches active exposures on the next reconciliation tick.

### 5.6 Wake gate

A wake-required command is one that needs the AnyHarness process to
be running. Wake-required kinds:

```text
materialize_workspace
materialize_environment              (target apply; needs the runtime)
refresh_agent_auth_config            (needs PUT /v1/agents/auth-config)
start_session
send_prompt
resolve_interaction
update_session_config
cancel_turn       (when the runtime must observe; close_session same)
close_session
backfill_exposed_workspace
```

Non-wake-required:

```text
configure_git_identity     (idempotent; can run on next wake naturally
                            unless caller wants it now)
ensure_repo_checkout       (same)
```

**Wake is async.** `enqueue_command` does not block on E2B. The
command row is persisted immediately; if the target's sandbox needs to be
woken, a background wake job is kicked off and the command stays in
`queued` status until the worker (after the sandbox resumes) leases it.

Web and mobile callers already poll for command status; the wake
latency becomes visible as time-in-`queued` without any new polling
surface. UI can surface "Your cloud is starting up" by reading
`GET /v1/cloud/sandbox-profiles/{id}/target-state` (existing) which
includes the sandbox status.

Wake control flow:

```text
server/proliferate/server/cloud/commands/service.py
  enqueue_command(...):
    ... existing preflight (agent_auth + runtime_config) ...
    persist cloud_commands row (status='queued')
    if kind in WAKE_REQUIRED_KINDS and target.kind == 'managed_cloud':
        kick_off_managed_sandbox_wake(target_id, command_id)
    return command_id   # NEVER blocks on E2B

server/proliferate/server/cloud/runtime/wake.py        (new)
  kick_off_managed_sandbox_wake(target_id, command_id):
    # synchronous portion: just enqueue the background job.
    # idempotent under concurrent callers via advisory lock per
    # target id; only one wake job is in-flight per target.
    advisory_lock_try(target_id)
    if wake_job_already_running(target_id):
        return                           # piggy-back on the in-flight job
    enqueue_wake_job(target_id)

  run_managed_sandbox_wake_job(target_id):
    # background worker function
    lock (target_id) advisory
    load the target's sandbox (1:1 with the active primary target)
    if sandbox.status == 'running':
        return  # nothing to do (a sibling command already woke it)
    consult spec-09 billing hook (deny if blocked):
        if denied:
            mark all queued wake-required commands for this target as
              failed_delivery with error_code='sandbox_wake_blocked'
            return
    if sandbox.status in ('paused', 'blocked'):
        perform_proliferate_owned_e2b_resume(sandbox)
        sandbox.status = 'resuming'
        record wake event for audit
    if sandbox.status == 'creating':
        await bounded for the in-flight create
    wait_for_worker_heartbeat(target_id, timeout)
    if sandbox.status != 'running' after timeout:
        mark all queued wake-required commands as failed_delivery
          with error_code='sandbox_wake_failed'
        return
    # worker is now polling; it will pick up the queued commands
    # naturally on its next lease tick.
```

The worker side does not change: when the sandbox is paused, the worker
process is suspended (no polling); after wake the worker resumes and
leases the queued commands. (The poll transport itself — the control
long-poll — is owned by the worker contract, not this section.)

**Fail-fast for terminal wake failures.** If the wake job runs out of
bounded retries or billing denies, queued wake-required commands for
that target transition to `failed_delivery` immediately with a typed
`error_code`. They do not loiter in `queued` waiting for hope:

```text
sandbox_wake_failed     E2B SDK returned a terminal error,
                        or worker did not heartbeat after wake.

sandbox_wake_blocked    spec-09 billing/policy denied the wake
                        (e.g. compute exhausted, billing block).

sandbox_wake_timeout    wake_timeout exceeded without the sandbox reaching
                        'running'. Same UX as failed; separate code
                        for diagnostics.
```

Callers polling `GET /v1/cloud/commands/{id}` see the transition from
`queued` → `failed_delivery` and surface a typed error. There is no
"queued forever" state.

**Explicit wake action** (for "warm up my cloud before I type"):

```text
POST /v1/cloud/sandbox-profiles/{profile_id}/wake
  body: { target_id? }   (defaults to the primary target)
  behavior: idempotent kick_off_managed_sandbox_wake;
            returns immediately with current sandbox state
  response: { sandbox_profile_id, target_id, sandbox_status,
              wake_in_flight, last_wake_started_at }
  errors:
    sandbox_wake_blocked  if billing denies (no row created)
    profile_not_active    if profile.status not in
                           ('active','provisioning')
```

This is a UX convenience. It does the same work `enqueue_command`
would, but without persisting a command. Mobile/web's "Resume
session" or "Wake cloud" button calls it before the user starts
typing so the latency happens behind a progress affordance.

Idempotency: `kick_off_managed_sandbox_wake` is safe to call
concurrently. The advisory lock + sandbox status re-read makes parallel
callers converge on one in-flight wake job.

Spec 09 owns the billing gate inside the wake job; spec 04 wires the
call hook. Spec 04's wake job uses a stub that returns "allow" until
spec 09 lands.

### 5.7 Workspace metadata

Add a typed `origin` column to `cloud_workspace`:

```text
ALTER TABLE cloud_workspace
  ADD COLUMN origin text NOT NULL DEFAULT 'manual_desktop'

CHECK ck_cloud_workspace_origin:
  origin IN ('manual_desktop','manual_web','manual_mobile',
             'automation','slack','cowork_api')
```

Mapping current data:

```text
existing rows: stamp origin from origin_json.kind where available,
                else default 'manual_desktop'.
```

`origin_json` stays for free-form metadata (originator details that
don't fit the enum) but is no longer the primary key for "where did
this come from."

`exposure_state` and `sandbox_type` are **derived**, not stored:

```text
exposure_state
  derived from cloud_workspace_exposure rows + their status/visibility
  values defined in spec-03 §5.3 Exposure vocabulary
  returned from GET /v1/cloud/workspaces/{id} as a computed field

sandbox_type
  derived from cloud_targets.kind + sandbox_profile.owner_scope:
    kind='local'                       -> 'local'
    kind='ssh'                         -> 'ssh'
    kind='managed_cloud'
      AND profile.owner_scope='personal'    -> 'managed_personal'
      AND profile.owner_scope='organization' -> 'managed_shared'
  returned from GET /v1/cloud/workspaces/{id} as a computed field
```

Derived fields are read-only on the API; they have no UPDATE path.

### 5.8 Worker dispatcher updates

```text
anyharness/crates/proliferate-worker/src/commands/dispatcher.rs

process_command(envelope):
  - if envelope.kind in agent_auth_scoped_kinds:
      synthesize AgentAuthExternalScope {
        provider: "proliferate-cloud",
        id: envelope.sandbox_profile_id?.to_string(),
        target_id: Some(envelope.target_id.to_string())
      }
      attach to AnyHarness CreateSessionRequest /
      ResumeSessionRequest
      (per spec 02 §5.2)

  - if envelope.kind in runtime_config_scoped_kinds:
      attach expected_runtime_config_revision {
        revision_id, content_hash, external_scope: { provider:
        "proliferate-cloud", id: sandbox_profile_id, target_id }
      } from envelope payload to AnyHarness create/resume request
      (per spec 01 §5.10)

  - on materialize_workspace result success:
      include anyharness_workspace_id and echo cloud_workspace_id
```

Worker reads new envelope fields from the contract; no version
gating (spec-03 migration-posture rule).

### 5.9 Passive UI rule

Cloud-mediated lists, summaries, and status reads NEVER trigger a
sandbox wake. The cloud_workspace + cloud_workspace_exposure +
cloud_session_projection + cloud_transcript_item rows are the
authoritative source.

Concretely:

```text
GET /v1/cloud/workspaces
GET /v1/cloud/workspaces/{id}
GET /v1/cloud/workspaces/{id}/sessions
GET /v1/cloud/sessions/{id}
GET /v1/cloud/sessions/{id}/transcript
GET /v1/cloud/sessions/{id}/pending-interactions
GET /v1/cloud/sandbox-profiles/{id}/target-state
GET /v1/cloud/sandbox-profiles/{id}/exposures      (new; admin & owner)

These endpoints:
  - read from Cloud DB only
  - never call kick_off_managed_sandbox_wake
  - never read cloud_target_runtime_access
  - return cached transcript / pending-interaction rows even if the
    sandbox is paused
```

A test in `server/tests/cloud/test_passive_ui_does_not_wake.py`
asserts that calling the GET endpoints above on a workspace whose
sandbox is paused does not mutate `cloud_sandbox.status` and does not
emit a wake event.

### 5.10 Removing direct-access reads from cloud_workspace

Spec 00 drops `cloud_workspace.active_sandbox_id`, `runtime_url`,
`runtime_token_ciphertext`. Spec 04 closes the callers:

```text
server/proliferate/server/cloud/runtime/config_sync/repo_config.py
  - read active_sandbox_id from cloud_target_runtime_access
  - read anyharness_base_url from cloud_target_runtime_access
  - decrypt runtime_token_ciphertext from cloud_target_runtime_access

server/proliferate/server/cloud/runtime/service.py
  - same; all direct-access reads route through
    cloud_target_runtime_access

server/proliferate/server/cloud/runtime/liveness/ensure_running.py
server/proliferate/server/cloud/runtime/config_sync/runtime_config.py
  - runtime access arrives through cloud_target_runtime_access-backed callers;
    raw AnyHarness protocol access stays in integrations/anyharness/**
```

Boundary rule (matches spec 00 §5.5):

```text
cloud_target_runtime_access is for:
  managed provisioning bootstrap
  allowlisted health checks
  diagnostics

Production Cloud -> AnyHarness mutations go through
cloud_commands -> worker -> AnyHarness.
```

A grep `rg "cloud_workspace\.(active_sandbox_id|runtime_url|runtime_token_ciphertext|anyharness_data_key_ciphertext)" server/proliferate`
returns no hits after spec 04 lands.

### 5.11 API surface added by this spec

User/admin:

```text
GET  /v1/cloud/workspaces/{cloud_workspace_id}/exposure
POST /v1/cloud/workspaces/{cloud_workspace_id}/exposure
PATCH /v1/cloud/workspace-exposures/{exposure_id}
       body: { default_projection_level?, commandable?,
               visibility?: requires admin/claim policy ok }
DELETE /v1/cloud/workspace-exposures/{exposure_id}     (archives)

GET  /v1/cloud/sandbox-profiles/{id}/exposures
       owner/admin view of active exposures across the profile

POST /v1/cloud/sessions/{session_id}/projection
       upgrade/downgrade projection_level (or create from a session
       discovered by backfill_exposed_workspace)

POST /v1/cloud/sandbox-profiles/{id}/wake
       body: { target_id? }
       idempotent; kicks off the async wake job; returns immediately
       with current slot state. Used by mobile/web "warm up cloud"
       affordances and any UX that wants to surface "starting up"
       before the first command is sent.
```

Worker (worker-token-only):

```text
GET /v1/cloud/worker/exposures
       returns active exposures + projections for the worker's target
       plus revision metadata so the worker can detect changes
```

Existing endpoints:

```text
POST /v1/cloud/commands                      (existing; payloads gain
                                              requiredRuntimeConfig*)
GET  /v1/cloud/commands/{id}                 (existing)
POST /v1/cloud/worker/commands/lease         (existing; target-correlated)
POST /v1/cloud/worker/commands/{id}/result   (existing; echo fields)
POST /v1/cloud/worker/commands/{id}/delivery (existing)
POST /v1/cloud/worker/events/batches         (existing; exposure-gated
                                              by Cloud-side check)
```

Cloud event ingest accepts batches only for sessions whose
projection has `projection_status = 'active'`. Batches for revoked/archived
projections are accepted but discarded with a structured warning
(useful for diagnostics) — see the per-event ack list.
Event ingest MUST look up the active exposure/projection before applying
events and MUST NOT auto-create `cloud_sessions` / projection rows from worker
event batches.

## 6. Files To Change

Server (Python):

```text
server/proliferate/db/models/cloud/commands.py
  - the column adds are owned by spec 00; spec 04 imports the new
    fields and uses them in service code

server/proliferate/db/models/cloud/workspaces.py
  - add origin enum column + CHECK
  - remove direct-access columns (already owned by spec 00; spec 04
    just confirms removal in migration ordering)

server/proliferate/db/models/cloud/sync.py
  - CloudSessionProjection (table cloud_sessions):
      add exposure_id, projection_level, commandable, gap_state_json,
      last_uploaded_seq columns + CHECKs

server/proliferate/db/models/cloud/exposures.py        (new)
  CloudWorkspaceExposure
  CloudWorkspaceExposureRevision (optional audit ring; defer if not
                                  needed by spec 05)

server/alembic/versions/<NEW>_exposure_projection_and_wake.py
  - cloud_workspace_exposure
  - cloud_sessions projection columns
  - cloud_workspace.origin column

server/proliferate/db/store/cloud_sync/
  exposures.py                    (new) snapshot loaders/upserts
  projections.py                  (new) cloud_sessions projection upserts
                                        and gap_state writes
  events.py                       update ingest to set
                                        last_uploaded_seq on
                                        cloud_session_projection
  workspaces.py                   write origin enum

server/proliferate/server/cloud/commands/service.py
  - thread cloud_workspace_id into every enqueue (already in
    authorization_context_json; promote to column)
  - _validate_runtime_config_preflight()
  - call kick_off_managed_sandbox_wake for wake-required kinds (async,
    fire-and-forget; command is persisted in 'queued' immediately)
  - on lease/result/delivery: correlate by target_id; reject (mark
    superseded) when the command's target is archived; emit observability
    event

server/proliferate/server/cloud/commands/api.py
  - response shape: include exposure_id, projection_id, target identity
    where helpful

server/proliferate/server/cloud/workspaces/service.py
  - rewrite create_cloud_workspace to use the new managed_profile_launch
    helper (signature below)
  - stamp origin enum from caller (web/desktop/automation/slack)

managed_profile_launch signature (canonical; every caller imports here):

  def managed_profile_launch(
      db: AsyncSession,
      *,
      owner_scope: str,                    # 'personal' | 'organization'
      owner_user_id: UUID | None,
      organization_id: UUID | None,
      normalized_repo_key: str,
      git_branch: str | None,
      worktree_path: str | None,
      origin: str,                         # spec 03 §5.3 Origin enum value
      source_kind: str,                    # spec 05 §5.1 source_kind for
                                           # claim provenance; matches origin
                                           # for most callers; 'manual' for
                                           # Desktop dispatch
      exposure_visibility: str,            # spec 04 §5.3 visibility enum
      exposure_commandable: bool,
      default_projection_level: str,       # 'live' | 'transcript' |
                                           # 'session_summaries'
      required_runtime_config_revision_id: str | None,   # spec 01
      required_agent_auth_revision: int | None,          # spec 02
      actor_user_id: UUID,
      idempotency_key: str | None = None,
  ) -> ManagedProfileLaunchResult:
      ...

  class ManagedProfileLaunchResult:
      sandbox_profile_id:        UUID
      target_id:                 UUID
      active_sandbox_id:         UUID    # the cloud_sandbox row, 1:1 with target
      cloud_workspace_id:        UUID
      cloud_workspace_exposure_id: UUID
      cloud_session_projection_id: UUID | None   # set later on start_session
      already_exists:            bool   # idempotency: True if same key
                                         # resolved to existing rows

The helper is transactional: ensure_*_sandbox_profile,
ensure_primary_profile_target, provision_managed_target (background-
provisioned), cloud_workspace INSERT, cloud_workspace_exposure
INSERT or revision bump, all in one server-side flow. On
failure before exposure insert, the cloud_workspace row is rolled
back.

Sandbox provisioning runs in the background (spec 00 §2.1); the
helper returns once the cloud_workspace + exposure rows exist
even if the sandbox is still `creating`. Wake-required commands
that arrive against a creating sandbox use the spec 04 §5.6 async
wake path.

Sensible exposure defaults per caller (callers pass these
explicitly; the helper does not infer):
  personal launch            visibility='private', commandable=true
  automation personal        visibility='private', commandable=true
  automation team            visibility='shared_unclaimed', commandable=true
  slack team                 visibility='shared_unclaimed', commandable=true
  desktop dispatch           visibility='private', commandable=true
  - create or upsert cloud_session_projection on session start

server/proliferate/server/cloud/runtime/wake.py     (new)
  kick_off_managed_sandbox_wake(target_id, command_id?)   (sync; enqueues
                                                           background job)
  run_managed_sandbox_wake_job(target_id)                 (background)
  perform_proliferate_owned_e2b_resume(sandbox)

server/proliferate/server/cloud/runtime/config_sync/repo_config.py
server/proliferate/server/cloud/runtime/service.py
server/proliferate/server/cloud/runtime/liveness/ensure_running.py
server/proliferate/server/cloud/runtime/config_sync/runtime_config.py
  - read from cloud_target_runtime_access instead of cloud_workspace

server/proliferate/server/cloud/workspaces/api.py
  - GET /workspaces/{id} returns computed exposure_state + sandbox_type
  - POST /workspaces/{id}/exposure
  - PATCH /workspace-exposures/{id}
  - DELETE /workspace-exposures/{id}

server/proliferate/server/cloud/sandbox_profiles/api.py
  - GET /sandbox-profiles/{id}/exposures   (admin & owner)

server/proliferate/server/cloud/worker/api.py
  - GET /worker/exposures
  - event ingest: discard events for inactive projections with a
    structured per-event ack

server/proliferate/server/automations/worker/cloud_execution/**
  - automation runner uses the new managed_profile_launch helper
  - origin = 'automation' on workspace + exposure
```

Worker (Rust):

```text
anyharness/crates/proliferate-worker/src/commands/dispatcher.rs
  - synthesize AgentAuthExternalScope on agent-auth-scoped kinds
  - attach expected_runtime_config_revision on runtime-config-scoped kinds
  - echo cloud_workspace_id on results

anyharness/crates/proliferate-worker/src/commands/mapping.rs
  - propagate envelope fields through to AnyHarness contract types

anyharness/crates/proliferate-worker/src/cloud_client/exposures.rs   (new)
  GET /v1/cloud/worker/exposures
  Snapshot dataclasses

anyharness/crates/proliferate-worker/src/store/
  worker_projection_cursor schema + DAO

anyharness/crates/proliferate-worker/src/sync/tailer.rs
  - replace store.list_sync_sessions() with
    store.list_active_projection_cursors()
  - on reconcile tick, refresh active exposures from Cloud
  - record gaps via projection cursor; surface to Cloud on next ingest

anyharness/crates/proliferate-worker/src/sync/backfill.rs
  - sync_existing_workspace is renamed to backfill_exposed_workspace
    in the same PR (server enum, worker supported_kinds, DB CHECK,
    payload type, SDK regen). Becomes the explicit backfill-when-
    exposure-is-new flow.
```

SDK regeneration:

```text
anyharness/sdk         (no contract change in spec 04 beyond what
                        spec 00/01/02 already shipped)
cloud/sdk              (add exposures/projection clients, new fields
                        on workspace responses)
```

Desktop:

```text
apps/desktop/src/hooks/access/cloud/workspaces/                    extend
  - returns exposure_state and sandbox_type from server payload
apps/desktop/src/hooks/access/cloud/exposures/                     (new)
  use-workspace-exposure.ts, use-exposure-mutations.ts
apps/desktop/src/hooks/access/cloud/projections/                   (new)
  use-session-projection.ts
apps/desktop/src/components/cloud/                                 add passive
  workspace sidebar row uses exposure_state + sandbox_type from
  vocabulary.ts (spec 03)
```

## 7. Implementation Chunks

```text
Chunk A  cloud_workspace_id + target correlation on commands
  - command service stamps cloud_workspace_id at enqueue
  - lease/result/delivery/event ingest correlate by target_id
  - reports from an archived (replaced) target are inert; command superseded
  - tests: archived-target result discarded; superseded marker

Chunk B  Runtime config preflight
  - _validate_runtime_config_preflight()
  - enqueue rejects stale; fail-fast V1
  - test: start_session with stale requiredRuntimeConfigSequence
    is rejected before reaching the worker

Chunk C  Exposure + projection model
  - cloud_workspace_exposure table
  - cloud_sessions projection columns
  - upsert exposure + projection on managed_profile_launch
  - worker /worker/exposures endpoint
  - worker projection cursor + tailer rewrite
  - event ingest gated by projection.status='active'

Chunk D  Async wake job
  - kick_off_managed_sandbox_wake (sync; advisory lock; enqueues job)
  - run_managed_sandbox_wake_job (background; consults billing hook;
    E2B resume; waits for heartbeat)
  - WAKE_REQUIRED_KINDS constant
  - POST /v1/cloud/sandbox-profiles/{id}/wake endpoint
  - failed wake transitions queued wake-required commands for the
    target to failed_delivery with typed error_code
  - tests: enqueue never blocks; wake runs in background; command
    transitions queued -> leased after wake; wake fail -> queued ->
    failed_delivery

Chunk E  Workspace metadata + derived fields
  - origin enum column with CHECK
  - origin stamped by every caller (web/desktop/automation/slack)
  - workspace API computes exposure_state + sandbox_type
  - desktop reads via use-workspace

Chunk F  Direct-access cleanup
  - repo_config_apply, runtime service, anyharness_api, ensure_running,
    credential_freshness, provision, setup_monitor, repo_config/service.py,
    db/store/cloud_runtime_environments.py, and db/store/cloud_workspaces.py
    stop reading/writing cloud_workspace/runtime_environment direct-access
    fields on managed-cloud launch paths
  - cloud_target_runtime_access is the only home
  - grep verifies zero matches

Chunk G  Passive UI invariant tests
  - integration test that calls every passive GET endpoint with a
    paused sandbox and asserts no slot mutation, no E2B SDK call
```

Preferred implementation is one PR per spec. Chunks are review checkpoints inside that PR and may be split only when the split does not leave duplicate models, dead paths, partially wired security checks, or visible inert UI.

## 8. Acceptance Criteria

1. Every managed-cloud `cloud_commands` row carries
   `cloud_workspace_id`. Non-managed (SSH, local) rows leave it NULL.
2. Command leasing correlates by `target_id` only; there is no
   `leased_cloud_sandbox_id` / `leased_slot_generation`.
3. Result, delivery, and event ingest reject reports from an archived
   (replaced) target. Affected commands are marked `superseded`. There is
   no slot generation and no "mark worker stale" step — a replaced sandbox
   is a brand-new target with a brand-new worker.
4. `_validate_runtime_config_preflight()` exists in
   `commands/service.py` and is called from `enqueue_command` for
   `start_session`, `send_prompt`, `resolve_interaction`,
   `update_session_config`, and `materialize_workspace`.
5. V1 preflight behaviour is **fail fast** on stale runtime config.
   Auto-cascade is a follow-up.
6. `cloud_workspace_exposure` exists with the schema in §5.3.
   Active exposure is unique per `(target_id, cloud_workspace_id)`.
7. `cloud_sessions` (CloudSessionProjection) has `exposure_id`,
   `projection_level`, `commandable`, `gap_state_json`,
   `last_uploaded_seq` columns.
8. Worker tailer is exposure-gated: it tails only sessions whose
   `cloud_session_projection.projection_status = 'active'` AND parent
   exposure is active. Sessions outside the active set are not
   uploaded.
9. `enqueue_command` never blocks on E2B. Wake-required commands
   are persisted in `queued` status; if the sandbox is not running,
   `kick_off_managed_sandbox_wake` is called and the wake job runs in
   the background. The command transitions to `leased` after the
   sandbox reaches `running` and the worker picks it up.
10. The async wake job consults the spec-09 billing hook (a stub
    returning "allow" is fine in this spec; spec 09 fills it in).
    Wake denials transition queued commands to `failed_delivery`
    with `error_code='sandbox_wake_blocked'` and never let them
    loiter in `queued`.
10a. Bounded wake retry exhaustion transitions queued commands to
    `failed_delivery` with `error_code='sandbox_wake_failed'` (E2B
    terminal) or `'sandbox_wake_timeout'` (no heartbeat after
    timeout). Same caller-visible failure surface; separate codes
    for diagnostics.
10b. `POST /v1/cloud/sandbox-profiles/{id}/wake` is idempotent.
    Concurrent callers converge on one in-flight wake job per
    target via an advisory lock.
11. `cloud_workspace.origin` is a typed column constrained to the
    spec-03 Origin vocabulary. Every workspace-create caller sets
    it.
12. `GET /v1/cloud/workspaces/{id}` returns computed `exposure_state`
    and `sandbox_type` fields using the spec-03 vocabulary string
    values. Neither is a stored column.
13. Worker dispatcher synthesizes `AgentAuthExternalScope` on
    agent-auth-scoped kinds (spec 02 §5.2) and attaches
    `expected_runtime_config_revision` on runtime-config-scoped
    kinds (spec 01 §5.10).
14. Managed-cloud launch paths no longer read/write
    `cloud_workspace.active_sandbox_id`, `cloud_workspace.runtime_url`,
    `cloud_workspace.runtime_token_ciphertext`, `cloud_runtime_environment`
    direct-access fields, or runtime access copied through
    `db/store/cloud_workspaces.py`. Runtime access reads route through
    `cloud_target_runtime_access`.
15. Passive UI endpoints (§5.9 list) never call
    `kick_off_managed_sandbox_wake` and never trigger a wake event.
    Integration test asserts this for a paused sandbox.
16. Cloud event ingest discards (with a per-event ack) events for
    projections whose status is not `active`. The discard is
    observable in the ack list but does not mutate transcript or
    pending-interaction rows.
17. `GET /v1/cloud/worker/exposures` exists and is worker-token-only.
    The worker projection cursor table reconciles to its response.
18. `materialize_workspace` worker result echoes `cloud_workspace_id`
    and (on success) `anyharness_workspace_id`. The server rejects
    results whose `cloud_workspace_id` does not match an existing
    row (spec 00 acceptance #23 enforced here).
19. The automation runner and Slack workspace launch (when spec 07
    lands) call the same `managed_profile_launch` helper.
20. Worker tailer's `backfill_exposed_workspace` (renamed from
    `sync_existing_workspace` in this PR; same-PR rename, no alias)
    fires only when an exposure is newly active or after a gap is
    detected. It is not used for routine ingest.

## 9. Verification / Tests

Server:

```bash
cd server && uv run pytest -q
```

Targeted tests:

```text
server/tests/cloud/commands/test_cloud_workspace_id_promoted_to_column.py
server/tests/cloud/commands/test_target_correlation_lease.py
server/tests/cloud/commands/test_archived_target_result_rejection.py
server/tests/cloud/commands/test_superseded_on_archived_target.py
server/tests/cloud/commands/test_runtime_config_preflight_stale.py
server/tests/cloud/commands/test_runtime_config_preflight_revision_mismatch.py
server/tests/cloud/commands/test_runtime_config_preflight_ok.py
server/tests/cloud/commands/test_enqueue_does_not_block_on_e2b.py
server/tests/cloud/commands/test_wake_kicked_off_for_wake_required_kinds.py
server/tests/cloud/commands/test_no_wake_for_non_wake_required.py
server/tests/cloud/commands/test_wake_job_consults_billing_hook.py
server/tests/cloud/commands/test_wake_failure_transitions_queued_to_failed.py
server/tests/cloud/commands/test_wake_idempotent_under_concurrent_kicks.py
server/tests/cloud/sandbox_profiles/test_wake_action_endpoint.py
server/tests/cloud/exposures/test_exposure_unique_per_workspace.py
server/tests/cloud/exposures/test_exposure_visibility_check.py
server/tests/cloud/exposures/test_exposure_default_for_personal_launch.py
server/tests/cloud/exposures/test_exposure_default_for_automation.py
server/tests/cloud/exposures/test_exposure_default_for_slack_launch.py
server/tests/cloud/projections/test_projection_columns_present.py
server/tests/cloud/projections/test_event_ingest_discards_inactive.py
server/tests/cloud/projections/test_gap_state_repair_flow.py
server/tests/cloud/workspaces/test_origin_enum_check.py
server/tests/cloud/workspaces/test_sandbox_type_derivation.py
server/tests/cloud/workspaces/test_exposure_state_derivation.py
server/tests/cloud/runtime/test_no_direct_access_reads_cloud_workspace.py
server/tests/cloud/passive_ui/test_passive_ui_does_not_wake.py
server/tests/automations/test_automation_uses_managed_profile_launch.py
```

Worker / AnyHarness:

```bash
cargo test -p proliferate-worker
```

Targeted Rust tests:

```text
anyharness/crates/proliferate-worker/src/sync/tailer.rs#tests
  - tailer tails only active projection cursors
  - inactive cursors are skipped
  - reconciliation refreshes from /worker/exposures
  - gap detection records gap_state and stops uploads until repair

anyharness/crates/proliferate-worker/src/commands/dispatcher.rs#tests
  - agent_auth_scope synthesized on start_session
  - expected_runtime_config_revision attached on start_session/send_prompt
  - materialize_workspace result echoes cloud_workspace_id
  - non-wake-required commands proceed even on a paused-status slot
    (worker side; the server-side wake gate is the policy authority)
```

Manual smoke:

```text
1. Personal workspace launch end-to-end
   - managed_profile_launch creates cloud_workspace + exposure (private)
     + projection
   - enqueue_command stamps cloud_workspace_id and required_*_revision;
     returns command_id immediately (no E2B block)
   - if sandbox is paused: kick_off_managed_sandbox_wake fires in background;
     UI polls /sandbox-profiles/{id}/target-state for "Cloud starting up"
   - slot transitions paused -> resuming -> running; worker heartbeats
   - worker leases the queued command, materializes, echoes ids
   - tailer picks up the new session via /worker/exposures
   - cloud_session_projection becomes active

1a. Mobile "warm up cloud" before typing
   - mobile calls POST /v1/cloud/sandbox-profiles/{id}/wake
   - server returns immediately with current slot state
   - background wake job runs; mobile polls target-state
   - by the time user finishes typing, the sandbox is running; first
     send_prompt has no wake latency

1b. Wake failure (billing block)
   - billing hook denies wake
   - all queued wake-required commands for the target transition
     queued -> failed_delivery with error_code='sandbox_wake_blocked'
   - caller's command-status poll surfaces the typed error
   - no commands loiter in queued forever

2. Slack-style team launch (preparation for spec 07)
   - managed_profile_launch with origin='slack' and visibility='shared_unclaimed'
   - exposure visible to org members
   - projection active; commandable=true
   - workspace listing for org members shows it without waking

3. Target replacement mid-flight
   - active session running
   - replace the managed target (archive old target + sandbox, provision new)
   - worker on the old target reports a result -> inert/superseded
     (the old target is archived; nothing routes to it)
   - the new target gets a fresh sandbox_profile_target_state row
   - cloud_workspace.materialized_target_id invalidated -> rematerialize-required
   - new launches re-materialize before send_prompt

4. Stale runtime config
   - bump sandbox_profile_runtime_config_current to N+1
   - start_session with requiredRuntimeConfigSequence=N is rejected
     by the preflight as 'runtime_config_stale'
   - re-enqueue with requiredRuntimeConfigSequence=N+1 after
     materialize_environment applies; succeeds

5. Passive UI on paused sandbox
   - pause the sandbox
   - GET /workspaces, /sessions, /transcript all succeed without
     waking; cloud_sandbox.status stays paused

6. Direct-access cleanup
   - rg returns no cloud_workspace.runtime_* reads
   - runtime endpoints work via cloud_target_runtime_access
```

## 10. Final Decisions / Deferred Questions

1. **`materialize_environment` result split: env vs runtime_config?**

   `materialize_environment` carries both repo/env materialization
   and the runtime_config fragment (spec 01). The worker result
   structurally has one status. If the env apply succeeds but the
   runtime_config apply fails, should the command be marked
   `accepted_but_partial`?

   Decision: report `failed` if either sub-step fails. Sub-step detail
   is in `result_json.errors[]`. The user-visible "what failed"
   surface is one error per command.

2. **Exposure default for Desktop-originated remote access**

   When a Desktop user clicks "Continue remotely" on a local
   workspace, what does the resulting `cloud_workspace_exposure`
   row look like?

   The user is the same person on both surfaces (Desktop + Web /
   Mobile). They presumably want full control from the new
   surface. But two surfaces sending prompts concurrently to one
   AnyHarness session has surprise potential.

   Options:

   ```text
   (a) visibility='private', commandable=true,
       default_projection_level='live'
         -- full live control from any of the user's surfaces;
            AnyHarness session loop serializes accepted prompts;
            transcript fans out to both Desktop SSE and Cloud
            projection.

   (b) visibility='private', commandable=false,
       default_projection_level='live'
         -- mobile/web can observe, not send. User explicitly
            promotes to commandable from Desktop UI when ready.

   (c) visibility='private', commandable=true on the surface that
       last interacted, with the other auto-promoted to read-only
         -- requires per-surface state on the exposure; overkill
            for V1.
   ```

   Decision: (a). The user explicitly clicked "Continue remotely";
   they want to use it remotely. AnyHarness already serializes
   the prompt queue. Concurrent send is a documented behaviour
   (the planning notes call this out). Surprise is mitigated by
   showing "Desktop session also open" / "Mobile session also
   open" indicators in the UI — owned by spec 08.

   Other source defaults (recap; not in question for spec 04):

   ```text
   personal launch                 visibility='private',
                                   default_projection_level='live',
                                   commandable=true
   automation personal             same as personal launch
   automation team                 visibility='shared_unclaimed',
                                   commandable=true
   slack team                      visibility='shared_unclaimed',
                                   commandable=true
   ```

   Spec 05 (claiming) and spec 08 (web/mobile/dispatch) may revise
   these. Spec 04 sets the V1 defaults; later specs override per
   their UX.

3. **Should exposure revisions be append-only history rows or just
   an integer on the exposure row?**

   Decision: integer on the row (`revision` already in §5.3). Spec 05
   may add an audit ring (`cloud_workspace_exposure_audit`) when
   claim transitions need durable timestamps. Spec 04 keeps the
   shape minimal.

4. **Auto-cascade preflight: when?**

   V1 is fail-fast on stale runtime config and stale agent auth.
   Auto-cascade means: when a launch arrives with stale revisions,
   the server transparently enqueues `materialize_environment`
   first, then the requested command, stitched so a retry collapses.

   Surface-by-surface analysis:

   ```text
   Desktop / Web (interactive)
     UI knows about the sandbox; if config is stale, it can route
     the user to "Apply your changes" and let them click Apply.
     Fail-fast is the right default here. Auto-cascade would hide
     the explicit user action behind invisible enqueues.

   Mobile (interactive but lightweight)
     Same as Desktop / Web but the UI is thinner. The user can
     still see "Cloud is updating" via target-state poll. Fail-fast
     is OK; the readiness panel is the affordance.

   Automation (spec 06)
     No interactive UI between trigger and run. A "stale config"
     failure mode would show up as a failed automation run, which
     looks like a bug. Auto-cascade is the right behaviour for
     automations: run the materialize before the prompt, mark the
     run as "materialized then ran" in the run log.

   Slack (spec 07)
     Same constraint as automations. The Slack thread expects a
     response; "configure your sandbox at this URL" is a bad UX.
     Auto-cascade is correct.

   Cowork API (programmatic callers)
     Caller is explicit; can be told either way. Default to
     fail-fast so the caller's retry loop is responsible. An
     opt-in `auto_cascade=true` query/body param can request
     cascade behaviour.
   ```

   So auto-cascade is a per-source behaviour, not a global toggle.
   Concretely: spec 06 and spec 07 land their own
   `_handle_stale_runtime_config_for_<source>(command, state)`
   helpers that enqueue materialization first and re-enqueue the
   original command depending on it. Spec 04 lands the fail-fast
   default and the typed `runtime_config_stale` error code so the
   per-source handlers have something to catch.

   Two risks:

   ```text
   - Cascade loop: a "stale runtime config" might actually be a
     config error (e.g. MCP credential revoked); naive cascade would
     loop forever. Mitigation: each cascade enqueue increments a
     `cascade_attempt` counter; after N attempts the run fails with
     `runtime_config_apply_failed`.
   - Audit noise: invisible enqueues clutter the audit log.
     Mitigation: cascade commands carry `parent_command_id` and a
     `cascade_reason` field; audit views collapse them under the
     visible parent.
   ```

   Decision: fail-fast in spec 04 V1. Add auto-cascade in spec 06
   (`automation`) and spec 07 (`slack`) with the loop guard +
   parent-command linking above. Cowork API gets opt-in flag in
   spec 08 if asked for.

5. **Rename `sync_existing_workspace` → `backfill_exposed_workspace`?**

   The worker command kind today is `sync_existing_workspace`.
   The architecture spec and the new exposure model use
   `backfill_exposed_workspace`.

   What touches when renaming:

   ```text
   server constant in CloudCommandKind enum (commands.py)
   DB CHECK constraint on cloud_commands.kind
   server-side command validator
   worker dispatcher's per-kind handler
   worker supported_kinds advertised at lease time
   payload type in anyharness-contract (if specific)
   SDK regen (anyharness/sdk + cloud/sdk)
   server tests + worker tests
   ```

   It's wide but mechanical: one find-and-replace, one migration
   to update the CHECK enum, one regen pass.

   Arguments to rename:

   ```text
   - "sync" was overloaded; the spec pack explicitly says don't use
     "sync" as a product primitive (cllloud/3) Cloud Running.md).
   - The new name aligns with the exposure model: it is a backfill
     of an exposed workspace.
   - Spec 08 (dispatch) will reference this command kind heavily;
     starting with the clean name avoids docs drift.
   - We have no users; rename cost is purely engineering time.
   ```

   Arguments to keep:

   ```text
   - Worker command kinds are stable identifiers; touching them
     ripples through tests and SDK.
   - "sync" is shorter and historically used in commit messages
     and bug reports.
   ```

   Decision: rename. Same-PR rename per migration posture; no alias.
   The new name is precise enough that spec 08 can build on it
   without re-explaining what it does.

6. **The `wake_timeout` value.**

   How long should the async wake job wait for the worker to
   heartbeat before declaring failure? E2B resume is typically
   2-15 seconds; first heartbeat after resume is bounded by the
   worker's heartbeat interval (`heartbeat_interval_seconds`
   in enrollment response).

   Decision: 60 seconds bounded with 3 retries (so worst-case 3
   minutes before `sandbox_wake_timeout` fires). Tunable per
   environment via `settings.sandbox_wake_timeout_seconds` and
   `settings.sandbox_wake_max_attempts`. Reconsider after we
   have real wake latency data.
