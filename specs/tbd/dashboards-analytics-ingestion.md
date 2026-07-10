# Dashboards: provider-cost analytics ingestion (v1)

Status: implemented (alembic `15649bf2cf24`, `server/scripts/analytics_ingest.py`,
infra provisioned in AWS + Metabase Cloud). See
`server/infra/analytics/README.md` and `server/infra/analytics/metabase-dashboards.md`
for the full operational writeup; this doc is the design record.

## Problem

Metabase talks to Postgres through a read-only role, `metabase_readonly`, that
can only read the `analytics` schema — never raw application tables. Product
usage metrics already have `analytics.*` views (alembic `a9b0c1d2e3f4`). This
doc covers the second half: business economics (Stripe revenue/MRR, AWS cost,
E2B cost, Sentry errors) and a few cross-cutting views (support triage,
retention, blended unit economics) that don't have a source-of-truth table to
view over — they need their own ingestion.

## Metabase: Cloud, not self-hosted

We reuse the existing **Metabase Cloud** instance
(`steep-moor.metabaseapp.com`, database "Proliferate Analytics", id `34`)
rather than standing up a self-hosted Metabase on ECS. It was already live
for this org (with the pre-existing 27-card "Proliferate Operating
Dashboard"), so there was no reason to run our own instance. It connects to
prod RDS through the existing SSH tunnel EC2,
`proliferate-prod-metabase-cloud-tunnel` (`i-01137399d0c9fbdfa`), using the
`metabase_readonly` role described below. Any earlier assumption in this doc
about a self-hosted/ECS-hosted Metabase is superseded by this.

## Schema objects (alembic `15649bf2cf24`)

### Provider snapshot tables (written by the ingestion job)

| Table | Grain | Notes |
| --- | --- | --- |
| `analytics.stripe_revenue_daily` | 1 row/day | `gross_collected_cents` from paid invoices, by UTC date of `paid_at` (falls back to `created`). |
| `analytics.stripe_mrr_snapshot` | 1 row/day | MRR/ARR/active-subscription snapshot, captured once per run for "today". Yearly/weekly/daily recurring prices are normalized to a monthly amount. |
| `analytics.aws_cost_daily` | 1 row/(day, service) | Unblended cost from Cost Explorer, `GroupBy SERVICE`, trailing 90 days. |
| `analytics.e2b_cost_daily` | 1 row/day | Sandbox CPU/RAM usage and cost from E2B's (unofficial) billing tRPC endpoint. |
| `analytics.sentry_errors_daily` | 1 row/(day, project, release) | Error counts from Sentry's `stats_v2` API. `release` defaults to `''` when not broken out by release. |

All five are plain tables (not views) because they're populated by an
external batch job rather than derived from another Postgres table.

### Derived views (over existing raw tables)

| View | Source | Purpose |
| --- | --- | --- |
| `analytics.support_reports_daily` | `support_report` | Daily submitted/resolved counts by `kind` (bug/feature). "Resolved" = `status='completed'` and any of tracker/github/linear status = `'completed'`. |
| `analytics.user_activity_daily` | `client_daily_activity` | One row per (user, day) for authenticated activity — the join target for retention. |
| `analytics.retention_weekly_cohorts` | `"user"` + `client_daily_activity` | Weekly cohort retention: `cohort_week` (from `user.created_at`), `weeks_since` signup, `active_users`, `cohort_size`, `retention_pct`. |
| `analytics.llm_cost_daily` | `agent_llm_usage_event` | Daily LLM cost/tokens/requests by provider+model. Currently 0 rows in most environments (table just added), the view is still valid. |
| `analytics.economics_daily` | the 4 provider tables + `agent_llm_usage_event` | One row per day blending Stripe revenue against AWS+E2B+LLM cost: `total_cost_usd`, `net_cents`. Missing provider data on a given day coalesces to 0. |

### Grants

The migration grants `metabase_readonly`:
- `USAGE` on schema `analytics`
- `SELECT` on all current tables/views in `analytics`
- default `SELECT` privileges for anything created in `analytics` later

The grant step first checks `pg_roles` for `metabase_readonly` and no-ops if
it's absent (e.g. local dev), so the migration is safe everywhere.

## Ingestion job

`server/scripts/analytics_ingest.py` (company ops tooling, deliberately not in
the installed `proliferate` package), run as:

```
E2B_TEAM_SLUG=<team-slug> uv --directory server run python scripts/analytics_ingest.py
```

Each provider is its own async function, called independently from `run()`;
one provider raising does not stop the others (caught, logged, and the
connection is rolled back for just that provider's work). `main()` prints a
per-provider row-upserted summary.

- **Stripe** — `settings.stripe_secret_key` (same config the app's Stripe
  client already uses). Pulls paid invoices over a 90-day trailing window and
  upserts `stripe_revenue_daily`; separately pulls active/trialing
  subscriptions and upserts one `stripe_mrr_snapshot` row for today. Skips
  (with a warning) if the key isn't configured.
- **AWS Cost Explorer** — `boto3` `ce` client, `us-east-1`, `GroupBy SERVICE`,
  `DAILY` granularity, trailing 90 days. Uses whatever AWS credential chain
  boto3 finds (env vars, shared credentials file, or an IAM role in ECS).
  Any failure is caught and logged; the job continues.
- **E2B** — reads `E2B_SESSION_COOKIE` (a captured browser session cookie;
  E2B has no public billing API) and calls the app's internal tRPC
  `billing.getUsage` endpoint for team slug `E2B_TEAM_SLUG` (default
  `pablo-5391`). A 401 or non-JSON response (expired cookie) logs a clear
  warning and skips E2B without crashing the job — this cookie will need
  periodic manual refresh in Secrets Manager.
- **Sentry** — reads `SENTRY_ANALYTICS_TOKEN` and `SENTRY_ORG`; calls
  `stats_v2` for per-project daily error counts. Best-effort: any missing
  config, non-2xx response, or unexpected payload shape logs a warning and
  skips rather than raising.

All upserts use `ON CONFLICT ... DO UPDATE`, so the job is safe to re-run
(verified: running it twice back-to-back produces identical row counts, no
errors).

## Running in production

Runs as a scheduled ECS Fargate task, `proliferate-analytics-ingest`, on
cluster `proliferate-prod`. Schedule is **EventBridge Scheduler**
`proliferate-analytics-ingest-nightly`, `cron(0 9 * * ? *)` UTC (once
daily), via scheduler role `proliferate-analytics-ingest-scheduler` calling
`ecs:RunTask`. Full task def, IAM policies, and the EventBridge target are
checked into `server/infra/analytics/` (`ecs-taskdef.json`,
`iam-task-role-policy.json`, `iam-scheduler-policy.json`,
`eventbridge-target.json`).

Required secrets (via Secrets Manager / task env):

- `DATABASE_URL` — standard app DB connection (`proliferate/prod/database`).
- `STRIPE_SECRET_KEY`, `JWT_SECRET` — from `proliferate/prod/server-app`
  (shared with the app; `JWT_SECRET` is only needed because
  `proliferate.config.Settings` requires it to construct).
- `E2B_SESSION_COOKIE` — E2B dashboard session cookie
  (`proliferate/prod/analytics-ingest`); **expires every few hours to a few
  days** and needs manual refresh (the job degrades gracefully, just
  skipping E2B, when it's stale — see `server/infra/analytics/README.md`
  for the refresh steps).
- `E2B_TEAM_SLUG` — optional, defaults to `pablo-5391`.
- `SENTRY_ANALYTICS_TOKEN`, `SENTRY_ORG` — Sentry API token with
  `org:read` / stats scope. **Not yet configured in prod** — the Sentry
  dashboard is empty until these are added (job skips Sentry, doesn't fail).
- AWS Cost Explorer access via the task's IAM role (`ce:GetCostAndUsage`),
  no separate secret needed.

## Merge-activation caveat

The scheduled task runs the prod server image with
`python /app/scripts/analytics_ingest.py`. That script is only copied into
the image once this PR is merged and deployed (via the Dockerfile's
`COPY server/scripts/ scripts/` line, added in this PR) — until then the
schedule fires nightly and the task exits non-zero because the script isn't
present. Data was bootstrapped once manually on 2026-07-05
(`server/infra/analytics/bootstrap.sql`, applied directly to prod) so the
dashboards weren't empty while this lands. Note the original prod bootstrap
predated the `economics_daily` gross/credits/net column split; the corrected
`bootstrap.sql` in this PR matches the migration, and `alembic upgrade head`
`DROP`s and recreates `economics_daily` on deploy to converge prod.

## Verified locally

- `alembic upgrade head` / `downgrade -1` / `upgrade head` again against a
  local Postgres — schema creation, view creation, and grant no-op (no
  `metabase_readonly` role locally) all succeed; re-running `upgrade head`
  a second time is a clean no-op (idempotent `_has_table` guards).
- `python scripts/analytics_ingest.py` run end-to-end twice
  against local Postgres: Stripe/E2B/Sentry cleanly skip (no local
  credentials configured) and log a warning each; AWS Cost Explorer ran for
  real against the available AWS credentials and upserted 2052
  `aws_cost_daily` rows (90 days x services), identical row count on the
  second run, confirming the upsert is idempotent.
- Spot-checked `analytics.economics_daily` and `analytics.retention_weekly_cohorts`
  return rows with the expected columns.
