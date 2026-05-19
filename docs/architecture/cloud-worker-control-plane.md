# Cloud Worker And Control Plane V1 Spec

Status: implementation spec for Cloud-mediated session control, Proliferate
Worker, target enrollment, command delivery, event ingestion, snapshots,
compute lifecycle, and Cloud exposure/projection. Current implementation notes
were verified against `main` on 2026-05-15.

Scope:

- `server/proliferate/server/cloud/**`
- `server/proliferate/db/models/**`
- `server/proliferate/db/store/cloud_sync/**`
- `server/alembic/versions/**`
- `anyharness/crates/proliferate-worker/**`
- `anyharness/crates/anyharness-contract/src/v1/**`
- `anyharness/crates/anyharness-lib/src/api/**`
- `anyharness/crates/anyharness-lib/src/domains/**`
- `anyharness/crates/anyharness-lib/src/live/**`

Related docs:

- `docs/anyharness/README.md`
- `docs/anyharness/specs/session-engine.md`
- `docs/anyharness/specs/product-mcps.md`
- `docs/server/README.md`
- `docs/architecture/cloud-worker-implementation-phases.md`
- `docs/architecture/plugins-and-skills.md`

This spec treats plugin and MCP bundles as resolved session launch input.
Plugin package structure, skills, and bundle composition are owned by
`docs/architecture/plugins-and-skills.md`.

Terminology note: older implementation paths use `sync_existing_workspace` and
`cloud_sync` naming. The product/architecture model in this spec is exposure
and projection:

```text
exposure
  Cloud is allowed to know this workspace/session exists.

projection
  Cloud stores/renders a bounded view of that runtime state.

commandability
  Cloud-mediated clients may send commands to the runtime.
```

Do not add new product semantics around "sync workspace" or "copy to cloud."
Use exposure/projection for visibility/control, and a separate move/migration
flow for runnable state transfer.

## Goal

V1 makes a target running AnyHarness addressable from Proliferate Cloud without
requiring inbound networking into that target.

Cloud-mediated clients can:

- list synced workspaces and sessions
- watch session transcripts and status
- send prompts
- resolve pending interactions
- cancel work
- start sessions on registered targets
- see target readiness and online state
- stop, hibernate, prune, or extend target/workspace lifetime when allowed

The target-side Proliferate Worker:

- registers the target
- connects outbound to Cloud
- leases commands
- calls the local AnyHarness API
- tails local AnyHarness events
- uploads normalized event batches
- reports inventory, readiness, versions, activity, and safe-stop state

AnyHarness remains the execution source of truth. Cloud stores command history,
normalized events, snapshots/read models, policy, audit, billing, target state,
and artifact references. Cloud does not become a second AnyHarness runtime
database.

## Current Main Implementation Notes

The architecture below is the target model. Current `main` implements the
worker spine with a few pragmatic differences that reviewers should keep in
mind:

- active worker command kinds are `configure_git_identity`,
  `ensure_repo_checkout`, `materialize_workspace`,
  `materialize_environment`, `start_session`, `send_prompt`,
  `resolve_interaction`, `update_session_config`, `cancel_turn`,
  `close_session`, and `sync_existing_workspace`.
- `sync_existing_workspace` is the current implementation name for existing
  workspace backfill. The target semantic is `backfill_exposed_workspace`:
  backfill only work covered by active Cloud exposure/projection rows.
- command leases are stored inline on `cloud_commands`; there is no separate
  lease table.
- worker command polling currently returns immediately from the server and the
  worker sleeps on empty responses. It is not server-held long polling yet.
- command `preconditions` are not accepted by the current Cloud command
  validator.
- the worker sends ordinary AnyHarness request bodies. There is not yet an
  AnyHarness `command_metadata` envelope.
- event sync polls
  `GET /v1/sessions/{session_id}/events?after_seq=...` and uploads batches
  directly. The worker has local command-result retry state, but no durable
  event outbox table.
- event ingest currently enforces caps by rejecting oversized batches and
  truncating retained payloads through payload policy; it does not yet emit all
  degraded/compacted marker variants described as future target behavior.

## Non-Goals For V1

Do not implement these in the first worker/projection pass:

- full file editing through Cloud
- full interactive terminal remoting through Cloud
- browser/computer-use frame streaming through Cloud
- direct Cloud mutation of AnyHarness SQLite
- Cloud replay of raw ACP protocol internals
- worker-owned prompt queue semantics
- worker-owned transcript reconstruction
- worker-owned org/team authorization
- full restore of a deleted sandbox from Cloud event history
- Durable Objects or actor infrastructure as a hard dependency

V1 should support remote supervision and command/control. Desktop remains the
rich direct client for files, git, terminals, browser, and local computer use.

## Core Invariant

Commands flow down. Events flow up.

```text
Cloud-mediated clients
  web / mobile / Slack / API / automations
    -> Proliferate Cloud command API
    -> durable command queue
    -> target-side Proliferate Worker
    -> local AnyHarness API

Event path
  AnyHarness normalized events
    -> local Proliferate Worker
    -> Cloud ingest
    -> event log + snapshots/read models
    -> live fanout
    -> web / mobile / Slack / API / desktop cloud views
```

The hard ownership split:

```text
AnyHarness:
  execution truth, local SQLite, session loop, command acceptance/order,
  normalized event emission, local capabilities, MCP/provider launch.

Proliferate Worker:
  outbound bridge, command delivery, event upload, sync cursors, inventory,
  readiness, activity reporting, update participation.

Cloud:
  org/team auth, target registry, command queue, event ingest, snapshots,
  fanout, automations, credential grants, audit, billing, compute policy.

Clients:
  render Cloud snapshots or direct AnyHarness state. They do not invent
  durable runtime truth.
```

## Direct Versus Cloud-Mediated Control

Two paths are first-class:

```text
Desktop direct
  Desktop -> AnyHarness

Cloud-mediated
  web/mobile/Slack/API/automations -> Cloud -> Worker -> AnyHarness
```

Both paths converge on the same AnyHarness command and event contract.

Direct reachability is not authority. For team/cloud sessions, direct desktop
attach must use a Cloud-issued or target-recognized control grant. A user being
able to reach an SSH host or sandbox does not imply they may control every
team session on that target.

Every runtime mutation becomes an AnyHarness command:

- send prompt
- update config
- resolve permission/user input/MCP elicitation
- cancel turn/session
- start/resume session
- launch session with an MCP/plugin bundle
- stop or close session
- terminal/file/browser actions when Cloud support is later added

Cloud queues and routes commands. AnyHarness accepts, rejects, queues, and
orders execution.

When the same exposed session is open in Desktop and web/mobile:

```text
Desktop prompt path
  Desktop -> AnyHarness directly

Cloud prompt path
  web/mobile/Slack/API -> CloudCommand -> Worker -> AnyHarness

Projection path
  AnyHarness events -> Worker cursor -> Cloud projection -> web/mobile/Slack
```

There is still one runtime session. Desktop and Cloud do not fork or copy the
conversation. Both prompt paths enter the same AnyHarness session queue, and
AnyHarness defines ordering by command acceptance. Cloud clients catch up from
worker event upload; Desktop may render earlier through direct SSE.

## Cloud Exposure And Projection Admission

Workers must not upload every workspace/session they can see. Cloud owns the
admission policy.

```text
No active exposure
  Worker ignores the workspace/session.

Active exposure
  Worker may map/backfill the workspace/session.

Active session projection
  Worker tails AnyHarness events after the stored cursor.

Commandable exposure/projection
  Cloud-mediated clients may enqueue commands, subject to actor authorization.
```

Exposure and commandability are separate:

```text
projection_level = transcript
commandable = false
```

is a valid read-only Cloud view.

Projection levels:

```text
index_only
  workspace appears in Cloud lists; no transcript or commands

session_summaries
  session title/status/last activity; no full transcript or commands

transcript
  semantic transcript/pending interactions; usually read-only

live
  semantic transcript plus live patches; commandable only when policy allows
```

Default behavior:

```text
Desktop local-only work
  no exposure by default

Continue remotely / Open from mobile
  create exposure
  create or upgrade session projection to live
  set commandable according to owner policy
  worker backfills and tails from cursor

Cloud-created personal work
  exposure exists by default for the owner

Slack/team/automation work
  exposure exists by default as shared_unclaimed org work

Claiming
  changes visibility/control policy
  does not change projection mechanics

Move/migration
  separate transfer operation
  may revoke source exposure and create destination exposure
```

## V1 Topology

```text
target machine / sandbox / SSH host / desktop dispatch machine
  Proliferate supervisor or platform process manager
    -> anyharness
    -> proliferate-worker

  anyharness
    local HTTP/SSE API
    local SQLite
    agent subprocesses
    MCP subprocesses
    workspace filesystem

  proliferate-worker
    local SQLite
    outbound Cloud connection
    local AnyHarness client
    event tailer
    command dispatcher
    inventory/update reporter

Proliferate Cloud
  API server
  Postgres
  Redis/NATS/pubsub for live fanout
  object storage for blobs/artifacts
  background workers for snapshot updates, expiry, pruning, notifications
```

V1 should use conventional infrastructure:

```text
Postgres:
  durable commands, events, snapshots, targets, workspaces, sessions,
  auth/policy, audit, billing.

Redis/NATS/pubsub:
  live fanout, invalidation, short-lived command/event notifications.

S3-compatible object storage:
  large payloads, artifacts, screenshots, logs when explicitly retained.

SSE first:
  web/mobile/desktop cloud views subscribe to workspace/session streams.
```

Keep the live coordination boundary actor-shaped so it can later be backed by
Durable Objects, a self-hosted actor runtime, or a custom coordinator. Do not
make any one vendor primitive the product contract.

## Target Model

A target is any compute environment that can run AnyHarness and optionally
connect to Cloud through Proliferate Worker.

Target kinds:

```text
managed_cloud
self_hosted_cloud
ssh
desktop_dispatch
local_direct
future_vpc_worker
```

These are onboarding and lifecycle variants. They are not separate product
architectures.

Target record:

```text
target_id
org_id
owner_user_id nullable
display_name
kind
access_scope: personal | team | org
created_by_user_id
created_at
updated_at
archived_at nullable
default_workspace_root nullable
persistence_class: ephemeral | persistent | snapshot_backed | unknown
direct_attach_policy: disabled | owner_only | team_grant | org_grant
cloud_sync_enabled
cloud_exposure_supported
update_channel: stable | beta | pinned
desired_anyharness_version nullable
desired_worker_version nullable
desired_supervisor_version nullable
```

Worker record:

```text
worker_id
target_id
org_id
install_id
public_key_fingerprint or token_hash
auth_version
status: enrolling | active | revoked | rotated
last_seen_at
last_heartbeat_id
worker_version
supervisor_version nullable
anyharness_endpoint_kind: http | unix_socket
created_at
rotated_at nullable
revoked_at nullable
```

Target status:

```text
target_id
online_status: online | degraded | offline
last_seen_at
last_inventory_at
last_activity_at
worker_connected
anyharness_reachable
anyharness_version
worker_version
supervisor_version nullable
safe_stop_state: safe | blocked | unknown
safe_stop_reasons json
active_session_count
active_turn_count
pending_interaction_count
active_terminal_count
active_process_count
```

Target inventory:

```text
target_id
os_kind
os_version
arch
distro nullable
shell
package_managers json
workspace_roots json
supports_process_spawn
supports_pty
supports_filesystem
supports_git
supports_network_egress
supports_port_forwarding
supports_browser
supports_computer_use
supports_docker
node_version nullable
npm_version nullable
python_version nullable
uv_version nullable
git_version nullable
provider_readiness json
mcp_readiness json
agent_catalog_revision nullable
reported_at
```

Session launch asks the same questions for every target:

- Can this target run this agent?
- Can this target access this repo/workspace?
- Can this target run the required MCP/plugin bundle?
- Can this session receive the required credential grants?
- Can this actor view/control the session?
- Is this workspace/session exposed, projected, and commandable through Cloud?
- What stop/prune policy applies after the work completes?

## Compute Lifecycle Policy

Compute lifecycle is first-class because running sandbox time is the dominant
cost.

Cloud owns policy:

- quotas
- billing
- idle timers
- max runtime
- stop/hibernate/prune decisions
- retention policy
- whether an org/user may extend or pin a workspace

Worker reports state:

- heartbeat
- activity
- active turns
- active terminals
- pending interactions
- safe-stop state
- local stop blockers
- versions

AnyHarness owns execution truth:

- whether a session is active
- whether a turn is active
- whether a prompt is queued
- whether an interaction is pending
- whether terminal/process handles exist
- whether local state can be stopped safely

Cloud must not guess whether a target is safe to stop without target state.

Compute commands:

```text
stop_workspace
hibernate_workspace
resume_workspace
prune_workspace
snapshot_workspace
extend_workspace_ttl
set_workspace_pin
```

Safe-stop response from Worker/AnyHarness:

```text
safe_stop_state: safe | blocked | unknown
blockers:
  - active_turn
  - pending_interaction
  - active_terminal
  - active_process
  - upload_outbox_not_empty
  - provider_install_in_progress
  - update_in_progress
  - workspace_operation_in_progress
```

Initial default policy:

```text
interactive managed cloud workspace:
  idle stop after 15 minutes
  prune after 24-72 hours inactive unless pinned
  user/org may extend TTL within quota

automation workspace:
  terminate immediately after final sync
  max default runtime 3 hours
  no-output watchdog after 15 minutes, configurable by automation type
  prune after completion unless configured to retain artifacts

cloud event history:
  keep semantic events/snapshots while workspace exists
  after prune, keep slim transcript and audit record
  delete raw large payloads unless pinned as artifacts
```

## Command Model

Cloud-mediated clients write commands to Cloud. Workers lease commands for the
targets they own. Worker calls local AnyHarness. AnyHarness emits canonical
events that reconcile command status and snapshots.

Command envelope:

```text
command_id
idempotency_key
org_id
actor_user_id nullable
actor_kind: user | automation | slack | api_key | system
source: web | mobile | slack | api | automation | desktop_cloud_view
target_id
workspace_id nullable
session_id nullable
kind
payload json
observed_event_seq nullable
preconditions json
status
created_at
leased_at nullable
lease_expires_at nullable
delivered_at nullable
accepted_at nullable
rejected_at nullable
expired_at nullable
authorization_context json
exposure_id nullable
session_projection_id nullable
exposure_revision nullable
required_projection_level nullable
error_code nullable
error_message nullable
```

V1 command kinds:

```text
configure_git_identity
ensure_repo_checkout
materialize_workspace
materialize_environment
start_session
send_prompt
resolve_interaction
update_session_config
cancel_turn
close_session
backfill_exposed_workspace
```

`sync_existing_workspace` is the current implementation command name on `main`.
New design and new docs should describe the behavior as
`backfill_exposed_workspace`: it backfills only Cloud-exposed work, not every
workspace discovered on the target.

Additional lifecycle commands such as `stop_workspace`,
`hibernate_workspace`, `resume_workspace`, `prune_workspace`, and
`extend_workspace_ttl` remain target architecture, not active worker command
kinds on current `main`.

Command status:

```text
queued
leased
delivered
accepted
accepted_but_queued
rejected
expired
superseded
failed_delivery
```

Precondition examples:

```text
send_prompt:
  observed_event_seq optional
  append after current accepted queue
  exposure_id required for Cloud-mediated sessions
  session_projection_id required for session commands
  required_projection_level = live
  commandable = true

update_session_config:
  expected_config_version

resolve_interaction:
  interaction_id
  expected_interaction_version
  expected_status = pending

cancel_turn:
  expected_turn_id
  expected_status = active

stop_workspace:
  expected_safe_stop_state = safe
  force = false by default
```

Cloud may render optimistic command state, but AnyHarness acceptance is the
canonical result.

## Normalized Event Model

AnyHarness emits normalized events with canonical per-session ordering. Worker
uploads them to Cloud. Cloud dedupes, stores, projects, and fans out patches.

Event identity:

```text
cloud_event_id
target_id
workspace_id
session_id
anyharness_event_id
anyharness_sequence
event_type
schema_version
source_kind: user | assistant | tool | system | worker | target
actor_user_id nullable
actor_external_id nullable
created_at
ingested_at
payload json nullable
payload_ref nullable
payload_size_bytes
dedupe_key
```

Unique constraint:

```text
unique(target_id, session_id, anyharness_sequence)
```

If AnyHarness later emits globally unique event ids across a target, Cloud may
also enforce:

```text
unique(target_id, anyharness_event_id)
```

V1 durable event categories:

```text
target.online
target.offline
target.inventory_reported
target.safe_stop_state_changed

workspace.created
workspace.updated
workspace.activity_changed
workspace.stopped
workspace.pruned

session.created
session.started
session.status_changed
session.ended
session.error

command.accepted
command.rejected
command.queued

transcript.item_added
transcript.item_updated
transcript.item_completed

assistant.message_completed
user.message_completed
tool.call_started
tool.call_completed

interaction.pending
interaction.resolved
interaction.expired

config.updated
usage.updated
artifact.created
```

Live-only events:

```text
assistant.message_delta
tool.call_delta
token_delta
terminal.output_delta
browser.frame_delta
computer_use.frame_delta
```

Live-only events may be streamed over Cloud while subscribers are connected.
They are not durable event-log rows by default. Durable rows store final
semantic items and references.

## Large Payload And Retention Policy

Cloud projection must not blindly store every byte produced by the target.

Inline payload limits:

```text
soft inline payload cap: 64 KB
hard inline payload cap: 256 KB
```

Session durable event caps:

```text
soft cap: 5,000 durable events or 15 MB payload per session
hard cap: 10,000 durable events or 25 MB payload per session
```

When inline caps are exceeded:

- truncate inline payloads with explicit truncation metadata
- move large payloads to object storage only when retention is required
- compact older turns into transcript snapshots and summaries
- keep AnyHarness local SQLite as exact runtime truth while target exists

When a durable session crosses the soft cap, Cloud should schedule compaction
before accepting more low-value durable rows. When a durable session reaches
the hard cap, ingest must follow one deterministic path: compact eligible older
events in the ingest transaction; if the session still exceeds the cap, append
only bounded lifecycle/command/request records and explicit
`retention_exceeded` markers, exclude or artifact-link non-critical transcript
and tool metadata, mark the session sync state degraded, and only then advance
the cursor for the processed events. Workers must not make independent cap
decisions.

Do not store inline by default:

- raw tool input/output bodies
- terminal streams
- browser/computer-use frame streams
- screenshots
- file contents
- large logs
- generated binaries

For large data:

```text
event payload:
  tool name
  status
  short summary
  size metadata
  content kind
  blob_ref if retained
```

Object storage retention:

```text
default artifact retention:
  delete with workspace unless pinned

automation output artifacts:
  retain final useful outputs, not all intermediate logs

browser/computer recordings:
  opt-in only
  short retention by default
```

## Cloud Persistence

Cloud stores:

- users, orgs, teams, roles, access grants
- targets and workers
- enrollment tokens
- inventory and readiness snapshots
- workspace records
- session records
- workspace exposure records
- session projection records and cursors
- commands and command leases
- normalized durable events
- ingest cursors
- snapshots/read models
- automation definitions and runs
- credential grant metadata
- artifact/blob references
- audit, billing, notification state

Cloud does not store:

- full AnyHarness SQLite databases
- raw ACP internals as product truth
- all live deltas forever
- all terminal/browser/computer streams
- broad raw secrets
- full workspace filesystem contents
- local desktop tab/layout state as runtime truth

Cloud exposure/projection is command routing plus event ingestion plus snapshot
building, not runtime database replication.

## Server Target File Structure

The Cloud worker/projection implementation lives under the existing `cloud`
server domain, split by product responsibility. Do not put all worker behavior
in `cloud/runtime`.

Implementation phase details live in
`docs/architecture/cloud-worker-implementation-phases.md`. This section defines
the stable server folder contract.

Cloud areas use the same default module shape. Do not create bespoke
area-specific file sets up front.

```text
server/proliferate/server/cloud/<area>/
  api.py          # HTTP/SSE transport only
  models.py       # Pydantic request/response schemas only
  service.py      # orchestration, transactions, store calls, integrations
  access.py       # optional resource-access route deps
  errors.py       # optional area-specific errors
  domain/
    types.py      # optional frozen dataclasses/enums used by pure rules
    rules.py      # optional pure validators, reducers, status transitions
    policy.py     # optional pure access/control policy verdicts
```

Default Cloud areas:

```text
server/proliferate/server/cloud/
  targets/        target registry, SSH enrollment, inventory/readiness
  worker/         worker-only auth, heartbeat, command lease, event upload
  commands/       CloudCommand enqueue/status/routing/idempotency
  events/         ingest, dedupe, cursor, payload policy, event log
  sessions/       CloudSession, messages, requests, config, transcript reads
  live/           Redis/NATS pubsub, SSE streams, replay
  compute/        stop/prune/extend/provider lifecycle policy
  target_config/  env/credentials/files/git/MCP materialization model
  runtime/        managed compute provisioning; direct-AnyHarness mutation paths transitional
```

Promotion rule:

- Start with `domain/types.py`, `domain/rules.py`, and `domain/policy.py`.
- Promote a specific `domain/<concern>.py` only when a default file becomes
  too large or mixes unrelated rule families.
- Do not pre-create `capabilities.py`, `enrollment.py`, `readiness.py`,
  `versions.py`, `routing.py`, `payload_policy.py`, or similar files as a
  default structure.

Existing folders keep their current ownership:

```text
cloud/runtime/
  managed sandbox provisioning, setup monitor, provider-specific runtime setup.
  It may create/register managed targets, but it must not own generic command
  leasing or event ingest.

cloud/workspaces/
  user-facing cloud workspace behavior. It should call targets/commands/
  sessions/live/compute services instead of owning worker sync internals.

cloud/credentials/
cloud/mcp_*/
  credential and MCP control-plane behavior. They provide session-scoped grant
  input to session launch; they do not transport commands to targets.

integrations/sandbox/
  E2B or other sandbox provider API access.

integrations/anyharness/
  direct AnyHarness API client code for transitional hosted runtime operations
  or local tests. Generic Cloud-mediated target control should move to
  commands/worker/events.
```

## Server Database Shape

New worker-sync ORM models live under `db/models/cloud/**`, new worker-sync
stores live under `db/store/cloud_sync/**`, and migrations live under
`server/alembic/versions/**`. Existing cloud product stores stay in their
current owner until the Phase 0 implementation audit assigns an explicit
disposition; do not create a second store for an existing ORM resource.

```text
server/proliferate/db/models/cloud/
  targets.py              # CloudTarget, CloudWorker, TargetInventory, status
  commands.py             # CloudCommand, CloudCommandLease
  events.py               # CloudSessionEvent, EventIngestCursor
  sessions.py             # CloudSession, messages, tool calls, requests, config state
  artifacts.py            # CloudArtifactRef / blob retention metadata
  target_config.py        # target env/credential/materialization state

server/proliferate/db/store/cloud_sync/
  __init__.py
  targets.py              # target/worker/enrollment CRUD
  worker_auth.py          # worker credential/token state
  inventory.py            # inventory/status read-write helpers
  commands.py             # enqueue, lease, status transition, expiry
  leases.py               # lease transitions and stale lease recovery
  events.py               # append/dedupe/read event log
  cursors.py              # ingest cursor and backfill progress
  sessions.py             # session row read/write
  messages.py             # transcript message row read/write
  tool_calls.py           # tool call summary row read/write
  requests.py             # pending/resolved interaction row read/write
  config.py               # session config state row read/write
  artifacts.py            # blob ref metadata
  target_config.py        # target config/materialization read-write
```

`db/models/cloud/sessions.py` owns the ORM tables for `CloudSession`,
`CloudMessage`, `CloudToolCallSummary`, `CloudRequest`, and
`CloudSessionConfigState`; separate store files own the per-resource access
paths listed above.

Stores return frozen dataclasses. ORM objects do not leave store boundaries.
Services thread `AsyncSession` into stores. Stores do not commit and do not
open sessions.

Required indexes and constraints:

```text
cloud_targets:
  index(org_id, kind, archived_at)

cloud_workers:
  unique(install_id)
  index(target_id, status)
  index(last_seen_at)

cloud_commands:
  unique(org_id, idempotency_key)
  index(target_id, status, created_at)
  index(session_id, status, created_at)
  index(lease_expires_at) where status = 'leased'

cloud_session_events:
  unique(target_id, session_id, anyharness_sequence)
  index(org_id, workspace_id, session_id, anyharness_sequence)
  index(session_id, created_at)
  index(event_type, created_at)

cloud_event_ingest_cursors:
  unique(target_id, session_id)

cloud_sessions:
  unique(target_id, anyharness_session_id)
  index(org_id, workspace_id, updated_at)

cloud_messages:
  index(session_id, created_at)

cloud_tool_call_summaries:
  index(session_id, message_id, created_at)

cloud_requests:
  index(session_id, status, created_at)

cloud_artifact_refs:
  index(org_id, retention_expires_at)
  index(workspace_id, session_id)
```

## Worker Binary Crate

The worker is a separate binary crate. Do not put worker code inside
`anyharness-lib`; the worker talks to AnyHarness over the local HTTP/SSE API.

The tree below is the intended ownership shape. Current `main` has the core
modules but not every target submodule: event sync uses polling in `sync/tailer`
rather than a local SSE stream tailer plus durable event outbox, command
preconditions are not implemented, and some inventory/readiness logic is still
coarser than the final split.

```text
anyharness/crates/proliferate-worker/
  Cargo.toml
  src/
    main.rs                  # process entrypoint
    config.rs                # config loading and env overrides
    error.rs
    logging.rs
    runtime.rs               # top-level async task orchestration

    identity/
      mod.rs
      enrollment.rs          # bootstrap enrollment flow
      credentials.rs         # worker token/key storage, rotation
      fingerprint.rs         # stable install id and target fingerprint

    cloud_client/
      mod.rs
      auth.rs                # request signing / bearer token use
      commands.rs            # lease/ack/status endpoints
      events.rs              # batch upload endpoint
      heartbeat.rs
      inventory.rs
      updates.rs

    anyharness_client/
      mod.rs
      contract.rs            # local request/response adapters
      health.rs
      sessions.rs
      workspaces.rs
      stream.rs              # local SSE tailer
      runtime.rs             # inventory/safe-stop endpoints

    commands/
      mod.rs
      dispatcher.rs          # command kind -> local AnyHarness call
      mapping.rs             # Cloud command payload -> AnyHarness request
      preconditions.rs       # local freshness checks before dispatch
      result.rs              # accepted/rejected/delivery result mapping

    sync/
      mod.rs
      backfill.rs            # initial workspace/session/event upload
      cursor.rs              # local cursor model
      event_batch.rs         # batch sizing and flush timing
      outbox.rs              # retryable upload queue
      tailer.rs              # live stream tail loop
      mapper.rs              # AnyHarness event -> Cloud ingest event

    inventory/
      mod.rs
      platform.rs            # OS/arch/distro/shell/package managers
      capabilities.rs        # PTY/git/files/network/browser/computer-use
      providers.rs           # agent provider readiness
      mcp.rs                 # MCP runtime readiness
      versions.rs            # AnyHarness/worker/supervisor versions

    lifecycle/
      mod.rs
      activity.rs            # active turns/sessions/terminals/pending input
      safe_stop.rs           # prepare-stop checks through AnyHarness
      shutdown.rs            # graceful worker shutdown

    updates/
      mod.rs
      desired.rs             # desired version reconcile
      staging.rs             # download/stage signed artifacts
      supervisor.rs          # ask supervisor/platform manager to restart

    store/
      mod.rs
      schema.rs
      migrations.rs
      identity.rs
      commands.rs
      cursors.rs
      outbox.rs
      inventory.rs
      updates.rs
```

Worker local state:

```text
~/.proliferate/worker/config.toml
~/.proliferate/worker/worker.sqlite
~/.proliferate/worker/logs/
~/.proliferate/bin/proliferate-worker
~/.proliferate/bin/anyharness
```

Managed cloud images may use different paths, but the logical layout should
match:

```text
$PROLIFERATE_HOME/worker/config.toml
$PROLIFERATE_HOME/worker/worker.sqlite
$PROLIFERATE_HOME/bin/
```

Worker local tables:

```text
identity:
  target_id, worker_id, install_id, cloud_base_url, token/key metadata

command_leases:
  command_id, lease_id, status, leased_at, lease_expires_at, last_error

projection_cursors:
  exposure_id, session_projection_id, workspace_id, session_id,
  projection_level, last_uploaded_seq, last_ack_seq

event_outbox:
  batch_id, target_id, session_id, seq_start, seq_end, payload, attempt_count

projection_mappings:
  local_workspace_id, cloud_workspace_id
  local_session_id, cloud_session_id
  exposure_id, session_projection_id

inventory_cache:
  last_report_hash, last_reported_at

update_state:
  component, installed_version, desired_version, staged_path, status
```

Worker task loop:

```text
runtime main
  -> load config and identity
  -> enroll if no identity exists
  -> start heartbeat loop
  -> start inventory loop
  -> start command lease loop
  -> fetch active exposure/projection list
  -> start event backfill/tail loop for active projections
  -> start activity/safe-stop reporting loop
  -> start update reconciliation loop
```

Loop defaults:

```text
heartbeat interval: implementation-configured; current worker config default is 30 seconds
inventory interval: 5 minutes or when hash changes
command poll: server returns immediately; worker sleeps briefly on empty responses
lease timeout: current worker requests a 300 second lease
event upload: worker polls AnyHarness events by seq and uploads batches directly
event outbox retry: not implemented as a separate durable local event outbox yet
```

## AnyHarness Contract Additions

Prefer using existing AnyHarness endpoints where they already express the
operation. Add contract fields only where worker/cloud correctness requires
canonical command identity, actor metadata, or target inventory.

Current `main` uses existing AnyHarness HTTP contracts for worker dispatch:
workspace resolve/worktree creation, session create/prompt/config/interaction
resolution/cancel/close, and session event listing. The `commands.rs`
metadata/precondition contract below remains target architecture and is not
accepted by current AnyHarness request bodies.

New/extended contract files:

```text
anyharness/crates/anyharness-contract/src/v1/runtime.rs
  RuntimeInventoryResponse
  RuntimeActivityResponse
  PrepareStopRequest
  PrepareStopResponse

anyharness/crates/anyharness-contract/src/v1/commands.rs
  RuntimeCommandMetadata
  RuntimeCommandAcceptance
  RuntimeCommandStatus
  RuntimeActor
  RuntimeCommandPreconditions

anyharness/crates/anyharness-contract/src/v1/events.rs
  ensure SessionEventEnvelope carries:
    session_id
    seq
    event_id
    event_type
    schema_version
    actor/source metadata where available
    payload size/truncation/blob metadata where available
```

Existing request types should accept optional command metadata:

```text
PromptSessionRequest:
  command_metadata optional

SetSessionConfigOptionRequest:
  command_metadata optional
  expected_config_version optional

ResolveInteractionRequest:
  command_metadata optional
  expected_interaction_version optional

CreateSessionRequest:
  command_metadata optional
  target/cloud launch context optional

ResumeSessionRequest:
  command_metadata optional in the future
```

In v0, resume command identity may remain only in the Cloud command envelope
and worker delivery record. If the command id is not forwarded into
`ResumeSessionRequest`, Cloud must still correlate the eventual AnyHarness
accept/reject/error response back to the queued `resume_session` command.

If an existing route can remain backwards compatible, add optional fields
instead of creating a parallel worker-only route.

AnyHarness API endpoints needed by Worker:

```text
GET  /v1/health
GET  /v1/runtime/inventory
GET  /v1/runtime/activity
POST /v1/runtime/prepare-stop

GET  /v1/workspaces
GET  /v1/workspaces/{workspace_id}
POST /v1/workspaces/{workspace_id}/stop-preflight   # optional if separate

GET  /v1/sessions?workspace_id=...
POST /v1/sessions
GET  /v1/sessions/{session_id}
POST /v1/sessions/{session_id}/resume
POST /v1/sessions/{session_id}/prompt
PATCH /v1/sessions/{session_id}/config
POST /v1/sessions/{session_id}/interactions/{interaction_id}/resolve
POST /v1/sessions/{session_id}/cancel

GET  /v1/sessions/{session_id}/events?after_seq=...
GET  /v1/sessions/{session_id}/stream?after_seq=...

GET  /v1/agents/launch-options?workspace_id=...
GET  /v1/agents/{kind}/model-registry?workspace_id=...
POST /v1/agents/{kind}/model-registry/refresh
```

If current routes use slightly different paths, keep the public route stable
and adapt inside the worker `anyharness_client` module. Do not create duplicate
AnyHarness behavior just for worker.

For `start_session` and `resume_session`, Cloud resolves the authorized
MCP/plugin launch input before delivery. The worker transports that
session-scoped input to AnyHarness; it does not choose plugins, skills,
credentials, or bundle policy.

## AnyHarness Implementation Placement

Inventory and safe-stop are runtime-facing, but their facts come from several
owners. Keep the API thin and delegate.

```text
anyharness/crates/anyharness-lib/src/api/http/runtime.rs
  HTTP mapping for inventory/activity/prepare-stop.

anyharness/crates/anyharness-lib/src/domains/runtime_inventory/
  mod.rs
  model.rs                 # InventorySnapshot, ActivitySnapshot, SafeStopState
  service.rs               # collects from domains/live/adapters
  readiness.rs             # provider/MCP readiness calculation

anyharness/crates/anyharness-lib/src/domains/workspaces/
  retention.rs             # existing workspace retention meaning
  retire_preflight.rs      # feeds prepare-stop blockers

anyharness/crates/anyharness-lib/src/domains/agents/readiness/
  provider readiness used by inventory.

anyharness/crates/anyharness-lib/src/live/sessions/
  exposes active session/turn/pending interaction counts to inventory service.

anyharness/crates/anyharness-lib/src/live/terminals/ or current terminals/
  exposes active terminal count to inventory service.

anyharness/crates/anyharness-lib/src/adapters/
  reports local filesystem/git/process/browser/computer-use capabilities.
```

Do not put Cloud registration, Cloud tokens, command lease logic, or event
upload logic into AnyHarness.

## Cloud API Endpoints

Client/admin endpoints:

```text
POST /api/v1/cloud/targets/enrollments
  create enrollment token for SSH/self-hosted/desktop dispatch.

GET /api/v1/cloud/targets
  list targets visible to actor.

GET /api/v1/cloud/targets/{target_id}
  target snapshot.

POST /api/v1/cloud/targets/{target_id}/archive
  archive target, revoke active worker tokens after safe shutdown if possible.

POST /api/v1/cloud/commands
  enqueue command.

GET /api/v1/cloud/commands/{command_id}
  command status.

GET /api/v1/cloud/workspaces
GET /api/v1/cloud/workspaces/{workspace_id}
GET /api/v1/cloud/sessions/{session_id}
GET /api/v1/cloud/sessions/{session_id}/transcript
GET /api/v1/cloud/sessions/{session_id}/events?cursor=...

GET /api/v1/cloud/workspaces/{workspace_id}/stream
GET /api/v1/cloud/sessions/{session_id}/stream
GET /api/v1/cloud/targets/{target_id}/stream
```

Worker-only endpoints:

```text
POST /api/v1/cloud/worker/enroll
  enrollment token + inventory -> worker credentials.

POST /api/v1/cloud/worker/heartbeat
  status + activity + safe-stop summary.

POST /api/v1/cloud/worker/inventory
  full inventory/readiness report.

POST /api/v1/cloud/worker/commands/lease
  long-poll/lease commands for target.

POST /api/v1/cloud/worker/commands/{command_id}/delivery
  delivered/failed_delivery status.

POST /api/v1/cloud/worker/commands/{command_id}/result
  local AnyHarness accepted/rejected/queued result when available.

POST /api/v1/cloud/worker/events/batches
  upload normalized durable event batch.

POST /api/v1/cloud/worker/sync/backfill-status
  report backfill progress for a workspace/session.

POST /api/v1/cloud/worker/update-status
  report staged/applied/failed update state.
```

Worker endpoints authenticate with worker credentials. Client endpoints
authenticate with user/session/API-key auth. Do not share auth mechanisms.

## Enrollment Flows

### Managed Cloud

```text
1. User or automation requests managed compute.
2. cloud/runtime provisions sandbox through integrations/sandbox.
3. Sandbox image starts AnyHarness and Proliferate Worker.
4. Worker uses one-time bootstrap token from sandbox metadata/env.
5. Worker calls /api/v1/cloud/worker/enroll.
6. Cloud creates target + worker records or attaches to pre-created target.
7. Worker reports inventory/readiness.
8. Cloud marks target online.
9. Commands may now route to the target.
```

Managed cloud should preinstall:

- AnyHarness
- Proliferate Worker
- baseline Node/npm
- git
- shell tools
- default agent shims
- default MCP runtime requirements where feasible

### BYO SSH

```text
1. User/admin creates enrollment token in Cloud.
2. UI shows install command.
3. User runs install command on SSH host.
4. Installer downloads signed AnyHarness + Worker artifacts.
5. Installer writes worker config with Cloud base URL and enrollment token.
6. Worker starts and enrolls outbound.
7. Worker reports inventory/readiness.
8. Cloud shows direct-attach caveat:
   teammates may control cloud-exposed sessions if policy allows, but direct
   Desktop attach requires their own target access or a granted attach path.
```

The installer should not require root. If systemd/user services are available,
use them. Otherwise use a documented foreground or user-level process manager
fallback.

### Desktop Dispatch

```text
1. User enables dispatch for the local desktop runtime.
2. Desktop starts or installs Proliferate Worker locally.
3. Worker enrolls as desktop_dispatch target.
4. User chooses which local workspaces/sessions are exposed to Cloud.
5. Cloud creates exposure/projection rows for those workspaces/sessions.
6. Worker backfills selected state and tails live events for active projections.
7. Mobile/web/Slack can supervise and send commands while desktop is online
   when the exposure is commandable.
```

Desktop dispatch should be opt-in per machine and per workspace/session. It is
not a sync-all mode.

## Command Flow: Web Sends Prompt

```text
1. Web calls POST /api/v1/cloud/commands:
   kind = send_prompt
   session_id = S
   idempotency_key = K
   observed_event_seq = N

2. Cloud authenticates user and authorizes control.

3. commands.service validates:
   session exists in CloudSession snapshot
   target is Cloud-addressable through an active worker
   workspace exposure exists and is active
   session projection exists and is active
   projection level is live
   exposure/session projection is commandable
   command kind is allowed
   idempotency key is unique or returns existing command
   preconditions are absent until the precondition contract is implemented

4. commands.store inserts queued command.

5. live.service publishes optimistic CommandStatus patch.

6. Worker lease loop long-polls /api/v1/cloud/worker/commands/lease.

7. Cloud leases command to worker:
   status = leased
   lease_expires_at = now + timeout

8. Worker dispatcher maps Cloud command to AnyHarness request:
   POST /v1/sessions/{S}/prompt.

9. AnyHarness accepts/rejects/queues and emits canonical events.

10. Worker reports command result if immediate result exists.

11. Worker event tailer uploads emitted events.

12. Cloud ingest dedupes/appends events.

13. sessions.service applies events to transcript/session snapshots.

14. live.service fans out durable snapshot patches to subscribers.
```

The UI may show the prompt optimistically, but the canonical prompt row comes
from AnyHarness events.

## Projection Backfill And Event Upload Flow

Backfill is required when enabling exposure/projection for an existing
workspace/session.

Current implementation note: worker event sync polls AnyHarness session events
by sequence and uploads batches directly to Cloud. The explicit local event
outbox steps below describe the target reliability model; they are not a
separate table in current `main`.

```text
1. Cloud creates or updates exposure/projection rows.
2. Cloud enqueues backfill_exposed_workspace, or worker observes the active
   exposure/projection list.
3. Worker lists only the requested workspace/session metadata from AnyHarness.
4. Worker creates or reconciles cloud id mappings for the exposure/projection.
5. Worker reads events after last_uploaded_seq for each active projection.
6. Worker applies payload policy and builds batches.
7. Worker inserts batches into local outbox.
8. Worker uploads batches.
9. Cloud dedupes by target_id/session_id/seq.
10. Cloud advances ingest cursor only across contiguous sequences.
11. Cloud rebuilds or updates snapshots.
12. Worker deletes acknowledged outbox batches.
13. Worker starts live tail from acknowledged seq.
```

Gaps:

- If Cloud sees seq 100 and 102 but not 101, it stores both but only advances
  contiguous cursor to 100.
- Worker retries missing seq/batch.
- Snapshot updates can either wait for contiguous order or apply out-of-order only
  for event types proven commutative. V1 should prefer contiguous order.

Duplicates:

- Duplicate event insert conflicts on `(target_id, session_id, seq)`.
- Cloud treats duplicate upload as success if payload hash matches.
- Payload hash mismatch for same seq is a hard ingest error and should mark
  target projection degraded.

## Live Fanout

Client live streams subscribe to Cloud, not to targets.

```text
GET /api/v1/cloud/sessions/{session_id}/stream?cursor=C
  -> authorize actor
  -> send current snapshot if requested
  -> replay snapshot patches/events after C
  -> subscribe to session channel
  -> send SSE patches as Cloud snapshots change
```

V1 channels:

```text
org:{org_id}
target:{target_id}
workspace:{workspace_id}
session:{session_id}
command:{command_id}
```

V1 stream payloads should be snapshot patches, not raw target protocol.

```text
event: snapshot
data: SessionSnapshot

event: patch
data: SnapshotPatch

event: command_status
data: CommandStatus

event: heartbeat
data: stream keepalive
```

Live-only deltas may be published with short TTL while subscribers are present,
but durable session/message/request/config rows must still converge from
semantic events.

## Snapshot Models

WorkspaceSnapshot:

```text
workspace_id
org_id
target_id
repo_identity
branch
display_name
status
last_activity_at
active_session_ids
pending_interaction_count
owner_user_id nullable
access_scope
retention_state
```

SessionSnapshot:

```text
session_id
workspace_id
target_id
agent_kind
model_id nullable
mode_id nullable
status
current_turn_id nullable
current_turn_status nullable
pending_prompt_count
pending_interaction_count
config_version
last_event_seq
last_activity_at
participants summary
control_capabilities
```

TranscriptSnapshot:

```text
session_id
last_event_seq
items:
  item_id
  kind
  actor/source
  status
  created_at
  completed_at nullable
  text/content summary
  tool metadata
  artifact refs
  truncation metadata
```

TargetSnapshot:

```text
target_id
kind
display_name
online_status
last_seen_at
capabilities summary
readiness summary
versions
safe_stop_state
active counts
quota/billing summary when authorized
```

Snapshot rebuild:

- snapshots can be rebuilt from durable normalized events plus target/session
  records
- session/transcript/config/request snapshot code belongs in
  `cloud/sessions/domain/rules.py` until promotion is earned
- snapshot writes belong in `db/store/cloud_sync/sessions.py`,
  `messages.py`, `tool_calls.py`, `requests.py`, and `config.py`
- clients should not duplicate event replay logic

## Credentials And MCP Grants

Cloud resolves credential authorization. AnyHarness injects session runtime
config. Worker transports resolved launch input but does not choose
credentials.

Flow:

```text
1. User/team/admin configures credential/MCP/plugin bundle in Cloud.
2. Session launch requests bundle.
3. Cloud validates org/team/user/automation policy.
4. Cloud mints session-scoped credential grants or references.
5. Cloud command payload includes grant references or sealed session config.
6. Worker delivers launch command to AnyHarness.
7. AnyHarness launches provider/MCP processes with narrow env/config.
8. Events and audit reference grant ids, never raw secrets.
```

Worker must not persist broad raw secrets. If it must cache short-lived
material for retry, store only encrypted/session-scoped material and expire it
quickly.

## Worker Authentication

Enrollment uses a short-lived one-time token created by Cloud.

After enrollment, worker uses a long-lived but rotatable worker credential:

- bearer token with hashed storage in Cloud, or
- asymmetric keypair with signed requests

V1 may use bearer tokens for speed, but the API should be shaped so signed
requests can replace them.

Worker auth requirements:

- every worker request includes `worker_id`, `target_id`, auth credential
- Cloud verifies worker belongs to target and org
- revoked workers cannot lease commands or upload events
- token rotation can happen without target recreation
- enrollment tokens expire quickly and are single-use

Client/user auth requirements:

- user/API/Slack/mobile auth never reuses worker credentials
- client command creation checks org/team/session policy
- target direct attach grants are short-lived and scoped

## Update Coordination

Runtime binary updates are separate from product configuration updates.

```text
Cloud desired version
  -> worker reports installed version
  -> worker stages signed artifact
  -> worker asks supervisor/platform manager for safe restart
  -> update applies only at safe boundary
  -> worker reports success/failure
```

Components:

```text
anyharness
proliferate-worker
proliferate-supervisor or platform service wrapper
agent ACP shims
managed provider binaries/packages
MCP sidecars when managed by Proliferate
```

Rules:

- do not hot-swap AnyHarness underneath an active turn
- do not update worker without preserving identity and outbox
- updates are signed and versioned
- worker reports installed/staged/desired versions
- Cloud can pin org/target update channels
- failed update rolls back or marks target degraded

V1 can rely on managed image rebuilds for short-lived sandboxes, but the data
model and worker status should support long-running SSH/self-hosted targets.

## Failure Modes

Target offline:

- commands remain queued until expiry
- clients see target offline and command queued
- worker resumes leases when back online
- expired commands become `expired`, not silently dropped

Worker crashes after lease before delivery:

- lease expires
- command returns to queued or failed_delivery depending attempt count
- idempotency key prevents duplicate user-visible command creation

Worker delivers command, then crashes before status report:

- AnyHarness emits command/session events
- worker backfill/tail uploads events after restart
- Cloud reconciles command status from events

Event upload duplicate:

- duplicate insert is treated as success if payload hash matches

Event upload gap:

- cursor does not advance past gap
- snapshot update waits or marks sync degraded
- worker retries outbox/backfill

Cloud snapshot update failure:

- event log remains appended
- sessions/live worker retries
- clients may see stale snapshots with sync health warning

AnyHarness rejects command:

- worker reports rejection if immediate
- AnyHarness emits rejection event when possible
- Cloud status becomes rejected with stable error code

Safe stop blocked:

- Cloud does not terminate unless force policy allows
- clients see blockers
- automation may time out and force according to org/workflow policy

## Observability

Server metrics:

```text
worker_enroll_success/failure
worker_heartbeat_latency
worker_online_count
command_queued_count
command_lease_latency
command_accept_latency
command_expired_count
event_batch_ingest_latency
event_dedupe_count
event_gap_count
snapshot_apply_latency
sse_subscriber_count
target_safe_stop_blocked_count
```

Worker logs:

- target_id
- worker_id
- command_id
- session_id
- event seq range
- batch_id
- cloud request id
- anyharness request id when available

Do not log raw prompts, secrets, raw tool bodies, or credential material in
worker or Cloud logs.

## Execution Plan

The executable migration plan, concrete file paths, phase numbers, and
mechanical acceptance gates live in
`docs/architecture/cloud-worker-implementation-phases.md`. This spec remains
the source of truth for the architecture model and invariants; do not infer
phase numbering from this document.

If you are about to write code for this migration, read the phases doc next.

At a high level, implementation must cover:

- contract, DB, and SDK foundations
- target enrollment, worker identity, heartbeat, and inventory
- command queueing, leasing, dispatch, and status reconciliation
- direct server-to-AnyHarness command-path migration
- event ingest, snapshots/read models, live streams, and backfill
- target config materialization, compute policy, updates, and hardening

## Verification

Server tests:

- command idempotency
- command status transition legality
- worker lease timeout/recovery
- target access policy
- event dedupe and hash mismatch
- cursor gap behavior
- snapshot rebuild from event log
- payload policy
- safe-stop policy

Worker tests:

- enrollment state machine
- heartbeat retry
- command dispatch mapping
- outbox retry/idempotent ack
- event batch flush thresholds
- inventory hashing/report suppression
- local AnyHarness reconnect

Integration tests:

- local server + AnyHarness + worker happy path
- web command -> worker -> AnyHarness -> event ingest -> SSE patch
- worker crash after lease
- duplicate event upload
- target offline and command expiry
- backfill existing session

Manual smoke:

```text
1. Start local server.
2. Start AnyHarness runtime.
3. Start worker with local Cloud enrollment.
4. Confirm target online.
5. Create cloud command send_prompt.
6. Confirm AnyHarness receives prompt.
7. Confirm Cloud transcript updates.
8. Kill worker, enqueue command, restart worker.
9. Confirm command eventually delivers or expires correctly.
10. Trigger safe-stop with active turn and confirm blocked.
```

## Implementation Invariants

- AnyHarness owns execution truth.
- Worker is delivery, upload, readiness, activity, and update plumbing.
- Cloud owns policy, command queueing, event ingest, snapshots, fanout,
  credential grants, audit, billing, quotas, and compute lifecycle decisions.
- Cloud-mediated surfaces never need target credentials or direct AnyHarness
  endpoints.
- Direct desktop attach is allowed when reachable and authorized, but it uses
  the same AnyHarness command/event contract.
- Target differences are expressed as capabilities and readiness, not separate
  session architectures.
- Cloud stores normalized durable events and snapshots, not full runtime
  databases.
- Large live streams are not durable by default.
- Every mutating remote action has a command id, idempotency key, actor,
  source, and authorization context.
- AnyHarness command acceptance/rejection reconciles optimistic Cloud state.
