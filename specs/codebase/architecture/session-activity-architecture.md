# Session Activity — resolved architecture (goals, loops, subagents, terminals)

> As-built update 2026-07-03: goals AND workflows are now implemented and
> validated — see `codex/workflows-architecture-current.md` for the
> as-built deep dive with file paths (PR #921 stack). Loops and the
> subagent/terminal activity rosters are now ALSO implemented and validated
> — see `codex/goals-loops-rosters-implementation.md` for the as-built deep
> dive with file paths (PRs #909/#918/#919/#920 + fork PRs #12/#13/#24/#25).
> This doc remains the design of record for the still-unbuilt pieces: the
> OpenCode/Cursor membranes and fleet/workflow consumption of activity.

Status: design of record, decisions locked with Pablo 2026-07-02.
Companions: `codex/harness-runtime-mechanics.md` (verified mechanics, all
four harnesses), `specs/tbd/goals-and-workflows-v1.md` (goals/workflows
product design).

## Locked decisions (Pablo, 2026-07-02)

1. **Membranes**: Claude/Codex normalization lives in our sidecar forks;
   OpenCode/Cursor normalization lives in anyharness **integration
   modules** (`integrations/opencode_activity`, `integrations/
   cursor_activity`). Condition: identical UX standards across all four —
   the capability matrix, not the membrane placement, is the only thing
   the product may reflect.
2. **No cloud sync**: there is no server-side projection/sync of
   activity. Read-from-source: the runtime serves activity; clients —
   including fleet views — read through the runtime access gateway.
3. **No synthetic harness behavior**: we never make other harnesses
   *behave* like Claude (no injected wake prompts, no fake
   notifications). Faithful mirroring of native evidence is in scope:
   e.g. Cursor's terminal file records `exit_code`/`ended_at`; showing
   "finished" from that is mirroring, not synthesis.
4. **Sequencing** (revised 2026-07-03): Phase A goals SHIPPED (PR
   stack). Next: **workflows built directly on top of goals** (they
   need goals, not rosters) with triggers = manual + schedule in the
   first cut, mid-chat after. **Parallel track** (separate agent):
   loops + subagent/terminal activity rosters (the original Phase
   B/C). OpenCode/Cursor membranes + fleet views follow. Run-view
   terminal/agent chips degrade gracefully until the roster track
   lands.
5. **Goal + activity UX** (reference image received 2026-07-02;
   decisions locked):
   - A slim **bar docked above the composer**, shown only when live
     state exists. The goal is its primary, **ever-present** element
     when set: `◎ Pursuing goal <objective>` with inline
     **pause / edit / delete** controls. The goal bar is display +
     controls only — it is NOT a click-in.
   - Pause is shown on all harnesses; **disabled with a tooltip**
     ("not supported by this agent") where there's no native pause
     (Claude). Codex pauses natively.
   - **Compact chips stack on the same bar row** when present:
     `⟳ 2 loops · ▸ 2 terminals · ⑂ 1 agent`. Each chip is the
     click-in to its own activity panel (terminal viewer, subagent
     transcript, loop list).
   - On met/blocked the bar transitions to a **sticky result** that
     stays until dismissed or a new goal is set. Revised after live
     feedback (2026-07-03): the collapsed line shows the OBJECTIVE
     (`✓ Goal met — <objective>`), never the raw reason (evaluator
     reasons quote tool output and truncate uselessly). The bar is
     EXPANDABLE (click / chevron): a popover above the bar with the
     full objective, the full met/blocked reason as readable multi-line
     text, and a stats row (iterations · tokens · duration) when
     present; actions: dismiss, set new goal. Same pattern for blocked
     (full blocked reason + "needs you" framing).
   - **Edit/set is multi-line** (Conductor reference, 2026-07-02): an
     auto-growing textarea in the bar with ✓ commit / ✗ cancel buttons;
     Cmd+Enter commits, Esc cancels, plain Enter is a newline.
   - **Goal lifecycle renders in the transcript** (Conductor
     reference): GoalUpdated/GoalMet/GoalCleared session events
     interleave into the transcript by seq as quiet system-style items
     ("◎ Goal set — …", "◉ Goal met — <reason>"), in addition to the
     bar. The runtime still keeps goal chunks out of raw transcript
     storage — this is client-side composition from the event stream.
   - **Anchoring rule** (locked 2026-07-03 after live feedback): rows
     anchor CAUSALLY, not by raw event seq. "Goal set/edited" anchors
     at the START boundary of the pursuing turn (immediately after the
     user message that armed it; between turns if armed while idle) —
     never below the assistant content it caused. "Goal met/cleared/
     status-change" anchors at the END of the turn where it occurred.
     Invariant: turn N+1 content never renders above any row anchored
     to turn N or earlier (no end-of-list tail buckets).

## The primitive

`SessionActivity` — one normalized, strictly-typed, per-session
aggregate; the single answer to "what is this agent doing right now".
Two element classes:

- **Mirrors with write paths**: `goal`, `loops[]` — externally settable/
  editable/clearable, always representing round-tripped native state.
- **Read-only rosters**: `processes[]`, `agents[]` — watchable, never
  writable. Each roster element carries an opaque `FeedRef` for its live
  content stream; the UI never learns the transport.

```
harness internals ─► membrane (normalize) ─► runtime mirror ─► contract ─► UI / workflows
```

Truth rules (from harness-runtime-mechanics §6): mutate only via
protocols; observe via protocols, tail files only where the wire is
silent; harness files are read-only evidence; our mirror is the product
source of truth; reconcile on attach.

## Contract (anyharness-contract v1)

```rust
pub struct SessionActivity {
    pub turn: TurnState,                      // Running { turn_id, started_at } | Idle
    pub goal: Option<Goal>,
    pub loops: Vec<Loop>,
    pub processes: Vec<ActivityProcess>,
    pub agents: Vec<ActivitySubagent>,
}
pub struct ActivityProcess {
    pub id: String, pub command: String, pub cwd: Option<String>,
    pub status: ProcessStatus,                // Running | Exited { exit_code: Option<i32> }
    pub pid: Option<u32>,                     // cursor provides; claude doesn't
    pub started_at: String, pub ended_at: Option<String>,
    pub feed: Option<FeedRef>,
}
pub struct ActivitySubagent {
    pub id: String,                           // claude task_id / codex child threadId / cursor agentId
    pub agent_type: Option<String>, pub description: Option<String>,
    pub model: Option<String>, pub background: bool,
    pub status: SubagentStatus,               // Running | Completed { summary } | Failed
    pub usage: Option<ActivityUsage>,
    pub feed: Option<FeedRef>,
}
pub struct FeedRef { pub feed_id: String, pub kind: FeedKind }  // TerminalBytes | Transcript
```

New `SessionEvent` variants: `GoalUpdated | GoalMet | GoalCleared |
LoopUpserted | LoopRemoved | LoopFired | ActivityProcessUpserted |
ActivitySubagentUpserted`. `SessionView.activity` added. SDKs
regenerated. Capability flags per harness ride the catalog +
initialize `_meta` (`goals: native|none`, `loops: native|none`,
rosters always available at whatever fidelity the harness offers).

## Membrane framework (per-harness parsing, one contract)

**ActivityPort wire contract** (extends the pinned GoalPort/LoopPort):

- UP — tagged chunks kept out of the transcript:
  `_meta.anyharness.transcriptEvent ∈ goal_updated | goal_met |
  goal_cleared | loop_upserted | loop_removed | process_upserted |
  subagent_upserted`, payload = the normalized record; feed transports
  travel membrane→runtime only (`tail_file(path) |
  acp_child_demux(thread_id) | http_sse(url)`), swapped for opaque
  `FeedRef`s before leaving the runtime.
- DOWN — ext methods (`_`-prefixed on the wire): `goal/set|get|clear`,
  `loop/set|clear|list`, `activity/list` (the reconcile pull).
- Capability advertisement: `InitializeResponse._meta.anyharness =
  { schemaVersion, goals: {...}, loops: {...} }` — stale membranes
  degrade to unsupported, never break.

**Per-harness membranes** (mechanics all verified; see
harness-runtime-mechanics):

| harness | where | up-path sources | feed transports |
|---|---|---|---|
| Claude | claude-agent-acp fork | task_* system events; ptuid-tagged subagent stream; transcript tail (goal status); CronCreate/session_crons (loops) | tail_file (task output_file; subagent transcript = same symlink) |
| Codex | codex-acp fork | ThreadGoalUpdated (already intercepted); CollabAgentToolCall roster; child-thread demux; in-turn commandExecution + byte channel | acp_child_demux (subagents); none needed for terminals (pure wire) |
| OpenCode | anyharness `integrations/opencode_activity/` | ACP tool_call snapshots (in-turn bash); task rawOutput metadata (child session id); HTTP side-channel roster (`/session/:id/children`) | http_sse (child transcripts via its in-process server) |
| Cursor | anyharness `integrations/cursor_activity/` | `cursor/task` inbound server-request (agentId, model, prompt, isBackground); tool_call updates; terminals-folder watcher (`~/.cursor/projects/<cwd>/terminals/<id>.txt` — pid/exit/timestamps) | tail_file (terminal files); per-agent sqlite read for subagent transcript (or ACP loadSession — one probe pending) |

Known fork work items: claude-acp persistent idle drain (structural —
nothing drains the SDK stream between prompts today); codex-acp
ExtMethodRequest handler + `Feature::Goals` force-enable + prose→tagged
goal emission; both: capability `_meta` + pin bump dance.

## Runtime organization (anyharness)

```
anyharness/crates/anyharness-lib/src/
  domains/goals/        model service store session_observer runtime   (mirror + write path)
  domains/loops/        same shape (list served from adapter mirror)
  domains/activity/     model service store session_observer feeds     (read-only rosters)
  domains/sessions/runtime/attach_reconcile.rs                          (uniform heal-on-attach)
  integrations/opencode_activity/  integrations/cursor_activity/        (membranes w/o sidecars)
  api/http/activity.rs   GET /v1/sessions/{id}/activity
                         WS  /v1/sessions/{id}/activity/watch
                         WS  /v1/feeds/{feed_id}                        (lazy; bytes flow only while watched)
  persistence/sql/00NN_activity.sql
```

- Ingestion: the ordered `SessionEventObserver` pass (plans-domain
  pattern, third instantiation). Observers persist records and re-emit
  contract events atomically.
- `FeedService` resolves transports lazily; a feed with no watcher
  costs nothing.
- `attach_reconcile`: on session attach/resume → `goal/get`,
  `loop/list`, `activity/list`; processes reset per harness semantics
  (process-bound children die with the harness; codex child threads
  re-listed since they're resumable).
- Restart semantics encoded per record (survives_restart flags follow
  the mechanics doc's persistence matrix).

## Read paths (no cloud sync)

Read-from-source everywhere: desktop reads local anyharness over HTTP/WS;
cloud clients reach the sandbox's anyharness through the runtime access
gateway. Fleet/aggregate views fan out to live runtimes (or their
last-known lifecycle state from existing session lifecycle records) —
no activity projection tables, no worker upload of activity data, no
byte shipping unless a panel is open.

## Spec alignment (checked against specs/ 2026-07-02)

The spec tree forces three integrations (and blesses the rest — the
session-engine/actor specs match this design's runtime assumptions
exactly):

1. **Subagents surface through the existing delegated-work primitive**,
   not a new panel. `features/delegated-work.md` is authoritative: "the
   UI primitive is delegated work, not subagents" — `DelegatedWorkItem
   { kind: subagent|cowork|plan_review|code_review, generatedName,
   colorToken, shortId, status, … }` with existing composer rows, header
   tabs, hover cards, and a status model (`needs_attention | failed |
   running | queued | wake_scheduled | finished | closed`) that already
   contains `wake_scheduled`. Harness-native subagents (Claude Task
   agents, Codex collab children, Cursor task agents) become a new
   delegated-work *source* feeding kind `subagent` items — the
   ActivitySubagent record maps into this model (status categories map
   1:1), and the ⑂ chip routes to the existing delegated-work surfaces.
   Definition home: `features/agent-features/definitions/subagents.md`
   (goals/loops get sibling definition files when they land).
2. **Agent terminals join the existing terminals surface.**
   `features/terminals.md` owns the right-panel terminal pane
   (`components/workspace/terminals/` — `TerminalPanel`,
   `TerminalViewport`, xterm lifecycle over
   `terminal-stream-registry`); runtime PTY internals are anyharness
   `domains/terminals`. Agent-spawned background terminals appear in
   that same pane, read-only, agent-attributed — the FeedService's
   `TerminalBytes` feeds plug into the stream-registry pattern and
   render through the existing `TerminalViewport`. (Rename the
   activity component — `TerminalPanel` is taken.)
3. **Cloud specs predate the no-sync ruling.** `cloud-dispatch.md` /
   `web-cloud-local-parity.md` (May 2026) describe the
   exposure/projection substrate; the current direction (post
   gateway cutover) is read-from-source per locked decision #2. Do not
   build activity on the projection substrate; those specs need a
   follow-up revision, out of scope here.

Also noted: `structures/anyharness/harnesses/` has pages for
claude/codex/gemini/grok only — add `cursor.md` and `opencode.md` when
their membranes land, recording the mechanics from
`harness-runtime-mechanics.md`.

## Product UI

```
apps/packages/product-domain/src/activity/    pure model + reducers
apps/packages/product-ui/src/activity/        shared panels
apps/desktop/src/components/workspace/activity/
  ActivityBar.tsx         the composer-docked bar (hidden when no live state):
                          goal primary + chips (⟳ loops · ▸ terminals · ⑂ agents)
  GoalBar.tsx             ever-present when set: ◎ "Pursuing goal" + objective,
                          inline pause (disabled+tooltip where non-native) /
                          edit-in-place / delete; sticky met/blocked result state
  ▸ terminals chip → the EXISTING right-panel terminals pane (spec:
      features/terminals.md), agent terminals listed read-only with
      agent attribution + structured header (command, pid, elapsed,
      exit); bytes via FeedService → terminal-stream-registry →
      TerminalViewport (reused, not rebuilt)
  ⑂ agents chip → the EXISTING delegated-work surfaces (spec:
      features/delegated-work.md): harness-native subagents feed
      DelegatedWorkItem (kind subagent, new source), inheriting
      generatedName/color identity, header tabs, and the status model
  panels/LoopsPanel.tsx      chip click-in (net-new surface): armed loops
                             (prompt, cadence, next fire, fire count →
                             links to fired turns)
playground fixtures first (components/playground/activity/)
```

Gating by capability flags only — the UI never branches on harness name.

## Phasing

A. **Goals** (specced in goals-and-workflows-v1): fork GoalPorts +
   goals domain + editable chip + panel.
B. **Activity rosters** (read-only): contract + activity domain +
   Claude/Codex membrane emission (same fork release train as A) +
   terminal/subagent panels + FeedService with tail_file/acp_child_demux.
C. **Loops**: loops domain + claude-acp cron mirror + LoopChip.
D. **OpenCode/Cursor membranes**: integration modules + http_sse
   transport + the two pending probes (cursor ACP loadSession for child
   sessions; opencode server port/options wiring).
E. **Fleet + workflows**: aggregate views over live runtimes; workflow
   steps (`agent.goal`, waits) consume the same contract events.

## Phase gates — manual testing (a phase does not merge until its gate passes)

Rules for every gate: run by the implementer against **real harnesses and
real keys** (`~/proliferate/.env`; all four binaries + both forks
available) — zero mocks. Two layers each time: (1) protocol gate —
today's probe scripts (scratchpad `goal-test/`) promoted into a repo
live-test harness, rerun through **anyharness** (not raw CLIs);
(2) product gate — `pdev` desktop, driven by hand or Playwright,
exercising the actual UI. Screenshot or wire-capture evidence attached
to the PR.

### Gate A — Goals
Protocol: `_anyharness/goal/set|get|clear` round-trips green on live
Claude + Codex sessions through anyharness; `GoalUpdated/GoalMet/
GoalCleared` observed on the SDK event stream; kill the agent process
mid-goal → resume → state reconciles (Codex resumes driving by itself;
Claude restores the condition).
Product (pdev):
- Claude session: set goal "DONE.txt exists containing done" from the
  bar → agent iterates → bar flips to sticky **met** with the
  evaluator's reason; dismiss works; re-set works.
- Edit mid-pursuit on Codex → steering observed (agent pivots);
  pause on Codex actually stops continuation turns; pause on Claude
  renders disabled + tooltip.
- Delete clears native state (verify with bare `/goal` on Claude,
  `thread/goal/get` on Codex — not just our UI).
- Gemini/OpenCode/Cursor sessions: no goal affordance rendered.

### Gate B — Activity rosters (Claude + Codex)
- Claude: prompt "run `sleep 30 && echo OK > out.txt` in the
  background" → ▸ chip appears with the command; existing terminals
  pane lists the agent terminal read-only; live tail renders; on exit
  the row flips finished and the wake turn appears in the transcript.
- Claude: spawn a background subagent → ⑂ chip; a DelegatedWorkItem
  appears with generated identity; nested transcript streams live and
  matches the on-disk `subagents/agent-<id>.jsonl` at completion.
- Codex: a turn running commands shows the terminal live from the wire
  (bytes, then exit); spawn a collab subagent → child stream renders
  under delegated work; roster empties when the turn ends.
- Reconcile: detach/reattach mid-run → Claude processes reset (files
  linger, rows marked stale/gone), Codex child threads re-listed.

### Gate C — Loops (Claude only, native)
- Set a 1-minute loop from the UI ("append ping + timestamp to
  PING.log") → ⟳ chip with next-fire; two fires observed as enqueued
  turns AND file lines; loops panel matches `session_crons` from the
  next hook snapshot; delete stops fires.
- Kill process → verify zero fires while dead (file gap) → resume →
  loop re-arms and fires again.
- No loop affordance on Codex/OpenCode/Cursor.

### Gate D — OpenCode + Cursor membranes
- Cursor: background command → row appears from the terminals-folder
  watcher with pid; live tail of the structured file; exit_code flips
  it finished; **verify no synthetic prompt was sent** (transcript
  clean). Subagent: `cursor/task` server-request handled (no protocol
  error), DelegatedWorkItem appears, transcript readable end-to-end.
- OpenCode: task-tool subagent → roster via the HTTP children
  endpoint, live transcript via SSE; in-turn bash snapshots render;
  kill/restart → sqlite-backed session state reconciles, background
  job registry correctly shows as lost (non-durable).

### Gate E — Fleet + workflows consumption
- Two+ live sessions (mixed harnesses, at least one cloud) with goals
  + activity → fleet view lists them read-from-source through the
  gateway; a `blocked` Codex goal sorts to the top; opening a feed
  from fleet streams only-while-open (verify no byte flow when
  closed).
- A workflow `agent.goal` step (when the engine lands) completes off
  the same `GoalMet` event the UI rendered — one event, two consumers.

## Open items

- Reference image for the goal-chip UX not yet received — §Locked
  decisions #5 described from words, validate against the image.
- Cursor: one probe to test ACP `loadSession`/`session/list` as a
  cleaner child-transcript read-path than sqlite.
- OpenCode: pin down `opencode acp` server port control for the
  side-channel client.
- claude-acp idle-drain refactor is the long pole of Phase A/B fork
  work — scope it first.
