# Sessions

`anyharness-lib/src/sessions/**` owns durable session truth, session-domain
validation, event persistence, live-config persistence, and the runtime-level
orchestration that bridges durable sessions into live ACP execution.

## Core Concepts

The sessions area has two layers:

- durable session domain
  - `anyharness/crates/anyharness-lib/src/sessions/model.rs`
  - `anyharness/crates/anyharness-lib/src/sessions/store.rs`
  - `anyharness/crates/anyharness-lib/src/sessions/service.rs`
  - `anyharness/crates/anyharness-lib/src/sessions/links/**`
- live orchestration bridge
  - `anyharness/crates/anyharness-lib/src/sessions/runtime.rs`

The durable layer owns:

- session identity
- stored status
- event history
- raw ACP notification history for debugging
- persisted live-config snapshots
- queued config changes
- internal prompt provenance for queued prompts
- durable session links between related sessions

The runtime layer owns:

- create-and-start
- resume
- prompt / cancel / close
- permission resolution
- coordination with workspaces and ACP

## Core Models

### `SessionRecord` (`anyharness/crates/anyharness-lib/src/sessions/model.rs`)

`SessionRecord` is the durable session row.

It includes:

- `id`
- `workspace_id`
- `agent_kind`
- `native_session_id`
- requested / current model and mode fields
- status
- timestamps

This is the durable identity surface for a session.

### `SessionEventRecord` (`anyharness/crates/anyharness-lib/src/sessions/model.rs`)

`SessionEventRecord` is the durable event log row.

It stores:

- monotonically increasing `seq`
- timestamp
- event type
- optional turn and item ids
- serialized event payload JSON

This is the backlog source for session history and SSE replay.

### `SessionRawNotificationRecord` (`anyharness/crates/anyharness-lib/src/sessions/model.rs`)

`SessionRawNotificationRecord` is the durable raw ACP notification row.

It stores:

- monotonically increasing `seq`
- timestamp
- ACP notification kind
- serialized raw notification JSON

This is a debug and regression-capture surface. It does not replace normalized
session events as the runtime truth for replay or rendering.

### `SessionLinkRecord` (`anyharness/crates/anyharness-lib/src/sessions/links/model.rs`)

`SessionLinkRecord` is the durable session graph row.

It stores an advisory relationship between two existing sessions:

- relation, currently `subagent`
- parent session id
- child session id
- workspace relation, currently `same_workspace`
- optional label for display and wake copy
- optional creator turn id
- optional creator tool-call id
- created timestamp

The link service validates that parent and child sessions exist, rejects
self-links, and enforces uniqueness for `(relation, parent_session_id,
child_session_id)`. For `subagent` links, a child may have only one parent.
Deleting a session removes any links where that session is the parent or child,
including completion and wake-schedule rows attached to those links.

Session links are durable product state, but their creator turn/tool metadata is
provenance only. It must not be used as an authorization, billing, or trust
boundary.

### Live Config Records (`anyharness/crates/anyharness-lib/src/sessions/model.rs`)

There are two durable config-related record types:

- `SessionLiveConfigSnapshotRecord`
  - the last normalized ACP-exposed config surface
- `PendingConfigChangeRecord`
  - config changes requested while a session was busy

These are how the runtime remembers live config across reconnects and busy
periods.

### Internal Prompt Provenance

`PromptPayload` (`anyharness/crates/anyharness-lib/src/sessions/prompt.rs`)
can carry internal prompt provenance while it moves through the runtime.

Current producers are internal only. Public prompt requests do not expose a
provenance field, and unknown request fields are not trusted as provenance.

Supported internal provenance kinds are:

- `agent_session`
- `automation`
- `system`
- `subagent_wake`

`None` means human, legacy, or unspecified. Provenance is persisted on
`session_pending_prompts.provenance_json` so queued prompts retain their sender
metadata across process restarts.

Public prompt request bodies still cannot set trusted provenance. Transcript
user-message payloads and pending-prompt read models expose a display-safe
projection for product UI:

- `agentSession`
- `subagentWake`
- `system`

Internal automation provenance is not exposed directly; it must be converted to
generic display-safe system provenance or omitted.

## Same-Workspace Subagents

Same-workspace subagents are the first product use of `SessionLinkRecord`.

The model is intentionally small:

- the child is a normal session in the same workspace as the parent
- the durable ownership boundary is `relation = subagent`
- `session_links` is the access-control check for every child-id-taking tool
- PR2 does not cascade-delete child sessions when a parent is deleted; deleting
  either session removes only the link and attached completion/schedule rows
- nested subagents are blocked; a session that is already a subagent child does
  not receive subagent MCP tools
- parents are limited to eight subagents
- `subagents_enabled` is a durable create-time session policy. Missing legacy
  rows default enabled in the session store/read model. Resume reads the stored
  policy and does not silently re-enable disabled sessions.

The subagent domain lives under
`anyharness/crates/anyharness-lib/src/sessions/subagents/**`.

It owns:

- subagent creation/list/read/send validation
- child ownership checks
- passive child completion rows in `session_link_completions`
- one-shot wake schedule rows in `session_link_wake_schedules`
- subagent MCP capability-token validation
- bounded and sanitized child event reads

### Subagent MCP Tools

Standard non-cowork parent sessions receive an internal MCP server named
`subagents` at launch time. The MCP binding is generated by a session extension,
not by client-provided configuration.

The token binds to:

- workspace id
- parent session id
- expiration time

Tools must not trust a model-supplied parent id. The trusted parent id comes
from the token. Any tool that accepts `childSessionId` must look up a matching
`session_links(parent_session_id, child_session_id)` row before reading or
mutating the child.

Current tools:

- `get_subagent_launch_options`
- `create_subagent`
- `list_subagents`
- `send_subagent_message`
- `get_subagent_status`
- `read_subagent_events`
- `schedule_subagent_wake`

`get_subagent_launch_options` is the discovery surface parent agents should use
before choosing non-default `agentKind`, `modelId`, or `modeId` values. It
reports current parent-derived defaults, launchable agents/models, subagent
limits, and live parent mode options when AnyHarness has observed them. Mode ids
remain launch hints in this PR; agent/model choices are validated against the
launch catalog.

`read_subagent_events` is deliberately bounded. It accepts `sinceSeq` plus a
limit capped at 100, strips streaming deltas, and removes raw tool input/output
from returned event JSON.

## Forked Sessions

Forked sessions use the same durable session/link model but with
`relation = fork` and `workspace_relation = same_workspace`.

Fork invariants:

- the child is a normal session in the same workspace as the parent
- the original parent transcript and workspace files are not mutated or
  reverted by AnyHarness
- the child has its own durable session row, native ACP session id, actor, and
  event stream
- adapters with durable fork ids may fork on the parent actor and then start the
  child with `load_session`
- adapters whose fork ids are process-local until first prompt, such as Claude,
  start the child actor with `fork_from_native`; that child actor calls ACP
  `session/fork` from the parent native id and owns the resulting live fork
- for adapters that cannot replay the forked transcript through child
  `load_session`, AnyHarness snapshots the parent's durable `session_events`
  into the child before startup and appends child events after that prefix
- raw ACP notifications are not copied into fork children
- generic ACP fork support means tip fork only

AnyHarness exposes fork through typed contract fields. ACP `_meta.anyharness`
is reserved for private runtime-to-adapter extensions and must not leak into
desktop or public HTTP shapes.

### Parent Wake

Child turn completion is passive by default. When a child turn finishes, the
subagent extension inserts a durable completion row keyed by
`(session_link_id, child_turn_id)` and injects a typed
`subagent_turn_completed` metadata event into the parent session. SDK reducers
and UI consumers use this for latest state; it is not transcript content.

Parent wake prompts require an explicit one-shot schedule. Parent agents should
call `schedule_subagent_wake` after `create_subagent` or
`send_subagent_message` when they want to listen for the child's next
completion. Legacy `wakeOnCompletion` fields on create/send are still parsed for
backward compatibility but are no longer advertised. The schedule is a latch in
`session_link_wake_schedules`; it applies only to the next newly recorded
completion for that link and is consumed in the same transaction that queues the
parent prompt. Duplicate/replayed completion processing must not consume a
schedule created after the original completion row already existed.

Parent-to-child prompts use internal `agent_session` provenance with the parent
session id and session link id. Runtime child-to-parent wake prompts use
internal `subagent_wake` provenance with the `session_link_id` and
`completion_id`. Legacy `system/subagent_wake` rows are tolerated for
pending-wake detection, but public read models must not fabricate missing link
or completion ids.

## Session Extensions

`SessionRuntime` supports small runtime extensions for launch additions and
turn-finished notifications.

The extension trait lives in
`anyharness/crates/anyharness-lib/src/sessions/extensions.rs`.

Extensions may:

- add launch MCP servers, environment, or system-prompt text through
  `resolve_launch_extras`
- receive `on_turn_finished` notifications with session id, workspace, turn id,
  outcome, stop reason, and last event seq

Cowork artifact support and subagent support both use this extension surface.
Extension failures are isolated from the actor path: they are logged and do not
make the completed turn fail.

## Durable Session Flow

### Create

`SessionService::create_session(...)`
(`anyharness/crates/anyharness-lib/src/sessions/service.rs`)
does the durable validation path.

It:

1. verifies the workspace exists
2. verifies the requested agent kind exists in the built-in registry
3. resolves the agent and requires it to be ready
4. validates the requested model id against the curated provider catalog
5. creates the durable `SessionRecord` in `starting` state

This path does not start ACP directly. It only produces a valid durable session
record.

### Read and History

The durable service and store own:

- `get_session`
- `list_sessions`
- `list_session_event_records`
- `get_live_config_snapshot`

SSE replay and history endpoints read from these durable records first before
merging live events.

## Runtime Flow

### Create and Start

`SessionRuntime::create_and_start_session(...)`
(`anyharness/crates/anyharness-lib/src/sessions/runtime.rs`)
is the eager live-start path.

It:

1. asks `SessionService` to create the durable row
2. resolves the workspace
3. resolves the agent again for launch
4. asks `AcpManager` to start the live actor
5. `AcpManager` reads the last durable event seq inside its start/inject
   critical section
6. persists the native session id and updates status to `idle`

This is the bridge from durable session creation into live ACP execution.

### Resume

`ensure_live_session(...)`
(`anyharness/crates/anyharness-lib/src/sessions/runtime.rs`)
is the idempotent cold-start path for an existing session.

It:

1. loads the durable session row
2. checks whether a live handle already exists
3. if not, restarts the live actor using the persisted native session id
4. returns the refreshed durable session summary

### Prompt / Cancel / Close

Prompt flow is owned by `SessionRuntime`, but actual prompt execution is owned
by the ACP actor.

The runtime layer:

- ensures the actor exists
- sends the command over the actor channel
- maps actor/lifecycle errors into runtime-facing errors

Cancel and close follow the same pattern.

### Permission Resolution

Permission resolution also goes through `SessionRuntime`.

It does not persist permissions itself. It finds the live session handle and
delegates to ACP’s permission broker via the live runtime.

## Configuring Flow

Live session configuration is deliberately split across the session and ACP
layers.

### What the session domain owns

The session domain owns:

- the durable live-config snapshot
- the queue of pending config changes
- normalized control metadata exposed back to clients

`live_config.rs`
(`anyharness/crates/anyharness-lib/src/sessions/live_config.rs`)
is the normalization layer from ACP config options into the runtime-owned
`SessionLiveConfigSnapshot` shape.

It:

- flattens ACP select options into raw config options
- groups known controls into normalized buckets such as model, mode, reasoning,
  effort, and fast mode
- preserves everything else as extras

### What the ACP runtime owns

The ACP runtime owns:

- applying or queuing config changes against a live actor
- restoring persisted config after resume
- emitting config updates when ACP changes the active surface

### End-to-end config flow

1. client requests a config change
2. `SessionRuntime` ensures the actor is live
3. the actor tries to apply the change through ACP
4. if the session is busy, the change is queued durably
5. ACP config updates rebuild the normalized snapshot
6. the snapshot is persisted durably
7. queued changes are replayed when the actor becomes idle

### Model selection specifics

Model changes have extra logic because agents expose models in different ways.

The runtime tries:

1. direct ACP model APIs
2. curated Claude alias handling when needed
3. generic config-option setters as a fallback

That is why model configuration spans both:

- `anyharness/crates/anyharness-lib/src/sessions/live_config.rs`
- `anyharness/crates/anyharness-lib/src/acp/session_actor.rs`

## SSE and Event Flow

The session stream endpoint merges:

- durable backlog from `SessionStore`
- live broadcast events from the active `LiveSessionHandle`

The important behavior is:

- durable history is always replayable
- live events continue from the highest already-sent sequence
- SSE does not become the source of truth; durable event rows do

Code path:

- `anyharness/crates/anyharness-lib/src/api/sse/sessions.rs`

## Boundaries

### Sessions Owns

- durable session identity
- session validation
- session status persistence
- event history persistence
- live-config snapshot persistence
- pending config-change persistence
- runtime-level orchestration between durable sessions, workspaces, and ACP

### Sessions Does Not Own

- low-level ACP protocol handling
- live actor registry
- workspace registration or worktree creation
- agent installation logic
- HTTP or SSE transport parsing

## Important Invariants

- A session must belong to a valid workspace.
- A session must target a supported, ready agent before creation succeeds.
- Session event sequences are monotonic per session.
- Durable records remain authoritative even when no live actor exists.
- Config changes requested while busy must not be lost.

## Extension Points

Add behavior here when it changes session-domain rules or durable/runtime
session orchestration, for example:

- new session validation rules
- new durable config metadata
- new session lifecycle operations
- new config-normalization behavior

Do not add behavior here when it belongs purely to:

- ACP protocol callbacks
- workspace identity rules
- agent install or credential logic
