## High level notes / mental model broadly

Cloud running is a remote control plane for targets that run AnyHarness.

Core invariant:

```text
commands go down
events go up
```

Target access split:

```text
local / SSH / directly accessible AnyHarness
  Desktop can talk directly to AnyHarness for workspace lists, sessions,
  creation, and live metadata.
  Proliferate is not paying for that compute, so direct runtime access is fine.

managed cloud personal/team
  Desktop/Web/Slack/API talk to Proliferate Cloud for passive metadata and
  orchestration.
  Cloud owns durable workspace/session projections.
  Cloud decides when billing allows the E2B sandbox to wake.
```

For managed cloud, passive product state must come from Cloud DB projections,
not from waking AnyHarness:

```text
list cloud workspaces
list cloud sessions
show transcript previews/history
show target/sandbox/billing state
  -> Cloud API / Cloud DB only
  -> no E2B wake

send prompt
open terminal
open live workspace
open preview
run automation/Slack command
sync runtime config or agent auth
  -> Cloud API
  -> billing/readiness check
  -> wake E2B if needed
  -> worker/AnyHarness
```

This is what lets E2B auto-pause save money without making the app feel like it
lost access to the user's work.

```text
web/mobile/Slack/API/automations
  -> Proliferate Cloud
  -> durable CloudCommand
  -> target Proliferate Worker
  -> local AnyHarness API

AnyHarness events
  -> Proliferate Worker
  -> Cloud ingest
  -> durable semantic rows + live fanout
  -> clients
```

Ownership:

- AnyHarness is execution truth: session loop, local SQLite, event sequence, tool/runtime behavior.
- Worker is the outbound bridge: leases commands, calls local AnyHarness, uploads events, reports readiness.
- Cloud is product/control truth: targets, commands, snapshots, policy, auth, audit, billing, retention.
- Clients render Cloud snapshots or direct AnyHarness state; they do not create runtime truth.

For managed cloud, "always accessible" means the Cloud control plane can always
show and orchestrate the target. It does not mean the E2B sandbox and
AnyHarness process are always hot. The sandbox may be paused most of the time.

MCP/skills config and agent auth are pre-launch target materialization steps. Cloud decides desired state, worker applies it, and launch proceeds only when the target is current enough.

For agent auth specifically:

```text
selection changes
  -> Cloud bumps sandbox_profile.agent_auth_revision
  -> Cloud queues refresh_agent_auth_config for the target/profile/revision
  -> worker fetches materialization plan
  -> worker applies synced files or gateway config
  -> worker reports applied_revision on target/profile state
  -> launch command preflight checks required_agent_auth_revision
```

Launch should not rely on the client resending auth config. A cold target,
restarted worker, automation, Slack run, or cloud-managed sandbox must recover
from durable Cloud state and worker materialization.

## Basic basic UX / high level

Users see targets/sandboxes, workspaces, sessions, and command status:

- Local target: Desktop talks directly to local AnyHarness.
- SSH target: worker/supervisor runs on user-accessible machine.
- Managed cloud target: worker/supervisor runs in Proliferate-managed compute.
- Shared target: org-visible target with stricter auth/claiming rules.

Cloud-mediated UX should be thinner than Desktop:

- show workspace/session list;
- show transcript/status;
- send prompts;
- resolve interactions;
- cancel/close;
- show worker/target readiness;
- link to richer Desktop/direct flows where needed.

Which events do we store?

- Store semantic product facts: messages, session status, requests, config state, command results, tool summaries, target readiness.
- Store bounded event log for replay/debug.
- Store large/raw payloads as artifact refs.
- Do not store full terminal streams, full browser frames, raw file contents, or raw tool I/O by default.
- Live deltas can be ephemeral; semantic rows must survive no connected client.

## Cloud exposure and projection admission

Do not use "sync" as a product primitive. It hides too many distinct things.

Use these concepts instead:

```text
target registration
  Can Cloud reach this machine/sandbox through a worker?

workspace exposure
  Is Cloud allowed to know this AnyHarness workspace/session exists?

projection level
  How much state should Cloud retain/render?

commandability
  May Cloud-mediated clients send commands to it?

migration/move
  Should runnable workspace state transfer to another target?
```

Core invariant:

```text
No exposure row -> worker ignores the workspace/session.
Active exposure -> worker projects only that workspace/session at the requested level.
Cloud dispatch -> requires active exposure + commandability + active projection.
```

Worker does not decide what is visible. Cloud owns exposure policy. Worker only
reconciles the active exposure/projection list and stores local cursors.

Projection levels:

```text
index_only
  Cloud can list the workspace.
  No transcript.
  No command dispatch.

session_summaries
  Cloud can list sessions, status, title, last activity.
  No full transcript.
  No command dispatch.

transcript
  Cloud stores semantic transcript items and pending interactions.
  Usually read-only unless commandable is also true.

live
  Cloud stores semantic transcript state, fans out live patches, and may route
  commands when commandable = true.
```

`commandable` is separate from `projection_level`:

```text
projection_level = transcript
commandable = false
```

supports read-only Cloud views.

Default exposure behavior:

```text
Local Desktop-only work
  no exposure by default

User clicks "Continue remotely" / "Open from mobile"
  create exposure
  create or upgrade session projection to live
  commandable = true
  worker backfills and tails from cursor

Personal cloud work
  exposure exists by default for the owner

Slack/team/automation work
  exposure exists by default as shared_unclaimed

Claiming
  updates visibility/control policy on exposure
  does not change projection mechanics

Move/migration
  separate transfer operation
  may revoke source exposure and create destination exposure
```

Direct Desktop and Cloud-mediated control can coexist for the same exposed
workspace/session:

```text
Desktop prompt path
  Desktop -> AnyHarness directly

Cloud/mobile/web/Slack prompt path
  Client -> Cloud command -> worker -> AnyHarness

Event projection path
  AnyHarness events -> worker cursor -> Cloud projection -> web/mobile/Slack
```

There is still only one runtime session. Desktop and Cloud clients do not fork
or copy the conversation. They both ultimately write to the same AnyHarness
session queue, and AnyHarness defines ordering by the order prompts/actions are
accepted. Desktop can render direct AnyHarness SSE immediately; Cloud clients
render the Cloud projection after worker upload/fanout. If a product surface
needs exclusive control, change `commandable` or claim policy. Do not solve that
by creating a second runtime session.

## Full DB models + schemas

Target/worker:

```text
cloud_target
  id
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

Workspace/session:

```text
cloud_workspace
  id
  target_id
  owner_scope
  organization_id
  owner_user_id
  claim_state: unclaimed | claimed | none
  claimed_by_user_id
  repo_id / repo_url
  anyharness_workspace_id
  path
  branch
  status
  last_activity_at

cloud_session
  id
  workspace_id
  target_id
  anyharness_session_id
  agent_kind
  model
  mode/config
  agent_run_config_id
  agent_run_config_snapshot_json
  status
  current_turn_id
  last_event_seq
  required_runtime_config_revision
  required_agent_auth_revision

cloud_message
  id
  session_id
  role
  content_summary_or_text
  event_seq
  created_at

cloud_tool_call_summary
  id
  session_id
  tool_name
  status
  short_summary
  artifact_refs
  started_at
  ended_at

cloud_request
  id
  session_id
  request_kind
  status: pending | resolved | expired | cancelled
  payload_json
  expires_at

cloud_session_config_state
  session_id
  config_version
  current_config_json
  available_options_json
  supported_updates_json
  source: anyharness
  updated_from_event_seq
  updated_at
```

Exposure/projection:

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

Worker local projection state:

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

The worker cursor table is a local mirror only. Cloud exposure/projection rows
are the source of truth.

Reusable agent run config:

```text
agent_run_config
  id
  owner_scope: system | personal | organization
  owner_user_id
  organization_id
  name
  agent_kind
  model_id
  control_values_json
  usable_in_personal_sandboxes
  usable_in_shared_sandboxes
  status
  created_at
  updated_at
```

`agent_run_config` stores selected values only. `catalog.json` owns available
models/controls and apply metadata. Session/automation/slack runs can snapshot
the resolved values they used for audit, but users edit the reusable config.

`cloud_target.readiness_json` / `cloud_target.inventory_json` and
`cloud_worker.inventory_json` are the V1 home for target-wide capability
facts: installed harnesses, supported commands, runtime versions, and current
MCP/skill/agent-auth revisions. Do not add a separate target capability table
unless these blobs become too hard to query or need history.

Readiness should separate desired state from applied state:

```text
desired_runtime_config_revision: Cloud wants target to have this MCP/skill set
current_runtime_config_revision: worker says target has applied this revision
desired_agent_auth_revision: Cloud wants target to have this auth selection
current_agent_auth_revision: worker says target has applied this auth revision
```

For launch:

```text
required_runtime_config_revision <= current_runtime_config_revision
required_agent_auth_revision <= current_agent_auth_revision
worker supports command kind and preflight fields
target status online/healthy enough for requested operation
```

If any required revision is stale, Cloud should queue/await materialization or
fail fast with a readiness error. Do not launch and hope the harness finds auth
later.

`cloud_session_config_state` is different: it is the live session config state
reported by AnyHarness events. Use product catalog + target readiness for new
session creation. Use `cloud_session_config_state` for an already-running
session's current config/options.

Managed cloud sandbox slot:

```text
cloud_sandbox_slot
  id
  billing_subject_id
  owner_scope: personal | organization
  owner_user_id
  organization_id
  target_id
  provider: e2b
  provider_sandbox_id
  state: not_created | creating | running | pausing | paused | blocked | error |
    killed
  lifecycle_on_timeout: pause
  lifecycle_auto_resume: true
  provider_timeout_seconds
  running_started_at
  last_checked_at
  blocked_reason
```

There should be one normal managed-cloud sandbox slot per user and one shared
managed-cloud sandbox slot per org. Workspaces/worktrees/sessions live inside
the slot. The slot state is the thing billing and cloud-running gate before
create/resume/connect/command delivery.

E2B lifecycle policy:

```text
onTimeout = pause
autoResume = true
timeout = short active window
```

Use E2B auto-pause to stop paying when idle. Use E2B auto-resume to make a
paused sandbox feel persistent when the user comes back. But every product wake
path must pass through Proliferate first. Raw E2B URLs, raw AnyHarness URLs, and
raw SDK credentials should not become durable user-facing product surfaces for
managed cloud.

Commands/events:

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
  idempotency_key
  preconditions_json
  payload_json
  status: queued | leased | accepted | succeeded | failed | cancelled | superseded
  leased_by_worker_id
  lease_expires_at
  result_json
  error_code

cloud_session_event
  id
  target_id
  session_id
  anyharness_event_seq
  event_kind
  payload_json
  payload_policy
  created_at

cloud_event_ingest_state
  target_id
  session_id
  last_ingested_seq
  gap_state_json

cloud_artifact_ref
  id
  owner_kind
  owner_id
  storage_url_or_key
  content_type
  byte_size
  sha256
```

Core command kinds:

```text
configure_git_identity
ensure_repo_checkout
materialize_workspace
materialize_environment
materialize_environment_runtime_config
refresh_agent_auth_config
start_session
send_prompt
resolve_interaction
update_session_config
cancel_turn
close_session
backfill_exposed_workspace
stop_workspace
hibernate_workspace
resume_workspace
prune_workspace
extend_workspace_ttl
```

## End to end flows through the product

Provision managed cloud target:

1. Cloud creates target/sandbox record.
2. Compute boots with supervisor bundle.
3. Supervisor starts AnyHarness and Proliferate Worker.
4. Worker enrolls with Cloud using enrollment token.
5. Worker reports versions, command support, inventory, readiness.
6. Cloud marks target online when required readiness checks pass.

Provision SSH target:

1. User/admin installs supervisor with enrollment token.
2. Supervisor starts worker and AnyHarness on the SSH host.
3. Worker enrolls and heartbeats outbound.
4. Cloud never needs inbound network access to the host.

Start workspace/session:

1. Client/automation asks Cloud to start work.
2. Cloud selects target and creates/loads `cloud_workspace`.
3. Cloud creates or loads `cloud_workspace_exposure`.
4. Cloud creates or loads session projection state when a session is requested.
5. Cloud enqueues `configure_git_identity` if needed.
6. Cloud enqueues `ensure_repo_checkout`.
7. Cloud enqueues `materialize_workspace`.
8. Cloud enqueues environment/runtime config refreshes:
   - repo/env/files via `materialize_environment`;
   - MCP/skills via `materialize_environment_runtime_config`;
   - agent auth via `refresh_agent_auth_config`.
9. Cloud enqueues `start_session` with required config/auth revisions and
   exposure/projection metadata.
10. Worker starts session through AnyHarness.
11. Worker uploads events only for active projections; Cloud builds
    transcript/status snapshots.

Managed cloud wake before command:

1. Client/automation/Slack asks Cloud to do live work.
2. Cloud persists the intended command or operation.
3. Cloud checks billing:
   - compute period exists and has remaining included time, or overage is
     enabled and under spend limit;
   - no active runtime block;
   - sandbox slot is not killed/error.
4. If the E2B sandbox is paused, Cloud performs a Proliferate-owned E2B SDK/HTTP
   operation that triggers auto-resume.
5. Cloud marks the sandbox slot running and records `running_started_at`.
6. Cloud waits for worker heartbeat / target online enough for the operation.
7. Worker long-polls, leases the command, and calls AnyHarness.

Do not just write a command row and assume the worker will pick it up. A paused
E2B sandbox suspends the worker process and its long poll. Cloud must wake the
sandbox before worker delivery matters.

Wake-gated command kinds:

```text
materialize_workspace
materialize_environment
materialize_environment_runtime_config
refresh_agent_auth_config
start_session
send_prompt
resolve_interaction
cancel_turn / close_session when the runtime must observe it
automation run
Slack run
```

Send prompt:

1. Client asks Cloud to send a prompt.
2. Cloud resolves workspace exposure and session projection.
3. Cloud verifies billing can wake/run the target if needed.
4. Cloud verifies actor can interact, `commandable = true`, and projection
   level is `live`.
5. Cloud wakes the managed sandbox if it is paused.
6. Cloud creates `send_prompt` command with exposure/projection identity.
7. Worker leases it.
8. Worker ensures local projection cursor exists or fetches desired projection
   state from Cloud.
9. Worker calls local AnyHarness.
10. AnyHarness accepts/rejects/queues according to session loop state.
11. Worker reports command result.
12. Worker tails resulting events and uploads them through the projection
    cursor.
13. Cloud stores completed messages/tool summaries/end-of-turn state and fans
    out live patches.

Cloud-originated commandability implies active projection. Projection does not
imply commandability.

Enable remote access for existing work:

1. Desktop or Cloud asks to expose an existing workspace/session.
2. Cloud creates or updates `cloud_workspace_exposure`.
3. Cloud creates or updates `cloud_session_projection` if a session should be
   visible/control-ready.
4. Worker sees the active exposure/projection on its next reconciliation tick or
   long-poll wake.
5. Worker maps the Cloud rows to AnyHarness workspace/session ids.
6. Worker backfills bounded metadata/transcript according to projection level.
7. Worker starts tailing events from `last_uploaded_seq`.
8. Web/mobile can open the Cloud projection.

This is not "copy to cloud." It is making an existing runtime visible and
commandable through Cloud. Move/migration is the separate operation that
transfers runnable state to another target.

Concurrent Desktop and Cloud prompts:

1. Session is exposed with `projection_level = live` and `commandable = true`.
2. Desktop sends prompt directly to AnyHarness.
3. Cloud/mobile sends prompt through Cloud command -> worker -> AnyHarness.
4. AnyHarness accepts, rejects, or queues each prompt according to normal
   session-loop rules.
5. Worker uploads events for both prompts because the session projection is
   active.
6. Cloud and Desktop eventually show the same ordered transcript, with latency
   depending on direct SSE vs worker projection upload.

Resolve interaction:

1. AnyHarness emits pending request event.
2. Cloud stores `cloud_request`.
3. Client resolves it through Cloud.
4. Cloud enqueues `resolve_interaction`.
5. Worker applies it to AnyHarness.
6. Cloud updates request status from command result/events.

Projection reconciliation/recovery:

1. Worker reconnects after downtime.
2. Worker fetches active exposures/projections for its target.
3. Worker backfills exposed workspaces/sessions only.
4. Cloud compares last ingested event sequence for each active projection.
5. Worker uploads missing events from AnyHarness history when available.
6. Cloud rebuilds snapshots and marks gaps if history is unavailable.
7. Worker does not upload workspaces/sessions with no active exposure.

Worker update:

1. Cloud records desired worker/supervisor version.
2. Worker sees update command or update policy.
3. Supervisor downloads/verifies new bundle.
4. Supervisor restarts worker safely.
5. Worker re-enrolls/heartbeats with new version.

## Specific hooks

Worker dispatch loop:

```text
heartbeat/readiness
  -> lease next command
  -> verify command kind/version/preconditions
  -> execute local action
  -> report accepted/succeeded/failed
  -> retry/report idempotently on network failure
```

Worker event loop:

```text
fetch active exposure/projection list
  -> ensure local projection cursors
  -> tail AnyHarness events after last seq for active projections only
  -> apply payload policy/redaction
  -> upload batch
  -> Cloud dedupes by target/session/seq
  -> Cloud updates semantic rows and live fanout
```

Launch preflight:

```text
before start_session/cold resume
  -> required MCP/skill runtime revision applied
  -> required agent auth revision applied
  -> workspace materialized
  -> agent binary/readiness available
  -> otherwise refresh/fail before launch
```

Cloud reconciler:

```text
stale target heartbeat
stuck leased command
failed materialization
drifted runtime config
drifted agent auth
expired target compute
paused managed cloud slot with queued wake-required command
E2B provider state drift from sandbox_slot state
```

Managed cloud passive data rule:

```text
Allowed without waking sandbox:
  list workspaces from cloud_workspace
  list sessions from cloud_sessions
  show transcript from cloud_transcript_items
  show pending interactions from cloud_pending_interactions
  show target readiness from cloud_target/cloud_worker
  show billing/blocked state

Requires wake:
  anything that needs fresh AnyHarness state not already projected
  prompt/session/terminal/preview/live command
  materialization/config/auth change
```

If a passive UI field is not available while the sandbox is paused, add it to
the worker projection/backfill path or display it as stale/unavailable. Do not
wake the sandbox just to render sidebars or history.

## Specific one offs

Idempotency:

- Every command should have an idempotency key.
- Worker result reporting must be retry-safe.
- Commands that are already applied should return accepted/succeeded no-op.

Preconditions:

- command can require target online;
- command can require worker min version;
- command can require runtime config revision;
- command can require agent auth revision;
- command can require workspace/session status.

Retention:

- Keep semantic transcript rows.
- Keep bounded raw event log.
- Compact or artifact-store large payloads.
- Retain command history long enough for audit/debug/billing.

Security:

- Worker auth is target-scoped.
- Worker can fetch only plans/secrets for its target.
- Direct desktop attach to shared targets needs explicit Cloud/target grant.
- Command payloads should not contain raw long-lived secrets.

## Deeper concepts

Rust daemons:

- `proliferate-supervisor` owns process lifecycle and updates.
- `proliferate-worker` owns Cloud communication.
- `anyharness` owns runtime execution.

Long polling vs polling:

- Ideal worker command lease can be long-polling to reduce latency.
- Correctness should not depend on open connections; polling/retry must work.

Snapshots vs events:

- Events are append-ish facts from AnyHarness.
- Snapshots are read models for fast clients.
- If snapshots drift, rebuild from semantic rows/events where possible.

Managed compute lifecycle:

- Cloud can pause/resume/prune managed workspaces/sandbox slots.
- Before destructive stop, save necessary git/worktree/session state.
- Billing/retention consumes lifecycle events, not raw runtime internals.
- For E2B, pause/resume is the normal cost-saving lifecycle. Snapshot/fork is a
  separate rollback/retention primitive, not the normal billing pause.
