# Harness runtime mechanics — goals, loops, subagents, terminals

Home: `codex/harness-runtime-mechanics.md` (canonical; a snapshot also
lives at `specs/tbd/harness-runtime-mechanics.md`).
Status: comprehension reference (no design proposals). Companion to
`specs/tbd/goals-and-workflows-v1.md`.
Date: 2026-07-02. All four harnesses verified same day (Claude Code
2.1.198 + Codex 0.142.0 + Cursor 2026.06.04 live-probed; OpenCode
1.17.13 from source).
Evidence: live probes against Codex app-server 0.142.0 and Claude Code
2.1.198 (scripts + captured wires in the session scratchpad `goal-test/`),
codex source (shallow clone of openai/codex main), Claude Code session
transcripts on disk, and the sidecar fork checkouts. Every claim below is
tagged [probe], [source], [disk], or [inferred].

---

## 0. The 20,000-foot model

Every harness is **one OS process running an event loop around a turn
queue**. A "turn" is: take an input, run the model until it stops calling
tools, emit a result. Everything that feels magical — goals that keep the
agent working, loops that fire while you type, background jobs that wake
the agent — is just **a different thing enqueueing or extending turns**:

| wake source | harness | mechanism |
|---|---|---|
| user prompt | both | enqueue turn (the boring case) |
| **goal continuation** | Codex | after a turn ends with an `active` goal unmet, the goal engine starts the next turn itself, injecting a continuation prompt as *internal context* |
| **goal continuation** | Claude | the turn is *prevented from ending*: a Stop hook evaluates the goal condition and blocks the stop, so the same turn keeps going |
| **cron / loop timer** | Claude only | in-process timer fires → the cron's prompt is **enqueued as a normal user turn** |
| **background task completion** | Claude only | harness-tracked task (background bash, subagent) exits → a task notification is injected → new turn starts |
| — | Codex | no cross-turn wake exists; long work happens *inside* a held-open turn (`unified_exec` sessions, `agent_jobs` fan-out) |

The two harnesses embody opposite philosophies:

- **Codex: hold the turn open.** Work is driven by keeping turns running
  (goal auto-continuation chains turns back-to-back; parallel sub-agents
  and persistent exec sessions live inside a turn). Steering happens by
  injecting *internal model context* mid-turn.
- **Claude: end turns early, wake often.** Turns finish fast; timers,
  task completions, and queued prompts re-enter through the front door
  (the message queue), each wake being an ordinary, observable turn.

And two persistence tiers decide what survives a process death:

| state | storage | survives kill? | rebuilt how |
|---|---|---|---|
| conversation | Codex rollout file / Claude transcript `.jsonl` | yes | `thread/resume` / `--resume` |
| Codex goal | `~/.codex/goals_1.sqlite` (one row per thread) | **yes** | self-resumes driving on `thread/resume` [probe] |
| Claude goal | session state inside the transcript | **yes** | restored on `--resume` (counters reset) [probe] |
| Claude crons | derived from the session record (no separate store found) | **yes** (re-arm) | timers rebuilt at load; **nothing fires while dead** [probe+disk] |
| background processes | OS processes + in-memory tracking | **no** | not rebuilt; output files remain on disk |

That last row is the punchline for your "loops are confusing" instinct:
**crons and background jobs are process-bound**. The `.jsonl`/rollout is
the durable brain; the timers and children are mortal muscle that gets
rebuilt (crons) or lost (processes) on restart.

---

## 1. The turn engine

### 1.1 Claude Code

- One CLI process. Driven interactively (TUI) or programmatically
  (`-p --input-format stream-json --output-format stream-json`, which is
  what the Agent SDK and our claude-acp wrap). Process stays alive while
  stdin is open; each JSON line in = a queued user message.
- **The message queue is explicit and persisted**: the transcript records
  `queue-operation` entries (`enqueue`/`dequeue`, with content) for every
  turn input — including cron fires [disk]. One turn runs at a time;
  inputs arriving mid-turn queue behind it.
- The transcript `.jsonl` under
  `~/.claude/projects/<munged-cwd>/<session_id>.jsonl` is the single
  durable record: messages, tool calls, hook results, attachments
  (goal_status etc.), queue operations [disk].
- **Hooks** are the extension seam: registered commands/prompts that run
  at lifecycle events (SessionStart, PostToolUse, Stop, …). Hook payloads
  carry live session facts — including `session_crons` — so hooks are
  also an observation channel [source: SDK types].
- Wire shape (stream-json): `system:init` (session id), `assistant`
  (text/tool_use), `user` (tool_result + injected wakes), `result` (turn
  end, `num_turns`), plus typed `system` events (`task_started`,
  `task_updated`, `task_notification`, `hook_started/response`,
  `thinking_tokens`, `rate_limit_event`) [probe].

### 1.2 Codex

- One binary, several frontends (TUI, `exec`, `app-server`), all over
  **codex core**. External programs speak the app-server JSON-RPC
  protocol; our codex-acp fork instead *embeds* core as a library and
  speaks ACP outward [source: codex-acp map].
- Vocabulary: **thread** (durable conversation; rollout file under
  `~/.codex/sessions/...`) → **turn** (`turn/started`…`turn/completed`)
  → **items** (typed: `reasoning`, `agentMessage`, `commandExecution`,
  …) with `item/started`, `item/agentMessage/delta`, `item/completed`
  notifications [probe].
- Side effects gate on server-requests: `item/commandExecution/
  requestApproval` blocks the turn until the client answers — **goal
  turns included** [probe].
- Long/parallel work lives inside turns: `unified_exec` (persistent
  interactive exec sessions the model can revisit), `agent_jobs` /
  multi-agent spawn (up to 64 concurrent sub-agents, polled to
  completion within the turn) [source: core/src/tools/handlers/]. There
  is no mechanism that wakes an idle thread later — idle means idle.

---

## 2. Goals

### 2.1 Codex — an engine that drives turns

Where it lives [source]: `codex-rs/ext/goal/` (runtime, steering, events,
accounting) + `codex-rs/state/` (`GoalStore`, sqlite model). Feature
`Feature::Goals`, stable + default-on since 0.133.

State [disk]: `~/.codex/goals_1.sqlite`, table `thread_goals` —
`thread_id` PRIMARY KEY (⇒ **at most one goal per thread**), `objective`,
`status ∈ {active, paused, blocked, usage_limited, budget_limited,
complete}`, `token_budget`, `tokens_used`, `time_used_seconds`,
timestamps. Separate from the rollout: killing the process loses nothing.

The loop, mechanistically [probe+source]:

1. `thread/goal/set {objective, status:"active"}` → goal row written →
   `thread/goal/updated` notification → **a turn starts immediately**
   (+1s in the probe), no prompt from anyone.
2. Each continuation turn begins with the **continuation template**
   (`ext/goal/templates/goals/continuation.md`) injected as an *internal
   context fragment* (`ContextualUserFragment` — not a user message; it
   does not appear as user input in the conversation). The template
   carries: the objective (marked untrusted data), budget arithmetic
   (used/budget/remaining), and the two audits below.
3. The model works normally — tools, approvals, sandbox rules all apply
   (the probe's goal turn blocked on a command approval like any turn).
4. Turn ends → if goal still `active` and budget remains → engine starts
   the next turn (`continue_active_goal_if_idle`). Token/time usage is
   accounted into the goal row as turns run (`thread/goal/updated`
   mid-turn with `turnId` set) [probe].
5. The model itself can only exit the loop via its `update_goal` tool
   with `complete` or `blocked` — everything else is external.

The two audits in the continuation prompt [source, verbatim behavior]:

- **Completion audit** (anti-reward-hacking): "treat completion as
  unproven"; every requirement needs authoritative current-state
  evidence; "do not redefine success around a smaller or easier task";
  uncertain evidence ⇒ keep working. You can watch this operate: the
  probe's model said "I'm going to … inspect the bytes to prove there is
  no trailing newline."
- **Blocked audit**: `blocked` is only allowed after the *same* blocker
  has repeated for **≥3 consecutive goal turns**; never "because the work
  is hard, slow, uncertain, or would benefit from clarification."

External control [probe]:

- `thread/goal/set` is create-or-patch: omit `objective` to patch only
  status/budget. Set with `status:"paused"` = no turn fires; flip to
  `active` = arms. Zero tokens for any mutation.
- Editing the objective **mid-turn** injects the `objective_updated`
  template (`<untrusted_objective>` steering) into the running turn.
- Restart semantics: after SIGKILL + new process + `thread/resume`, the
  active goal **self-resumes driving** — a fresh continuation turn
  started hands-off at +15s in the probe. Caveat: the `thread/resume`
  response does **not** include the goal (`thread.goal` = null); state
  must come from `thread/goal/get` or the notifications.
- Budget exhaustion: `budget_limit.md` steering template + status
  `budget_limited` (externally patchable to re-arm).

### 2.2 Claude Code — a hook that refuses to stop

Where it lives: inside the CLI (`/goal`, shipped 2.1.139), implemented as
a **prompt-type Stop hook** plus session state. No separate store — state
rides the session and survives `--resume` (iteration counters reset)
[probe].

The loop, mechanistically [probe]:

1. `/goal <condition>` — a **local command**: zero tokens, zero turns,
   processed by the CLI, sendable as a plain user message over any wire.
   It registers the condition and arms a Stop hook.
2. The agent runs normal turns. When a turn tries to end, the Stop hook
   fires: a **Haiku evaluator** reads the transcript and judges the
   condition.
3. Not met → the hook blocks the stop and the agent continues working
   (same turn keeps going — contrast Codex, which chains *new* turns).
   Met → the goal auto-clears, and a `goal_status` attachment with
   `{met: true, condition, reason}` is written.
4. Re-sending `/goal <new>` **replaces** (the CLI strips existing goal
   Stop hooks first). Bare `/goal` is a free status poll.

Observation gap [probe, verified twice]: `active_goal` / `goal_status`
events **never cross the stream-json/SDK wire**. They exist only as
`attachment` entries in the transcript `.jsonl`. Anything that wants to
observe Claude goal state externally must read the transcript (or poll
bare `/goal`). This is why claude-acp tails the transcript.

### 2.3 Side-by-side

| | Codex | Claude |
|---|---|---|
| primitive | engine driving turns | hook blocking turn-end |
| state | sqlite row per thread | session state in transcript |
| loop unit | new turn per continuation | same turn, stop refused |
| completion authority | model's `update_goal` (audited) | Haiku evaluator (judges transcript) |
| budgets | token budget + usage accounting native | none native |
| blocked signal | native status (3-turn audit) | none |
| external set/edit | zero-token protocol calls | `/goal` text message (zero-token local cmd) |
| external observe | `thread/goal/updated` notifications | transcript attachments only |
| survives restart | yes; self-resumes driving on resume | yes; state restored, counters reset |

---

## 3. Loops (session crons) — Claude only

What `/loop` actually is [disk]: a **skill** (prompt expansion). The
model reads the expanded instructions, parses `[interval] <prompt>`, and
calls the **`CronCreate` tool**: `{cron: "*/1 * * * *", prompt,
recurring}` (a deferred tool, loaded via ToolSearch). So arming a loop is
model-mediated and costs a small turn — unlike `/goal`, which is a local
command. `CronDelete` / `CronList` manage them; `ScheduleWakeup` is the
one-shot variant. Multiple crons per session are legal.

The fire, mechanistically [disk]: when the in-process timer matches, the
harness **enqueues the cron's prompt into the session's message queue**
— the transcript shows a literal `queue-operation: enqueue` whose
`content` is the prompt text, then a normal turn runs it. A wake is
nothing more exotic than a self-sent user message.

Verified lifecycle [probe, PING.log + transcript]:

- Fires headless under SDK-driven stream-json sessions: pings at 1-minute
  cadence while the process lived (10:01→10:04).
- **Process-bound**: zero fires while the process was dead (10:04→10:06
  gap).
- **Re-arms on `--resume`**: fires resumed at 1-minute cadence in the
  resumed process (10:07→10:09). No separate cron store exists on disk
  (checked `~/.claude/{tasks,jobs,sessions}`) — the session record itself
  is the durable source the timers are rebuilt from.

Observability: cron arming crosses the wire as ordinary `tool_use`
(`CronCreate` with full schedule+prompt). Fires are visible as the
enqueued turn.

**CORRECTIONS (live-falsified 2026-07-03, claude 2.1.199, during Gate C
remediation):** (1) `session_crons` does NOT actually appear in hook
payloads — verified absent across an entire live session; the SDK type
exists but the field is never populated. Mirror reconciliation must come
from transcript history (CronCreate/CronDelete tool rows), not hook
snapshots. (2) A cron wake does NOT replay its prompt as a user message
on the SDK stream (even with `--replay-user-messages`) — the wake turn
is a bare spontaneous assistant turn; the authoritative fire signal is
the transcript's `isMeta` user row containing the cron prompt. (3) Cron
re-arm across `--resume` did NOT reproduce on 2.1.199 (a resume probe
showed zero post-resume fires), contradicting the 2.1.198 PING.log
evidence above — treat native resume re-arm as version-unstable;
mirror-side the armed set is rebuilt from transcript history.

**Pull asymmetry vs goals**: there is no zero-turn, on-demand "list the
crons" call (contrast bare `/goal`). `CronList` is a model tool (costs a
turn). But the mirror stays true without one: every mutation is a
wire-visible tool call, and every hook firing hands the adapter a fresh
`session_crons` snapshot to reconcile against. An external `loop/list`
surface is therefore served from the adapter's tracked state, not from
the harness — which is exactly how the pinned LoopPort wire contract
specifies it.

Codex: **no equivalent** [source, verified]: no loop/heartbeat slash
command in the TUI `SlashCommand` enum, no `Feature::` flag, no
app-server methods for recurring in-session prompts. Codex "automations"
(`~/.codex/automations/<id>/automation.toml`, RRULE + prompt + model) are
driven by OpenAI's desktop app layer — no protocol surface.

Interplay with typing: because a fire is just an enqueue, a cron that
fires mid-turn queues behind the running turn; user messages and cron
prompts serialize through the same queue in arrival order. There is no
parallel model execution within a session — concurrency exists only in
the *work* (background tasks, below), never in the *conversation*.

---

## 4. Background work

### 4.1 Claude Code — tasks that wake the agent

Three primitives, one pattern (harness-tracked **task** + completion
wake):

- **Background bash** (`Bash {run_in_background: true}`): tool_result
  returns immediately with a task id + output file path; the process
  runs detached.
- **Subagents** (Task/Agent tools) — verified live, both directions
  [probe]: subagents ARE tasks (`task_type: "local_agent"`), same event
  family with extras (`subagent_type`, `prompt` on `task_started`;
  `task_progress` with token/tool/duration usage; `task_notification`
  with `summary`). Their conversation flows on **two channels**:
  1. **Wire, live but partial**: the subagent's own messages stream
     interleaved on the parent wire, tagged with top-level
     `parent_tool_use_id` + `subagent_type` (`isSidechain` never appears
     on the wire). Foreground runs suppress thinking blocks and the
     final text (final text arrives in the tool_result); background
     runs include thinking + final text but suppress the prompt echo.
  2. **File, complete**: a dedicated transcript per subagent at
     `<project>/<parent_session_id>/subagents/agent-<task_id>.jsonl`
     (every line `isSidechain: true`, `agentId` = task id) + a
     `.meta.json` (agentType, description, toolUseId, spawnDepth). The
     task's `output_file` is a **symlink to this transcript**. The
     parent transcript contains zero subagent lines — the wire-tagged
     messages are wire-only, never persisted to the parent.
  So: lifecycle + partial live stream on the wire; the file is the only
  complete record. `task_id` doubles as the SendMessage agent id for
  continuing the subagent.
- **One-shot wakeups** (`ScheduleWakeup`): a timer task.

Verified wire lifecycle [probe]:

```
tool_use  Bash {command, run_in_background: true}
system    task_started      {task_id, tool_use_id, description, task_type:"local_bash"}
user      tool_result       "Command running in background with ID: …, output → <file>"
result    (turn ends — agent said "armed", conversation is free)
… 20s pass, user could be typing/prompting normally …
system    task_updated      {task_id, patch:{status:"completed", end_time}}
system    task_notification {task_id, tool_use_id, status:"completed", output_file}
(new turn starts by itself; model reacts: "Done.")
result    (wake turn ends, num_turns=1)
```

Key properties: tasks are **first-class and fully typed on the wire**
(start/update/notification events with stable ids); output accumulates in
a file the client can read any time; the completion wake is an injected
turn — again, just the queue. Polling exists too (`BashOutput`,
`TaskOutput`) for the model to check without waiting. Tasks do NOT
survive process death (OS children + in-memory registry); their output
files do.

The channel split to internalize: the wire carries **lifecycle**
(started/updated/completed, ids, descriptions), the filesystem carries
**continuous output** (each background task's `output_file` accumulates
live and is tailable at any moment), and foreground command output
streams over the wire via the display-terminal channel (§7). Subagent
activity additionally surfaces in-stream (subagent messages tagged with
the parent tool_use id; sidechain records in the transcript), so a
nested live transcript needs no file access at all.

### 4.2 Codex — work stays inside the turn

No cross-turn task registry, no completion wake. Instead [source]:

- `unified_exec`: persistent interactive exec sessions (the model can
  start a server, come back to the same PTY later *within the turn*).
- `agent_jobs` / multi-agent spawn: fan-out to sub-agents (default 16,
  max 64 concurrent; 30-min default item timeout), awaited by polling
  inside the turn.
- The turn simply stays open while work runs; the goal engine (§2.1) is
  what makes indefinitely-long work sequences possible, by chaining
  turns.

Consequence: "is anything running?" has different answers per harness.
Claude: session idle + N live tasks + M armed crons is a normal state.
Codex: activity ⇔ a turn is in progress (thread `status` reflects it);
an idle Codex thread has nothing pending except possibly an active goal
that will re-fire only via the engine (which runs while the process
lives; on restart, on resume).

---

## 5. What crosses our wire today (per adapter seam)

Facts only — from the fork checkouts and probes; design lives elsewhere.

- **codex-acp** embeds codex core (no app-server subprocess). Everything
  in §2.1 exists *in-process* — `GoalStore`, `apply_external_goal_set/
  clear`, `continue_active_goal_if_idle` are pub APIs; the app-server's
  `thread_goal_processor.rs` is the reference flow. `ThreadGoalUpdated`
  events are already intercepted (currently rendered as prose text).
  ACP 0.14 routes unknown `_`-prefixed methods to an ext handler (none
  registered yet). `Feature::Goals` must be force-enabled in the fork's
  config load; goals need a persisted thread + state_db.
- **claude-acp** pins agent-sdk 0.2.84; the SDK pump runs only inside
  `prompt()` — when no prompt is in flight, nothing drains the query
  stream (this is the structural item for any idle-time injection or
  wake forwarding). `transcript_path` is available from hook inputs (not
  from `system:init`). Goal events require transcript tailing (§2.2);
  cron and task events are already on the wire (§3, §4.1).
- **anyharness** sees whatever the sidecars emit as ACP session updates /
  tagged `_meta.anyharness` chunks, normalized by the sink and observer
  pass; its own turn queue serializes prompts per session, and
  `SessionExtension::on_turn_finished` is the runtime-side hook that
  fires at every turn boundary.

## 6. Source of truth: the files vs the wire

The question "do we trust the JSON-RPC surface or the dot-files?" has a
layered answer because the two are not peers:

1. **The process is the engine; its files are its private database.**
   While a harness process is alive, `goals_1.sqlite` / the transcript
   are its internals — it caches, holds connections, and rewrites them.
   Writing them behind a live process is split-brain by construction.
   They are also unversioned internal formats (note the `_1` in
   `goals_1.sqlite`: they already migrate it) with no compatibility
   promise. Treat harness files as **read-only evidence, never an API**.
2. **Mutations go through the protocol, always.** `thread/goal/set`, a
   `/goal` message, `CronCreate` — these route through the engine's own
   validation, locking, accounting, and (codex) notification emission.
   That is what makes an edit *true* rather than merely on disk.
3. **Observation prefers the protocol; files fill its silences.** Codex
   goal state, claude cron arming, claude task lifecycle: all on the
   wire. Claude goal status is the one silence — so the adapter tails
   the transcript, but *normalizes immediately* into a typed event on
   our wire; nothing downstream ever sees the file.
4. **The product's source of truth is our normalized mirror** — the
   typed records anyharness keeps (goal / loop / task state per
   session), built exclusively from protocol round-trips (+ the tailing
   shim). This is the strictly-typed, programmable surface workflows
   consume. Workflow steps never read dot-files and never speak raw
   harness protocols.
5. **Drift heals by reconciliation on attach.** State can change while
   we are not connected (the user can run the TUI directly against the
   same thread/session). Rule: on session attach/resume, issue explicit
   reads (`thread/goal/get`, cron list, task list) and resync the
   mirror; between attaches, trust the event stream. The files' real
   jobs are durability across restarts and debugging/recovery evidence.

## 7. Terminal & background-agent visibility channels (facts)

What exists today for "show me everything running under this session":

- **Foreground commands (both harnesses)**: the sidecars already
  implement a display-terminal streaming pattern. When the client
  advertises terminal-output support, codex-acp streams command output
  bytes tagged `terminal_info {terminal_id}` / `terminal_output` /
  `terminal_exit` on ToolCallUpdate meta (src/thread.rs:2576–2613);
  claude-agent-acp carries the identical vocabulary (acp-agent.ts:261–
  270). Read-only live terminal rendering is a supported channel, not a
  hack.
- **Claude background bash**: typed task lifecycle on the wire
  (`task_started/updated/notification` with `task_id` + `output_file`).
  The output file accumulates continuously and can be tailed for a live
  read-only view at any time. No stdin path exists (processes run
  detached); termination is via the model's kill tools or OS process
  management. Tasks die with the harness process; output files persist.
- **Claude background subagents**: same task machinery; the output is a
  full subagent transcript `.jsonl` — tailable and renderable as a
  nested transcript (the product's delegation slices are the precedent).
- **Codex `unified_exec`**: interactive PTY sessions owned by codex core,
  used by the model *within* turns; visible as `commandExecution` items
  (+ the terminal streaming above). Only the model writes to their
  stdin — there is no external write path in the protocol.
- **Codex sub-agents** — verified live (`multi_agent` = feature `Collab`,
  Stable, default-ON; V2 + CSV fanout still experimental): spawned agents
  are **full threads** with their own rollout files
  (`rollout-<ts>-<childThreadId>.jsonl`, whose `session_meta` carries
  `parent_thread_id`, spawn depth, nickname, `thread_source:
  "subagent"`). Activity crosses the wire **redundantly**: (a) the parent
  thread gets `collabAgentToolCall` items (`spawnAgent`/`sendInput`/
  `wait`/`closeAgent`, with `senderThreadId`/`receiverThreadIds` and
  per-child `agentsStates`), and (b) the child's COMPLETE event stream
  (turns, items, deltas, token usage) auto-arrives on the same
  connection tagged with the child `threadId` — no extra subscription.
  Caveats [probe]: no `thread/started` fires for the child and
  `parentThreadId` is not populated on the wire in V1 — the only live
  child↔parent link is the collab item's id fields. `thread/read`/
  `resume`/`delete` accept child ids. Spawned agents do NOT inherit a
  cheap model (probe child ran gpt-5.5/xhigh). Separately, *delegate*
  agents (review/compact) get rollout files but are NOT threads — their
  events fold into the parent stream.
- **anyharness-owned terminals** (`domains/terminals/`): real PTYs the
  runtime itself owns — the only fully *interactive* terminals in the
  stack today. Anything we execute (as opposed to the harness executing)
  can be both rendered and typed into.

The structural boundary to internalize: **interactivity follows
ownership**. Harness-executed work (its Bash tool, unified_exec) can be
*watched* through the channels above but not typed into — the harness
owns the PTY and its permission model. Only executor surfaces we own
(anyharness terminals; any future client-executed command path) can be
fully interactive.

## 8. The other harnesses: OpenCode and Cursor

### OpenCode (we run its native `opencode acp`; fork-pinned 1.17.7)

- **Goals: none. Loops: none.** Nothing self-wakes; sessions run only
  when prompted. (Only external trigger is the out-of-process
  `opencode github` webhook command.)
- **Subagents**: the `task` tool creates a **real child session**
  (`parent_id` column in its sqlite; `GET /session/:id/children`).
  Child transcripts do **NOT cross ACP** — the ACP layer drops events
  for unregistered child sessions; the completed task's
  `tool_call_update.rawOutput.metadata` carries `{parentSessionId,
  sessionId, model, background}` for correlation. Background subagents
  are experimental (`OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS`),
  with a process-local, non-durable job registry.
- **Terminals**: fresh child process per bash call (detached process
  group, killable); live output snapshots cross ACP in
  `tool_call_update` metadata; overflow spills to
  `~/.local/share/opencode/tool-output/`. **No background-bash
  equivalent.** A client-facing PTY subsystem (websocket, 25-session
  cap) exists but is not an agent tool.
- **Persistence**: sqlite (`opencode.db`: sessions/messages/parts +
  durable event log) survives restart; background jobs and PTYs don't.
- **Wrapper superpower**: `opencode acp` boots the FULL HTTP server
  in-process on a real port — child-session endpoints and global SSE
  event firehose are a typed side-channel available alongside ACP.

### Cursor (we run its hidden `cursor-agent acp`; archive-pinned) — live-probed 2026-07-02

- **Goals: none. Loops: none** (no user-facing schedule surface; only
  internal poll scheduling strings).
- **Background terminals — file-tracked, wire-silent after launch**
  [probe]: the agent detaches the command (tool_call completes
  immediately with exitCode 0) and then **nothing further crosses the
  wire** — no progress, no completion event, no wake (the model must
  poll; contrast Claude's `task_notification`). The tracking channel is
  a structured file per terminal:
  `~/.cursor/projects/<munged-cwd>/terminals/<id>.txt` with YAML-ish
  frontmatter — `pid`, `cwd`, `command`, `started_at`,
  `running_for_ms`, then on exit `exit_code`, `elapsed_ms`, `ended_at` —
  richer metadata than Claude's raw output file, but the path is NOT
  announced on the wire; derive it from the project-dir convention or
  watch the folder.
- **Subagents — lifecycle on the wire, content in files** [probe]: the
  parent's `task` tool calls surface as ACP `tool_call/tool_call_update`
  (`rawOutput {durationMs, isBackground}`), plus a custom agent→client
  **server request `cursor/task`** carrying `{toolCallId, description,
  prompt, subagentType, model, agentId}` (the client must respond; probe
  observed model `composer-2.5-fast` — subagents get a fast model by
  default). Follow-up messages to a running subagent are supported
  (task tool with the same agentId; "Sub-agent is currently running"
  error while busy). The subagent's own conversation does NOT stream on
  the parent wire; it persists in
  `~/.cursor/chats/<project-hash>/<agentId>/store.db` (a full sqlite
  chat store per subagent) + a per-project
  `agent-transcripts/<agentId>/` dir. (The advertised `loadSession` /
  session-list capability may offer an ACP read-path to child sessions —
  unverified.)
- **State**: per-ACP-session sqlite at `~/.cursor/acp-sessions/<uuid>/
  store.db` (+ `meta.json`); chats + terminals + agent-transcripts under
  `~/.cursor/projects/<munged-cwd>/` and `~/.cursor/chats/`.

### Capability matrix (verified 2026-07-02)

| | Claude Code | Codex | OpenCode | Cursor |
|---|---|---|---|---|
| goals | native (`/goal`, Stop hook) | native (engine + sqlite) | — | — |
| loops | native (session crons) | — | — | — |
| subagents | tasks + tagged wire stream + per-agent file | full child threads, complete stream on wire | child sessions, HTTP/DB only (not on ACP) | lifecycle on wire (`cursor/task` req) + per-agent sqlite |
| background exec | tasks + output files + completion wake | none cross-turn (in-turn only) | none (experimental bg subagents only) | detached, wire-silent; structured terminal files (pid/exit/timestamps) |
| self-wake sources | crons, task completions, goal (stop-refusal) | goal engine only | none | none (no completion wake — model polls) |

## 9. Evidence inventory

Scratchpad `goal-test/`:

- `codex_goal_test.mjs` — goal CRUD + notifications (original probe).
- `codex_goal_restart_probe.mjs` + `p3-codex-restart.out` — SIGKILL /
  resume / self-resume, approval gating.
- `loop_wake_probe.mjs`, `loop_resume_probe.mjs`, `loop-run/PING.log` —
  cron fire cadence, process-bound gap, resume re-arm.
- `bg_bash_wire_probe.mjs` + `p4-bg-wire.out` — task lifecycle events +
  completion wake.
- `claude_stream_test.mjs`, `sdk_goal_test.mjs` — `/goal` set/replace/
  poll/auto-clear; transcript-only observation.
- Transcript with cron mechanics: `~/.claude/projects/…loop-run/
  8b604a18-….jsonl` (queue-operations, CronCreate input, skill text).
- Source: scratchpad `codex/` (openai/codex), `codex-acp/`,
  `claude-agent-acp/`; distilled maps in scratchpad `impl-maps/`.
