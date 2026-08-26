# Sessions

Status: target for the control-plane registry half; the runtime event log and its API describe `main`. Grade B / C — see [Known gaps](#known-gaps).

Read before touching: `anyharness/crates/anyharness-lib/src/domains/sessions/**`, `anyharness/crates/anyharness-lib/src/live/sessions/**`, `anyharness/crates/anyharness-lib/src/api/http/sessions_*.rs`, `anyharness/crates/anyharness-lib/src/api/sse/sessions.rs`, `anyharness/crates/anyharness-contract/src/v1/events.rs`.

## 1. Purpose

A session is the product object a person or an agent talks to: one ordered, durable conversation with one harness in one workspace. This system owns the session as *two objects with one name*: the runtime's execution-side record — the append-only event log and the durable session row beside it — and the control plane's registry row, which exists before any compute and outlives the environment. The record is what a reader sees; the process state is what a resumed harness needs; they are different objects, and this spec keeps them different.

The runtime half is converged and proven. The control-plane half is the build that makes sessions durable, addressable from Slack and the API, and readable without waking a VM.

## 2. Owned state

Runtime (SQLite per runtime, schema in [0001_initial.sql](../../../anyharness/crates/anyharness-lib/src/persistence/sql/0001_initial.sql) and successors under [persistence/sql/](../../../anyharness/crates/anyharness-lib/src/persistence/sql/0001_initial.sql)):

```text
sessions                       id, workspace_id, agent_kind, native_session_id, status, timestamps
session_events                 (session_id, seq) UNIQUE · timestamp · event_type · turn_id · item_id
                               · payload_json · completion_wake_removal_key — the log
session_raw_notifications      raw ACP traffic for debugging (never the record)
session_live_config_snapshots  persisted live-config, queued config changes
session_pending_config_changes
session_adapter_markers        adapter migration markers
session links / fork operations / launch intents / pending prompts /
completion deliveries / support windows / attachments / titles
```

Written only through [domains/sessions/store/](../../../anyharness/crates/anyharness-lib/src/domains/sessions/store/mod.rs). The durable session row (`SessionRecord`, [model.rs](../../../anyharness/crates/anyharness-lib/src/domains/sessions/model.rs)) and the event record (`SessionEventRecord`) are this system's two core models.

Control plane (※ new): the **session registry row** — id, subject, environment binding, status, external bindings (`{kind: "slack", team_id, channel_id, thread_ts}` and later Linear/GitHub/ email), and the queued-prompt content the seam's outbox delivers — plus the **checkpointed record**: the shipped event log, with retention tiers.

> [!decision] PABLO DECIDES: session identity across planes.
> Options: (a) the registry row's id *is* the runtime session id (the
> control plane mints it and the courier passes it down, so every event
> envelope already carries the global id); (b) separate ids joined by a
> binding column. Recommendation: (a) — one id per session everywhere is the
> only way "same name every plane" holds for the most-referenced object in
> the product.

## 3. Public surface

Runtime HTTP (route modules under [api/http/](../../../anyharness/crates/anyharness-lib/src/api/http/sessions_lifecycle.rs); full operation contract in [api.md](../../areas/anyharness.md)):

| Route | Purpose |
| --- | --- |
| `POST /v1/sessions` · `GET /v1/sessions/{id}` | create-and-start (idempotent), read |
| `POST …/prompt` · `…/pending-prompts/{seq}` · `…/pending-prompts/order` · `…/pending-prompts/{seq}/steer` | prompt queue: enqueue, cancel, reorder, steer |
| `POST …/cancel` · `…/close` · `…/dismiss` · `…/resume` · `/v1/workspaces/{id}/sessions/restore` | lifecycle |
| `GET …/events` · `GET …/events/support-window` · `GET …/raw-notifications` | the log: replay from a cursor, support windows |
| `POST …/fork` | fork-with-context at an anchor seq |
| `…/interactions/{request_id}/resolve` · `…/mcp-url/reveal` | permission and interaction resolution |
| `…/live-config` · `…/config-options` · `…/title` · `…/goal` · `…/loops` · `…/reviews` | live configuration and session-scoped features |
| `…/subagents` · `…/subagents/{child}/open|close|promote` | in-environment subagent fan-out (surface here; laws in the subagents spec) |

Runtime SSE: `GET /v1/sessions/{id}/stream` ([api/sse/sessions.rs](../../../anyharness/crates/anyharness-lib/src/api/sse/sessions.rs)) — the loopback source the seam's shipper subscribes to.

Contract types: `SessionEvent`, `SessionEventEnvelope` ([events.rs](../../../anyharness/crates/anyharness-contract/src/v1/events.rs)) — the one canonical envelope every plane speaks.

Control plane (※ new): registry create/read/list, external-binding attach/detach, checkpoint read — exposed through the API system's `/v1` verbs, not as a second front door.

## 4. Consumes

- **Workspaces** — `workspace_id`, worktree and MCP workspace attachment
  ([workspace_mcp_attachment.rs](../../../anyharness/crates/anyharness-lib/src/domains/sessions/runtime/workspace_mcp_attachment.rs);
  owner: [workspaces.md](../workspaces/anyharness-workspaces.md)).
- **Harnesses / adapters** — the ACP driver a session actor speaks
  ([acp.md](../../areas/anyharness.md), [adapters.md](../../areas/anyharness.md)).
- **Agent auth** — launch environment and credential application
  ([launch_env.rs](../../../anyharness/crates/anyharness-lib/src/domains/sessions/runtime/launch_env.rs);
  owner: [AGENT_AUTH.md](../agent_auth/deep-dive.md)).
- **Integration gateway** — MCP bindings assembled per session
  ([mcp_bindings/](../../../anyharness/crates/anyharness-lib/src/domains/sessions/mcp_bindings/mod.rs)).
- **Workflows (gen-2)** — durable workflow links
  ([workflow_links.rs](../../../anyharness/crates/anyharness-lib/src/domains/sessions/store/workflow_links.rs);
  owner: [WORKFLOWS.md](../automations/deep-dive.md)).
- **Seam** (target) — courier delivery of queued prompts and shipping of
  ship-now events ([seam.md](../environments/seam.md)).

## 5. Laws

The five event-log invariants (architecture Law 10), each with its enforcing path:

**Append-only.** There is no UPDATE path on `session_events`; the only DELETE is whole-session deletion ([store/sessions.rs](../../../anyharness/crates/anyharness-lib/src/domains/sessions/store/sessions.rs)). Repairs write new events, never rewrite old ones.

**Per-session monotonic seq.** Durable appends take `COALESCE(MAX(seq), 0) + 1` inside the transaction ([store/events.rs](../../../anyharness/crates/anyharness-lib/src/domains/sessions/store/events.rs) `append_event_with_next_seq`); a live actor assigns seq from memory through its `SessionEventSink`, and the two never run concurrently — the ACP start/inject critical section in [acp.md](../../areas/anyharness.md) is the guard. `UNIQUE (session_id, seq)` is the backstop.

**One canonical envelope.** `SessionEventEnvelope { session_id, seq, timestamp, turn_id?, item_id?, event }` from the contract crate is the only shape the log, the SSE stream, the SDKs, and (target) the shipped record use. Persisted payloads are sanitized copies ([persisted_payloads.rs](../../../anyharness/crates/anyharness-lib/src/domains/sessions/store/persisted_payloads.rs)); the original is what the stream emits.

**Classed.** `event_type` is the class key. Ship policy on top of it is structural (turn-level and lifecycle = ship now; intra-turn = checkpoint; deltas = never persist) and lives in the seam; the runtime never learns who is watching.

**Cursor-replayable.** `list_events` reads `ORDER BY seq`; support windows and fork anchors are seq ranges ([support_windows.rs](../../../anyharness/crates/anyharness-lib/src/domains/sessions/store/support_windows.rs), [fork_anchor.rs](../../../anyharness/crates/anyharness-lib/src/domains/sessions/runtime/fork_anchor.rs)). A client that stops at the first sequence hole (PRO-352) is correct by this law, not by convention.

Session-object laws:

**The record and the process state are different objects.** The record is the log; process state is harness-native (`native_session_id`, adapter markers, the harness's own files). *Resume* is environment-bound; when the environment is gone the product offers *fork with context* and never calls it resume. The environment binding state drives the verb: live → open, paused → wake, reaped or lost → fork.

**Prompt queue admission is durable and ordered.** Prompts persist before dispatch ([prompt_queue.rs](../../../anyharness/crates/anyharness-lib/src/domains/sessions/runtime/prompt_queue.rs), [pending_prompts.rs](../../../anyharness/crates/anyharness-lib/src/domains/sessions/store/pending_prompts.rs)); creation is idempotent ([idempotent_create.rs](../../../anyharness/crates/anyharness-lib/src/domains/sessions/store/idempotent_create.rs)). This is the runtime half of the seam's "ack means persisted" law.

**Completion deliveries are exactly-once by removal key.** A child's terminal turn wakes its parent through a durable record keyed by `completion_wake_removal_key` ([completion_deliveries/](../../../anyharness/crates/anyharness-lib/src/domains/sessions/store/completion_deliveries.rs)), so a wake is never delivered twice and never lost across a restart.

**One session, one runtime, one ordered log; every client is a replica.** The server relays prompts *as a client* and is never a second writer to the log. Multiplayer is fan-out of one stream, not merge of two.

Target laws (※ new):

**Session before compute.** The registry row, its bindings, and the first queued prompt are created in one transaction and acknowledged instantly; the environment catches up through the courier.

**Reads never wake a VM.** Bound surfaces (Slack, mobile, triage) read the checkpointed record at the control plane.

**Deletion orders after checkpoint.** A session is deletable at the runtime only once its terminal checkpoint is acknowledged by the control plane; otherwise the record is lost with the VM.

> [!decision] PABLO DECIDES: collaboration default. The settled architecture
> says org-open sessions (Ramp's forced-multiplayer lesson). Options:
> org-open by default with per-session private; private by default with
> explicit share. Recommendation: org-open — it is the setting that makes
> the Slack thread, the triage view, and the parent–child run tree work
> without a sharing step.

## 6. Emits

- The session event stream (`SessionEventEnvelope`) over SSE, consumed by
  the product client's transcript
  ([chat/transcript.md](../chat/transcript.md)),
  the runtime gateway proxy, and (target) the seam's shipper.
- Terminal turn and subagent-wake records
  ([completion_deliveries.rs](../../../anyharness/crates/anyharness-lib/src/domains/sessions/store/completion_deliveries.rs)),
  consumed by subagent orchestration and the wake-on-completion courier
  message.
- Session status transitions (`status` on the row), consumed by workspace
  surfaces and the registry projection.
- Target: the checkpointed record and `run result` linkage consumed by
  runs/triage, and binding fan-out posts consumed by the Slack system.

## 7. Fences

- **Subagents** own in-environment fan-out semantics — the `…/subagents`
  routes are a surface on this object, but per-subagent auth, promotion,
  and the product MCP are the subagents spec's
  ([agent_operations/](../../../anyharness/crates/anyharness-lib/src/domains/agent_operations/mod.rs),
  [delegated-work.md](../subagents/delegated-work.md)).
- **Observers** (goals, loops, activity roster) are session-scoped
  features living in this folder today
  ([active_goals.rs](../../../anyharness/crates/anyharness-lib/src/domains/sessions/active_goals.rs),
  [active_loops.rs](../../../anyharness/crates/anyharness-lib/src/domains/sessions/active_loops.rs),
  [active_activity_roster.rs](../../../anyharness/crates/anyharness-lib/src/domains/sessions/active_activity_roster.rs))
  — sections of this spec until the observers fold (sweep Wave 3) gives
  them a home.
- **Live runtime** internals — actor, driver, sink, rendezvous — are the
  runtime owner docs' ([live-runtime.md](../../areas/anyharness.md),
  [session-actor.md](session-actor.md),
  [session-engine.md](session-engine.md)); this spec states
  the laws they uphold, not their folder shape.
- **Runtime gateway** owns proxying a client to a session's runtime
  ([SANDBOX/gateway.md](../environments/README.md)); sessions own
  what is proxied.
- **Chat** (client surface) owns rendering, composer, ingest hydration and
  hole detection ([chat/](../chat/README.md)).
- **Seam** owns transport and cursors ([seam.md](../environments/seam.md)); sessions own
  content.
- **Workspaces** own the worktree a session runs in and session selection
  within a workspace
  ([session-selection.md](../workspace-surface/session-selection.md)).

## 8. Code map

```text
anyharness/crates/anyharness-contract/src/v1/
└── events.rs                                    SessionEvent · SessionEventEnvelope — the envelope

anyharness/crates/anyharness-lib/src/
├── persistence/sql/0001_initial.sql             sessions + session_events + UNIQUE (session_id, seq)
├── domains/sessions/
│   ├── mod.rs
│   ├── model.rs                                 SessionRecord · SessionEventRecord
│   ├── store/                                   the only writer
│   │   ├── mod.rs
│   │   ├── sessions.rs                          row CRUD, whole-session delete
│   │   ├── events.rs                            append (MAX(seq)+1), list ORDER BY seq
│   │   ├── persisted_payloads.rs                sanitized persisted copy
│   │   ├── pending_prompts.rs · idempotent_create.rs
│   │   ├── completion_deliveries.rs · completion_deliveries/
│   │   ├── fork_operations.rs · links.rs · link_completions.rs · launch_intents.rs
│   │   ├── live_config.rs · support_windows.rs · titles.rs · workflow_links.rs
│   │   ├── adapter_markers.rs · attachments.rs · background_work.rs · mobility.rs
│   │   ├── notifications.rs · opencode_message_ids.rs
│   │   └── tests/                               proof (below)
│   ├── service/                                 durable-layer service
│   ├── prompt/                                  prompt shapes
│   ├── runtime/                                 create-and-start, resume, prompt dispatch, fork, lifecycle
│   ├── live_config/                             persisted live configuration
│   ├── mcp_bindings/                            per-session MCP assembly (consumes integration gateway)
│   ├── links/                                   durable session links
│   ├── admission.rs · delegation.rs · deletion.rs · extensions.rs
│   ├── execution_summary.rs · fork_operation.rs · launch_intent.rs · live_ports.rs
│   ├── adapter_migration.rs · attachment_storage.rs
│   └── active_goals.rs · active_loops.rs · active_activity_roster.rs   observers (fenced above)
├── live/sessions/                               actor · driver · sink · manager · rendezvous (owner docs)
├── api/http/sessions_*.rs                       routes above
└── api/sse/sessions.rs                          the event stream

server/proliferate/server/                       ※ new: sessions/ (registry, bindings, record, retention)
```

## 9. Proof

- [store/tests/events.rs](../../../anyharness/crates/anyharness-lib/src/domains/sessions/store/tests/events.rs)
  — append/seq/ordering.
- [store/tests/runtime_event_idempotency.rs](../../../anyharness/crates/anyharness-lib/src/domains/sessions/store/tests/runtime_event_idempotency.rs)
  — idempotent runtime-owned appends.
- [store/tests/pending_prompt_events.rs](../../../anyharness/crates/anyharness-lib/src/domains/sessions/store/tests/pending_prompt_events.rs)
  and
  [store/tests/pending_prompts.rs](../../../anyharness/crates/anyharness-lib/src/domains/sessions/store/tests/pending_prompts.rs)
  — durable prompt admission.
- [store/tests/delete.rs](../../../anyharness/crates/anyharness-lib/src/domains/sessions/store/tests/delete.rs)
  — whole-session deletion is the only delete.
- [runtime/idempotent_creation_tests.rs](../../../anyharness/crates/anyharness-lib/src/domains/sessions/runtime/idempotent_creation_tests.rs),
  [runtime/checkpoint_dispatch_tests.rs](../../../anyharness/crates/anyharness-lib/src/domains/sessions/runtime/checkpoint_dispatch_tests.rs),
  [runtime/fork_prompt_terminal_protection_tests.rs](../../../anyharness/crates/anyharness-lib/src/domains/sessions/runtime/fork_prompt_terminal_protection_tests.rs)
  — creation, checkpoint dispatch, fork protection.
- The five-invariants clearance recorded in the cull investigation
  (append-only, `MAX(seq)+1`, no UPDATE paths) — re-run as a grep gate:
  `grep -rn "UPDATE session_events" anyharness/` must stay empty.

## Known gaps

- [ ] The control-plane registry row, external bindings, checkpointed
      record, and retention tiers do not exist; today the control plane
      reads sessions only by proxying to the runtime. Build order item 5.
- [ ] No pinning test for "deletion orders after checkpoint" because
      checkpoints do not exist yet; add it with the seam's ingest.
- [ ] Client ingest hole-detection (PRO-351/352) lives in the chat surface
      and becomes redundant once bound surfaces read the control-plane
      replica; bugfix-only until then.
- [ ] > [!decision] PABLO DECIDES: retention tiers for the checkpointed
      record (full log vs turn-level skeleton vs summary) and who pays.
      Recommendation: full log for 30 days, skeleton indefinitely, org-billed
      storage deferred until it measurably matters.
- [ ] > [!decision] PABLO DECIDES: whether `goals`, `loops`, and the activity
      roster become one `observers` system (sweep Wave 3) or stay sections
      here. Recommendation: fold into `observers` — they share a trigger
      framework and none owns state a session reader needs.
- [ ] The `…/reviews` route hangs the review lane on sessions; it moves with
      the one-review-system ruling.
