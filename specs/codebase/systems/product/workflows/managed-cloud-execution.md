# Managed Cloud Workflow Execution

Managed Cloud execution delivers an immutable portable invocation without a
Desktop process. New delivery is controlled by
`WORKFLOW_MANAGED_RUNS_ENABLED`, which defaults off. Disabling the gate blocks
only new delivery; detail/history, observation, and cancellation of existing
work remain available.

## Product API

```text
POST /v1/workflow-invocations/{id}/deliver
POST /v1/workflow-invocations/{id}/cancel
GET  /v1/workflow-invocations/{id}
GET  /v1/workflow-invocations?workflowDefinitionId={id}&cursor={cursor}
```

The detail projection keeps four independent truths: delivery status and
checkpoint, desired state, AnyHarness execution state, and Cloud freshness.
Freshness is derived on read from a durable basis plus `latestObservedAt`; a
proven terminal projection remains live, while an unprovable store replacement
is `target_lost` and never invents a terminal run outcome.

## Custody and checkpoints

`workflow_invocation` remains immutable. Its one
`workflow_managed_execution` row owns generations, checkpoints, safe runtime
projection, and durable non-FK correlations. Target custody is the exact pair
`cloudSandboxId + executionStoreId`; the SQLite-owned execution-store identity
survives process restart and changes with a replacement database.

```text
none -> target_plan_frozen -> target_bound -> workspace_put_started
     -> workspace_ready -> run_put_started -> accepted
```

The frozen plan contains only placement meaning. Repository plans pin the
active Cloud repo environment and its nonempty default branch before effects;
there is no guessed `main` fallback. Workspace success is not checkpointed
until the exact AnyHarness workspace, ordinary `CloudWorkspace`, and active
`managed_cloud` materialization ledger agree on owner, sandbox, and workspace
identity.

`run_put_started` is the response-ambiguity boundary. Cancellation before it
invalidates delivery and creates no run. Cancellation at or after it reconciles
the exact idempotent run PUT, then calls the Workflow cancel endpoint. Cloud
never substitutes direct session cancellation.

## Background execution

Exactly three outbox-delivered task names exist:

```text
workflows.deliver
workflows.observe
workflows.cancel
```

Idempotency keys are `workflow:<operation>:<invocationId>:<generation>`. Each
attempt claims one generation, performs at most one bounded external phase,
then commits a guarded result and one successor. Escaped crashes are broker
retried; duplicate delivery is expected and safe. No managed-execution row lock
or transaction spans E2B or AnyHarness I/O.

Observation accepts only an explicit secret-free run DTO. `stateVersion`
orders projections: higher applies, equal-identical refreshes reachability,
equal-different records an invariant error, and lower is ignored. Prompts,
arguments, transcript data, credentials, response bodies, and arbitrary error
messages are never projected or persisted.

## Operational posture

The capability contract is version 3 and exposes `workflowManagedRuns` from
the same setting used by delivery admission. Older servers default false.
Each relay heartbeat emits fixed-cardinality Workflow outbox depth/oldest-age
gauges plus queued/delivering age, accepted observation age, pending-cancel
age, unreachable/target-lost counts, and equal-version conflict count. Worker
error attempts emit only operation and a bounded safe code; correlation logs
carry invocation ID and generation but never request/response content.

CI also scans the Workflow server tree and rejects imports from the legacy
Cloud command/session/event planes or the public Cloud proxy. Managed delivery
must continue using its typed direct runtime and owned Postgres seams.

Runtime, worker, and Beat use the same image through the background substrate.
This implementation defines no production enablement: hosted exact-image proof
and controlled rollout are qualification work, and production remains a hard
separate approval gate.
