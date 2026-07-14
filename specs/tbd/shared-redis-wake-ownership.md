# Shared Redis/Wake Ownership Decision

Status: draft

Current gap: the Worker-control doorbell and revision system ratified here was
removed and is not current behavior.

Date: 2026-06-05.

## Decision

The worker control-loop owns the worker-control doorbell semantics.

`server/proliferate/server/cloud/live/domain/channels.py` owns the logical
`worker-control:{target_id}` channel name, and
`server/proliferate/integrations/pubsub/**` owns the transport adapter behind
the shared `PubSubBus` contract. The current implementation is process-local;
a real shared Redis/NATS adapter is required before API horizontal scaling or
multi-process API workers rely on immediate wake delivery.

The worker-tier durable-jobs migration conforms to this decision. It may use
the same Redis deployment for redbeat, distributed locks, and rate limits, but
it does not own or redefine the worker-control doorbell. RabbitMQ remains the
Celery broker. Redis is ancillary, not the job broker.

## Ownership Boundaries

| Surface | Owner | Redis/Wake Role |
| --- | --- | --- |
| Worker control long-poll wake | Cloud worker control-loop | Lossy pub/sub doorbell; durable truth is Postgres worker-control revision. |
| Cloud live/SSE fanout | Cloud live service | Uses the same `PubSubBus` integration contract and logical channel module. |
| Durable background jobs | Worker-tier / Celery | RabbitMQ broker; Redis only for redbeat, locks, and rate limits. |
| Managed runtime wake job | Worker-tier durable-job candidate | Durable task that may change command/target state; it bumps control revision and publishes the control doorbell after commit. |
| Command delivery to target worker | Cloud worker control API | External-pull HTTP control API; not a Celery task queue. |

## Transport Contract

The doorbell is a lossy wakeup:

- publish only after the database transaction commits
- payload is advisory and may be empty except for debugging fields such as
  reason/revision
- `control/wait` must re-read Postgres after every wake or timeout
- missing or duplicated publishes are acceptable because the worker replays by
  cursor/revision
- no DB session may be held while parked on the pub/sub wait

The current in-process bus is acceptable only with timeout fallback and a
single API process/task. Production scaling beyond that requires replacing the
adapter behind `get_pubsub_bus()` with a shared backend before treating
immediate wake as reliable.

## Namespace Rules

Logical channel names stay centralized in
`server/proliferate/server/cloud/live/domain/channels.py`. A real Redis adapter
must add environment/app namespace outside the domain channel helpers so product
code does not hand-roll deployment prefixes.

Worker-tier Redis keys must use separate namespaces from live/control pub/sub,
for example:

- redbeat scheduler metadata
- distributed locks
- rate-limit buckets

Do not place Celery task identity, task payloads, or task result truth in the
worker-control channel namespace.

## Sequencing

1. The worker control-loop completion can proceed using the existing
   `PubSubBus` contract, `worker_control_channel`, and after-commit publish
   helper.
2. If that completion needs stronger immediate wake guarantees before API
   horizontal scaling, implement the shared Redis/NATS pub/sub adapter in the
   control-loop track.
3. Worker-tier durable jobs may later configure Redis for redbeat/locks/rate
   limits, but must not move RabbitMQ broker responsibilities or
   worker-control doorbell ownership into the job system.
4. When a Celery task changes worker-visible command, target, exposure, or
   projection state, it must use the same store/service bump and
   `publish_worker_control_after_commit` path as request handlers.

## Review Law

- Control-loop PRs must not introduce a second worker wake channel outside
  `worker_control_channel`.
- Worker-tier PRs must not use Redis as the Celery broker.
- Worker-tier PRs must not make durable task delivery depend on lossy pub/sub.
- Runtime wake jobs are durable tasks; worker-control wakes are notifications
  that tell long-poll waiters to re-check durable state.
