# Truthful Workflow Cancellation, Versioning, and Session Admission

Owner: AnyHarness workflow run control.

This specification adds truthful, durable cancellation and run-state
versioning to the existing one-prompt workflow execution vertical. It builds
directly on [`runs.md`](runs.md) (the C2a envelope) and
[`invocations.md`](invocations.md) (portable invocation and
target resolution, schema v2) and supersedes only the clauses listed in
[§9](#9-supersession-and-cross-links). Everything else in both predecessor
specs remains authoritative.

Read with:

- [`runs.md`](runs.md) for the one-prompt envelope,
  acceptance/replay, execution sequence, and completion extension;
- [`invocations.md`](invocations.md) for the v1/v2 version
  boundary, target resolution, and `resolved_plan_json`;
- [`../../../structures/anyharness/guides/domains.md`](../../../structures/anyharness/guides/domains.md)
  and [`guides/persistence.md`](../../../structures/anyharness/guides/persistence.md)
  for placement and SQLite transaction rules; and
- [`../../../../developing/testing/README.md`](../../../../developing/testing/README.md)
  for test tiers.

## 1. Outcome

AnyHarness can durably request cancellation of a v1 or v2 workflow run and
report what is actually known:

```text
cancel before prompt dispatch -> cancelled immediately; prompt never sent
cancel after prompt dispatch  -> running + cancelRequestedAt
correlated cancelled turn     -> cancelled
runtime restart ambiguity     -> interrupted/runtime_restarted
```

While a run is nonterminal, it exclusively controls execution mutation of the
normal session it creates. Foreign execution mutation fails with
`409 SESSION_CONTROLLED_BY_WORKFLOW` before any persistence, projection,
queue, actor command, or file effect. Reads and cosmetic title updates remain
available. Cancellation is durable requested state, not a guarantee that it
beats an already accepted or queued turn; a later correlated completion or
failure remains truthful and may win.

## 2. Boundary

### 2.1 In scope

- `POST /v1/workflow-runs/{runId}/cancel`;
- required `stateVersion` plus optional `cancelRequestedAt` and
  `interruptionCode` on v1 and v2 run responses;
- `cancelled` and `interrupted` run/step states on both response families;
- the atomic four-outcome cancel-intent operation;
- one narrow crate-private exact-active-turn live-cancel session seam;
- `WorkflowRunGates`: per-run serialization across acceptance, execution CAS
  boundaries, completion terminal CAS, and cancellation;
- workflow-owned session mutation admission with stable
  `409 SESSION_CONTROLLED_BY_WORKFLOW`;
- preselected session-ID reservation, active-controller uniqueness, and
  permit-serialized terminal release;
- trusted internal workflow prompt/cancel mutation sources plus static HTTP
  and non-HTTP owner ratchets;
- custom foreign-key migration `0062` with strict legacy pair validation; and
- restart fencing to `interrupted/runtime_restarted`.

### 2.2 Explicit non-goals

- existing-session takeover or workspace locking;
- Cloud/Desktop/UI projection;
- retry, resume, recovery, grants, MCP, credentials, goals, multiple steps;
  and
- a generalized workflow actor, manager, scheduler, or cancellation framework.

## 3. Public contract

### 3.1 Cancel route

```http
POST /v1/workflow-runs/{runId}/cancel
```

The operation has no request body and returns the existing
`VersionedWorkflowRunResponse` envelope. The route uses the existing workflow
bearer rules and remains excluded from direct-attach JWT routes.

| Request | Result |
| --- | --- |
| Noncanonical UUID | `400 WORKFLOW_RUN_INVALID` |
| Unknown run | `404 WORKFLOW_RUN_NOT_FOUND` |
| Known run | `200` with its current versioned workflow snapshot |
| Terminal run | unchanged `200` |
| First nonterminal request | durable intent, then best-effort live cancel when a prompt may have been dispatched |
| Repeated nonterminal request | same timestamp/version, but re-attempt live cancel so an earlier missing actor can recover |

A `200` acknowledges durable intent. It does not claim the turn is cancelled.

### 3.2 Response fields and states

Both v1 and v2 run responses add:

```text
stateVersion        integer >= 1, required
cancelRequestedAt?  optional timestamp, omitted when null
interruptionCode?   optional closed enum, omitted when null: runtime_restarted
```

Both response families share these run states:

```text
accepted | running | completed | failed | cancelled | interrupted
```

Both share these step states:

```text
pending | running | completed | failed | cancelled | interrupted
```

Request shapes and the separate existing v1/v2 failure-code components
(`WorkflowRunFailureCode`, `WorkflowRunFailureCodeV2`) remain unchanged. Step
responses gain only the expanded status vocabulary.

### 3.3 Wire version distinguisher

V1 and v2 responses are distinguished by `schemaVersion` and the presence of
`resolvedHarness` (v2 only). `resolved_plan_json` is a DB-only column: it is
never serialized on the wire in either family.

### 3.4 V1 widening supersession

This contract supersedes the
[`invocations.md`](invocations.md) "do not rename or widen
the existing v1 components" clause for exactly these additions, and nothing
else:

- required `stateVersion` on both v1 and v2 run responses;
- optional-omitted `cancelRequestedAt` and `interruptionCode` on both v1 and
  v2 run responses; and
- the widened run/step status vocabularies (`cancelled`, `interrupted`) on
  both families.

Request components and the per-family failure-code components remain per
family and otherwise unchanged.

## 4. State and version rules

- Acceptance starts at `stateVersion = 1`.
- Every successful externally visible snapshot transaction increments the run
  version exactly once.
- Run `updatedAt` changes if and only if `stateVersion` increments; step
  `updatedAt` changes only when that step actually changes.
- A coupled run+step change increments once, not once per row.
- Exact replay, guarded no-op, duplicate callback, late callback, and repeated
  cancel intent do not increment.
- Run `failureCode` is non-null if and only if run status is `failed`.
- Run `interruptionCode = runtime_restarted` if and only if run status is
  `interrupted`.
- Step `failureCode` is non-null if and only if step status is `failed`.
- Every other step status, including `interrupted`, has null `failureCode`;
  steps have no interruption-code column.
- `cancelled` and `completed` carry neither `failureCode` nor
  `interruptionCode`.
- `completed` or `failed` may retain `cancelRequestedAt` when that truthful
  terminal outcome wins after cancellation intent.
- `cancelled` does not require `cancelRequestedAt`: migrated rows and exact
  correlated provider cancellation may provide truthful cancelled-turn
  evidence without workflow API intent.
- Terminal rows remain immutable; first truthful terminal evidence wins.
- JSON, OpenAPI, and generated TypeScript tests pin required `stateVersion`
  and optional-omitted control fields for both v1 and v2.

## 5. Durable cancellation flow

### 5.1 Cancel-intent operation

The atomic cancel-intent operation returns one domain outcome:

```text
Missing
Terminal(current snapshot)
CancelledBeforeDispatch(current snapshot)
CancellationPending(current snapshot + sessionId + optional turnId)
```

Rules:

1. Record the first `cancelRequestedAt` and one version increment.
2. If the materialized step is still pending, atomically terminalize run and
   step as `cancelled`; this is proof that no prompt was dispatched.
3. If the step is running, retain the last proven status. When its durable
   workflow `turn_id` is present, request cancellation only if that exact turn
   is still active in the bound session. When it is null (queued, or
   correlation persistence was unavailable), record intent only; never cancel
   unrelated active work.
4. Missing/unavailable live state leaves the durable run nonterminal for a
   repeated request or restart fencing.
5. After the live-cancel attempt, read and return the latest durable snapshot;
   the response may therefore already be terminal if correlated evidence won.

### 5.2 Live-cancel session seam

A narrow internal session seam reports:

```text
request_live_turn_cancel(sessionId, expectedTurnId)
  -> Requested | NotActive | NotLive | ActorUnavailable
```

This crate-private mechanism targets the already-bound live session under the
owning workflow's trusted mutation source; the public session-cancel path is
fenced above it. It changes no session row. The actor serially compares
`expectedTurnId` with its current active turn before forwarding ACP
cancellation. `Requested` proves only that the matching-turn cancel command
was accepted, not provider cancellation; `NotActive` covers idle or a
different active turn. No seam result terminalizes the workflow; only the
exact correlated callback can.

### 5.3 Queued and null-turn prompts

The predecessor's `Queued` prompt behavior remains unchanged. Session
admission prevents new foreign execution mutation after the workflow binds
the session, but it does not turn a queued or acknowledgement-lost dispatch
into terminal evidence. There is no workflow-specific queue-removal path;
cancellation remains requested and only its exact correlated terminal outcome
(or restart fencing) terminalizes the run. A stale stored workflow turn ID
must never cancel a different active turn: the actor's exact-active-turn
comparison returns `NotActive` and forwards nothing.

### 5.4 Cancelling a lost-acknowledgement step

A lost prompt acknowledgement (`TextPromptDispatchError::AcknowledgementLost`,
PR #1185) leaves the step running with a null `turn_id` and writes no failure:
the turn may or may not be running. Under this spec such a step follows the
null-turn rule in [§5.1](#51-cancel-intent-operation) exactly: cancellation
records intent only — with no stored turn there is no exact turn to target,
and unrelated active work must never be cancelled. The run is then resolved by
the exact correlated callback if the turn did run, or by startup fencing to
`interrupted/runtime_restarted` if it did not.

### 5.5 Failure behavior

- Invalid/missing run fails before mutation with the public results in
  [§3.1](#31-cancel-route).
- Intent-transaction or blocking-task failure before commit returns the
  existing generic workflow storage `500` and changes nothing.
- `NotActive`, `NotLive`, and `ActorUnavailable` are truthful `200` pending
  snapshots, not transport failures.
- A final snapshot-read failure after intent commit returns generic `500`, but
  the committed intent remains and exact repetition is safe.
- Logs and errors contain stable codes and safe run/session IDs only — never
  prompts, arguments, credentials, provider bodies, or raw error chains.

## 6. Cancel/dispatch ordering

### 6.1 WorkflowRunGates

`WorkflowRunGates` (`domains/workflows/control/gate.rs`) is the per-run keyed
gate: acceptance, execution CAS boundaries, the completion extension's
terminal CAS, and cancellation all serialize on the same per-run key.

Wiring: `app/` constructs one shared `Arc<WorkflowRunGates>` and injects it
into both the workflow runtime and the completion extension. Do not add an
actor, manager, scheduler, retry loop, or generalized orchestration framework.

### 6.2 Ordering rules

Exactly one prompt-dispatch classification site exists — `run_execution` in
`domains/workflows/execution.rs`, which consumes the shared decision seam in
`domains/workflows/dispatch.rs` (`apply_prompt_dispatch_outcome`) — plus the
separate v2 effort-application step; these rules are written against those
sites.

- PUT holds the run gate through durable acceptance and execution scheduling.
- Execution acquires the gate for `accepted -> running`, releases it while
  acquiring the workspace lease, then reacquires it to recheck
  nonterminal/uncancelled state and hold through durable session creation plus
  `session_id` binding. If cancellation wins that recheck, no session is
  created; if creation wins, its binding attempt happens before cancellation
  can terminalize the pending step.
- Session startup and optional v2 effort application run outside the gate so a
  cancel request is not blocked for their full duration.
- Execution reacquires the gate for its final uncancelled CAS,
  `pending -> running`, prompt acceptance at the single dispatch site,
  persistence of a returned running `turn_id`, and any prompt-dispatch failure
  terminalization.
- Cancellation holds the same gate across cancel-intent CAS and the
  live-cancel request.
- If cancellation wins, stale execution cannot send a prompt.
- If prompt acceptance wins, cancellation observes the accepted state and may
  issue the exact-active-turn request; it never claims that command acceptance
  is terminal evidence.
- Session completion uses the same per-run serialization before its terminal
  CAS, so a cancel request and a terminal callback cannot cross in an
  unobservable interval. The completion task obtains its opaque run key
  through an exact session+prompt store lookup; it never parses the
  deterministic prompt ID.
- Every classified execution-failure terminalization uses the same run gate.
- If session creation wins before cancellation, cancellation waits for its
  binding attempt. A binding infrastructure failure or process death between
  the separate session and workflow transactions remains restart-fenced
  ambiguity; only already-persisted correlation is promised.
- Cancellation during startup or v2 effort application may terminalize the
  still-pending step; the execution task must observe terminal/cancel intent
  before dispatch and send no prompt.
- A session whose creation or startup already won may remain as an ordinary
  retained idle session after pre-dispatch cancellation. Do not initiate a new
  startup after observing terminal state, but add no cleanup or actor-teardown
  semantics; the hard guarantee here is zero prompt dispatch.
- `WorkflowRunRuntime::cancel` uses the same detached main-runtime handoff as
  PUT. Dropping the HTTP future cannot cancel the intent-CAS -> live-request
  -> final-snapshot sequence. A process failure still leaves durable intent
  for a repeated request or startup fencing.

### 6.3 Workflow-owned session mutation admission

The existing nonterminal `workflow_runs.session_id` binding is the durable
controller record. A partial unique index permits at most one nonterminal run
to control a non-null session ID; terminal history may reuse a session.

Creation closes the writable gap:

1. the workflow preselects the normal session ID;
2. it reserves that session's transient mutation gate before the session row
   exists;
3. under the run gate and held mutation permit, it creates the session and
   durably binds `workflow_runs.session_id`; and
4. it releases the permit only after the binding commits.

Every external execution-affecting session owner acquires admission before its
first effect. An active controller returns stable
`409 SESSION_CONTROLLED_BY_WORKFLOW`; ordinary sessions keep their existing
behavior. The workflow's crate-private prompt and exact-turn cancel seams use
an unforgeable trusted `WorkflowRun(runId)` source. HTTP input cannot select
that source.

Terminal completion, failure, and cancellation acquire the same session
permit before the terminal workflow CAS. Foreign mutation therefore either
observes active control and conflicts or proceeds after terminal release.
Startup `runtime_restarted` fencing is the narrow exception: it runs before
session runtime construction or HTTP service, when no live mutation can race.

When an owner also needs a workspace operation lease, lock order is mutation
permit before workspace lease. Workspace purge, retirement, retention, and
mobility destruction acquire permits for affected sessions, take the
exclusive lease, and recheck the durable controller set before destructive
effects. Lookup or recheck failure is fail-closed. Read APIs, transcript/SSE,
and store-only cosmetic title changes remain admitted.

## 7. Persistence and migration

Extend AnyHarness SQLite only:

```text
workflow_runs
  state_version          integer not null check >= 1
  cancel_requested_at    text nullable
  interruption_code      text nullable, runtime_restarted only
```

Because `workflow_runs` and `workflow_run_steps` have status checks and a
parent/child foreign key, this is custom foreign-key migration `0062`
(`workflow_run_control_migration.rs`, beside
`workflow_runs_v2_migration.rs`), registered in
`CUSTOM_FOREIGN_KEY_MIGRATIONS`; it is not an ordinary SQL migration.

Migration requirements:

- rebuild and copy both tables;
- preserve schema v1/v2, `invocation_json`, nullable/required
  `resolved_plan_json`, every correlation ID, timestamp, and v2-only failure
  code;
- set every historical run to `stateVersion = 1`;
- old `failed/session_turn_cancelled` run+step -> `cancelled`, clear the
  failure code;
- old `failed/runtime_restarted` run+step -> `interrupted`, clear the failure
  code and set run `interruptionCode = runtime_restarted`;
- leave all other completed/failed history unchanged;
- migrated `cancelRequestedAt = null`;
- enforce the status/code relationships in [§4](#4-state-and-version-rules)
  with direct-SQL cross-column checks on the rebuilt tables;
- validate legacy run+step pairs before copying: the known
  cancellation/restart mappings require the run and its materialized step to
  be failed with the same legacy code; all failed pairs must share one failure
  code; completed pairs must both be completed; accepted pairs are
  accepted+pending; running pairs may have a pending or running step. Any
  other pair aborts the migration instead of guessing product history; and
- restore FK enforcement, run `foreign_key_check`, and regenerate the schema
  snapshot.

Do not add active-session uniqueness or a controller table here.

## 8. Restart and retention

Before serving HTTP, startup fencing converts every remaining nonterminal run
and step to `interrupted`, sets `runtime_restarted` on the run, and increments
each run's `stateVersion` exactly once.

- No prompt or session replay.
- No retry or recovery.
- Workspace/session/turn/transcript correlation is retained.
- Already-terminal rows remain unchanged.
- A fencing failure still aborts AppState construction.

## 9. Supersession and cross-links

This spec supersedes only these [`runs.md`](runs.md)
clauses:

- the §2.2 non-goal excluding workflow mutation locking;
- the §2.2 non-goals lines excluding cancellation APIs and cancellation
  recovery;
- the §5.1 run/step status enumerations (now widened per
  [§3.2](#32-response-fields-and-states));
- the §6.2 restart clause "there is no resume, retry, replay, cancellation, or
  reconciliation" (fencing now writes `interrupted` plus one version
  increment, and durable cancellation exists); and
- the §9 definition-of-done line asserting the diff contains no cancellation.

It supersedes only the [`invocations.md`](invocations.md)
v1-widening clause, exactly as scoped in
[§3.4](#34-v1-widening-supersession).

Everything else in `runs.md` — the one-prompt envelope, acceptance
and replay, target resolution, the execution sequence, the completion
extension, and all unrelated behavior — and all of `invocations.md`
remain authoritative and unchanged.

## 10. Ownership and interface sketch

```text
anyharness-contract/src/v1/workflow_runs.rs
anyharness-contract/src/v1/workflow_runs_v2.rs

anyharness-lib/src/domains/workflows/
  model.rs
  service.rs
  runtime.rs                 # facade; delegates cancel and execution
  dispatch.rs                # effect boundary: abort contract + dispatch decision
  execution.rs               # the one execution task with the §6.2 gate points
  session_extension.rs
  control/
    mod.rs                   # exports only
    gate.rs                  # WorkflowRunGates: transient per-run async serialization
    runtime.rs               # cancel use case and detached handoff
  store/{mod,runs,steps}.rs

anyharness-lib/src/domains/sessions/runtime/lifecycle.rs
  narrow internal exact-active-turn cancel request only

anyharness-lib/src/domains/sessions/admission.rs
  generic keyed mutation gate, source, kind, permit, and policy port

anyharness-lib/src/domains/workflows/session_admission.rs
  durable active-controller lookup and workflow policy implementation

anyharness-lib/src/live/sessions/
  handle.rs
  actor/command.rs
  actor/run.rs
  actor/turn/active.rs
  narrow conditional-cancel command/result only

anyharness-lib/src/api/http/workflow_runs*.rs
anyharness-lib/src/api/http/access.rs
anyharness-lib/src/api/router.rs
anyharness-lib/src/persistence/workflow_run_control_migration.rs
anyharness-lib/src/persistence/workflow_run_control_migration_tests.rs
anyharness-lib/src/persistence/custom_migrations.rs
anyharness/sdk generated artifacts
scripts/check_session_mutation_admission.py
scripts/session_mutation_admission*.txt
```

Workflows owns cancellation policy, run serialization, and the durable
controller lookup. Sessions owns the generic mutation gate/policy port and
live-cancel mechanism; `app/` injects the workflow policy without a Sessions
dependency on Workflows. HTTP remains thin. Contract types stay at the API
boundary; SQLite row types stay in the store. The conditional live command is
crate-private, trusted only for its owning workflow, and the existing public
session-cancel route is fenced above it.

## 11. Required proof

### 11.1 Contract and migration

- v1 and v2 status/field shapes plus generated OpenAPI/SDK;
- cancel `400`, `404`, and truthful `200` snapshots;
- direct-attach JWT exclusion for POST cancel, matching existing PUT/GET;
- file-backed pre-0062 upgrade containing v1 and v2 rows;
- exact historical mappings and v2 `resolved_plan_json`/failure preservation;
- an invalid legacy pair aborts the migration, leaves `0062` unapplied, and
  restores the connection's prior foreign-key-enforcement state; and
- reopen, constraints, schema snapshot, and `foreign_key_check`.

### 11.2 Real SQLite and concurrency

- exact version progression for accept, begin, bind, step, turn, terminal;
- no increments for replay, no-op, duplicate/late callback, repeated intent;
- cancel before the executor and at every durable boundary;
- cancellation during effort application;
- the final dispatch-versus-cancel gate race;
- a running turn stays running until exact cancelled evidence;
- queued/null-turn cancellation records intent without cancelling unrelated
  active work and remains nonterminal until a correlated outcome or restart;
- a stale stored workflow turn ID while a newer foreign turn is active returns
  `NotActive` and never forwards ACP cancellation;
- completion/failure/cancellation first-terminal-wins races;
- missing actor plus repeated cancel retry;
- a dropped cancel HTTP awaiter cannot orphan the durable-to-live handoff;
- an intent-write failure performs no durable change;
- a post-commit final-read failure returns `500` while preserving durable
  intent; and
- restart -> `interrupted` exactly once with zero replay.

### 11.3 Acceptance journey

```text
start portable v2 one-prompt run with a held scripted turn
  -> POST cancel
  -> observe running + cancelRequestedAt
  -> provider reports correlated cancellation
  -> GET cancelled run + step
  -> prove one session, prompt, and turn
  -> exact PUT replay creates no effects
```
