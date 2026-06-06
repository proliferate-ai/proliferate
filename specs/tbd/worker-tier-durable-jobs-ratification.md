# Worker Tier Durable Jobs Ratification

Status: ratified implementation plan for the first worker-tier durable-jobs
slices. This document resolves the draft-only decisions in
`worker-tier-scalability-rfc.md` and `worker-tier-migration-catalog.md`.

This is not a behavior-change spec by itself. It is the review law for the next
worker-tier implementation PRs until the relevant pieces are promoted out of
`specs/tbd/`.

## Decisions

1. **RabbitMQ is the Celery broker.** Redis must not be used as the broker for
   durable jobs.
2. **Celery owns task execution, retry, routing, priority, and ack semantics.**
   Domain logic remains in server services; task functions are thin shells.
3. **Redis is ancillary.** It is allowed for redbeat scheduler state, locks,
   rate limits, and metrics. It is not the worker-control doorbell owner and is
   not the Celery broker.
4. **Worker-control doorbells stay owned by the control-loop.** Celery tasks
   that mutate worker-visible state bump Postgres control state and use the
   existing after-commit worker-control publish path.
5. **Use redbeat for scheduler HA in the first implementation.** Do not build a
   custom leader-elected Beat until redbeat has failed a concrete deployment
   requirement.
6. **No Redis result backend by default.** Jobs write durable outcomes to
   Postgres domain tables. Add a Celery result backend only for a named
   operational need.
7. **Use prefork Celery workers with `asyncio.run(...)` task wrappers.** Keep
   the existing async SQLAlchemy service layer. Do not introduce sync database
   sessions for Celery tasks.
8. **Transactional outbox gates broker-delivered domain work.** Any task whose
   enqueue must be consistent with a state mutation must be inserted through an
   outbox row in the same caller-owned transaction.
9. **No broad outbox before explicit session ownership.** A domain can move to
   outbox-backed tasks only after the touched stores/services accept a caller
   owned `AsyncSession` and do not self-commit in the relevant path.
10. **No temporary bespoke loop-lift by default.** In-process FastAPI lifespan
    loops should move to Beat-fired periodic tasks once the Celery skeleton is
    ready. A separate dedicated-loop process is allowed only as an emergency
    production brake with its own rollback plan.
11. **Worker-visible mutations need a distributed wake story.** A Celery task
    that mutates command, target, exposure, or projection state must not rely on
    the current process-local `PubSubBus` for cross-process immediate wake. Its
    PR must either land the shared Redis/NATS worker-control pub/sub transport
    first, or explicitly accept and test timeout-only wake behavior.

## Target Package Shape

```text
server/proliferate/background/
  celery_app.py
  config.py
  beat_schedule.py
  relay.py
  tasks/
    __init__.py
    health.py
```

Implementation notes:

- `celery_app.py` creates the single Celery app and imports configuration.
- `config.py` owns broker URLs, queue names, routing, retry defaults, and
  redbeat settings derived from `Settings`.
- `beat_schedule.py` owns periodic schedule registration only.
- `relay.py` owns outbox-to-Celery publication once the outbox slice exists.
- `tasks/**` modules call domain service functions. They do not contain
  business logic or SQLAlchemy queries.

## Queue And Task Naming

Initial queue names:

| Queue | Purpose |
| --- | --- |
| `periodic.default` | Beat-fired lightweight periodic passes. |
| `default` | General on-demand jobs without a specialized lane yet. |
| `notifications` | Loose-consistency outbound notifications. |
| `runtime.wake` | Managed-runtime wake and similar runtime-control jobs. |
| `automations.execution` | Cloud automation execution tasks. |

Task names use `domain.action`:

- `background.health.noop`
- `notifications.send_slack`
- `runtime.wake_target`
- `automations.execute_run`
- `billing.reconcile_pass`
- `support.reconcile_tracker`

Queue additions require the owning PR to state the isolation reason and the
expected workload.

## Ordered Implementation Slices

### Slice 1: Infrastructure Skeleton

Add the `background/` package, Celery config, redbeat config, local/dev env
documentation, and a no-op task. This slice must not move business work.

Requirements:

- update `specs/codebase/structures/server/README.md` and the background guide to
  ratify `server/proliferate/background/**` before adding the package

Verification:

- import Celery app in tests without connecting to RabbitMQ
- assert task names/routes for the no-op task
- repo shape and server lint

### Slice 2: Outbox Foundation

Add a Postgres outbox table, store helpers, and a relay shell. The relay may
publish only the no-op task or a test task until a real domain path is ready.

Requirements:

- outbox rows are inserted in caller-owned transactions
- publication is idempotent on a stable outbox/job id
- relay crash before/after publish is covered by tests
- duplicate publish does not duplicate domain effects

### Slice 3: Loose-Consistency Notification Task

Move one Slack notification fire-and-forget path to Celery. This proves Celery
configuration with low consistency risk. It may enqueue directly if the PR
explicitly documents why loss/duplication is acceptable for that notification.

### Slice 4: Runtime Wake Or Worktree Cleanup

Move the first correctness-sensitive fire-and-forget path behind the outbox.
Candidate: managed-runtime wake. The PR must prove that the state mutation and
task enqueue cannot split.

### Slice 5: First Periodic Reconciler

Move one in-process FastAPI lifespan reconciler to a Beat-fired task. The task
must call an existing service pass function or extract one before moving.

### Slice 6: Automations Execution

Move cloud automation execution to one idempotent Celery task per run. Keep
stage execution internal to the task initially; do not introduce a Celery chain
until stage-level retry isolation has a measured need.

## Workload Gate Checklist

Before moving a real workload, the implementation PR must fill in this checklist
for that workload:

| Workload | Minimum gate |
| --- | --- |
| Signup Slack notification | Direct enqueue is allowed if duplicate and failed delivery are acceptable and observable. |
| Customer.io desktop-auth side effects | Direct enqueue is allowed only after the auth transaction commits and the task uses stable event/idempotency keys. |
| Support diagnostics and immediate tracker kicks | Use outbox when report state depends on completion; otherwise direct enqueue must be backed by the periodic tracker reconciler. |
| Runtime wake | Outbox-backed enqueue plus the distributed worker-control wake decision from Decision 11. |
| Deferred worktree cleanup | Outbox-backed enqueue if tied to policy state; otherwise a Beat reconciler may own cleanup discovery. |
| Cloud workspace provisioning | Outbox-backed enqueue; provisioning must be idempotent on workspace/provisioning run id. |
| Automations execution | Outbox-backed enqueue from run creation; task idempotent on `run_id`. |
| Periodic reconcilers and telemetry | Beat-fired tasks; no outbox unless the pass materializes on-demand work. |

## Backward Compatibility And Deletion Plan

- Old in-process loops and fire-and-forget paths remain until their replacement
  task has tests and deployment wiring.
- Do not run old and new executors for the same job family unless the PR proves
  idempotency and names the duplicate-handling owner.
- Delete the old path in the same PR that enables the new path for a job
  family, or gate it with an explicit temporary feature flag and removal PR.

## Failure-Injection Requirements

Every PR that moves real work must include at least one failure-oriented test
for that workload:

- duplicate task delivery
- worker crash before ack
- relay crash after publish
- broker outage with outbox backlog
- scheduler failover for Beat-fired work

The no-op skeleton slice is exempt from workload failure tests but must include
configuration/route tests.

## First Implementation Hand-Off

The next implementation agent should do **Slice 1 only**:

1. Read this ratification, the server background guide, and deployment env-var docs.
2. Add `server/proliferate/background/**` with a Celery app and no-op task.
3. Update server structure docs for the new `background/**` top-level package.
4. Add settings/env documentation for RabbitMQ, Celery worker queues, Redis
   redbeat, and local dev.
5. Add tests that import the app and assert the no-op route without requiring a
   live broker.
6. Do not move billing, runtime, automation, telemetry, Slack, or support work
   in Slice 1.

## Non-Goals

- Moving cloud-worker command delivery to RabbitMQ.
- Replacing external desktop/local executor claim APIs.
- Changing billing, runtime lifecycle, or automation semantics while adding
  the job substrate.
- Adding a custom scheduler, custom broker, or custom queue primitive.
