# One-Prompt Workflow Execution in an Existing Workspace (C2a)

Status: frozen implementation specification, revision `C2a.3`.

Owner: AnyHarness workflow runs.

This specification defines the smallest real AnyHarness-only workflow
execution vertical. It consumes the authored definition contract in
[`workflows.md`](workflows.md) without making Cloud, Desktop, or another
product surface responsible for workflow execution.

Read with:

- [`../structures/anyharness/README.md`](../structures/anyharness/README.md) for
  AnyHarness ownership;
- [`../structures/anyharness/guides/api.md`](../structures/anyharness/guides/api.md)
  for HTTP boundary rules;
- [`../structures/anyharness/guides/domains.md`](../structures/anyharness/guides/domains.md)
  for store/service/runtime ownership;
- [`../structures/anyharness/guides/persistence.md`](../structures/anyharness/guides/persistence.md)
  for SQLite transaction rules;
- [`../structures/anyharness/guides/live-runtime.md`](../structures/anyharness/guides/live-runtime.md)
  for nonblocking session extensions; and
- [`../../developing/testing/README.md`](../../developing/testing/README.md)
  for test tiers.

## Handoff metadata

This table records implementation custody. It is not part of the wire,
persistence, or product contract.

| Field | Value |
| --- | --- |
| Repository | `proliferate-ai/proliferate` |
| Spec revision | `C2a.3` |
| Base SHA | `2ec15eaf8cfc870cbdbb42c225a5f1428e5282b4` |
| Stage | frozen; implementation handoff ready |
| Implementation head | none |
| Founder approval | 2026-07-13 |

An implementation based on a later revision must first reconcile this spec
against that revision. The base SHA never appears in product data.

## 1. Outcome

AnyHarness accepts one frozen executable workflow definition, concrete
arguments, and an existing AnyHarness workspace ID. It stores the invocation
and one materialized prompt step in AnyHarness SQLite, creates a new normal
session in the supplied workspace, executes the prompt, persists run and step
status, and returns the durable result.

```text
PUT definition + arguments + existing workspaceId
  -> validate and transactionally create / replay / conflict
  -> materialize one pending step in AnyHarness SQLite
  -> create a new normal session in the supplied workspace
  -> resolve arguments and send one prompt
  -> observe completion through one SessionExtension
  -> persist step and run terminal status
  -> GET run + step status
```

Acceptance requires one real prompt to complete while proving:

- run and step status are queryable;
- transcript and actor detail remain in existing session APIs;
- no workspace, directory, Git repository, or worktree is created; and
- replaying the identical PUT creates no second step, session, prompt, or
  turn.

## 2. Boundary

### 2.1 In scope

- `PUT /v1/workflow-runs/{runId}`;
- `GET /v1/workflow-runs/{runId}`;
- one strict schema-version-1 invocation;
- one frozen definition plus concrete scalar arguments;
- one existing AnyHarness workspace supplied by the caller;
- exactly one stage containing exactly one `agent.prompt` step;
- canonical-JSON exact replay versus same-ID conflict;
- AnyHarness SQLite run and materialized-step records;
- one new normal `SessionRuntime` session in the supplied workspace;
- one prompt with deterministic workflow-owned identity;
- terminal observation through one `SessionExtension`;
- `accepted`, `running`, `completed`, and `failed` run states;
- `pending`, `running`, `completed`, and `failed` step states;
- fail-closed restart fencing without recovery; and
- durable correlation to the ordinary workspace, session, turn, and
  transcript.

### 2.2 Explicit non-goals

- creating, initializing, registering, renaming, deleting, or claiming a
  workspace;
- scratch workspaces, cloning, repository selection, or worktrees;
- existing-session takeover, workflow mutation locking, or exclusive
  workspace access;
- more than one stage or prompt step;
- goals, cancellation APIs, or cancellation recovery;
- Cloud/Desktop delivery, custody, acknowledgements, or product run history;
- product-facing invocation or UI;
- secret inputs or arguments;
- grants, integrations, external MCP servers, or required tools;
- schedules, polling, retry, resume, or automatic recovery;
- reasoning-effort mutation;
- assistant-output projection into workflow tables;
- handwritten Cloud/Desktop/SDK workflow clients; and
- a workflow actor, manager, scheduler, task registry, executor port, generic
  step trait, plugin registry, command bus, placement hierarchy, retry
  framework, or `live/workflows` subsystem.

Later slices extend this domain; they do not expand this PR.

## 3. Invocation and API

### 3.1 Request

```http
PUT /v1/workflow-runs/{runId}
GET /v1/workflow-runs/{runId}
```

```json
{
  "schemaVersion": 1,
  "workspaceId": "20000000-0000-4000-8000-000000000002",
  "definition": {
    "inputs": [
      {
        "name": "ticket",
        "type": "string",
        "required": true
      }
    ],
    "stages": [
      {
        "harnessConfig": {
          "agentKind": "claude",
          "modelId": "claude-sonnet-4-5",
          "modeId": "bypassPermissions"
        },
        "steps": [
          {
            "kind": "agent.prompt",
            "prompt": "Investigate {{inputs.ticket}}"
          }
        ]
      }
    ]
  },
  "arguments": {
    "ticket": "PROL-123"
  }
}
```

Rules:

- `runId` is a canonical UUID supplied in the path only.
- Objects are strict; unknown fields are rejected at every level.
- `schemaVersion` is exactly `1`.
- `workspaceId` is a required existing AnyHarness workspace identifier.
- The definition contains exactly one stage and one `agent.prompt` step.
- Input names are unique, nonblank identifiers.
- Input types are `string`, `number`, or `boolean`, with boolean `required`.
- Defaults, arrays, objects, choices, and secret input types are rejected.
- `arguments` contains no undeclared keys and every value matches its declared
  scalar type.
- Every required input is present.
- Every input referenced by the prompt has an argument; an unreferenced
  optional input may be omitted.
- Placeholders are exactly `{{inputs.name}}`.
  - strings insert verbatim;
  - numbers use JSON scalar representation;
  - booleans render as `true` or `false`.
- The rendered prompt is nonblank and at most 16,384 UTF-8 bytes.
- `agentKind` is nonblank with no surrounding whitespace.
- `modelId` and `modeId` are required keys containing a nonblank string or
  `null`.
  - `modelId: null` uses existing target-default behavior.
  - `modeId: null` uses existing `SessionRuntime` behavior.
  - non-null values pass unchanged to `SessionRuntime`.
- Goals, attachments, system-prompt append, effort, caller-supplied prompt ID,
  and definition database identity/revision metadata are rejected.

Structural, input, argument, template, and rendered-prompt validation happen
before acceptance. Workspace availability, agent readiness, and model/mode
support remain post-acceptance execution checks and produce a durable failed
run.

### 3.2 Exact replay

The normalized domain invocation—`workspaceId`, frozen definition, and
arguments—is serialized as canonical `invocation_json`.

- `invocation_json` is the sole replay authority; there is no plan hash.
- JSON whitespace and object-key order do not matter.
- Workspace ID, arguments, prompt text, typed values, and array order do
  matter.

```text
no existing runId                    -> insert run + step -> Created
same runId + equal invocation_json   -> unchanged         -> ExactReplay
same runId + different invocation    -> unchanged         -> Conflict
```

Acceptance inserts the run and pending step in one transaction. The
transaction contains no workspace, session, or live-runtime call. Only
`Created` starts execution. Replay never resumes, retries, or starts effects.

### 3.3 Response and HTTP results

PUT and GET return:

```text
run:
  id, schemaVersion, definition, arguments
  status, workspaceId, sessionId?
  failureCode?
  createdAt, updatedAt, startedAt?, finishedAt?

steps:
  stageIndex, stepIndex, status, promptId, turnId?, failureCode?
  createdAt, updatedAt, startedAt?, finishedAt?
```

Assistant output, actor state, stop reason, and transcript events remain in
existing session APIs.

| Result | HTTP |
| --- | --- |
| New durable acceptance | `201 Created` |
| Exact replay | `200 OK` with current run and step |
| Same ID, different invocation | `409 WORKFLOW_RUN_CONFLICT` |
| Invalid ID, definition, arguments, or rendered prompt | `400` |
| Missing GET | `404 WORKFLOW_RUN_NOT_FOUND` |
| Acceptance storage failure | `500`; no committed run or step |

Ordinary AnyHarness `/v1` bearer behavior applies. These routes are not added
to the direct-attach JWT allowlist.

## 4. Persistence

### 4.1 Ownership

The server's existing `workflow_definition` Postgres table remains the
authored workflow source. This PR adds no Postgres run table. Future Cloud
delivery or product history may own a separate invocation/projection record.

AnyHarness SQLite is authoritative for execution.

### 4.2 Tables

`workflow_runs` owns invocation-level state:

```text
id                  text primary key
schema_version      integer not null, exactly 1
invocation_json     text not null, valid JSON
status              text not null
workspace_id        text not null
session_id          text nullable
failure_code        text nullable
created_at          text not null
updated_at          text not null
started_at          text nullable
finished_at         text nullable
```

`workflow_run_steps` owns the materialized prompt step:

```text
run_id              text not null
stage_index         integer not null
step_index          integer not null
status              text not null
prompt_id           text not null unique
turn_id             text nullable
failure_code        text nullable
created_at           text not null
updated_at           text not null
started_at           text nullable
finished_at          text nullable
primary key          (run_id, stage_index, step_index)
```

Constraints:

- run status is `accepted`, `running`, `completed`, or `failed`;
- step status is `pending`, `running`, `completed`, or `failed`;
- `workflow_run_steps.run_id` uses `ON DELETE CASCADE` to its run;
- `workspace_id`, `session_id`, and `turn_id` are stored identifiers, not
  foreign keys, and remain as correlation evidence after artifact deletion;
- `session_id` is not globally unique: future takeover may reuse a session
  after an earlier run releases it;
- active session exclusivity belongs to the later session-claim contract;
- C2a materializes only `stage_index = 0`, `step_index = 0`;
- the run has no persisted current-step cursor; step rows are the status
  authority;
- `failure_code` is at most 64 UTF-8 bytes;
- terminal rows have `finished_at` and only failed rows have `failure_code`;
- there is no `plan_sha256`, persisted failure message, stop reason, or event
  sequence; and
- there is no workflow deletion or cleanup API.

The deterministic prompt ID is:

```text
workflow:<runId>:0:0
```

It is opaque correlation evidence. Clients must not parse it, and it is not
the replay guard.

## 5. Lifecycle and execution

### 5.1 State machine

```text
run:   accepted -> running -> completed
       accepted -----------> failed
       running ------------> failed

step:  pending  -> running -> completed
       pending  ------------> failed
       running ------------> failed
```

- Run and pending step are committed together.
- The run becomes `running` before session setup.
- The step becomes `running` immediately before prompt dispatch.
- `SessionTurnOutcome::Completed` completes run and step.
- Failed or cancelled turn fails run and step.
- Setup failure fails the run and still-pending step with the same code.
- Stop reason and detailed actor state remain session-event concerns.
- All transitions are guarded compare-and-set writes.
- Terminal rows are immutable; duplicate and late callbacks are no-ops.
- If completion beats the post-send turn-ID write, the hook's turn ID wins.

### 5.2 Main flow

1. Decode and validate the strict invocation, bindings, and rendered prompt.
2. Canonicalize the full invocation.
3. In one SQLite transaction, create run plus pending step, exactly replay, or
   conflict.
4. For `Created` only, `WorkflowRunRuntime` starts one task on the captured
   process/main Tokio runtime.
5. Transition the run `accepted -> running`.
6. Use the supplied workspace unchanged: no filesystem, Git, registration,
   naming, worktree, or takeover behavior.
7. Acquire the existing shared `WorkspaceOperationKind::SessionStart` lease
   and hold it through prompt acceptance. This prevents destructive exclusive
   lifecycle operations without excluding other ordinary sessions.
8. Call checked durable internal-session creation using:
   - accepted `agentKind`, `modelId`, and `modeId`;
   - no system-prompt append;
   - no supplied MCP servers or binding summaries;
   - `SessionMcpBindingPolicy::InternalOnly`;
   - subagents disabled; and
   - `OriginContext::system_local_runtime()`.
9. Persist `session_id`, then call `start_persisted_session`.
10. Resolve arguments into the prompt.
11. Transition step `(0, 0)` `pending -> running`, then call the domain-owned
    text-prompt seam with rendered text and deterministic `prompt_id`.
    - `Running`: record the returned `turn_id` without overwriting terminal
      data.
    - `Queued`: remain running with nullable `turn_id`; add no queue model or
      retry.
12. `WorkflowRunSessionExtension` matches the exact stored `session_id` and
    `prompt_id`, then schedules one checked terminal transaction on the
    process/main runtime's blocking pool.
13. GET reads the durable run and step; session APIs provide transcript and
    actor detail.

The workflow owns the new session, not the supplied workspace. Other sessions
may share and mutate the same working directory. Worktree isolation and
exclusive workflow mutation locking are deferred.

### 5.3 Session seams

The runtime uses:

```text
create_persisted_internal_session(typed input)
  -> persist session_id
  -> SessionRuntime::start_persisted_session
  -> SessionRuntime::send_text_prompt_with_id
```

`create_persisted_internal_session` is a crate-visible, generic
`SessionRuntime` entry. It performs the existing workspace-access assertion,
creates but does not start the InternalOnly/subagents-disabled session, and
preserves typed creation errors. Workflow code does not call the unchecked
`create_durable_session`, `SessionService`, or `WorkspaceAccessGate` directly.

The split preserves `session_id` before startup. The combined
`create_and_start_session` path cannot provide that checkpoint on startup
failure.

`send_text_prompt_with_id` is a crate-visible, domain-owned text-only prompt
entry. It reuses the normal access check, live handle, actor command, and
`Started`/`Queued` result. The workflow domain does not import the wire-only
`anyharness_contract::v1::PromptInputBlock`.

The generic session completion context gains `prompt_id: Option<String>` from
the already-present actor `PromptDiagnostics`, passed narrowly through:

```text
SessionTurnFinishResult
  -> SessionTurnFinishedContext
  -> SessionRuntime extension mapping
```

The extension requires exact session and prompt identity. Session-only
matching could terminalize a workflow for an unrelated or queued turn.

## 6. Failure, restart, and retention

### 6.1 Failure behavior

Before acceptance:

- invalid shape, bindings, template, or rendered prompt returns `400` and
  creates no row;
- replay mismatch returns `409` and leaves the existing rows unchanged; and
- SQLite acceptance failure returns `500` with neither row committed.

After acceptance:

- missing or unavailable supplied workspace fails run and step;
- session creation, startup, or prompt dispatch failure fails run and step;
- failed or cancelled turn fails run and step; and
- already-persisted workspace/session/turn identifiers remain unchanged.

Stable failure codes are:

```text
workspace_unavailable
session_create_failed
session_start_failed
prompt_dispatch_failed
session_turn_failed
session_turn_cancelled
runtime_restarted
```

No failure message is persisted. `failureCode` is the programmatic result.
Prompts, arguments, credentials, environment, provider responses, transcript,
raw error chains, and `SessionTurnFinishedContext.error_details` are never
copied into workflow rows.

If session startup fails, the run retains `workspace_id` and `session_id`; run
and pending step become `session_start_failed`; the workspace remains
untouched; and the session row remains inspectable.

If a terminal SQLite write fails, log only safe correlation IDs, leave rows
nonterminal, and let startup fencing handle them. Never claim completion.

### 6.2 Restart and retention

After migrations and before serving HTTP, AppState construction fences all
nonterminal workflow state in one checked transaction:

```text
accepted | running run  -> failed(runtime_restarted)
pending  | running step -> failed(runtime_restarted)
```

- A fencing failure aborts AppState initialization; HTTP does not serve
  ambiguous rows.
- Previously terminal rows remain unchanged.
- There is no resume, retry, replay, cancellation, or reconciliation.
- The supplied workspace is never deleted, retired, renamed, or managed by
  workflows.
- The created session and transcript use existing retention behavior.
- Stored correlation identifiers remain on workflow rows.
- There is no scratch or cleanup behavior.

## 7. Engineering structure

### 7.1 Ownership and files

`domains/workflows` is a top-level AnyHarness product domain. A workflow run
may own several sessions later, so it is not a sessions subdomain. Durable
truth does not belong in `live/`, HTTP handlers, app wiring, the server, or the
thin binary.

```text
anyharness/crates/anyharness-contract/src/v1/workflow_runs.rs

anyharness/crates/anyharness-lib/src/domains/workflows/
  mod.rs
  model.rs
  store/
    mod.rs
    runs.rs
    steps.rs
  service.rs
  runtime.rs
  session_extension.rs

anyharness/crates/anyharness-lib/src/api/http/
  workflow_runs.rs
  workflow_runs_contract.rs
  workflow_runs_errors.rs

anyharness/crates/anyharness-lib/src/app/workflows.rs
anyharness/crates/anyharness-lib/src/persistence/sql/0060_workflow_runs.sql
```

Two row families earn `store/`. Store `mod.rs` owns public atomic operations;
`runs.rs` and `steps.rs` own private row SQL and mapping. Domain `mod.rs` is
exports-only. Service and runtime remain flat until another named concern or
the normal file-size thresholds earn a split.

Existing session files receive only the narrow generic seam changes described
above:

```text
domains/sessions/runtime/creation.rs
domains/sessions/runtime/prompt.rs
domains/sessions/runtime/startup.rs
domains/sessions/extensions.rs
live/sessions/actor/turn/types.rs
live/sessions/actor/turn/finish.rs
```

Normal integration edits register contracts, routes, OpenAPI, migration,
schema snapshot, generated SDK artifacts, AppState wiring, and the new product
domain in the AnyHarness architecture/code map.

### 7.2 Responsibilities

```text
WorkflowRunStore    synchronous workflow SQL
WorkflowRunService  synchronous durable rules
WorkflowRunRuntime  async cross-domain execution facade
SessionRuntime      existing session/live-agent orchestration
SessionActor        existing live actor
```

`WorkflowRunStore`:

- owns synchronous SQL and private row mapping;
- atomically accepts run plus step and atomically transitions coupled state;
- exposes intent-named operations such as `accept`, `bind_session`,
  `begin_step`, `record_turn`, `finish_turn`, `fail_nonterminal`, and
  `fence_nonterminal_after_restart`;
- returns replay, terminal, not-found, and mismatch outcomes as `Ok` data; and
- never validates product input, calls sessions, starts tasks, or awaits.

`WorkflowRunService`:

- owns invocation validation, scalar rendering, canonical JSON, replay,
  guarded transitions, GET, and restart fencing;
- uses domain models and typed status/failure/outcome enums;
- translates store infrastructure failures into one typed service error; and
- never spawns, awaits, holds live state, or calls `SessionRuntime`.

`WorkflowRunRuntime`:

- is the sole async workflow facade stored in `AppState`;
- depends on `Arc<WorkflowRunService>`, `Arc<SessionRuntime>`,
  `Arc<WorkspaceOperationGate>`, and the process/main Tokio handle;
- accepts before effects and spawns only for `Created`;
- owns the shared workspace-operation lease and concrete session sequence;
- converts every post-acceptance error into one guarded durable failure
  attempt; and
- delegates GET to the service on the blocking pool.

`WorkflowRunSessionExtension`:

- depends only on `Arc<WorkflowRunService>` and the captured main Tokio
  handle;
- maps generic session completion into a domain completion input;
- matches exact session and prompt identity;
- returns immediately on the per-session actor runtime; and
- schedules checked SQLite completion on the process/main blocking pool.

API handlers assert workspace auth, map wire/domain shapes, make one runtime
call, and map one typed runtime error. They contain no product validation,
SQL, spawning, session calls, or orchestration. Contract types stop at the API
boundary; private row types stop inside the store.

### 7.3 Composition

```text
Db::open -> migrations
  -> WorkflowRunStore
  -> WorkflowRunService
  -> synchronously fence interrupted run + step rows
  -> WorkflowRunSessionExtension(service, main Tokio handle)
  -> existing SessionRuntime(extension list)
  -> WorkflowRunRuntime(service, SessionRuntime, operation gate, main handle)
  -> AppState.workflow_run_runtime
  -> thin PUT / GET handlers
```

`app/workflows.rs` performs construction only. Wiring is intentionally
two-phase because the workflow extension exists before `SessionRuntime`, while
the completed `SessionRuntime` is injected into `WorkflowRunRuntime`.

### 7.4 Rust and concurrency rules

- Domain JSON-object-like maps use deterministic forms such as `BTreeMap`.
- Statuses and failure codes are enums with stable storage/wire strings; no
  control flow depends on error text.
- `AcceptOutcome::{Created, ExactReplay, Conflict}` and transition no-ops are
  structured `Ok` outcomes. Infrastructure failures are errors.
- Every synchronous workflow-store call from async code runs through
  `spawn_blocking`.
- `WorkflowRunRuntime` owns that boundary for PUT, GET, and execution; the
  extension uses its captured main-runtime handle.
- Synchronous durable session creation is also offloaded.
- No SQLite connection, transaction, mutex guard, or workspace lease moves
  into blocking work or survives an unrelated await.
- No `SessionRuntime` call occurs while a workflow transaction is held.
- Private `&Connection` row helpers compose one transaction; public store
  methods do not recursively acquire `Db`.
- Domain-meaningful timestamps are minted by service/runtime; store-owned
  `updated_at` is bookkeeping.
- Public use cases have one tracing span with run/workspace IDs. Logs exclude
  prompts, arguments, credentials, provider responses, and raw error chains.
- The one execution task has one outer `Result` boundary, no
  `unwrap`/`expect`, and one guarded failure write.
- No task registry, JoinSet, workflow mailbox, or in-memory retry system is
  introduced. Process death or panic is handled by the next startup fence.
- Completion terminalizes run and step atomically, may fill a null `turn_id`,
  and treats a later same-turn write as idempotent. Correlation mismatch is a
  typed no-op; terminal rows never change.

### 7.5 Growth discipline

- Multiple prompt/goal steps extend `WorkflowRunRuntime`; runtime files split
  only when another execution concern exists.
- A second concrete step kind earns the later shared step-dispatch seam.
- Placement/takeover adds durable claims in its own slice.
- Grants and required tools extend stage/session launch inputs through existing
  session-extension and MCP composition seams.
- Cloud and automation call the same PUT API.
- Parallel lanes earn durable lane identity and a live coordinator only when
  real concurrent execution exists.

None of those future seams are created in this PR.

## 8. Verification

### 8.1 Contract and HTTP

- strict nested shape, UUID, workspace ID, and one-stage/one-step cardinality;
- input declaration, argument type, missing/undeclared argument, template, and
  rendered-prompt validation;
- PUT `201`, replay `200`, mismatch `409`, GET, and missing `404`;
- GET embeds step `(stageIndex: 0, stepIndex: 0)` without transcript/actor
  projection;
- ordinary runtime bearer behavior without direct-attach expansion; and
- OpenAPI plus generated SDK artifacts.

### 8.2 Real AnyHarness SQLite

- run and pending step commit atomically;
- step identity is `(run_id, stage_index, step_index)` with no run cursor;
- exact replay includes workspace ID, definition, and arguments;
- concurrent identical acceptance yields one `Created` and all other results
  `ExactReplay`;
- concurrent changed acceptance yields one winner and conflicts for mismatches;
- transition guards and terminal immutability;
- duplicate/late completion and completion-before-turn-ID races;
- later terminal runs may reuse a historical `session_id`;
- wrong or missing prompt ID, wrong session ID, and conflicting turn ID do not
  mutate rows;
- no hash, failure-message, stop-reason, or event-sequence columns;
- non-FK correlation IDs remain after external artifact deletion;
- file-backed reopen fences nonterminal run and step rows;
- fencing failure prevents AppState and HTTP startup; and
- generated schema snapshot matches migrations.

### 8.3 Ownership and concrete runtime

- contract types do not cross `api/http`; row types do not escape the store;
- `WorkflowRunService` has no `SessionRuntime`, Tokio, actor, or API dependency;
- only `WorkflowRunRuntime` calls `SessionRuntime` for workflows;
- workflow code imports no wire `PromptInputBlock`;
- async workflow SQLite calls execute on the blocking pool;
- completion returns immediately on the per-session runtime and hands durable
  work to the main runtime;
- AnyHarness dependency and old-path ratchets remain green;
- the supplied workspace is reused without directory, Git, workspace-record,
  display-name, or worktree creation;
- exactly one new normal session is created in that workspace;
- ordinary workspace access and shared session-start lease are enforced;
- `session_id` is persisted before startup;
- arguments resolve into the prompt with deterministic prompt/turn
  correlation;
- immediate failures persist only stable codes;
- exact replay invokes no execution effect twice; and
- tests use real AnyHarness fixtures, not a mock executor port.

### 8.4 Real acceptance journey

```text
boot isolated AnyHarness with an existing workspace
  -> PUT definition + arguments + workspaceId
  -> poll GET terminal
  -> assert completed run + step
  -> correlate workspace/session/prompt/turn with session events
  -> inspect assistant output through session API
  -> replay identical PUT
  -> prove no workspace creation and no second step/session/prompt/turn
```

The live-agent journey remains Tier 3. Replay, concurrency, lifecycle,
restart, and failure safety are merge-gated with real SQLite and controlled
AnyHarness fixtures.

## 9. Definition of done

The slice is complete only when:

- both routes and strict contracts are generated and documented;
- canonical `invocation_json` is the only replay authority;
- one new normal session executes exactly one resolved prompt in the supplied
  workspace;
- identical replay is side-effect free and mismatch conflicts;
- GET remains useful after terminal completion and external artifact deletion;
- prompt/session/turn correlation, completion races, duplicate callbacks, and
  restart fencing are proven;
- failure persistence is stable-code-only and secret-safe;
- focused merge-gated tests pass;
- the real Tier 3 journey passes with captured evidence; and
- the diff contains no Cloud, Desktop, scratch, takeover, cancellation,
  cleanup, workflow actor/manager, scheduler, retry, generalized executor, or
  premature future-feature framework.
