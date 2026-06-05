# Tier B: Worker-Tier Durable Jobs

Status: draft-to-executable migration plan. Start with design ratification.

## Starting Baseline

Start after PR 529 merges. This track is orthogonal to slot removal. It replaces
hand-rolled server background execution with a designed durable job system.

Before either this track or the control-loop track implements Redis-backed wake
delivery, record the shared Redis/wake ownership decision from
`post-529-migration-roadmap.md`. That mini-ratification is narrower than this
track's full Celery/RabbitMQ/redbeat design ratification.

Do not hand an implementation agent only the raw RFC and ask it to code the full
system. First produce a ratified end-state plan for the minimal first slice.

## Docs To Read

- `AGENTS.md`
- `specs/README.md`
- `specs/codebase/structures/server/README.md`
- `specs/codebase/structures/server/guides/workers.md`
- `specs/tbd/worker-tier-scalability-rfc.md`
- `specs/tbd/worker-tier-migration-catalog.md`
- `specs/tbd/cloud-worker-control-loop.md` for Redis/wake coordination
- Relevant domain specs for each migrated job family

## Intended End State

- RabbitMQ is the durable broker.
- Celery owns task execution, routing, retries, and priorities.
- Redis is ancillary: redbeat scheduling locks, rate limits, distributed locks,
  and possibly control-loop doorbells. Redis is not the broker.
- Postgres remains truth.
- Transactional outbox prevents dual-write loss between state changes and task
  publication.
- Consumers are idempotent on stable job ids.
- Reconcilers survive for external-truth drift, not as compensation for internal
  lost work.
- In-process FastAPI lifespan loops and fire-and-forget `asyncio.create_task`
  paths are removed or reduced to safe adapters.

## Owned Files / Surfaces

- New `server/proliferate/background/**` package, if ratified
- Server lifespan startup for existing in-process loops
- Automations worker scheduler/executor paths
- Billing, cloud runtime setup, agent gateway, mobility, support, telemetry
  reconcilers
- Runtime wake, deferred worktree cleanup, Slack notification fire-and-forget
  paths
- Deployment/config for RabbitMQ, Celery workers, beat/redbeat, and Redis usage
- Tests for task idempotency, outbox relay, and failure handling

## Out Of Scope

- External pull APIs such as desktop local executor claims and cloud worker
  command claims, unless a later design explicitly moves them.
- Worker control-loop long-poll implementation, except for shared Redis/wake
  coordination.
- Broad domain behavior changes unrelated to job delivery.

## Migration Slices

1. **Shared Redis/wake ownership slice**
   - Decide and document the doorbell owner, Redis namespace, pub/sub vs redbeat
     relationship, and command-wake/task boundary with the control-loop plan.
2. **Ratify the minimal architecture**
   - Decide package names, broker config, queue names, task naming, retry policy,
     redbeat/leader policy, and result backend stance.
3. **Add infrastructure/config skeleton**
   - Add Celery app, config, test settings, and a no-op task.
   - Add deployment/dev docs without moving business work yet.
4. **Transactional outbox**
   - Add outbox table/store helpers.
   - Add relay process/task with idempotent publication.
5. **Tier 0: lift in-process loops**
   - Move billing, setup monitor, agent gateway, mobility cleanup, support, and
     telemetry out of API lifespan or convert them to beat-fired tasks.
6. **Tier 1: kill fire-and-forget**
   - Runtime wake jobs, deferred worktree cleanup, Slack notifications.
7. **Tier 2: automations execution**
   - Move cloud automation execution to broker-delivered idempotent task per run.
8. **Tier 3: refine reconcilers**
   - Make surviving reconcilers enqueue corrective tasks instead of doing heavy
     work inline.
9. **Cutover**
   - Remove old process entrypoints and lifespan loops once new workers are
     deployed and monitored.

## Data / Contract Changes

Likely additions:

- outbox table
- job id/idempotency columns where a domain lacks them
- deployment variables for RabbitMQ, Celery, Redis/redbeat
- observability events for task lifecycle and DLQ outcomes

## Backward Compatibility And Deletion Plan

Use feature flags or deployment sequencing for the first job families. Do not
run old and new executors for the same job family without idempotency proof and
clear ownership of duplicate handling.

## Verification

- Unit tests for outbox insertion/publication idempotency
- Task retry tests with duplicate delivery
- Domain tests for each moved job family
- Failure injection: worker crash before ack, relay crash after publish,
  duplicate task delivery, scheduler failover
- Server CI
- Deployment smoke in a dev/staging profile

## Risks And Open Questions

- RabbitMQ/Celery deployment and local dev ergonomics need explicit ownership.
- Redbeat vs leader-elected Beat must be chosen.
- Wake delivery overlaps with the control-loop plan.
- Do not let the control-loop track accidentally define durable-job Redis
  ownership by shipping first without the shared mini-ratification.
- Task boundaries for automations stage pipeline need a deliberate decision:
  one idempotent task per run first, or a chain.

## Critique Prompts

Plan critique:

```text
Review the durable job migration plan. Does it avoid a naive broker rewrite? Are
outbox, idempotency, scheduler HA, reconcilers, and deployment sequencing clear?
Are first slices small enough to review? Return findings first.
```

Implementation critique:

```text
Review the durable job implementation. Look for dual-write loss, non-idempotent
consumers, old/new executor duplication, business logic inside task shells,
missing session ownership, and missing failure tests. Return findings first.
```
