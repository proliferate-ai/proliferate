# Sessions

`anyharness-lib/src/domains/sessions/**` owns durable session truth, session-domain
validation, event persistence, live-config persistence, and the runtime-level
orchestration that bridges durable sessions into live ACP execution.

This is a legacy subsystem doc updated for current implementation paths.
Session MCP binding assembly lives under `domains/sessions/mcp_bindings/**`, and the
session store is split under `domains/sessions/store/**`. The runtime implementation is
split under `domains/sessions/runtime/**`.

## Core Concepts

The sessions area has two layers:

- durable session domain
  - `anyharness/crates/anyharness-lib/src/domains/sessions/model.rs`
  - `anyharness/crates/anyharness-lib/src/domains/sessions/store/**`
  - `anyharness/crates/anyharness-lib/src/domains/sessions/service/**`
  - `anyharness/crates/anyharness-lib/src/domains/sessions/prompt/**`
  - `anyharness/crates/anyharness-lib/src/domains/sessions/live_config/**`
  - `anyharness/crates/anyharness-lib/src/domains/sessions/mcp_bindings/**`
  - `anyharness/crates/anyharness-lib/src/domains/sessions/links/**`
- live orchestration bridge
  - `anyharness/crates/anyharness-lib/src/domains/sessions/runtime/**`

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

### `SessionRecord` (`anyharness/crates/anyharness-lib/src/domains/sessions/model.rs`)

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

### `SessionEventRecord` (`anyharness/crates/anyharness-lib/src/domains/sessions/model.rs`)

`SessionEventRecord` is the durable event log row.

It stores:

- monotonically increasing `seq`
- timestamp
- event type
- optional turn and item ids
- serialized event payload JSON

This is the backlog source for session history and SSE replay.

### `SessionRawNotificationRecord` (`anyharness/crates/anyharness-lib/src/domains/sessions/model.rs`)

`SessionRawNotificationRecord` is the durable raw ACP notification row.

It stores:

- monotonically increasing `seq`
- timestamp
- ACP notification kind
- serialized raw notification JSON

This is a debug and regression-capture surface. It does not replace normalized
session events as the runtime truth for replay or rendering.

### `SessionLinkRecord` (`anyharness/crates/anyharness-lib/src/domains/sessions/links/model.rs`)

`SessionLinkRecord` is the durable session graph row.

It stores an advisory relationship between two existing sessions:

- relation: `subagent`, `owned_agent`, or `fork`. Two further values,
  `cowork_coding_session` and `review_agent`, are RETIRED: cowork and reviews
  are deleted and nothing writes them, but the parser still accepts them so
  historical rows load
- parent session id
- child session id
- workspace relation: `same_workspace`, `cross_workspace`, or
  `cowork_managed_workspace` (the last retired with cowork, parsed but never
  written). It is decided when the link is written, by
  comparing the two sessions' workspace ids, and is a durable fact rather than a
  derived one — both sessions' workspaces can later move or be retired, so the
  row records where the child actually landed at creation. `spawn_agent` writes
  `cross_workspace` whenever its `workspaceId` is not the caller's own.
- optional label for display and wake copy
- optional creator turn id
- optional creator tool-call id
- created timestamp
- optional promoted timestamp
- optional closing session id and close reason

The link service validates that parent and child sessions exist, rejects
self-links, and enforces uniqueness for `(relation, parent_session_id,
child_session_id)`. For `subagent` links, a child may have only one parent.
Deleting a session removes any links where that session is the parent or child,
including completion and wake-schedule rows attached to those links.

#### Ownership

`session_links` is also the ownership substrate. Two relations confer
ownership — `subagent` and `owned_agent` — and an agent's ownership state is
read off one row:

| State | Row |
| --- | --- |
| Subagent | `relation = 'subagent'` and `promoted_at IS NULL` |
| Promoted | `relation = 'subagent'` and `promoted_at IS NOT NULL` |
| Owned peer | `relation = 'owned_agent'` |

Promotion stamps `promoted_at`; it does not change the relation, because the
parent stays the owner. It is one idempotent write, and it is one-way. Two
callers perform it: the parent agent's `promote_subagent` tool, and
`POST /v1/sessions/{session_id}/subagents/{child_session_id}/promote` for the
human. Both resolve ownership the same way and take the workspace's shared
`SubagentWrite` lease without a session mutation permit — the write lands on a
link row, not on a session.

The two ownership relations are written by different tools and never converge.
`spawn_subagent` writes `subagent` and `spawn_agent` writes `owned_agent`; a
promoted subagent keeps `subagent` forever. So `owned_agent` means "born a
peer", `subagent` with `promoted_at` set means "became a peer", and the
difference stays legible for the life of the row. A `Promoted` row and an
`Owned peer` row confer the same capabilities from here on.

`closed_by_session_id` and `close_reason` record which agent closed this one and
why. Both stay `NULL` for a session a person closed through the UI or the HTTP
close route — the columns record an *agent's* close, not every close.

Ownership is deliberately separate from `authorize`
(`domains/sessions/authorize.rs`), which answers reachability and is
runtime-wide and unlinked. Reaching an agent and acting on its lifecycle are
different questions; promotion and close resolve an ownership row first, they do
not go through the reachability funnel.

Session links are durable product state, but their creator turn/tool metadata is
provenance only. It must not be used as an authorization, billing, or trust
boundary.

### Live Config Records (`anyharness/crates/anyharness-lib/src/domains/sessions/model.rs`)

There are two durable config-related record types:

- `SessionLiveConfigSnapshotRecord`
  - the last normalized ACP-exposed config surface
- `PendingConfigChangeRecord`
  - config changes requested while a session was busy

These are how the runtime remembers live config across reconnects and busy
periods.

### Internal Prompt Provenance

`PromptPayload` (`anyharness/crates/anyharness-lib/src/domains/sessions/prompt/**`)
can carry internal prompt provenance while it moves through the runtime.

Current producers are internal only. Public prompt requests do not expose a
provenance field, and unknown request fields are not trusted as provenance.

Supported internal provenance kinds are:

- `agent_session`
- `automation`
- `system`
- `subagent_wake`
- `agent_wake`

`None` means human, legacy, or unspecified. Provenance is persisted on
`session_pending_prompts.provenance_json` so queued prompts retain their sender
metadata across process restarts.

Public prompt request bodies still cannot set trusted provenance. Transcript
user-message payloads and pending-prompt read models expose a display-safe
projection for product UI:

- `agentSession`
- `subagentWake`
- `agentWake`
- `system`

Internal automation provenance is not exposed directly; it must be converted to
generic display-safe system provenance or omitted.

### Prompt Attachments

Prompt attachments are durable session state split across SQLite metadata and
runtime-home files. `session_prompt_attachments` owns lifecycle state, kind,
source, MIME/display metadata, size/hash, and the relative storage path. The
attachment bytes live under the AnyHarness runtime home at
`attachments/sessions/<session-id>/<attachment-id>/content` and are read or
deleted only through `PromptAttachmentStorage`.

`kind` describes the content class (`image` or `text_resource`). `source`
describes how the attachment entered the prompt (`upload` or `paste`) and is
display metadata only. Pasted text is still a text resource; it is not a
separate prompt block type. Runtime dispatch embeds image and text-resource
bytes into ACP prompt content after reading them from storage. Managed
`anyharness-attachment://sessions/<session-id>/attachments/<attachment-id>`
URIs identify transcript resources but are not an agent dereference mechanism.

## Same-Workspace Subagents

Same-workspace subagents are the first product use of `SessionLinkRecord`.

The model is intentionally small:

- the child is a normal session in the same workspace as the parent
- the durable ownership boundary is `relation = subagent`
- `session_links` is the access-control check for every child-id-taking tool
- PR2 does not cascade-delete child sessions when a parent is deleted; deleting
  either session removes only the link and attached completion/schedule rows
- nested subagents are blocked; an UNPROMOTED subagent child receives no
  spawn-style tools (`get_subagent_launch_options`, `spawn_subagent`, the
  deprecated `create_subagent` alias, `spawn_agent`, `get_workspace_options`
  and `spawn_workspace`), and both spawn gates refuse it at the service as
  well: `validate_parent_can_spawn` with a depth limit,
  `validate_caller_can_spawn_agent` as a subordinate caller. The tool bodies
  read those gates, so the block does not rest on dispatch alone
- parents are limited to eight *unpromoted* subagents at a time; promoted
  children no longer occupy a slot. The cap counts subagents only: an owner
  sitting at the cap may still spawn owned agents, which are uncapped
- `subagents_enabled` is a durable create-time session policy. Missing legacy
  rows default enabled in the session store/read model. Resume reads the stored
  policy and does not silently re-enable disabled sessions. `spawn_subagent`
  creates every child with it OFF: that flag is how a spawned child carries its
  subordination. Promotion lifts it — `validate_parent_can_spawn` treats a
  promoted child as enabled — so promotion stays one durable fact on the link
  rather than a second write to the session row that could diverge from it.
- the advertised subagent count and remaining slots are the same predicate the
  fanout cap enforces, so the numbers an agent is told match the answer it gets

The subagent domain lives under
`anyharness/crates/anyharness-lib/src/domains/sessions/subagents/**`.

It owns:

- subagent creation/list/read/send validation
- child ownership checks
- passive child completion rows in `session_link_completions`
- one-shot link-scoped wake schedule rows in `session_link_wake_schedules`
  (session-scoped wake rows in `session_wake_schedules` are owned by the
  sessions domain itself, not by the subagent service)
- subagent MCP capability-token validation
- bounded and sanitized child event reads

### Subagent MCP Tools

Standard parent sessions receive an internal MCP server named
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
- `spawn_subagent` (deprecated alias: `create_subagent`)
- `spawn_agent`
- `list_subagents`
- `send_subagent_message`
- `get_subagent_status`
- `read_subagent_events`
- `schedule_subagent_wake`
- `promote_subagent`
- `close_agent` (deprecated alias: `close_subagent`)
- `get_workspace_options`
- `spawn_workspace`

Advertisement is not enforcement. A session's tool list is frozen at launch, so
an agent promoted afterwards holds a list that never showed the spawn tools and
one launched before its promotion holds a list that did. The spawn gate
therefore runs again at dispatch in `agent_ops/calls.rs`, against the caller's
state at the moment it acts, and matches the wire name so the deprecated
`create_subagent` spelling cannot walk around it.

`spawn_subagent` and `spawn_agent` are two modes of one routine,
`create_agent_session` in `agent_ops/spawn_ops.rs`. Both create a durable
session, inheriting the caller's agent kind, model and mode unless overridden,
write the ownership link, arm the optional wake, start the runtime, and send the
first prompt — unwinding the session, link and wake if any step fails. A
subagent is always created in the caller's own workspace and has no argument to
ask otherwise; `spawn_agent` takes an optional `workspaceId` and defaults to the
caller's. They differ in three places, all keyed off the ownership mode:

- the link relation, `subagent` or `owned_agent`
- the wake: a subagent's is link-scoped, hung off the completion row, while a
  peer has no link completion to wait on and so takes a session-scoped wake.
  The peer's is armed as a REPLY wake, the same kind `wakeOnReply` arms on a
  send: the first prompt is a question, so the peer's answer consumes the
  schedule and only a peer that answers nobody produces the pointer
- the first prompt: a subagent's carries parent-to-child provenance with the
  `session_link_id`, a peer's is an envelope-wrapped peer message with none

A peer is created with the full tool surface, including the spawn tools, so it
is never in the "unpromoted" state and needs no promotion. It also does not
cascade: closing the owner does not close it.

Because `spawn_agent` can create in a workspace that is not the caller's, it is
absent from `MUTATING_TOOL_NAMES`: the route's lease is the CALLER's workspace,
which is the wrong one. It takes the TARGET workspace's write lease in the call
instead, held across creation, start and the first prompt, so a concurrent
retire preflight on that workspace sees the session being built inside it. There
is no admission permit and none is possible — the target session does not exist
until the call creates it — so PR1227-LOCK-01 has no order to invert.

The launch selection is resolved against the TARGET workspace's catalog, not the
caller's. A harness that workspace cannot launch is refused, naming what it can;
a model the caller NAMED that the target does not offer is refused; a model
merely INHERITED from the caller is replaced by the target's default for that
harness. A workspace whose catalog resolves to nothing is passed through
unchanged, so an environment without resolvable readiness does not become
un-spawnable.

`get_workspace_options` and `spawn_workspace` let an agent create a workspace of
its own. Both are spawn-style, so an unpromoted subagent gets neither.
`get_workspace_options` is read-only: the configured repo roots, which of them
this machine actually has, and the two creation modes. `spawn_workspace` takes
only a repo root, a mode, a branch name and a label — everything else is
server-side policy — and creates through the same runtimes the human routes use.
It is absent from `MUTATING_TOOL_NAMES` for a different reason than
`spawn_agent`: the workspace it creates does not exist yet, so there is nothing
to lease. It gates the way the human worktree route gates, on
`assert_can_mutate_for_repo_root` plus the caller's own workspace still being
mutable. Retirement is not on this surface at all — see
[workspaces.md](workspaces.md#agent-requested-creation).

`promote_subagent` promotes one of the caller's subagents to a peer. The agent
keeps its transcript, its label and its owner, and gains the full tool surface
including spawning its own agents; it stops closing when its owner closes, and
stops counting against the owner's subagent limit. Only the owning parent may
promote, and only its own child. It is one indexed UPDATE against a link row in
the caller's own workspace and touches no session actor, so it takes the route's
workspace write lease and no session mutation permit.

`close_agent` closes any agent the caller owns, by `sessionId` or by
`subagentId`, with an optional `reason`. Because the target may live in another
workspace and because a close acts on the target session, it takes its own fence
rather than the route's: the TARGET session's mutation permit first, then the
TARGET workspace's write lease (PR1227-LOCK-01). Skipping the permit would let a
close run straight through a workflow that had taken control of that session.

`get_subagent_launch_options` is the discovery surface parent agents should use
before choosing non-default `agentKind`, `modelId`, or `modeId` values. It
reports current parent-derived defaults, launchable agents/models, subagent
limits, and live parent mode options when AnyHarness has observed them. Mode ids
remain launch hints; agent/model choices are validated against the launch
catalog.

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
- a process-local fork id only becomes durable (reloadable via `load_session`)
  once the child has run its own first turn. Until then — i.e. while the child's
  `last_prompt_at` is unset — startup re-forks from the parent
  (`fork_from_native`) rather than loading the child's recorded native id, even
  if one was eagerly persisted at fork creation. Loading it after a cold
  restart-before-first-prompt returns `Resource not found` and, with no
  fallback, bricks the session. Once `last_prompt_at` is set the child loads its
  own native id with no fallback (re-forking would drop the child's own turns).
  If a zero-turn child cannot resolve a parent native id, it falls back to its
  own (possibly stale) native id rather than failing the launch. This applies
  to process-local-fork adapters (Claude); durable-fork adapters keep loading
  their recorded native id per the durable-fork bullet above (a zero-turn
  durable-fork child still uses `load_session`). The decision keys on
  `last_prompt_at`, not on
  `turn_started`: the transcript snapshot below copies the parent's
  `turn_started` events into the child, so that signal is always set for forks.
  Because re-fork is tip-only, a zero-turn child re-forked after the parent
  advanced is seeded from the parent's current tip while its stored
  `session_events` snapshot still reflects the fork-point prefix; the agent then
  reasons over state the child transcript does not show. This is accepted as
  better than the prior permanent failure, but it is a real divergence, not just
  a fidelity gap.
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

### Session-Scoped Wakes

Link-scoped wakes above only ever wake a parent about its own child. A
session-scoped wake is armed on a session PAIR in `session_wake_schedules`
(`watcher_session_id`, `target_session_id`), so it can be armed on any session
in the runtime with no relationship between the two. Arming twice is a no-op —
the pair is the primary key — and a session cannot wait on itself.

Three callers arm the same row: `schedule_agent_wake`, the `wakeOnReply` flag on
`send_agent_message`, and `POST /v1/sessions/{session_id}/wakes/{target_session_id}`
for the human. All three require an OPEN target: a closed session never finishes
another turn, so arming on one is rejected rather than silently never firing.
The human route additionally requires the TARGET to be visible to the token's
scope, and answers every refusal it cannot serve with the same 404 discovery
gives an unknown id; runtime-wide reach is the agent contract, not the human
one.

The row records WHY it was armed (`armed_for_reply`), because the two reasons
are consumed differently. A `wakeOnReply` arm is the safety net for an answer,
so the answer consumes it. An explicit `schedule_agent_wake` (or the human
route) is a standing request that only the target's turn finish ends, so an
incidental message — "starting now" — cannot cancel it. Re-arming an existing
pair keeps the stronger reason: a reply arm upgrades to an explicit schedule and
is never downgraded back.

Consumption mirrors the link-scoped latch. When ANY session finishes a turn, one
transaction deletes every schedule for that target and queues one pointer prompt
per deleted watcher. No schedule is ever consumed without its prompt, and no
schedule fires twice. An offline watcher needs no special case: the pointer is a
durable `session_pending_prompts` row.

Two watchers are handled differently by that transaction, because a pointer is a
PROMPT and the prompt paths have rules:

- A watcher a nonterminal workflow controls is not prompted, and its schedule is
  NOT consumed. The row stays armed and fires at the target's next finished turn
  after the run releases control. Every other route into a session's prompt
  queue refuses a controlled session; a wake is no exception. Which watchers are
  controlled is decided by a read-only controller lookup taken BEFORE the
  transaction — it acquires no admission permit and no workspace lease, so it
  adds no edge to the canonical lock order.
- A CLOSED watcher's schedule is deleted with no prompt. A closed session takes
  no input, so the schedule can never be fulfilled and leaving it armed would
  strand the row.

A closed TARGET is handled at the same point: it will not finish another turn,
so its remaining schedules are cleared rather than left unconsumable. Deleting
either session clears both sides already.

Because consumption happens at turn finish rather than at arm time, a schedule
armed while the target's turn is ALREADY running fires at the end of that turn:
there is no wait-for-next-turn race for a target that is working. That is the
whole of the guarantee. A wake fires at the end of the target's next FINISHED
turn, so an IDLE target that nobody prompts fires nothing at all —
`schedule_agent_wake` reports the target's live status so the caller can send a
message instead of waiting on silence. Consumption also runs only from the
actor's turn-finish path: a turn that failed before it ever opened still fires
(the pointer carries `Outcome: failed`), but a runtime that dies mid-turn
consumes nothing and leaves the schedule armed for the next finished turn.

A real reply consumes the schedule instead of firing it: when the target sends
the watcher an agent message, that message already carried the content, so the
`(watcher, target)` reply arm is dropped. Consumption happens after the send
lands, not inside it — the send is a runtime call that may boot an actor, not a
single write — so a crash in that gap costs one redundant pointer rather than a
lost wake. The mirror case is the failed send: an arm whose dispatch failed is
compensated away, but only while no send that LANDED relies on it
(`dispatch_confirmed_at`), because two concurrent sends to one target share the
one row.

Session-scoped wake prompts use internal `agent_wake` provenance carrying the
target session id and its label. There is no link id or completion id to carry.

## Session Extensions

`SessionRuntime` supports small runtime extensions for launch additions and
turn-finished notifications.

The extension trait lives in
`anyharness/crates/anyharness-lib/src/domains/sessions/extensions.rs`.

Extensions may:

- add launch MCP servers, environment, or system-prompt text through
  `resolve_launch_extras`
- receive `on_turn_finished` notifications with session id, workspace, turn id,
  outcome, stop reason, and last event seq

Subagent support and session-scoped wakes both use this
extension surface — the wake extension runs for every finished turn, because any
session can be the target of a wake.
Extension failures are isolated from the actor path: they are logged and do not
make the completed turn fail.

## Durable Session Flow

### Create

`SessionService::create_session(...)`
(`anyharness/crates/anyharness-lib/src/domains/sessions/service/create.rs`)
does the durable validation path.

It:

1. validates an optional caller-selected canonical lowercase v4 `sessionId`
2. for an idempotent public replay, returns the nonterminal row already owned
   by the same workspace and agent or rejects cross-owner, closed, or dismissed
   reuse with `SESSION_ID_CONFLICT`; the UUID is first-writer resource identity,
   so the original row remains authoritative for later same-owner replays
3. verifies the workspace exists
4. verifies the requested agent kind exists in the built-in registry
5. resolves the agent and requires it to be ready
6. validates the requested model id against the curated provider catalog
7. atomically creates the durable `SessionRecord` in `starting` state, or
   returns the concurrently inserted row for the same idempotent request

This path does not start ACP directly. It only produces a valid durable session
record. Omitting `sessionId` preserves ordinary server-minted identity. Internal
preselected ids remain strict fresh-create inputs unless their caller explicitly
uses the idempotent public create seam.

### Read and History

The durable service and store own:

- `get_session`
- `list_sessions`
- `list_session_event_records`
- `get_live_config_snapshot`

SSE replay and history endpoints read from these durable records first before
merging live events.

## Runtime Flow

The runtime flow is implemented across `domains/sessions/runtime/**`, split by
API-facing session operation family.

### Create and Start

`SessionRuntime::create_and_start_session(...)`
(`anyharness/crates/anyharness-lib/src/domains/sessions/runtime/creation.rs`)
is the eager live-start path.

It:

1. asks `SessionService` to create the durable row or resume the exact
   caller-selected row
2. resolves the workspace
3. resolves the agent again for launch
4. asks `LiveSessionManager` to start the live actor; idempotent create requests
   hold the session mutation permit across this operation so concurrent replays
   cannot launch duplicate actors, and a replay that finds a handle still in
   startup joins its shared readiness result instead of returning early
5. `LiveSessionManager` reads the last durable event seq inside its start/inject
   critical section
6. persists the native session id and updates status to `idle`

This is the bridge from durable session creation into live ACP execution.

### Resume

`ensure_live_session(...)`
(`anyharness/crates/anyharness-lib/src/domains/sessions/runtime/startup.rs`)
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

#### Close cascade

`close_live_session` closes a tree: children first, then the actor, then the
inbound links. Which children go down with the parent is decided per link:

- `subagent` cascades only while `promoted_at IS NULL`. Promotion severs the
  cascade and nothing else — the row survives, so the former parent may still
  close that agent deliberately.
- the retired `cowork_coding_session` and `review_agent` relations still
  cascade. Nothing writes them any more, so this only governs historical rows.
- `owned_agent` never cascades: it is a peer by construction, so there is no
  subordination to sever.
- `fork` never cascades: a fork is a copy, not a dependent.

When a session itself closes, every inbound ownership link pointing at it —
plus any historical cowork or review link — closes with it, promoted or not.

The cascade closes descendants directly. The soft close below is a guarantee for
the agent a close was AIMED at, not for its subtree: a working subagent of a
closing parent goes down with the parent, mid-step, as it always has.

#### Soft close

Closing an agent that is *working* does not interrupt it.

- The target's execution phase is `Running`: the call authorizes the close,
  stamps `closed_by_session_id`/`close_reason` on the still-open ownership row,
  and returns `closeRequested`. That stamped-but-open row IS the durable
  request. The agent finishes the step it is on; at turn finish
  (`domains/sessions/ownership/hooks.rs`) the close tree runs. Because the
  request is durable, a runtime that restarts mid-turn still owes the close and
  the next finished turn pays it.
- Any other phase closes immediately. `AwaitingInteraction` is a turn that
  cannot finish without a human, so deferring would mean never; `Starting` has
  no turn to finish and may never emit one.

The deferred half re-takes the same two gates in the same order rather than
carrying them, because the requesting call returned long ago and control can be
acquired in between. A refusal there leaves the request armed for the next
finished turn rather than dropping it.

Once a close is requested, no new turn may START. Otherwise the deferred close
races the actor's own queue: turn N ends, the idle loop immediately takes the
next durable prompt, and the close — landing a few milliseconds later from the
turn-finish hook — kills turn N+1 in the middle of its step, which is exactly the
interruption a soft close promises never happens. So the actor consults the
durable request at both of its turn-start points (`live/sessions/actor/run.rs`:
the queue drain, and the prompt command received while idle) and starts nothing
while a request stands. The check is fail-closed — a lookup error blocks the
turn — because a turn wrongly not started is recoverable and a step killed in
the middle is not.

Prompts aimed at an end-requested agent are therefore never delivered, and the
paths differ in how they say so:

- An agent's `send_agent_message` / `send_subagent_message` is refused outright,
  told that the target is finishing its final step before closing and takes no
  new messages. Reads are untouched: the transcript stays readable during the
  window and after the close.
- A prompt from a person on the HTTP route is accepted and stored durably,
  exactly as a prompt to any busy session is. It simply never starts — the
  actor's turn-start fence is the seam, and once the close lands the actor does
  not run again. There is no separate refusal on the human route.
- Prompts already queued behind the in-flight turn are kept, not cancelled. A
  close marks the session closed and closes its links; it does not delete
  `session_pending_prompts` rows. They stay visible as queued work that was
  never run.

A request whose agent never finishes another turn — the runtime died between the
stamp and the turn end — is paid at boot. A startup pass sweeps the open
ownership rows carrying a close request and, for any target with no live handle,
completes the close through the same body the turn-finish hook uses. A target
that IS live is left alone; its own turn finish still owes the close.

Attribution is written once, and the first requester owns it for the whole
end-requested window: a second close arriving while the request is still open
neither overwrites the record nor re-stamps it. A close of an already-closed
agent leaves the first close's record alone and returns idempotently before
taking any gate.

### Interaction Resolution

Interaction resolution also goes through `SessionRuntime`.

It does not persist interaction decisions itself. It finds the live session
handle and delegates to the live runtime. Current interaction kinds include:

- permission decisions
- requested user input
- MCP elicitation responses

The public resolution path is
`POST /v1/sessions/{session_id}/interactions/{interaction_id}/resolve`.
`proliferate-worker` uses the same route for Cloud-mediated web/mobile/Slack
approval and input commands.

## Configuring Flow

Live session configuration is deliberately split across the session and ACP
layers.

### What the session domain owns

The session domain owns:

- the durable live-config snapshot
- the queue of pending config changes
- normalized control metadata exposed back to clients

`live_config/**`
(`anyharness/crates/anyharness-lib/src/domains/sessions/live_config/**`)
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

### Who requests a config change

Two callers reach the same `SessionRuntime::set_live_session_config_option`, and
neither has its own apply machinery:

- the human client, through
  `POST /v1/sessions/{session_id}/config-options`
- another agent, through the `configure_agent` tool on the agent ops MCP
  (`domains/sessions/agent_ops/**`)

The tool takes the same `configId`/`value` pair the route's request body does.
It differs only in what it must establish before applying, because the session
it mutates is not the one it was called on:

- the options it validates against are composed for the TARGET session's
  workspace (`resolved_workspace_launch_options` for that workspace, merged
  with that session's live snapshot) — never the calling agent's workspace
- it acquires the TARGET session's `SessionMutationKind::Config` admission
  permit with an External source, so a workflow-controlled session refuses a
  foreign change with the same stable conflict the HTTP route answers
- it then takes the TARGET workspace's shared `SubagentWrite` operation lease,
  unconditionally and with no same/different-workspace branch, in the canonical
  `permit -> operation lease` order. There is nothing to reuse: `configure_agent`
  is deliberately absent from `tools::MUTATING_TOOL_NAMES`, so the MCP endpoint
  holds NO workspace lease for this call, and the route's lease would have been
  the CALLER's workspace anyway — the wrong one to hold open against the target
  workspace's retire preflight. `send_agent_message` works the same way; the
  comment at `agent_ops/tools.rs` on `MUTATING_TOOL_NAMES` is the code-side
  statement of it.
- the caller's own workspace is still asserted mutable (an access-gate check,
  no lease), because the route stopped doing it once the tool left
  `MUTATING_TOOL_NAMES`

### End-to-end config flow

1. client or peer agent requests a config change
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

- `anyharness/crates/anyharness-lib/src/domains/sessions/live_config/**`
- `anyharness/crates/anyharness-lib/src/live/sessions/actor/config/**`

#### Same-session model changes

The current active catalog authorizes a catalog model against the recorded auth
contexts captured when the session was created. Legacy sessions without those
recorded auth contexts gain no extra catalog authorization: advertised options
govern when present. The legacy direct setter may defer to the harness only
when there is no model config option and no direct model control—both
`current_model_id` and `available_models` are empty.

The runtime will start or resume a live actor before applying a model change.
What happens next depends on actor state and authorization:

- When the actor is idle, an accepted update applies to the live process.
- When the actor immediately rejects a catalog-authorized model, the runtime
  persists the requested model, retires the agent process, and attempts to
  relaunch it under the same session ID.
- Persistence occurs before retirement and relaunch. If relaunch fails, the
  request returns an internal error and the durable model selection remains
  updated; it is not rolled back.
- An immediate rejection that is not catalog-authorized returns
  `SESSION_CONFIG_REJECTED` and does not relaunch the process.
- During an active turn, the actor persists the change and returns `Queued`.
  It replays the change when idle. A replay rejection removes the pending
  change inside the actor. The requested model remains persisted; current
  model remains the last accepted value, and the rejection does not reach the
  runtime relaunch arm or retroactively fail the original request. This is a
  current gap rather than a universal relaunch contract.

Every path preserves the durable session identity. A same-session model change
may therefore keep or replace the live agent process without creating a new
session.

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
- Only the owning parent may promote or close an agent, and ownership is read
  from a `session_links` row — never from reachability.
- Promotion is one-way and idempotent, and severs only the close cascade.
- A close of a working agent never interrupts its in-flight step.
- A close whose target is outside the caller's own link tree takes the target
  session's mutation permit before any workspace lease.

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
