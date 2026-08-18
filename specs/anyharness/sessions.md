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

- relation, currently `subagent`
- parent session id
- child session id
- workspace relation, currently `same_workspace`
- optional label for display and wake copy
- optional creator turn id
- optional creator tool-call id
- created timestamp
- optional `subagent_closed_at`, the reversible operability gate for subagent
  relationships
- optional `closed_at`, the terminal relationship-history marker

The link service validates that parent and child sessions exist, rejects
self-links, and enforces uniqueness for `(relation, parent_session_id,
child_session_id)`. For `subagent` links, a child may have only one parent.
Deleting a session removes any links where that session is the parent or child,
including completion and wake-schedule rows attached to those links.
Accepted completion-delivery snapshots are separate from link history: deleting
the parent removes them, while promotion or later child deletion preserves them
until the parent sees the attributed completion prompt.

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

## Same-Workspace Delegated Agents

Same-workspace delegated agents use `SessionLinkRecord`; `subagent` remains the
durable relation and public product vocabulary.

The model is intentionally small:

- the child is a normal session in the same workspace as the parent
- the durable ownership boundary is `relation = subagent`
- `session_links` is the authorization check for every relationship-targeting
  operation
- the child session and capped relationship are inserted atomically, so an
  in-progress delegated-agent creation is never observable as an ordinary
  session
- deleting either session removes the relationship and link completion rows.
  Accepted completion-delivery snapshots are separate: parent deletion removes
  them, while child deletion or promotion preserves them until the parent sees
  the attributed prompt
- delegated agents cannot create agents, but eligible delegated sessions still
  receive Workspace for identity, reads, messaging, and parent-authorized
  operations
- parents are limited to eight delegated-agent relationships, including
  reversibly Closed relationships
- `subagents_enabled` remains serialized on session records for wire and
  mobility compatibility. Workspace attachment and current-role authority do
  not consult it; Workspace-created delegated agents intentionally store it as
  disabled.

Subagent relationship operability is separate from terminal session state:

- Open means `subagent_closed_at` is unset and parent/user mutations may target
  the child.
- Close atomically sets `subagent_closed_at` and purges every durable pending
  prompt. Completion-ledger rows, transcript, config, native session id,
  session row, and relationship remain. The transaction also removes any stale
  shared wake-table row left by an older runtime, but current delegated-agent
  behavior cannot create or read such a schedule.
- After that transaction commits, the runtime non-terminally unloads the actor.
  An active turn is cancelled with a bounded grace period; already-streamed
  output and the Cancelled completion are preserved. Close never writes the
  session's `closed_at` or `dismissed_at`.
- Open restarts the same durable/native conversation before clearing the gate.
  Failure leaves the relationship Closed, and purged prompts are not replayed.
- Closed relationships remain parent/user-queryable and count toward the
  eight-child limit, but all mutation paths other than Open or idempotent Close
  return an Open-required conflict.
- Promotion is allowed only while Open. It physically deletes the relationship
  while leaving the session, actor, active turn, native identity, transcript,
  and config untouched; subsequent authorization and reads treat the session
  as ordinary.

The relationship mutation gate is shared by Workspace Agent Operations and
HTTP session mutations. This keeps Close serialized against prompts, config
changes, and terminal lifecycle calls. There is no Subagents MCP
registration, capability token, tool surface, or compatibility alias.

The subagent domain lives under
`anyharness/crates/anyharness-lib/src/domains/sessions/subagents/**`.

It owns only the remaining session-domain mechanics:

- capped same-workspace relationship insertion and roster summaries
- passive child completion rows in `session_link_completions`
- durable completion delivery, retry, and transcript-correlation helpers
- the turn-finished latency nudge for the crash-safe delivery worker

### Workspace MCP And Completion Delivery

Workspace Agent Operations owns agent discovery, creation, configuration,
messaging, interruption, Close, Open, Promote, and request-time relationship
authorization. Its MCP implementation lives under
`domains/agent_operations/mcp/**`; the exact 20-tool contract lives in
[Workspace Product MCP](../codebase/platforms/product/agent-features/definitions/workspace.md).

Workspace attaches to Standard sessions unless their binding policy is
`InternalOnly`. That includes ordinary, delegated, and promoted/restarted
sessions; Cowork and internal review/workflow sessions do not receive it. The
capability token binds the runtime, workspace, session, and product MCP, while
every `tools/call` resolves current caller role, parent ownership,
relationship, workspace, and target truth again.

Delegated completion notification is durable session admission, not a
one-shot MCP wake tool. Terminal persistence captures the child completion and
delivery intent; the delivery worker admits at most one parent prompt with
`PromptProvenance::SubagentWake`, and restart/reconciliation preserves exactly
once visibility. The terminal assistant message remains the completion payload
relayed to the parent.

A fresh delivery may instead resolve without its own parent wake turn at
enqueue time, in the same transaction that would have inserted the wake:

- `coalesced` — an earlier wake for the same child is still queued and
  unconsumed. Its queue row is rewritten in place (same seq and queue
  position) to carry the newest delivery's canonical prompt, and the older
  delivery is retired, so the parent drains at most one wake per child and
  always sees the newest terminal result. Durable child event sequence, rather
  than worker claim order, decides which result is newest: if restart or retry
  processes an older completed delivery after a newer completed, failed, or
  cancelled result, that stale completed delivery retires without adding a
  second wake. The newer failed or cancelled result itself always keeps its
  actionable wake.
- `redundant_child_message` — the child's own `agent_session` message for the
  completed terminal turn already reached the parent (still queued since the
  child turn started, or correlated after execution through its durable queue
  identity and original `queued_at`), so the message is the wake and a second
  turn would be redundant. The same transaction also retires an older queued
  completed wake that the message supersedes. The same transaction retains a
  durable removal intent with that exact queue identity. The worker persists
  exactly one `pending_prompt_removed` through a durable event key,
  acknowledges the intent only after strict event persistence, and retries
  leased unacknowledged intents after failure, restart, or mobility handoff.
  That key is reserved for canonical completion-wake prompt ids; ordinary
  prompt deletions remain unkeyed so reused identities in legacy histories stay
  importable.
  Failed attempts are deferred so a poisoned parent cannot starve later
  removals. This makes live and replayed queue projections converge. This never
  applies to failed or cancelled turns; those always materialize a wake turn.

Every automatic durable-queue drain first ensures that the row's
`pending_prompt_added` event is persisted. Detached activation and startup
replay therefore preserve the original queue identity and `queued_at` before
the row can become an executed transcript item, including across a crash
between queue commit and activation. The visibility check matches sequence,
immutable `queued_at`, and the current prompt projection (`prompt_id`, text,
content parts, and prompt provenance), so neither a legacy reused numeric
sequence nor an earlier projection of an in-place completion-wake rewrite can
impersonate the current row. A rewritten row receives a replacement
`pending_prompt_added` before execution. If a staged row is removed before this
check, the drain discards its staged payload and re-peeks the durable queue.
Database migration backfill raises existing cursors from pending rows, scalar
and reordered queue events, completion projections, and delivery-held prompt
identities or review-feedback receipts before new prompts are allocated.

Neither applies to a delivery that ever reached the parent queue
(recreate/retry reconciliation keeps its legacy exactly-once path). A retired
or suppressed delivery is terminal `delivered` with no
`parent_prompt_seq`/`parent_turn_id`; the completion ledger row and injected
completion event keep the result durable and visible to delegated-work
surfaces, and the worker records the decision under
`anyharness.subagent.delivery_suppressed` with the reason.

The worker also injects one `subagent_turn_completed` event into the parent
transcript on the single Pending to Enqueued delivery transition, ahead of the
wake turn admitted from the queued prompt — and likewise when a delivery is
suppressed, where that event is the only parent-transcript record. That event
carries the completion metadata the transcript indexes for wake receipts and
roster invalidation; injection is best effort because the delivery is already
committed and the transition never repeats.

`session_link_wake_schedules` remains a shared persistence and mobility wire
contract solely for Cowork. Delegated-agent relationships cannot create, read,
export, or import a wake schedule; mobility filters and validates schedules by
Cowork relation.

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
- generic ACP fork support (`action_capabilities.fork`) means tip fork only;
  targeted fork requires the separate `action_capabilities.targeted_fork`
  capability, absent on every adapter until the per-harness bridges land

### Fork boundary and the durable operation record

Every fork — tip or targeted — is one durable operation recorded in
`fork_operations` before the native call and advanced through explicit phases.
The record is the single source of truth for idempotency, provenance, and
recovery; nothing load-bearing lives in opaque adapter `_meta`.

- Boundary. A tip fork carries no product anchor (`target = null`). A targeted
  fork's boundary is `(turn_id, item_id)` of a committed user message in the
  parent's `session_events`, meaning "the conversation as it stood immediately
  before that message." `item_id` is required at the product boundary; an
  item-less target is rejected `INVALID_FORK_TARGET`. An anchor that does not
  resolve to a committed user-message event is `TARGET_NOT_FOUND`; an anchor
  inside the parent's active/uncommitted turn is `BOUNDARY_NOT_COMMITTED`. A
  resolved target never silently degrades to a tip fork — it dispatches at the
  recorded anchor or it fails.
- Provenance. The record stores the product anchor, the provider anchor
  (kind/value and inclusivity rule), the exact copied-prefix terminal `seq` and
  its digest, and the adapter/native versions. It is written atomically with the
  child session row, the `fork` link, and (for snapshot adapters) the copied
  event prefix.
- Identity/idempotency. The operation key is the caller's `child_session_id` or
  an `Idempotency-Key`, bound to a canonical request digest. Same key + same
  payload resumes the in-flight operation or returns the same child; same key +
  a different payload is `IDEMPOTENCY_CONFLICT`. The phase is marked
  `native_call_in_flight` before dispatch; a timeout, disconnect, or crash
  leaves the record `native_outcome_unknown`, which blocks blind redispatch and
  preserves an orphan candidate for audited reconciliation rather than
  speculatively re-forking (surfaced as `FORK_NATIVE_OUTCOME_UNKNOWN`).

### Restart and recovery

A process-local fork id (Claude) only becomes durable (reloadable via
`load_session`) once the child has run its own first turn. The
has-the-child-run signal is the child's own `last_prompt_at`, never
`turn_started`: the transcript snapshot copies the parent's `turn_started`
events into the child, so that signal is always set for forks.

On a child cold start:

- if the child recorded its own durable native id (durable-fork adapter, or a
  process-local child with `last_prompt_at` set), it loads that id with no
  fallback — re-forking would drop the child's own turns.
- otherwise it runs the exact-prefix recovery recipe: re-fork from the parent
  native id, reproduce the copied prefix, and verify the reproduced prefix
  digest against the `fork_operations` provenance before going live. A mismatch
  fails visibly (`FORK_RECOVERY_PREFIX_MISMATCH`); the child never re-forks the
  parent's later tip. If no parent native id resolves, it falls back to the
  child's own (possibly stale) native id rather than failing the launch.

AnyHarness exposes fork through typed contract fields. ACP `_meta.anyharness`
is reserved for private runtime-to-adapter extensions and must not leak into
desktop or public HTTP shapes.

### Parent Wake

Every terminal child turn atomically records a completion row and an independent
delivery snapshot while the subagent relationship exists. A retry worker turns
that snapshot into one durable, attributed parent prompt using the stable
delivery id for deduplication. This is automatic for completed, failed, and
cancelled turns, including reversible Close cancellation; it does not depend on
the legacy one-shot wake schedule. The worker reconciles parent transcript and
pending-queue state before inserting, and marks delivery complete only after the
attributed parent transcript item is durable — or after it suppresses a
redundant or coalesced completed-turn wake as described under
[Workspace MCP And Completion Delivery](#workspace-mcp-and-completion-delivery).

The shared one-shot wake-schedule table remains only for Cowork session-link
behavior. Delegated-agent relationships neither create nor read those rows,
and the table does not gate automatic terminal-completion delivery.

Parent-to-child prompts use internal `agent_session` provenance with the parent
session id and session link id. Runtime child-to-parent wake prompts use
internal `subagent_wake` provenance with the `session_link_id` and stable
delivery id as `completion_id`. Legacy `system/subagent_wake` rows are tolerated
for pending-wake detection, but public read models must not fabricate missing
link or completion ids.

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

Cowork artifact support and subagent support both use this extension surface.
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
- Session titles keep a fixed precedence. An explicitly assigned title (user
  rename or generated summary through `PATCH /v1/sessions/{id}/title`) always
  wins and is never overwritten by lower layers. The prompt endpoint assigns
  the first prompt's text as the title only when the session has none, and
  harness `session_info_update` titles are fallback-only: both persist through
  `update_title_if_absent` and never replace an assigned title.

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
