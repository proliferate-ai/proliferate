# Portable Invocation and Target Resolution

Status: authoritative implementation contract, revision `1.0`.

Owner: Cloud Workflow invocations and AnyHarness Workflow target resolution.

Read with [`definitions.md`](definitions.md), [`runs.md`](runs.md),
the Server and AnyHarness structure guides, and the repository testing standard.

## Outcome and boundary

Cloud freezes one exact current saved-definition revision, scalar arguments,
placement intent, and managed target into an immutable user-owned invocation.
AnyHarness schema v2 accepts the same portable one-stage/one-prompt meaning,
resolves model, mode, and optional effort against one existing workspace once,
stores the concrete plan before effects, and uses the existing
`WorkflowRunRuntime` to execute it.

This PR proves manual/test transfer. It does not own automated delivery,
background work, target custody, workspace creation/materialization,
cancellation, takeover, UI, Desktop, goals, multiple steps/stages, grants, MCP,
subagents, schedules, retry, recovery, a generalized compiler/resolver, a new
actor/manager/scheduler, or a Cowork refactor.

## Cloud API

```http
GET /v1/workflows/{definitionId}/run-eligibility
PUT /v1/workflow-invocations/{invocationId}
GET /v1/workflow-invocations/{invocationId}
```

`invocationId` is a canonical lowercase hyphenated UUID: parse it and require
its lowercase `8-4-4-4-12` rendering to equal the original path segment.

### Eligibility

```json
{
  "eligible": false,
  "blockers": [{
    "code": "goal_not_supported",
    "path": "stages[0].steps[0].goal",
    "message": "Goals are not supported by the current Workflow runner."
  }]
}
```

Positive is exactly `{ "eligible": true, "blockers": [] }`. Paths use the
bracketed grammar above. Collect all blockers, sorted by `path` then `code`.
Closed codes:

```text
stage_count_not_supported
step_count_not_supported
goal_not_supported
agent_catalog_selection_unavailable
model_catalog_selection_unavailable
effort_catalog_selection_unavailable
default_repository_unavailable
```

Check one stage, one prompt, no goal, current Cloud catalog identity, and an
owner-matched non-deleted default repo. Do not claim target readiness. PUT
reuses this collector and never drops an unsupported field.

### Immutable invocation

Strict create body:

```json
{
  "schemaVersion": 1,
  "workflowDefinitionId": "10000000-0000-4000-8000-000000000001",
  "expectedRevision": 3,
  "arguments": { "ticket": "PROL-123" },
  "target": { "kind": "managedCloud" }
}
```

ID is path-only. `expectedRevision` must equal the current active definition
row; there is no historical revision body. Only `managedCloud` is accepted.

Strict response:

```json
{
  "id": "40000000-0000-4000-8000-000000000001",
  "schemaVersion": 1,
  "workflowDefinitionId": "10000000-0000-4000-8000-000000000001",
  "definitionRevision": 3,
  "title": "Diagnose a ticket",
  "description": "",
  "definition": {
    "inputs": [{ "name": "ticket", "type": "string", "required": true }],
    "stages": [{
      "harnessConfig": {
        "agentKind": "claude",
        "modelSelection": { "kind": "targetDefault" },
        "permissionPolicy": "workflowDefault"
      },
      "steps": [{
        "kind": "agent.prompt",
        "prompt": "Investigate {{inputs.ticket}}"
      }]
    }]
  },
  "arguments": { "ticket": "PROL-123" },
  "placement": {
    "kind": "repositoryWorktree",
    "repoConfigId": "20000000-0000-4000-8000-000000000001"
  },
  "target": { "kind": "managedCloud" },
  "createdAt": "2026-07-14T12:00:00Z"
}
```

No default repo yields `{ "kind": "scratch" }`. No workspace/path/branch,
concrete target model/mode, credential, token, delivery state, or execution
state is exposed. First PUT is `201`; exact replay and GET are `200` with the
stored typed response. Definition changes never mutate it.

## Shared execution contract

Cloud maps an explicit authored model to `{kind: exact, modelId: canonicalId}`
and omission to `{kind: targetDefault}`. Effort requires an exact model.
Permission is always `workflowDefault`; Cloud never chooses `modeId`.

AnyHarness request:

```json
{
  "schemaVersion": 2,
  "workspaceId": "30000000-0000-4000-8000-000000000001",
  "definition": {
    "inputs": [{ "name": "ticket", "type": "string", "required": true }],
    "stages": [{
      "harnessConfig": {
        "agentKind": "claude",
        "modelSelection": { "kind": "exact", "modelId": "claude-sonnet-4-5" },
        "effort": "high",
        "permissionPolicy": "workflowDefault"
      },
      "steps": [{
        "kind": "agent.prompt",
        "prompt": "Investigate {{inputs.ticket}}"
      }]
    }]
  },
  "arguments": { "ticket": "PROL-123" }
}
```

V2 is strict: one stage/prompt, scalar inputs/arguments, no goal, input names
`^[A-Za-z][A-Za-z0-9_]*$`. Consume only exact `{{inputs.name}}`; remaining
`{{`/`}}` rejects. Required and referenced inputs need arguments. Rendering is
one pass: strings verbatim, canonical number scalar, booleans lowercase. Result
is nonblank and <=16,384 UTF-8 bytes. V1 validation/replay remains exact,
including underscore-leading names.

## AnyHarness version boundary

Do not rename or widen the existing v1 components:

```text
PutWorkflowRunRequest
WorkflowRunResponse
WorkflowRun
WorkflowRunStep
WorkflowRunFailureCode
```

Add strict v2 members and separately named operation unions:

```text
VersionedPutWorkflowRunRequest
  = PutWorkflowRunRequest | PutWorkflowRunRequestV2
VersionedWorkflowRunStoredSource
  = WorkflowRunInvocation | WorkflowRunStoredSourceV2
VersionedWorkflowRunResponse
  = WorkflowRunResponse | WorkflowRunResponseV2
```

Dispatch on required integer `schemaVersion` before strict member decode; GET
dispatches from stored version. V2 keeps `run + steps` and adds safe
`resolvedHarness {agentKind, modelId, modeId, effort}`. It never exposes effort
config ID, rendered prompt, launch options, or credentials.

Keep `WorkflowRunFailureCode` exact. V2 run/step use
`WorkflowRunFailureCodeV2 = v1 values + session_config_apply_failed`.

## Portable numbers

V2 accepts finite IEEE-754 binary64/I-JSON numbers and rejects integers outside
`[-9007199254740991, 9007199254740991]`. Replay and prompt scalar rendering use
RFC 8785: `-0` equals `0`; `1`, `1.0`, and `1e0` are equal. Python and Rust own
production canonicalization. TypeScript only parses/validates the shared
fixture and generated types. JSONB or raw `serde_json::Number` equality is not
the contract. V1 is unchanged.

## Target resolution and execution

For a new v2 run before acceptance:

1. Enforce HTTP workspace auth scope.
2. Run `WorkspaceAccessGate::assert_can_mutate_for_workspace`.
3. Read workspace `resolved_workspace_launch_options`.
4. Require the agent and an exact model, or require target `default_model_id`
   to yield one concrete model.
5. In `domains/workflows/resolution.rs`, map `workflowDefault`:
   Claude -> `bypassPermissions`; Codex -> `full-access`.
6. Require that mode in the selected model's mode list; other agents reject.
7. For effort, require the selected exact model's `effort` or
   `reasoning_effort` value and same-key active session control
   `mapping.liveConfigId`; persist `{configId,value}`.
8. Render, validate, and persist source + resolved plan before effects.

Workflow owns the policy. Do not import/edit Cowork. One narrow generic
session/catalog read seam may expose `liveConfigId`; do not move Workflow policy
into sessions/agents or broaden raw launch options.

Resolved plan is exactly:

```text
workspaceId, agentKind, modelId, modeId,
effortConfig: null | {configId,value}, renderedPrompt, promptId
```

Reuse the normal InternalOnly, subagents-disabled session. After start and
before `begin_step`, call `set_live_session_config_option` when effort exists
and require `Applied`. Queued/rejected/missing/other fails run+step as
`session_config_apply_failed` and sends no prompt. Replay never resolves or
executes again.

## Persistence

Postgres:

```text
workflow_invocation
  id uuid primary key
  user_id uuid not null FK user.id on delete cascade
  workflow_definition_id uuid not null, non-FK correlation
  definition_revision integer not null
  title_snapshot text not null
  description_snapshot text not null
  schema_version integer not null, exactly 1
  creation_request_json jsonb not null
  invocation_json jsonb not null
  created_at timestamptz not null default now()
  updated_at timestamptz not null default now()
```

Reparse and RFC-8785-canonicalize stored typed `creation_request_json` for
replay; never use JSONB equality. `invocation_json` is the immutable response
and later delivery payload. This PR adds no delivery/execution status.

AnyHarness keeps `workflow_runs.invocation_json`; replay identity becomes
`(schema_version, canonical invocation_json)`. Add nullable
`resolved_plan_json`, required for v2 and nullable for v1. Do not backfill
guessed v1 resolution.

Register `0061_workflow_runs_v2` in `CUSTOM_FOREIGN_KEY_MIGRATIONS` and use
`run_named_foreign_key_migration`, because steps reference the rebuilt parent.
Copy all rows, allow only v1/v2, require plan for v2, restore FK enforcement,
run `foreign_key_check`, and update schema snapshot. Do not use plain SQL.

## Replay and concurrency

Cloud:

```text
strict request + canonical UUID
  -> acquire_workflow_invocation_acceptance_lock
       pg_advisory_xact_lock(hashtextextended(
         'workflow-invocation:' + invocationId, 0))
  -> global ID lookup
       foreign owner -> 404 workflow_invocation_not_found
       same owner + exact request -> stored 200, no definition read
       same owner + mismatch -> 409
  -> current owned definition + exact revision + eligibility
  -> snapshot and insert -> 201
```

PUT authenticates but does not preload a definition dependency. Service returns
`Created` or `Replay`; HTTP glue chooses status.

AnyHarness:

```text
strict version + canonical source
  -> narrow run-ID gate
  -> exact existing version/source -> 200 without launch lookup
  -> mismatch -> 409
  -> access + resolve + render
  -> atomic run/source/plan/step insert
  -> Created only schedules existing executor
```

Keep lookup through scheduling inside the existing detached,
cancellation-safe `WorkflowRunRuntime::put` handoff. SQLite remains persistent
correctness authority.

## Failure contract

Cloud:

- malformed wire -> existing Pydantic `422`, no row;
- semantic args/nonportable number/noncanonical UUID ->
  `400 invalid_workflow_invocation`;
- definition absent/foreign -> `404 workflow_definition_not_found`;
- stale revision -> `409 workflow_definition_revision_conflict`;
- invocation mismatch -> `409 workflow_invocation_conflict`;
- invocation absent/foreign -> `404 workflow_invocation_not_found`;
- unsupported definition/catalog/repo ->
  `422 workflow_invocation_ineligible` with blockers.

AnyHarness pre-acceptance:

- missing workspace -> `404 WORKSPACE_NOT_FOUND`;
- direct-attach scope -> existing `403 DIRECT_ATTACH_SCOPE_MISMATCH` or
  `DIRECT_ATTACH_FORBIDDEN`;
- blocked/retired -> `409 WORKSPACE_MUTATION_BLOCKED` / `WORKSPACE_RETIRED`;
- access-store failure -> generic `500`;
- unresolved agent/model/mode/effort/mapping/default ->
  `422 WORKFLOW_RUN_TARGET_UNRESOLVABLE`;
- invalid prompt -> existing `400 WORKFLOW_RUN_INVALID`;
- replay mismatch -> existing `409 WORKFLOW_RUN_CONFLICT`.

Never persist/log/return prompts, argument values, credentials, environment,
launch payloads, provider bodies, or raw error chains as error detail.

## Ownership

```text
fixtures/contracts/workflow-portable-execution/v1.json
server/proliferate/db/models/workflows.py
server/proliferate/db/store/workflow_invocations.py
server/proliferate/server/workflows/{api,models,service,access,errors}.py
server/proliferate/server/workflows/domain/invocation.py
server/proliferate/main.py
server/alembic/versions/<revision>_workflow_invocations.py
cloud/sdk/src/{generated/openapi,types/workflows,client/workflows}.ts

anyharness/crates/anyharness-contract/src/v1/workflow_runs.rs
anyharness/crates/anyharness-lib/src/domains/workflows/{model,resolution,service,runtime}.rs
anyharness/crates/anyharness-lib/src/domains/workflows/store/**
anyharness/crates/anyharness-lib/src/domains/sessions/service/launch_options.rs
anyharness/crates/anyharness-lib/src/persistence/{custom_migrations,migrations}.rs
anyharness/crates/anyharness-lib/src/api/http/workflow_runs*.rs
anyharness/crates/anyharness-lib/src/api/workflow_runs_tests.rs
anyharness/sdk/{generated/openapi.json,src/generated/openapi.ts}
```

Existing `/workflows` router owns eligibility. Add `invocations_router` with
prefix `/workflow-invocations` and mount it in `main.py`. Invocation GET uses an
owner-scoped access dependency; PUT must decide replay before definition read.

Server stores own SQL/snapshots, service owns orchestration without SQL/commit,
and API owns transport. Workflow service owns sync validation/persistence;
`WorkflowRunRuntime` owns async sequencing. Cloud regenerates through
`make cloud-client-generate` and adds thin Workflow SDK aliases/methods.
AnyHarness regenerates Rust-owned OpenAPI artifacts only; no handwritten
Workflow SDK wrapper.

## Required proof

- eligibility positive/full blocker matrix and ordering;
- strict Cloud shapes, codes, current revision, snapshots, repo/user isolation;
- real Postgres identical/mismatch/foreign-owner advisory-lock races;
- Python/Rust RFC-8785 fixture and TypeScript fixture/type validation;
- exact v1 component/behavior compatibility and strict v1/v2 dispatch;
- pre-0061 file upgrade, copied rows, schema snapshot, `foreign_key_check`;
- real SQLite races and stored-plan replay without launch lookup;
- exact/default model, Claude/Codex mode, effort mapping, unsupported targets;
- access denial before acceptance;
- effort Applied before step; every other result sends no prompt;
- dropped PUT detached handoff, worker bearer, direct-attach exclusion/scope;
- one session/prompt/turn under replay; and generated OpenAPI/SDK ratchets.

Acceptance:

```text
create eligible definition -> Cloud PUT 201
edit definition/defaults -> exact replay 200 and GET same stored invocation
changed arguments/same UUID -> 409
manually transfer definition+arguments to AnyHarness v2 with existing workspace
-> one normal session completes
change launch defaults -> replay same plan, no second session/prompt/turn
```

Scripted/fake agent execution is sufficient here. Real-agent Tier 3 is later.

## Handoff metadata

| Field | Value |
| --- | --- |
| Spec revision | `1.0` |
| Base SHA | `0eab251fd35d26022165f7f0852db2885a8c4093` |
| Predecessor | PR #1158 |
| Founder approval | 2026-07-14 |
