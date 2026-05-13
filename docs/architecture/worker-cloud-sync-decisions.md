# Worker And Cloud Sync Decisions

Status: decision record for the Proliferate Worker, Cloud-mediated control
plane, BYO SSH targets, managed cloud targets, and storage/retention model.

This file answers the core questions behind the architecture. It is deliberately
written as a mental-model document, not as an exhaustive implementation spec.
For implementation structure, see
`docs/architecture/worker-cloud-sync-v1-implementation-spec.md`.

## Core Questions This Document Answers

These are the explicit questions that drove the design. If a future change
touches Worker, Cloud sync, BYO SSH, managed cloud, or cloud-visible sessions,
it should be able to answer these questions without changing the core
invariants.

### Product And Topology Questions

- Are we building a desktop app with cloud features, or a team/cloud agent
  platform with a great desktop client?
  - Answer: a team/cloud agent platform with a great desktop client. Desktop
    remains the richest client, but Cloud is the coordination plane for team,
    automation, mobile, Slack, web, and API surfaces.
- Do we need both direct Desktop access and Cloud-mediated access?
  - Answer: yes. Desktop direct is required for rich local workflows. Cloud
    mediation is required for teams, mobile, Slack, automations, private
    networks, audit, billing, command queueing, and fanout.
- Should Cloud directly connect to AnyHarness runtimes?
  - Answer: no for generic control. Managed cloud bootstrap may use direct
    runtime access temporarily, but the long-term path is Cloud command queue
    to Worker to local AnyHarness.
- What is the one-sentence architecture?
  - Answer: commands down, events up, projections out; AnyHarness executes,
    Worker bridges, Cloud coordinates, clients render.
- What is a target?
  - Answer: a compute environment that can run AnyHarness and optionally run
    Worker: managed cloud, self-hosted cloud, SSH, desktop dispatch,
    local direct, or future VPC worker.
- Are target kinds separate architectures?
  - Answer: no. They are onboarding and lifecycle variants of one
    capability-based target model.

### Worker Questions

- What is the worker's overall premise?
  - Answer: a thin outbound bridge installed next to AnyHarness. It makes a
    target Cloud-addressable without requiring inbound networking.
- What is the precise worker structure?
  - Answer: config, identity/enrollment, Cloud client, AnyHarness client,
    command dispatcher/mapper, sync tail/cursors, inventory, updates, local
    store, and runtime task loops.
- What should Worker not do?
  - Answer: it must not own prompt queueing, transcript reconstruction,
    credential choice, MCP authorization, workspace lifecycle policy, team/org
    auth, or UI concepts.
- How does Worker authenticate?
  - Answer: initial enrollment token creates or attaches a target and returns
    worker credentials. Ongoing requests use worker identity plus credential
    validation. Future versions can add signed requests and rotation.
- How does Worker receive commands?
  - Answer: by long polling or a persistent outbound channel to Cloud. V1 can
    use async long poll and command leases.
- Is tens of thousands of long polls acceptable?
  - Answer: yes if implemented as async waiting on pubsub/timers without
    holding DB connections. Persistent WebSockets can be introduced later if
    needed.
- How does Worker call AnyHarness?
  - Answer: through a small local AnyHarness HTTP/SSE client with typed payloads.
    Transport can be handwritten; payload contracts should be strongly typed.
- Why distinguish dispatcher and mapper?
  - Answer: dispatcher chooses the command handler; mapper converts a typed
    Cloud command payload into the exact AnyHarness request shape.
- Does Worker read AnyHarness SQLite?
  - Answer: no. It reads AnyHarness APIs/streams. AnyHarness SQLite remains
    AnyHarness-owned.
- Does Worker need a durable event outbox?
  - Answer: not by default for V1. Cursor-first sync is preferable because
    AnyHarness already persists events. Add a worker outbox later only if
    cursor-first sync proves insufficient.
- Can Worker process multiple things in parallel?
  - Answer: yes. Same-session mutations should serialize, but different
    sessions/workspaces can run in separate async lanes later. V1 can start
    simpler.

### Cloud Command Questions

- What does Cloud store before Worker sees a command?
  - Answer: a durable `CloudCommand` with target, actor, source, kind, typed
    payload, idempotency key, observed sequence, preconditions, expiration,
    and status.
- Who decides whether a command is accepted?
  - Answer: AnyHarness. Cloud queues and routes intent. Worker delivers.
    AnyHarness accepts, rejects, queues, or executes and emits canonical events.
- How are stale commands prevented?
  - Answer: idempotency keys, observed event sequences, preconditions, command
    expiration, and AnyHarness-side validation.
- What are core V1 command kinds?
  - Answer: start session, send prompt, resolve interaction, update config,
    cancel turn/session, stop workspace, prune workspace.

### Cloud Event And Fanout Questions

- What exactly is Cloud ingest?
  - Answer: a server API/service that authenticates worker event batches,
    dedupes them, applies payload policy, stores durable semantic rows, updates
    projections, publishes live patches, and returns ack cursors.
- Is Cloud ingest the SSE service?
  - Answer: no. Ingest processes worker uploads. SSE subscribes to Redis/NATS
    and sends patches to clients.
- What happens if no web/mobile clients are connected?
  - Answer: durable rows and projections still update. Live pubsub patches are
    ephemeral and disappear.
- Where do duplicate events go?
  - Answer: the unique key is `target_id + session_id + anyharness_sequence`.
    Same payload hash means duplicate retry and is ignored. Different hash
    means conflict.
- Do we durably store token deltas?
  - Answer: no. Token/delta-ish data is live-only. Durable Cloud history stores
    final semantic facts and summaries.
- What is the three-lane model?
  - Answer: live patches for responsiveness, durable semantic event log for
    replay/audit/debug, projections/read models for clients.
- What does Cloud fanout use in V1?
  - Answer: Postgres for durable rows, Redis/NATS/pubsub for patches, and SSE
    for clients. Durable Objects remain an optional future implementation
    detail, not a V1 dependency.
- How do workspace/session creation events reconcile with optimistic UI?
  - Answer: Cloud clients may create optimistic pending workspaces/sessions
    after submitting a command. The canonical workspace/session identity and
    status should reconcile from AnyHarness/Worker events and Cloud projection
    updates.
- How do active tool calls flow through the system?
  - Answer: AnyHarness emits tool lifecycle events. Worker uploads semantic
    tool started/completed summaries durably and may forward progress/delta
    patches live. Cloud stores summaries/blob refs, not raw tool bodies by
    default.
- How does Slack get notified?
  - Answer: Slack should be driven by Cloud projections and event processing.
    When a linked session reaches message completed, interaction pending,
    session completed, or failure states, Cloud notification logic posts or
    updates the Slack thread. Slack never connects to AnyHarness directly.

### Cloud Storage Questions

- Does Cloud copy AnyHarness SQLite?
  - Answer: no. Cloud stores product-visible commands, semantic events,
    projections, messages, interactions, config, target state, and artifact
    references.
- How do we avoid storing GBs per user?
  - Answer: do not durably store token deltas, raw tool bodies, terminal byte
    streams, browser frames, screenshots inline, full file contents, or huge
    logs by default. Use caps, truncation, summaries, and blob refs.
- What rows does Cloud need?
  - Answer: target, worker, workspace, session, message, tool-call summary,
    pending interaction, session config, config options, command, semantic
    event, ingest state, and artifact/blob ref.
- Should clients rebuild transcripts from raw events?
  - Answer: no. Clients load projections/messages and apply patches.
- What should remain after compute is pruned?
  - Answer: slim transcript, status, audit, selected artifacts, and enough
    metadata to understand what happened. Raw payloads should be short-lived
    unless pinned.
- How does local-to-Cloud dispatch work?
  - Answer: enabling dispatch registers the local desktop machine as a
    `desktop_dispatch` target, starts Worker, backfills selected
    workspace/session metadata and event cursors, then tails events the same
    way as SSH or managed cloud. Cloud commands can then target that local
    worker while it is online.

### BYO SSH And Managed Cloud Questions

- How does an SSH machine become Cloud-accessible?
  - Answer: Cloud creates an enrollment token, UI shows an install command,
    the command installs AnyHarness/Worker/supervisor, Worker enrolls outbound,
    then reports heartbeat and inventory.
- How does managed cloud become a target?
  - Answer: the sandbox image includes AnyHarness/Worker/supervisor, bootstrap
    injects enrollment data, and Worker enrolls on boot.
- In V1, does Cloud need to provision a new sandbox for every run?
  - Answer: no. V1 can target existing registered compute and create new
    worktrees/sessions there. Later policy can provision per-run targets.
- When creating new work, what are the compute options?
  - Answer: choose a target, then choose the workspace strategy that target
    supports: existing workspace, new worktree under an existing target, or
    later a newly provisioned managed target/sandbox.
- If a teammate sees a workspace but lacks direct SSH access, what happens?
  - Answer: they can still use Cloud-mediated web/mobile/Slack surfaces if
    policy allows. Rich direct Desktop attach requires direct access or a
    Cloud-issued/target-recognized grant.
- What must SSH readiness include?
  - Answer: git installed, repo access, clone/fetch/push ability, commit
    identity, node/npm/npx if needed, python/uv if needed, workspace root
    permissions, and network egress.

### MCP, Plugin, And Skill Questions

- Where is the selected MCP/plugin bundle resolved?
  - Answer: Cloud or the launching surface resolves/authorizes a
    session-scoped `SessionPluginBundle`. Worker materializes target artifacts.
    AnyHarness launches the bundle.
- What does materialization mean?
  - Answer: make the selected runtime artifacts exist on the target before
    calling AnyHarness: command exists, npm package installed, uv package
    available, managed binary staged, or skill artifact fetched.
- Can Cloud send arbitrary install shell commands?
  - Answer: no. Worker should support typed allowlisted recipe kinds only.
- Is node enough for all MCPs?
  - Answer: no. HTTP MCPs need network/credentials. Stdio MCPs may need node,
    npm/npx, python/uv, git, browser dependencies, OS/arch support, and a
    writable cache.
- Are skills ref-backed today?
  - Answer: not fully. Current bundle work supports inline skills; ref-backed
    skill artifacts are the future target.

### Catalog, Config, And Model Questions

- When does Cloud catalog matter?
  - Answer: before a live target/session exists, Cloud catalog supports
    optimistic UI and defaults.
- What is the live truth for session config?
  - Answer: AnyHarness/session events and target-discovered readiness.
- How does a config update happen from web/mobile/Slack?
  - Answer: Cloud command to Worker to AnyHarness, then AnyHarness emits config
    events that update Cloud projections.
- How do dynamic model lists work?
  - Answer: target-side discovery produces registry snapshots; Worker syncs
    them to Cloud as projections; launch still validates against target truth.

### Update And Supervisor Questions

- Why do we need a supervisor?
  - Answer: Worker may need to update/restart AnyHarness and itself. A stable
    local supervisor stages binaries, restarts processes, and keeps state
    outside versioned binary directories.
- Does supervisor poll Cloud directly?
  - Answer: not normally. Worker reports versions and desired updates through
    Cloud, then asks supervisor to apply. Supervisor can later have fallback
    manifest polling.
- Why are binaries per architecture?
  - Answer: Rust source is portable, but compiled binaries target specific OS,
    CPU architecture, and libc/runtime conventions.
- When is an update safe?
  - Answer: when AnyHarness reports no active turns, no unsafe terminals or
    processes, no critical pending commands, and safe-stop state allows it.

### Retention And Pruning Questions

- Is current worktree pruning enough?
  - Answer: no. It is a seed for a broader workspace lifecycle and retention
    system.
- What is the distinction between prune and purge?
  - Answer: prune/materialization cleanup removes compute/files/checkouts.
    Purge deletes runtime or Cloud history.
- Should pruning a worktree delete Cloud data?
  - Answer: not automatically. Most cloud-owned work should prune compute
    aggressively but keep slim Cloud-visible history and selected artifacts.
- What layers of cleanup exist?
  - Answer: compute stop, materialization prune, runtime data purge, and Cloud
    data retention.
- Who decides cleanup policy?
  - Answer: Cloud decides policy; Worker/AnyHarness report safety and execute
    target cleanup; Cloud updates state after confirmed cleanup events.

### SDK, Web, Mobile, Slack, And API Questions

- Do we need to fully design all clients now?
  - Answer: no. V1 needs a basic web client to validate commands, projections,
    and live fanout. Mobile/Slack/API can build on the same model later.
- How do we avoid duplicate client logic?
  - Answer: extract a reusable Cloud SDK core from desktop Cloud access code,
    then use surface-specific adapters for auth/base URL/storage.
- Should Cloud SDK expose the full AnyHarness API?
  - Answer: no. Cloud exposes product commands and projections. Shared payload
    types can come from AnyHarness contracts where they are truly common.
- What should basic web prove?
  - Answer: target listing, workspace/session listing, transcript/messages,
    prompt send, pending interaction resolution, config updates, command
    status, and stop/prune test commands.

### Rich Dev-Tool Remoting Questions

- Can Cloud clients support terminals?
  - Answer: eventually yes, but not as part of the first sync spine. Terminal
    support needs explicit command streams, output retention policy, PTY
    lifecycle, permissions, and live backpressure. V1 should not durably store
    terminal byte streams as normal session events.
- Can Cloud clients support browsers and computer use?
  - Answer: eventually yes, but frame streaming is a separate high-bandwidth
    surface. V1 should store only summaries/artifacts unless a recording is
    explicitly retained.
- Can Cloud clients support file browsing?
  - Answer: yes, but it should be a separate Cloud command/read capability with
    target policy and path safety, not inferred from transcript events. Desktop
    remains the rich file client first.
- Why not build these before the sync spine is finished?
  - Answer: they are high-volume and easy to over-store. The safe order is
    commands/events/projections first, then files/terminal/browser as explicit
    capabilities with their own retention rules.

### Questions Still Intentionally Open

- Exact explicit Cloud table shape for `CloudSession`, `CloudMessage`,
  `CloudPendingInteraction`, and `CloudSessionConfig` versus generic projection
  snapshots during early V1.
- Exact retention defaults by plan, org, target type, and workspace source.
- Whether automation workspaces should default to per-run managed targets or
  reused target worktrees.
- How much web-side file/git reading is needed before mobile/Slack/API.
- Exact direct attach grant model for team-controlled desktop access.
- Whether self-hosted Proliferate Cloud ships first as a full control plane or
  as a target worker pool connected to hosted Cloud.

## What Problem Are We Solving?

Proliferate needs to let users and teams run coding-agent work on many kinds of
compute:

- local desktop machines
- SSH machines
- managed cloud sandboxes
- self-hosted cloud pools
- future customer VPC workers

The same session should be controllable from desktop, web, mobile, Slack,
automations, and eventually a developer API.

The system must preserve this invariant:

```text
AnyHarness runs the work.
Cloud coordinates people, policy, routing, projections, and surfaces.
Worker bridges targets to Cloud.
Clients render and command through stable contracts.
```

## What Is AnyHarness?

AnyHarness is the target-side runtime primitive.

It owns:

- workspace identity on the target
- session lifecycle and session actor state
- prompt queueing and command acceptance
- agent process lifecycle
- MCP/plugin bundle launch
- local files/git/terminals/process capabilities
- local SQLite runtime truth
- normalized event emission

It does not own:

- org/team policy
- billing
- Cloud command queueing
- Slack/mobile/web fanout
- Cloud projections
- worker registration
- target fleet updates

## What Is Proliferate Worker?

Proliferate Worker is a target-side bridge process installed next to
AnyHarness.

It owns:

- target enrollment
- worker authentication
- outbound Cloud connection
- command polling/leasing
- translating Cloud commands to AnyHarness API calls
- tailing AnyHarness normalized events
- uploading event batches to Cloud
- cursor/ack tracking
- heartbeat, activity, inventory, readiness, and version reporting
- update coordination with a supervisor

It must not own:

- prompt queue semantics
- transcript reconstruction
- MCP authorization policy
- team permission decisions
- credential selection
- workspace lifecycle policy
- UI concepts

The worker should stay boring. It is transport, sync, inventory, and update
plumbing.

## Why Not Let Cloud Directly Connect To AnyHarness?

Direct Cloud-to-AnyHarness is wrong as the long-term spine.

Reasons:

- many targets are behind NAT, on laptops, in SSH boxes, or in customer VPCs
- Slack/mobile/web should not know target endpoints or target credentials
- commands need durable queueing when targets are offline
- team auth, billing, audit, and notifications belong in Cloud
- multiple client surfaces should consume one Cloud projection model
- self-hosted and BYO SSH need outbound-only connectivity

Cloud may still bootstrap managed cloud infrastructure, but after a target is
registered, generic control should flow through:

```text
Cloud -> command queue -> Worker -> AnyHarness
```

and events should flow back through:

```text
AnyHarness -> Worker -> Cloud ingest -> projections/fanout
```

## Do We Still Need Direct Desktop Access?

Yes.

Desktop direct access remains first-class for rich workflows:

- low-latency chat
- file browsing
- git review
- terminals
- browser/computer use
- debugging local runtimes

The two supported paths are:

```text
Desktop direct:
  Desktop -> AnyHarness

Cloud-mediated:
  Web/Mobile/Slack/API/Automations -> Cloud -> Worker -> AnyHarness
```

Both paths must use the same AnyHarness command/event contract. Direct
reachability is not authority: for team/cloud sessions, direct desktop attach
must still be backed by Cloud-issued or target-recognized grants.

## What Is A Target?

A target is any compute environment that can run AnyHarness and optionally run
Proliferate Worker.

Target kinds:

- `managed_cloud`
- `self_hosted_cloud`
- `ssh`
- `desktop_dispatch`
- `local_direct`
- `future_vpc_worker`

These are onboarding/lifecycle variants, not separate product architectures.

Every target should be capability-described:

- OS, arch, distro, shell
- workspace roots
- process spawn
- PTY
- filesystem
- git
- network egress
- port forwarding
- browser/computer-use support
- Docker
- node/npm/npx
- python/uv
- agent/provider readiness
- MCP readiness
- installed AnyHarness/worker/supervisor versions

## How Does BYO SSH Registration Work?

The user flow should be:

```text
Desktop/Web:
  "Connect an SSH machine"
  -> Cloud creates enrollment token
  -> UI shows install command containing token

SSH machine:
  user runs install command
  -> installer installs supervisor, AnyHarness, worker
  -> worker enrolls outbound to Cloud
  -> worker reports heartbeat and inventory

Cloud:
  records CloudTarget + CloudWorker
  shows target as available
```

For V1, SSH targets are existing machines. Cloud does not need to provision new
SSH machines. Cloud only routes commands to the registered worker.

## How Does Managed Cloud Registration Work?

For managed cloud, the enrollment token is injected during sandbox bootstrap.

The managed image should already include:

- supervisor
- AnyHarness
- Proliferate Worker
- baseline tools such as git, node/npm/npx, and eventually uv/python where
  needed

The sandbox boots, worker enrolls, target inventory is reported, and Cloud can
target it the same way it targets SSH.

For early V1, a managed cloud sandbox can be a long-lived target where new
workspaces are created as worktrees. Later, Cloud can provision new managed
targets per run or per policy.

## How Are Commands Represented?

All runtime mutations become Cloud commands when coming from web/mobile/Slack,
automations, or API.

Examples:

- start session
- send prompt
- resolve interaction
- update config
- cancel turn/session
- stop workspace
- prune workspace
- materialize plugin bundle

Commands include:

- command id
- idempotency key
- actor
- source surface
- target id
- workspace id when known
- session id when known
- kind
- typed payload
- observed AnyHarness event sequence when relevant
- preconditions
- expiration

Cloud owns command queueing and delivery state. AnyHarness owns whether the
command is accepted, rejected, queued, or executed.

## How Does Worker Use AnyHarness?

Worker should use a small Rust AnyHarness client over the local AnyHarness
HTTP/SSE API.

The client should be handwritten transport but strongly typed payloads. Avoid
generic `serde_json::Value` for command payloads wherever possible.

Worker command flow:

```text
worker polls/leases command
  -> dispatcher chooses command kind
  -> mapper builds typed AnyHarness request
  -> local AnyHarness client sends request
  -> worker reports delivery/result
  -> AnyHarness emits canonical event
  -> worker uploads event batch
```

The distinction:

- dispatcher: chooses which local client method handles a command
- mapper: converts Cloud command payload into the exact AnyHarness request type
- client: performs local HTTP/SSE transport

## How Does Worker Sync Events?

The target-side source of truth is AnyHarness SQLite and AnyHarness event
streaming.

Worker should not read AnyHarness SQLite directly. It should tail the
AnyHarness event API.

Preferred V1 sync model:

```text
for each synced session:
  read events after last_cloud_ack_seq
  micro-batch events
  upload batch to Cloud ingest
  Cloud dedupes and returns last contiguous ack
  worker advances local cursor
```

Worker local state should include sync cursors, not a second transcript copy.

Durable worker outbox can be added later if we find that transient network
loss during event reads creates unacceptable gaps. The simpler V1 default is
cursor-first because AnyHarness already persists events locally.

## How Does Cloud Ingest Events?

Cloud ingest is a normal server API endpoint/service.

It should:

1. authenticate the worker
2. validate target and worker ownership
3. parse normalized AnyHarness events
4. dedupe by `target_id + session_id + anyharness_sequence`
5. apply payload retention policy
6. store bounded semantic event rows
7. update projections/read models
8. publish live patches through Redis/NATS/pubsub
9. return ack cursor to worker

Cloud ingest is not the SSE service. SSE subscribes to pubsub and forwards
patches to connected clients.

If no clients are connected, ingest still stores durable rows and updates
projections. Live patches simply expire.

## Do We Store Token-Level Events In Cloud?

No, not durably.

Use three lanes:

```text
1. Live patches
   fast, ephemeral, token/delta-ish, for responsiveness

2. Durable event log
   bounded, semantic, replayable events

3. Projections
   fast read models for clients
```

Live stream can be chatty. Durable Cloud history must be semantic and bounded.

Do not durably store by default:

- token deltas
- raw `item_delta` rows
- raw tool input/output bodies
- terminal byte streams
- browser/computer-use frames
- screenshots inline
- full file contents
- huge logs

Do store:

- workspace/session lifecycle
- user/assistant completed messages
- tool call started/completed summaries
- pending/resolved interactions
- config/model changes
- command accepted/rejected
- selected artifact/blob references

## What Cloud Rows Should Exist?

The Cloud side should model product-visible facts, not raw AnyHarness SQLite.

Core rows:

- `CloudTarget`
- `CloudWorker`
- `CloudWorkspace`
- `CloudSession`
- `CloudMessage`
- `CloudToolCallSummary`
- `CloudPendingInteraction`
- `CloudSessionConfig`
- `CloudConfigOption`
- `CloudCommand`
- `CloudSessionEvent`
- `CloudEventIngestState`
- `CloudArtifactRef`

Projections/read models can be stored either as explicit tables or
snapshot JSON, but clients should not reconstruct transcript logic themselves.

## What Happens To Cloud Data When Worktrees Or Sandboxes Are Pruned?

Pruning compute/files and deleting Cloud history are separate decisions.

Layers:

```text
1. Compute stop
   pause/hibernate sandbox, keep filesystem and AnyHarness DB

2. Materialization prune
   delete worktree/checkout/files, keep Cloud-visible history

3. Runtime data purge
   delete AnyHarness local workspace/session DB rows and attachments

4. Cloud data retention
   delete or compact Cloud messages/events/projections/artifacts/audit refs
```

Most cloud-owned work should eventually prune materialization, but keep a slim
Cloud transcript and audit record for useful product history.

Raw payloads and blobs should expire much earlier unless pinned.

## Should Worktree Pruning Become A Larger System?

Yes.

The current AnyHarness worktree pruning system is a seed, not the final model.
The broader system should be called workspace lifecycle and retention.

The current rule:

```text
For each repo on this target, keep at most N materialized standard worktrees.
```

should become one policy rule inside a broader cleanup engine that handles:

- local managed worktrees
- SSH worktrees
- managed cloud worktrees
- whole sandbox teardown
- automation-created ephemeral workspaces
- Slack/team-created shared sessions
- Cloud-visible history after compute is gone

## How Do MCPs And Skills Work With Worker?

Cloud resolves what the session is allowed to use. Worker materializes what
the target needs. AnyHarness launches the bundle.

Flow:

```text
Cloud:
  resolve selected plugin/MCP/skill bundle
  authorize credentials
  create session-scoped launch input
  include materialization plan when needed

Worker:
  verify target readiness
  install/cache selected local stdio MCP commands if missing
  fetch selected skill artifacts if using ref-backed skills
  pass resolved SessionPluginBundle to AnyHarness

AnyHarness:
  mount MCP servers
  expose skills
  run session
```

Worker must not accept arbitrary shell install scripts from Cloud. Use typed
allowlisted materialization recipes.

## What Runtime Readiness Matters For MCPs?

HTTP MCPs usually need only network egress and credentials.

Stdio MCPs may need:

- node/npm/npx
- python/uv
- git
- browser/playwright dependencies
- writable plugin cache
- OS/arch compatibility

Node is not universally enough. Some npm packages include native modules,
postinstall downloads, browser installs, or OS-specific binaries.

## How Do Config And Model Options Work?

Cloud catalog is good for optimistic UI before a live target/session exists.

The live truth comes from AnyHarness and target-discovered state:

- available config options
- current session config
- target model/provider readiness
- dynamic model registries

Config updates should be Cloud commands:

```text
client updates config
  -> CloudCommand(update_session_config)
  -> Worker
  -> AnyHarness
  -> AnyHarness emits config.updated/options.updated
  -> Cloud updates projections
```

## Do We Need Durable Objects?

Not for V1.

Use conventional infrastructure first:

- Postgres for durable rows
- Redis/NATS/pubsub for live patches
- SSE for web/mobile/desktop cloud views
- object storage for retained blobs/artifacts

Keep the coordinator actor-shaped so we can later replace the internals with
Durable Objects or another actor runtime if fanout/ordering pressure requires
it.

## What Is The Biggest Architecture Trap?

Boundary drift.

Avoid:

- Cloud becoming a second AnyHarness runtime database
- Worker reconstructing transcripts
- Worker deciding permissions or credentials
- clients inventing surface-specific command semantics
- Slack/mobile/web each having their own transcript model
- direct desktop access bypassing team policy
- pruning files and deleting Cloud history as one implicit operation

Hard invariant:

```text
Commands down.
Events up.
Projections out.
AnyHarness executes.
Worker bridges.
Cloud coordinates.
Clients render.
```
