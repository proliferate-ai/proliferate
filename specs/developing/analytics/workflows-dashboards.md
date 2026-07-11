# Workflow Runs — Dashboard Query Definitions

Track 1e (observability) deliverable: checked-in query definitions for the two
dashboards called for in the workflows program (§4 of
`workflows-part-ii-mental-model.md`). These are **not** live-provisioned —
creating the actual Metabase/Grafana dashboards from these queries is an
external ops step (see below). This doc is the source of truth for both
query bodies so the dashboards can be recreated deterministically.

Zero new columns were needed. Every column referenced already exists on
`workflow_run` (migration `e4f7a2b9c6d1` for the base table, plus
`trigger_id`/`scheduled_for` added in `b2d4f6a8c0e1`):

- `created_at` — row insert time (run accepted)
- `scheduled_for` — when a schedule-triggered run was due to fire (null for
  manual/chat/agent/api triggers)
- `delivered_at` — when the run was handed to its execution target (our beat
  latency ends here)
- `started_at` — when the target actually began executing (sandbox/desktop
  wake latency ends here)
- `finished_at` — terminal timestamp (completed/failed/cancelled)
- `status` — `pending_delivery | delivered | running | waiting_approval |
  completed | failed | cancelled`
- `target_mode` — `local | personal_cloud` (maps to "desktop" / "cloud" in
  the dashboard split — there is no literal `cloud`/`desktop` enum value,
  `personal_cloud` is the cloud path and `local` is the desktop path)

## 1. Metabase — successful vs. failed runs over time

Mirrors the existing `analytics.daily_automation_activity` pattern (see
`metabase.md`) but scoped to `workflow_run` terminal outcomes, bucketed daily.

```sql
-- analytics.daily_workflow_run_outcomes
select
    date_trunc('day', finished_at) as day,
    target_mode,
    trigger_kind,
    status,
    count(*) as run_count
from workflow_run
where finished_at is not null
  and status in ('completed', 'failed', 'cancelled')
group by 1, 2, 3, 4
order by 1 desc;
```

Recommended card: stacked bar of `run_count` by `day`, series = `status`,
filterable by `target_mode` and `trigger_kind`. Add a second card computing
the failure rate:

```sql
select
    date_trunc('day', finished_at) as day,
    target_mode,
    count(*) filter (where status = 'failed')::numeric
        / greatest(count(*) filter (where status in ('completed', 'failed')), 1)
        as failure_rate,
    count(*) filter (where status in ('completed', 'failed')) as terminal_count
from workflow_run
where finished_at is not null
group by 1, 2
order by 1 desc;
```

## 2. Grafana — scheduled-start vs. actual-start latency

Two latency legs per the code-validated facts (§11): our beat's delivery
latency (`delivered_at - scheduled_for`) and the execution target's wake
latency (`started_at - delivered_at`), each split by `target_mode` since
cloud sandbox wake and desktop wake have very different tails.

```sql
-- beat latency: how late our scheduler delivers relative to the due time.
-- only meaningful for schedule-triggered runs (scheduled_for is null otherwise).
select
    date_trunc('hour', scheduled_for) as bucket,
    target_mode,
    extract(epoch from (delivered_at - scheduled_for)) as beat_latency_seconds
from workflow_run
where trigger_kind = 'schedule'
  and scheduled_for is not null
  and delivered_at is not null;
```

```sql
-- wake latency: how long the execution target took to actually start
-- running after delivery (sandbox cold start / desktop app wake).
select
    date_trunc('hour', delivered_at) as bucket,
    target_mode,
    extract(epoch from (started_at - delivered_at)) as wake_latency_seconds
from workflow_run
where delivered_at is not null
  and started_at is not null;
```

Recommended Grafana panels: p50/p95/p99 of `beat_latency_seconds` and
`wake_latency_seconds` over time, one series per `target_mode`
(`local` = desktop, `personal_cloud` = cloud). Both queries are safe to run
directly against Postgres via Grafana's Postgres data source — no view
needed, but if a stable Metabase-style view is preferred, wrap each as
`analytics.workflow_run_beat_latency` / `analytics.workflow_run_wake_latency`
following the read-model conventions in `metabase.md`.

## External ops (not done by this change)

Provisioning the actual dashboards is out of repo scope and must happen
by hand in the external tools:

- Metabase Cloud: add `analytics.daily_workflow_run_outcomes` (or the raw
  query above) as a new question/dashboard card under the existing
  automation-activity collection.
- Grafana: add a new Postgres data-source panel using the two latency
  queries above, split by `target_mode`.

Neither of those provisioning steps was performed as part of this change.

## Privacy note

These queries only ever surface ids, timestamps, enum-like columns
(`status`, `target_mode`, `trigger_kind`), and derived numeric latencies —
no `args_json`, `resolved_plan_json`, `step_outputs_json`, or
`error_message` content, consistent with the Privacy Rules in `metabase.md`.
