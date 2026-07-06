# Analytics dashboards v1 — business economics, support, retention, errors

Status: **live but incomplete.** Code shipped in PR #973 (open, unreviewed
as of this writing). Infra is provisioned and partially running in prod.
Two human actions are outstanding (Sentry token, E2B cookie refresh), one
merge is outstanding, and one self-hosting cleanup has not been started.
This document supersedes `specs/tbd/dashboards-analytics-ingestion.md` (kept
in place as the original design record) as the operational reference — read
this one first.

## 1. Executive summary

This system computes business metrics — revenue, cost of serving, support
throughput, retention, and error rates — for internal use by Proliferate the
company, and renders them as five Metabase dashboards. It deliberately does
**not** reuse in-product billing code as its source of truth: instead a
standalone nightly ingestion job pulls directly from each provider's own API
(Stripe, AWS Cost Explorer, E2B, Sentry) and writes daily snapshot rows into
a dedicated `analytics` Postgres schema, which is the only schema a
read-only Metabase Postgres role can see. Two more views blend those
snapshots against pre-existing usage-tracking tables (`client_daily_activity`,
`support_report`) to produce cost-of-serving and retention metrics.

Current status: four of five dashboards have real data (Economics, Support,
Retention, At-a-Glance); the fifth (Errors) is structurally built but empty
because no real-org Sentry token exists yet. The nightly ingestion job is
provisioned in AWS but **will fail every night** (`ModuleNotFoundError`)
until PR #973 merges, because the scheduled ECS task already runs against
the prod server image and that image doesn't contain
`proliferate.analytics.provider_ingest` yet. E2B's session-cookie credential
has already expired once (confirmed via a live 401) and needs a manual
refresh — this is a recurring operational chore, not a one-time fix. And
separately from all of the above, a self-hosting concern surfaced mid-build:
the ingestion script and its infra docs currently live inside locations that
read as core, shippable product rather than "this company's own internal ops
tooling," and one line of code has this company's personal AWS/E2B account
identifier baked in as a default. That cleanup has **not** happened yet.

## 2. Architecture

```
 Stripe API      AWS Cost Explorer     E2B tRPC billing.getUsage     Sentry stats_v2 API
 (invoices,      (ce:GetCostAndUsage,  (unofficial, session-cookie   (SENTRY_ANALYTICS_TOKEN,
  subscriptions)  90-day daily/svc)     auth, e2b.dev)                 SENTRY_ORG)
      |                  |                      |                          |
      v                  v                      v                          v
 +----------------------------------------------------------------------------+
 |         proliferate/analytics/provider_ingest.py  ::  run()                |
 |   4 independent async provider functions; each is fetched, upserted,       |
 |   committed, and rolled back on failure INDEPENDENTLY of the others        |
 |   (server/proliferate/analytics/provider_ingest.py:506-534, _run_provider) |
 +----------------------------------------------------------------------------+
      |  (SQLAlchemy AsyncConnection -> prod RDS Postgres, DATABASE_URL secret)
      v
 +----------------------------------------------------------------------------+
 |  Postgres schema `analytics` (alembic 15649bf2cf24, on top of a9b0c1d2e3f4)|
 |                                                                            |
 |  base tables (written directly by the job):                               |
 |    stripe_revenue_daily · stripe_mrr_snapshot · aws_cost_daily ·           |
 |    e2b_cost_daily · sentry_errors_daily                                   |
 |                                                                            |
 |  derived views (computed from the base tables + pre-existing raw tables): |
 |    support_reports_daily · user_activity_daily · retention_weekly_cohorts |
 |    · llm_cost_daily · economics_daily                                     |
 |                                                                            |
 |  pre-existing usage views (alembic a9b0c1d2e3f4, NOT part of this project):|
 |    daily_client_activity · daily_new_users · daily_cloud_workspaces · ... |
 +----------------------------------------------------------------------------+
      |  GRANT USAGE + SELECT to role `metabase_readonly` only on schema `analytics`
      v
 +----------------------------------------------------------------------------+
 |  EC2 SSH tunnel `proliferate-prod-metabase-cloud-tunnel`                    |
 |  (i-01137399d0c9fbdfa) — pre-existing, reused unmodified                    |
 +----------------------------------------------------------------------------+
      v
 +----------------------------------------------------------------------------+
 |  Metabase Cloud — steep-moor.metabaseapp.com                               |
 |  database "Proliferate Analytics" (id 34), connected via metabase_readonly |
 |  5 new dashboards (#68-#72) + 1 archived legacy dashboard (#34)            |
 +----------------------------------------------------------------------------+
```

### Why each hop exists

**Why a dedicated `analytics` Postgres schema, not raw tables.** Metabase's
Postgres user (`metabase_readonly`) is scoped to `USAGE` on schema
`analytics` and `SELECT` on everything in it — nothing else
(`server/alembic/versions/15649bf2cf24_dashboards_provider_ingestion_v1.py:380-391`,
`_grant_metabase_readonly`). This means Metabase can never see raw
application tables (`user`, `cloud_workspace`, Stripe webhook state, etc.),
only whatever is explicitly exposed as an `analytics.*` object. Every metric
a dashboard needs has to be materialized as a view or table in that schema
first — this is why the migration both creates the provider tables/views
*and* grants read access to them in one place.

**Why Stripe/AWS/E2B are fetched from the providers' own APIs, not from
in-product billing state.** The spec's premise (not repeated verbatim here,
per instructions, but reflected in the code) is that business economics
should be computed independently of whatever the in-product billing system
happens to be tracking at any given moment — the in-product billing ledger
answers "what did we charge this customer," not "what did Stripe/AWS/E2B
actually charge us." `provider_ingest.py` calls Stripe's `/v1/invoices` and
`/v1/subscriptions` directly with `settings.stripe_secret_key`
(`provider_ingest.py:66-78`), AWS Cost Explorer directly via `boto3`
(`provider_ingest.py:240-263`), and E2B's own billing endpoint
(`provider_ingest.py:320-405`) — none of these read from Proliferate's own
billing/credits tables.

**Why Metabase Cloud, reused, not a new self-hosted Metabase.** The org
already had a live Metabase Cloud instance
(`steep-moor.metabaseapp.com`, database id `34`) serving the pre-existing
27-card "Proliferate Operating Dashboard," connected to prod RDS through an
already-provisioned SSH tunnel EC2 instance
(`proliferate-prod-metabase-cloud-tunnel`, `i-01137399d0c9fbdfa`). Standing
up a second, self-hosted Metabase on ECS would have meant a second BI tool,
a second set of dashboard permissions, and a second network path into prod
RDS, for zero benefit over pointing the existing instance at a new schema
(`server/infra/analytics/README.md:28-36`).

**Why AWS cost needed a gross/credits split.** AWS Cost Explorer's
`UnblendedCost` metric bakes promotional credits into the same per-service
line items as negative amounts — e.g. a `-$135` credit booked against "AWS
Data Transfer" can net a real compute cost down to ~$0 if you just sum
everything (`provider_ingest.py:298-302`, comment above
`economics_daily`'s definition;
`server/infra/analytics/README.md:107-114`). Summed blindly, this would make
"cost of serving" look artificially cheap on days when credits landed and
artificially expensive on days when they didn't, with no way to tell the
difference. `analytics.economics_daily` therefore reports **gross** AWS
cost (`cost_usd > 0` only) as the cost-of-serving driver, and exposes
`aws_credits_usd` (sum of the negative lines) and `aws_net_usd` (true sum)
as separate columns so credits stay visible without silently hiding real
serving cost
(`server/alembic/versions/15649bf2cf24_dashboards_provider_ingestion_v1.py:298-364`).

## 3. Data model — complete reference

### 3a. Pre-existing usage-tracking objects this project builds on top of

These were **not** created by this project (alembic `a9b0c1d2e3f4`,
2026-05-20, `"metabase analytics storage v1"`) but the new derived views
described in 3c read from them.

**`client_daily_activity`** — the core usage-tracking table.
`server/proliferate/db/models/analytics.py:12-57`.

- Grain: one row per (day, surface, identity) — identity is either
  `actor_user_id` (authenticated) or `anonymous_install_uuid` (anonymous),
  enforced by `ck_client_daily_activity_identity_present`
  (`analytics.py:19-22`).
- Columns: `id`, `activity_date`, `surface` (`desktop`/`web`/`mobile`,
  `ck_client_daily_activity_surface`), `actor_user_id`,
  `anonymous_install_uuid`, `telemetry_mode`, `app_version`, `platform`,
  `route_or_screen`, `created_at`, `last_seen_at`, `received_count`.
- Write path: `POST /analytics/client-daily-activity`
  (`server/proliferate/server/analytics/api.py:18-33`) →
  `record_client_daily_activity` (`server/proliferate/server/analytics/service.py:16-42`,
  requires `anonymous_install_uuid` when unauthenticated) →
  `upsert_client_daily_activity`
  (`server/proliferate/db/store/analytics.py:26-82`), a Postgres
  `INSERT ... ON CONFLICT DO UPDATE` keyed on a **partial unique index**:
  `(activity_date, surface, actor_user_id)` where `actor_user_id IS NOT
  NULL`, or `(activity_date, surface, anonymous_install_uuid)` where
  `actor_user_id IS NULL AND anonymous_install_uuid IS NOT NULL`
  (`analytics.py:23-38`). Each ping after the first same-day ping increments
  `received_count` and bumps `last_seen_at` rather than inserting a new row.
- Read by: this project's `analytics.user_activity_daily` and
  `analytics.retention_weekly_cohorts` (3c); the pre-existing
  `analytics.daily_client_activity` view (below).

**Pre-existing `analytics.*` usage views** (alembic
`a9b0c1d2e3f4_metabase_analytics_storage_v1.py:69-303`), for context — these
are what the archived Operating Dashboard queried, and what the new
"At a Glance" overview reuses instead of re-deriving:

| View | Source | Grain |
| --- | --- | --- |
| `analytics.daily_client_activity` | `client_daily_activity` | (day, surface) — activity rows, distinct auth/anon users, pings |
| `analytics.daily_desktop_installs` | `anonymous_telemetry_install` | (day, telemetry_mode, platform) — new desktop installs |
| `analytics.daily_anonymous_usage` | `anonymous_telemetry_event` | (day, surface, telemetry_mode) — sessions/prompts/workspaces from anonymous telemetry payloads |
| `analytics.daily_new_users` | `"user"` | (day) — signups |
| `analytics.daily_cloud_workspaces` | `cloud_workspace` | (day, owner_scope) — created/archived counts |
| `analytics.daily_cloud_sessions` | `cloud_sessions` | (day, agent_harness, status) |
| `analytics.daily_sandboxes` | `cloud_sandbox` | (day, provider, status) |
| `analytics.daily_automation_activity` | `automation` / `automation_run` | (day, target, status, trigger) — conditionally created only if the expected column exists (`_has_column` guard, `a9b0c1d2e3f4:213-224`) |
| `analytics.daily_mcp_activity` | `cloud_mcp_connection_event` | (day, catalog_entry, event_type) |
| `analytics.daily_mobility_activity` | `cloud_workspace_mobility_event` | (day, direction, event_type) |

Three of these (`daily_mobility_activity`, `daily_cloud_sessions`,
`daily_mcp_activity`) are the ones behind the archived Operating Dashboard's
dead cards — see §6.

### 3b. New provider snapshot tables (alembic `15649bf2cf24`)

All five are plain **tables**, not views, because they're populated by an
external batch job (`provider_ingest.py`) rather than derived in-database
from another table
(`server/alembic/versions/15649bf2cf24_dashboards_provider_ingestion_v1.py:42-44`).
Creation is idempotent via a `_has_table(..., schema="analytics")` guard
(lines 36-39) so re-running `upgrade()` is a no-op.

**`analytics.stripe_revenue_daily`** — 1 row per day.

```sql
CREATE TABLE analytics.stripe_revenue_daily (
    activity_date DATE NOT NULL,
    gross_collected_cents BIGINT NOT NULL DEFAULT 0,
    paid_invoice_count INTEGER NOT NULL DEFAULT 0,
    currency VARCHAR(8) NOT NULL DEFAULT 'usd',
    updated_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (activity_date)
);
```
(`15649bf2cf24:48-73`.) Populated from Stripe `/v1/invoices` where
`status=paid`, bucketed by the UTC date of `status_transitions.paid_at`
(falling back to `created` if `paid_at` is absent),
`gross_collected_cents` summing `amount_paid`
(`provider_ingest.py:120-177`). Read by Economics and At-a-Glance.

**`analytics.stripe_mrr_snapshot`** — 1 row per day (one snapshot per
ingestion run, keyed on "today").

```sql
CREATE TABLE analytics.stripe_mrr_snapshot (
    captured_date DATE NOT NULL,
    mrr_cents BIGINT NOT NULL DEFAULT 0,
    arr_cents BIGINT NOT NULL DEFAULT 0,
    active_subscriptions INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (captured_date)
);
```
(`15649bf2cf24:75-90`.) Populated by summing normalized monthly amounts
across all `active`/`trialing` Stripe subscriptions
(`provider_ingest.py:180-221`); `_monthly_normalized_amount`
(`provider_ingest.py:103-117`) converts yearly/weekly/daily recurring
prices to a monthly-equivalent amount (`ARR = MRR * 12`, computed directly,
not independently derived). Read by Economics and At-a-Glance.

**`analytics.aws_cost_daily`** — 1 row per (day, service).

```sql
CREATE TABLE analytics.aws_cost_daily (
    activity_date DATE NOT NULL,
    service VARCHAR(128) NOT NULL,
    cost_usd NUMERIC(18,6) NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (activity_date, service)
);
```
(`15649bf2cf24:92-106`.) Populated from AWS Cost Explorer
`get_cost_and_usage` (`UnblendedCost`, `Granularity=DAILY`,
`GroupBy=[{"Type":"DIMENSION","Key":"SERVICE"}]`, trailing 90 days,
`us-east-1`) via `boto3` on a thread (`provider_ingest.py:240-312`). Can
contain negative `cost_usd` rows for credit line items — see the gross/net
split in §2. Read by `economics_daily` (only `cost_usd > 0` rows) and
Economics' "AWS Cost by Service" chart.

**`analytics.e2b_cost_daily`** — 1 row per day.

```sql
CREATE TABLE analytics.e2b_cost_daily (
    activity_date DATE NOT NULL,
    cpu_hours NUMERIC(18,6) NOT NULL DEFAULT 0,
    ram_gib_hours NUMERIC(18,6) NOT NULL DEFAULT 0,
    price_cpu_usd NUMERIC(18,6) NOT NULL DEFAULT 0,
    price_ram_usd NUMERIC(18,6) NOT NULL DEFAULT 0,
    sandbox_count INTEGER NOT NULL DEFAULT 0,
    total_cost_usd NUMERIC(18,6) NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (activity_date)
);
```
(`15649bf2cf24:108-151`.) Populated from E2B's internal (unofficial) tRPC
`billing.getUsage` endpoint using a captured browser session cookie —
`total_cost_usd = price_for_cpu + price_for_ram`
(`provider_ingest.py:320-405`). See §4 for freshness status.

**`analytics.sentry_errors_daily`** — 1 row per (day, project, release).

```sql
CREATE TABLE analytics.sentry_errors_daily (
    activity_date DATE NOT NULL,
    project VARCHAR(128) NOT NULL,
    surface VARCHAR(64),
    release VARCHAR(255) NOT NULL DEFAULT '',
    error_count BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (activity_date, project, release)
);
```
(`15649bf2cf24:153-174`.) Populated from Sentry's `stats_v2` API,
`category=error`, grouped by `project`+`outcome` (only `outcome IN (None,
"accepted")` kept), `release` always written as `''` (not currently broken
out by release despite the column existing) (`provider_ingest.py:413-498`).
Currently **zero real rows** — see §4/§7.

### 3c. New derived views (over existing raw tables and the new base tables)

All created with `CREATE OR REPLACE VIEW`
(`15649bf2cf24:194-364`), so they're safe to re-run.

**`analytics.support_reports_daily`** — source `support_report`.

```sql
CREATE VIEW analytics.support_reports_daily AS
SELECT
    (created_at AT TIME ZONE 'UTC')::date AS activity_date,
    kind,
    count(*) FILTER (WHERE status IN ('uploading', 'completed')) AS submitted_count,
    count(*) FILTER (
        WHERE status = 'completed'
        AND (tracker_status = 'completed' OR github_status = 'completed' OR linear_status = 'completed')
    ) AS resolved_count
FROM support_report
GROUP BY (created_at AT TIME ZONE 'UTC')::date, kind;
```
Grain: (day, kind) where `kind` is `bug` or `feature` (the latter being
Submit-a-Prompt). Read by the Support & Submit-a-Prompt dashboard and
At-a-Glance's "Open Bugs" / "Submit-a-Prompt submitted" tiles.

**`analytics.user_activity_daily`** — source `client_daily_activity`.

```sql
CREATE VIEW analytics.user_activity_daily AS
SELECT DISTINCT actor_user_id, activity_date
FROM client_daily_activity
WHERE actor_user_id IS NOT NULL;
```
Grain: one row per (authenticated user, day). This is the retention join
target — anonymous activity is excluded because retention cohorts key off
`"user".id`. Read by Retention & Cohorts and At-a-Glance ("New Users 7d",
"Weekly Active Users").

**`analytics.retention_weekly_cohorts`** — sources `"user"` +
`client_daily_activity`.

Computes, per signup cohort (`cohort_week = date_trunc('week',
user.created_at)`), the count of distinct users still active in each
subsequent week (`weeks_since = floor((activity_week - cohort_week)/7)`),
divided by the cohort's original size, as `retention_pct`. Full SQL at
`15649bf2cf24:227-281`. Grain: (cohort_week, weeks_since). Read by
Retention & Cohorts' curve and cohort table.

**`analytics.llm_cost_daily`** — source `agent_llm_usage_event`.

```sql
CREATE VIEW analytics.llm_cost_daily AS
SELECT (occurred_at AT TIME ZONE 'UTC')::date AS activity_date, provider, model,
    coalesce(sum(cost_usd), 0) AS cost_usd,
    coalesce(sum(total_tokens), 0)::bigint AS tokens,
    count(*) AS requests
FROM agent_llm_usage_event
GROUP BY (occurred_at AT TIME ZONE 'UTC')::date, provider, model;
```
Grain: (day, provider, model). Currently returns **zero rows** in prod — see
§8 for why (this is a pre-existing, unrelated feature-flag gap, not a bug in
this view). Read by Economics.

**`analytics.economics_daily`** — sources the four provider tables above
plus `agent_llm_usage_event` directly. One row per day, `UNION`-ing every
date that appears in *any* of the four sources so a day with, say, only AWS
data still shows up (missing sources `coalesce`d to 0). Columns:
`stripe_gross_collected_cents`, `aws_cost_usd` (gross, `cost_usd > 0` only),
`aws_credits_usd` (negative-lines-only sum), `aws_net_usd` (true sum),
`e2b_cost_usd`, `llm_cost_usd`, `total_cost_usd` (= `aws_cost_usd +
e2b_cost_usd + llm_cost_usd` — **gross** AWS, not net), `net_cents` (=
Stripe gross minus `total_cost_usd` in cents). Full SQL at
`15649bf2cf24:303-364`. Read by Economics and At-a-Glance ("Cost of Serving
30d", "Net 30d").

Note: `server/infra/analytics/bootstrap.sql:76-93` contains an **older**
version of `economics_daily` without the gross/credits/net split (just
`aws_cost_usd` as a straight sum) — this was the version manually applied to
prod on 2026-07-05 before the gross/net split was added to the migration.
The migration's `CREATE OR REPLACE VIEW` will overwrite it with the
gross/net version once PR #973 deploys; until then, prod is running the
older, unsplit definition. `bootstrap.sql` itself has not been updated to
match — see the file's own note that it's "kept the same shape as the
migration" (`README.md:118-125`), which is now slightly stale for this one
view.

## 4. The ingestion job — complete walkthrough

Module: `server/proliferate/analytics/provider_ingest.py`. Entry point:
`python -m proliferate.analytics.provider_ingest` → `main()` → `run()`
(lines 521-550).

`run()` iterates the four providers in a fixed order — `stripe`, `aws_cost`,
`e2b`, `sentry` — calling `_run_provider(name, conn, coro)` for each
(`provider_ingest.py:521-534`). `_run_provider` (lines 506-518) is the
isolation mechanism: it `await`s the provider coroutine, commits on success,
and on **any** exception logs it (`logger.exception`) and rolls back the
connection — then `run()` moves on to the next provider regardless. This
means a Stripe outage never blocks AWS/E2B/Sentry from updating, and vice
versa. The summary dict returned by `run()` (`{provider: rows_upserted}`) is
printed by `main()`.

**Stripe** (`ingest_stripe`, lines 224-232). Skips with a warning if
`settings.stripe_secret_key` is unset. Two sub-jobs share one `httpx`
client: `_ingest_stripe_revenue` (paid invoices, 90-day lookback,
`STRIPE_LOOKBACK_DAYS = 90` at line 44) and `_ingest_stripe_mrr` (all
active/trialing subscriptions, normalized to MRR). Status: **healthy** —
uses the same `stripe_secret_key` config the rest of the app already relies
on.

**AWS Cost Explorer** (`ingest_aws_cost`, lines 266-312). Runs
`boto3.client("ce", region_name="us-east-1").get_cost_and_usage(...)` on a
thread (`asyncio.to_thread`), 90-day lookback (`AWS_COST_LOOKBACK_DAYS = 90`,
line 51), paginating via `NextPageToken`. Any exception is caught at the
top level (`except Exception: logger.exception(...); return 0`) — the
broadest of the four providers' error handling. Status: **healthy** —
confirmed working via the manual bootstrap and the verified-facts freshness
check below.

**E2B** (`ingest_e2b`, lines 320-405). Reads `E2B_SESSION_COOKIE` from the
environment; skips with a warning if unset. Calls the unofficial tRPC
endpoint `E2B_API_BASE = "https://e2b.dev/api/trpc/billing.getUsage"` (line
46) with `Cookie: <cookie>`, team slug from `E2B_TEAM_SLUG` env var or
**`DEFAULT_E2B_TEAM_SLUG = "pablo-5391"` (line 47)** if unset. A `401`
response, an `httpx.HTTPError`, or a non-JSON body are all treated as "skip
this run, log a warning, don't fail the job" (lines 338-350) — the intended
degradation mode for an expiring cookie. Status: **the cookie is currently
expired**, confirmed via a live HTTP 401 against the E2B tRPC endpoint at
the time this doc was written. It was working as of 2026-07-05 (bootstrap
populated 120 days of history, ~$360 lifetime cost) but has since expired;
expiry window is documented as hours-to-days
(`server/infra/analytics/README.md:78-101`). This needs a **manual,
recurring** refresh (steps in §5).

**Sentry** (`ingest_sentry`, lines 413-498). Reads `SENTRY_ANALYTICS_TOKEN`
and `SENTRY_ORG` from the environment; skips with a warning if either is
unset. Calls `stats_v2` with `category=error`, `interval=1d`,
`field=sum(quantity)`, `groupBy=[project, outcome]`, `statsPeriod=90d`.
Status: **not configured at all** — neither env var is set in the
`proliferate/prod/analytics-ingest` secret today. The only Sentry
credential available during the build was a throwaway test org (`test-9mk`)
which 401s against the real org (`o4510721919025152`); no real-org token has
been minted or provided yet.

**Freshness snapshot (as verified, not stale):**

| Provider | Table | Freshest data | Health |
| --- | --- | --- | --- |
| Stripe | `stripe_revenue_daily`, `stripe_mrr_snapshot` | current (job/bootstrap ran) | healthy |
| AWS | `aws_cost_daily` | 2026-07-05 (one day stale as of now) | job hasn't run successfully since the manual backfill — see §5, blocked on PR #973 merge |
| E2B | `e2b_cost_daily` | 2026-07-05 bootstrap (120 days, ~$360 lifetime) | session cookie expired (confirmed 401); no new data until refreshed |
| Sentry | `sentry_errors_daily` | none — 0 rows | no real-org token configured |

## 5. Infrastructure — complete inventory

AWS account `157466816238`, region `us-east-1`
(`server/infra/analytics/README.md:3`). All files below live in
`server/infra/analytics/` (see §7 for why that location itself is flagged).

**ECS task definition** — `ecs-taskdef.json`. Family
`proliferate-analytics-ingest`, Fargate, `cpu=512`, `memory=1024`, image
`157466816238.dkr.ecr.us-east-1.amazonaws.com/proliferate-server:36554c4b06cc`
(the shared server image — this job runs the same container as the main
app, just with a different command), command `["python", "-m",
"proliferate.analytics.provider_ingest"]`. Execution role
`proliferate-prod-ecs-execution` (shared). Task role
`proliferate-prod-analytics-ingest-task`. Injects 5 secrets from Secrets
Manager as env vars: `DATABASE_URL`, `JWT_SECRET`, `STRIPE_SECRET_KEY`,
`E2B_SESSION_COOKIE`, `E2B_TEAM_SLUG`. Logs to CloudWatch log group
`/ecs/proliferate-analytics-ingest`.

**IAM task role policy** — `iam-task-role-policy.json`:

```json
{"Version":"2012-10-17","Statement":[
 {"Sid":"CostExplorer","Effect":"Allow","Action":["ce:GetCostAndUsage","ce:GetCostForecast"],"Resource":"*"},
 {"Sid":"Secrets","Effect":"Allow","Action":["secretsmanager:GetSecretValue"],"Resource":[
   "arn:aws:secretsmanager:us-east-1:157466816238:secret:proliferate/prod/analytics-ingest-*",
   "arn:aws:secretsmanager:us-east-1:157466816238:secret:proliferate/prod/database-*",
   "arn:aws:secretsmanager:us-east-1:157466816238:secret:proliferate/prod/server-app-*"
 ]}
]}
```

**IAM scheduler role policy** — `iam-scheduler-policy.json`:

```json
{"Version":"2012-10-17","Statement":[
 {"Effect":"Allow","Action":["ecs:RunTask"],"Resource":["arn:aws:ecs:us-east-1:157466816238:task-definition/proliferate-analytics-ingest:*"]},
 {"Effect":"Allow","Action":["iam:PassRole"],"Resource":[
   "arn:aws:iam::157466816238:role/proliferate-prod-ecs-execution",
   "arn:aws:iam::157466816238:role/proliferate-prod-analytics-ingest-task"]}
]}
```

**EventBridge Scheduler** — `proliferate-analytics-ingest-nightly`. **State:
ENABLED.** Cron `0 9 * * ? *` UTC (9am UTC daily). Target
(`eventbridge-target.json`): ECS `RunTask` on cluster `proliferate-prod`,
task-definition-arn `.../proliferate-analytics-ingest:2`, `TaskCount: 1`,
Fargate, subnets `subnet-09207f5ce65ea006c` / `subnet-0608c451bf16b6913`,
security group `sg-043efce5792a8ce80`, `AssignPublicIp: ENABLED`. Scheduler
role `proliferate-analytics-ingest-scheduler`.

**This schedule fires and fails every night right now.** It's ENABLED, it
runs against the prod server image, and that image (as of the last build,
`36554c4b06cc`) does not contain `proliferate.analytics.provider_ingest` —
that module only ships once PR #973 merges and a new image is built and this
task definition is (re-)registered against it. Each nightly run currently
exits with `ModuleNotFoundError: No module named 'proliferate.analytics'`
(`server/infra/analytics/README.md:16-26`).

**Secrets (AWS Secrets Manager):**

| Secret | Keys | Notes |
| --- | --- | --- |
| `proliferate/prod/analytics-ingest` | `E2B_SESSION_COOKIE`, `E2B_TEAM_SLUG` | analytics-specific; needs periodic manual refresh |
| `proliferate/prod/database` | `DATABASE_URL` | shared with the main app |
| `proliferate/prod/server-app` | `JWT_SECRET`, `STRIPE_SECRET_KEY` | shared with the main app; `JWT_SECRET` pulled in only because `proliferate.config.Settings` requires it to construct, not because the job uses it |

**Manual invocation** (for testing without waiting for the schedule):

```
aws ecs run-task \
  --cluster proliferate-prod \
  --task-definition proliferate-analytics-ingest \
  --launch-type FARGATE \
  --network-configuration '{"awsvpcConfiguration":{"subnets":["subnet-09207f5ce65ea006c","subnet-0608c451bf16b6913"],"securityGroups":["sg-043efce5792a8ce80"],"assignPublicIp":"ENABLED"}}'
```

**Metabase Cloud** — `steep-moor.metabaseapp.com`, database "Proliferate
Analytics" (id `34`), connects to prod RDS through the pre-existing SSH
tunnel EC2 `proliferate-prod-metabase-cloud-tunnel`
(`i-01137399d0c9fbdfa`) using the `metabase_readonly` Postgres role.

**DB access pattern / anti-pattern flag.** During this build, direct ad-hoc
queries and one-off `aws ecs run-task` invocations were used against the
prod RDS instance and prod ECS cluster to bootstrap and verify data (e.g.
the manual 2026-07-05 `bootstrap.sql` application). This is flagged in
Claude's cross-session memory as `reference-prod-adhoc-ecs-antipattern` — a
note-to-self for future sessions that ad-hoc prod ECS/DB access, while it
worked here, is a pattern to be wary of repeating rather than a sanctioned
practice. **This has not been fixed or replaced with a safer mechanism as
part of this project** — it's a flagged concern for future work, not a
resolved item. Do not read this section as "the access pattern was
corrected."

## 6. The dashboards

All five live in Metabase Cloud database id `34`, documented in
`server/infra/analytics/metabase-dashboards.md`. The pre-existing 27-card
"Proliferate Operating Dashboard" is a separate, older dashboard — see the
archival note below.

1. **Proliferate — At a Glance (overview)** (dashboard #72). Scalar tiles:
   New Users 7d, Weekly Active Users, New Cloud Workspaces 7d, New Desktop
   Installs 7d (last two from the pre-existing usage views, not this
   project), Errors 7d (`sentry_errors_daily`), Open Bugs
   (`support_reports_daily`, `kind='bug'`), MRR (`stripe_mrr_snapshot`),
   Cash Collected 90d (`stripe_revenue_daily`), Cost of Serving 30d /
   Net 30d (`economics_daily`), Submit-a-Prompt submitted
   (`support_reports_daily`, `kind='feature'`). Trend lines: New Users
   daily, Cost of Serving by Provider daily, Weekly Active Users.

2. **Economics — Revenue & Cost of Serving** (dashboard #68). Scalars: Cash
   Collected 90d, MRR, ARR, Active Subscriptions
   (`stripe_mrr_snapshot`/`stripe_revenue_daily`), Cost of Serving 30d, AWS
   Cost of Serving 30d (gross), E2B Cost 30d, LLM Cost 30d, AWS Credits
   Applied 30d. Charts: Daily Cost of Serving by Provider, E2B Daily Cost,
   AWS Cost by Service (gross only), MRR Over Time. AWS figures throughout
   use gross cost, never net — see §2/§3c.

3. **Support & Submit-a-Prompt** (dashboard #69). Scalars: Bugs Submitted,
   Bugs Resolved, Bug Resolution Rate, Submit-a-Prompt Submitted,
   Submit-a-Prompt Resolved — all from `support_reports_daily` split by
   `kind`. Charts: submitted-vs-resolved trend line, by-kind bar chart.

4. **Retention & Cohorts** (dashboard #70). Weekly Retention Curve and
   Retention Cohorts table (`retention_weekly_cohorts`). New Users by Week,
   Weekly Active Users (`user_activity_daily`).

5. **Errors (Sentry)** (dashboard #71). Errors 7d, Errors by Day, by
   Project, by Release — all from `sentry_errors_daily`. **Structurally
   built but currently empty** — no real-org Sentry token exists yet (§4,
   §10).

**Archived: "Proliferate Operating Dashboard" (dashboard #34).** The
pre-existing 27-card usage dashboard was audited during this project. 7 of
its 24 real cards (3 cards are headers/text, not queries) were found to be
dead: they queried `daily_mobility_activity`, `daily_cloud_sessions`, and
`daily_mcp_activity` — three of the pre-existing usage views from
`a9b0c1d2e3f4` (§3a) — which no longer exist against the live schema.
Confirmed by direct live API calls against those views, which returned
`Table ... is inactive` and `relation ... does not exist` errors. The
dashboard was **archived** (moved to Metabase's trash — reversible, not
deleted) rather than repaired in place, because the Users/activity
information it carried is now covered by the new "At a Glance" overview
(#72) plus Retention & Cohorts (#70).

## 7. The self-hosting problem — UNRESOLVED

Proliferate is public, open-source, and self-hosted by enterprises running
their own instance of this exact server codebase. Anything that ships
inside the installed `proliferate` Python package or that AGENTS-level docs
present as core infrastructure gets treated by self-hosters as "part of the
product I'm running" — not as "internal tooling belonging to the company
that maintains this repo." A self-hosted enterprise has no Proliferate-the-
company Stripe account, AWS account, or E2B team, so a script that assumes
those specific accounts (and worse, defaults to a specific person's account
slug) is actively harmful noise in their install, and a hardcoded personal
identifier baked into a public repo is also just not something that should
exist regardless of packaging.

**The exact problem, confirmed by direct inspection right now:**

- `server/proliferate/analytics/provider_ingest.py:47`:
  ```python
  DEFAULT_E2B_TEAM_SLUG = "pablo-5391"
  ```
  This is a personal/company-specific E2B account slug hardcoded as a code
  default. It's only overridden if the `E2B_TEAM_SLUG` env var is set
  (`provider_ingest.py:327`) — a self-hosted deployment that ran this module
  without setting that env var would silently query *this company's* E2B
  team slug as a URL parameter (harmlessly failing on auth, since they also
  wouldn't have the cookie — but the identifier still shouldn't be there).

- The ingestion script lives at `server/proliferate/analytics/` — inside
  the installed, shippable `proliferate` package
  (`server/proliferate/analytics/__init__.py`, `provider_ingest.py`) —
  rather than `server/scripts/`, which is this repo's existing convention
  for company-specific one-off/ops tooling (e.g.
  `server/scripts/mint_pro_promo_codes.py`, a Stripe promo-code minting
  script gated on `STRIPE_API_KEY` with no product-code dependency, and
  `server/scripts/provision_password_auth_user.py`). Anything under
  `server/proliferate/` is part of the product that ships and runs for
  every deployment, self-hosted or not; `server/scripts/` is explicitly
  *not* part of the running server, it's a company operator's toolbox.

- The infra documentation and provisioning artifacts
  (`ecs-taskdef.json`, `iam-task-role-policy.json`,
  `iam-scheduler-policy.json`, `eventbridge-target.json`, `bootstrap.sql`,
  `README.md`, `metabase-dashboards.md`) live under `server/infra/analytics/`
  — sibling to `server/infra/self-hosted-aws/` and `server/infra/main.tf`,
  i.e. positioned as if it were part of the self-hosting-relevant
  infrastructure surface, when it's exclusively about this one company's
  own Metabase/AWS/Stripe/E2B accounts and has nothing to do with what a
  self-hosting enterprise would ever need to provision.

**The fix (not yet done):**

1. Move `server/proliferate/analytics/provider_ingest.py` (and its
   `__init__.py`) out of the installed package into `server/scripts/`,
   following the `mint_pro_promo_codes.py` convention — a standalone script
   invoked directly by the operator/CI, not a module of the shipped
   `proliferate` package.
2. Delete the `DEFAULT_E2B_TEAM_SLUG = "pablo-5391"` default entirely; make
   `E2B_TEAM_SLUG` a required environment variable (raise/skip clearly if
   unset, the way `settings.stripe_secret_key` and
   `SENTRY_ANALYTICS_TOKEN`/`SENTRY_ORG` already do) rather than silently
   falling back to a specific person's account.
3. Relocate `server/infra/analytics/` to a location that doesn't read as
   self-hosting-relevant infra — e.g. somewhere under `server/scripts/` or
   a clearly-labeled internal-ops directory outside `server/infra/`.

None of this has happened. The migration (`15649bf2cf24`), the `analytics`
schema, and the Metabase dashboards themselves are not implicated by this
problem — they're internal-only artifacts anyway (a self-hosted Metabase
would just never be pointed at this schema). The problem is specifically
the script's package location and the hardcoded default, plus the infra
docs' folder placement.

## 8. The LLM/Bedrock cost gap — full root-cause explanation

Economics shows **LLM Cost 30d as $0** right now. This is real, and the
root cause is fully understood and is *not* a bug introduced by this
project — it's a pre-existing feature flag that happens to be off.

**The two-gate architecture:**

- **Gate 1 — is the LiteLLM proxy service even deployed?** Controlled by
  the GitHub Actions variable `LITELLM_DEPLOY_ENABLED`, consumed by
  `.github/workflows/_deploy-litellm.yml:15` (comment: `set "true" once the
  RDS + ECS service exist`) and gating the `deploy-litellm` job in both
  `deploy-staging.yml:215` and `promote-production.yml:185`
  (`enabled: ${{ needs.plan.outputs.litellm == 'true' }}`). This gate is
  about whether the *proxy infrastructure itself* gets deployed/updated by
  CI.
- **Gate 2 — does the running server actually consume LLM usage data from
  the proxy?** Controlled by `agent_gateway_enabled: bool = False`
  (`server/proliferate/config.py:348`), which defaults to `False` when the
  `AGENT_GATEWAY_ENABLED` env var is unset. This flag gates whether
  `start_agent_gateway_usage_import()` starts its background loop at all
  (`server/proliferate/server/cloud/agent_gateway/worker.py:98-104`: `if
  not settings.agent_gateway_enabled: return None`) — that startup call
  happens from the app lifespan at `server/proliferate/main.py:213`. This
  is the loop that pages LiteLLM spend logs into `agent_llm_usage_event`,
  the table `analytics.llm_cost_daily` and `economics_daily` both read.

**What's actually true right now, confirmed by direct inspection:**

- The LiteLLM proxy service (`proliferate-prod-litellm`, ECS) **is
  running**: 1/1 healthy tasks, created 2026-07-03.
- Bedrock models **are correctly configured** in
  `server/litellm/config.yaml` (Claude Sonnet/Opus/Haiku/Fable variants on
  `bedrock/us.anthropic.*` and `bedrock/global.anthropic.*` model IDs,
  `aws_region_name: os.environ/AWS_BEDROCK_REGION`).
- `agent_llm_usage_event` has **0 rows** in prod.
- AWS Cost Explorer reports **genuine $0 spend** on every Bedrock service
  line for the last 90 days, queried directly, and **zero Bedrock
  CloudWatch log groups exist** — meaning no Bedrock model has ever
  actually been invoked in this AWS account. This isn't "usage happened but
  wasn't imported" — it's "usage has never happened."
- Root cause, confirmed by directly inspecting the live ECS task definition
  for `proliferate-prod-server` (the currently-running revision):
  `AGENT_GATEWAY_ENABLED` **does not appear anywhere** among its 83
  environment variables or 18 secrets. Since the config default is `False`
  (`config.py:348`), the entire agent-gateway usage-import loop never
  starts on the live server — which is exactly consistent with zero rows in
  `agent_llm_usage_event` and zero real Bedrock invocations.

So: the capability is built (proxy running, models configured, importer
code exists and works when enabled) but the consuming flag is off on the
live server. The Economics dashboard's "LLM Cost: $0" is therefore
completely accurate and self-explanatory — it doesn't need any further
"why" than "the gateway isn't turned on yet."

**This document explicitly does not recommend flipping
`AGENT_GATEWAY_ENABLED`.** Turning it on activates real Bedrock model
routing, real spend, and real budget/credit enforcement for every agent
session server-wide — that's a product/business decision for a human to
make deliberately, not something to do as a side effect of wanting better
dashboard data.

## 9. Coordination with issue-autofix-system-v1

A separate, unrelated in-flight project — `issue-autofix-system-v1` — builds
per-issue lifecycle automation (Sentry issue → autofix attempt → PR) and is
architecturally disjoint from this project (aggregate daily business metrics
vs. per-issue state machine; no shared tables, no shared views, no code
overlap). Reconciling the two surfaced exactly two coordination points,
which are accurately summarized here (the source spec section itself was
not modified, per instructions):

1. **Sentry token scope reuse.** Both projects need a Sentry API credential
   against the real org (`o4510721919025152`), not the throwaway test org
   (`test-9mk`) used during this build. Rather than minting two separate
   tokens, the org token that eventually gets created should have scopes
   covering *both* this project's `stats_v2`/error-count read needs
   (`SENTRY_ANALYTICS_TOKEN`/`SENTRY_ORG`, §4) *and* the autofix system's
   future per-issue ingestion needs, minted once.

2. **ECS-scheduled-task pattern reuse.** This project's deployment shape —
   EventBridge Scheduler → Fargate `RunTask` + Secrets Manager-injected
   credentials, using the *shared server image* with a different command
   (§5) — is the reference pattern the autofix system's future sync jobs
   are expected to copy for their own scheduled work.

**Timing risk, flagged but not yet acted on:** because point 2 means this
project's ECS pattern is about to become a *template* copied into a second
system, the self-hosting cleanup in §7 (script relocation, dropped default,
infra doc relocation) is now higher-stakes than it would otherwise be — an
uncleaned pattern copied once is one instance of the problem; copied twice
is two. There is a real argument for landing the §7 cleanup *before* the
autofix system's sync jobs are scaffolded from this one, rather than after.
That has not happened yet and is not scheduled.

## 10. Current status / what's remaining

### Blocking human actions (only a person can do these)

- **(a) Merge PR #973.** State: open, `mergeable: MERGEABLE`, no review
  decision yet, 1 commit, 11 files changed. Until merged and deployed, the
  nightly EventBridge schedule (`proliferate-analytics-ingest-nightly`,
  ENABLED, fires 9am UTC daily) will continue to fail every single night
  with `ModuleNotFoundError` against the current prod server image.
- **(b) Mint/provide a real-org Sentry token.** Needs `org:read`/stats
  scope against `o4510721919025152`, and per §9, scopes should also cover
  the autofix system's future needs so it's minted once, not twice. Until
  this exists, the Errors dashboard stays empty and Sentry ingestion keeps
  skipping every run.
- **(c) Refresh the E2B session cookie.** Currently expired — confirmed via
  a live 401 against the E2B tRPC endpoint. Refresh steps in
  `server/infra/analytics/README.md:86-98` (log into e2b.dev as the
  `E2B_TEAM_SLUG` account, capture the `e2b_session` cookie from devtools,
  `aws secretsmanager put-secret-value --secret-id
  proliferate/prod/analytics-ingest ...`). **This is a recurring chore, not
  a one-time fix** — the cookie expires again every few hours to a few
  days, with no automated refresh mechanism.
- **(d) Decide whether/when to flip `AGENT_GATEWAY_ENABLED`.** This would
  unblock real LLM cost data flowing into `economics_daily`/`llm_cost_daily`
  (§8), but it's an explicit business/product decision about turning on
  real Bedrock spend and credit enforcement platform-wide — not something
  that should be flipped reflexively just to make a dashboard number
  non-zero.

### Known cleanup work, not yet started

- **The self-hosting reorganization (§7):** move
  `provider_ingest.py`/`__init__.py` from `server/proliferate/analytics/` to
  `server/scripts/`; delete `DEFAULT_E2B_TEAM_SLUG = "pablo-5391"`
  (`provider_ingest.py:47`) and make `E2B_TEAM_SLUG` required; relocate
  `server/infra/analytics/` out of `server/infra/`. Should ideally land in
  PR #973 itself or as a fast-follow **before** the autofix system's sync
  jobs get scaffolded from this project's ECS pattern (§9's timing risk).

### Things that are genuinely done and don't need further action

- The `analytics` schema, all 5 provider tables, all 5 derived views, and
  the `metabase_readonly` grants — designed, migrated, verified idempotent
  (upgrade/downgrade/upgrade cycle tested locally, per
  `specs/tbd/dashboards-analytics-ingestion.md:142-155`).
- The per-provider isolation pattern in `provider_ingest.py` — verified: one
  provider failing doesn't block the others, re-running the job twice
  produces identical row counts (idempotent upserts).
- Stripe ingestion — healthy, using existing app config, no outstanding
  action.
- AWS Cost Explorer ingestion — healthy; the gross/credits/net accounting
  split for `economics_daily` is correctly designed and implemented.
- All 5 Metabase dashboards — built and correctly wired to their
  `analytics.*` sources (Errors is correctly built, just waiting on data —
  the dashboard itself needs no further construction work).
- The Operating Dashboard audit and archival — investigated, root-caused (3
  dead source views), archived reversibly; no further action needed on the
  archived dashboard itself.
- The choice to reuse Metabase Cloud instead of self-hosting a second
  instance — settled, documented, no revisit needed.
- IAM policies, ECS task definition, EventBridge schedule config, and
  Secrets Manager wiring — all correctly scoped and provisioned; the *only*
  problem with this infra is (i) it can't run successfully until PR #973
  merges, and (ii) its file locations are implicated in the §7 self-hosting
  cleanup — the actual policy/permission content is correct as-is.

## 11. File index

```
server/alembic/versions/
  a9b0c1d2e3f4_metabase_analytics_storage_v1.py    pre-existing: client_daily_activity table +
                                                    10 pre-existing analytics.daily_* usage views
  15649bf2cf24_dashboards_provider_ingestion_v1.py this project: 5 provider snapshot tables,
                                                    5 derived views, metabase_readonly grants

server/proliferate/analytics/
  __init__.py                                      package docstring, points at the tbd spec
  provider_ingest.py                               the ingestion job (4 providers); line 47 has
                                                    the hardcoded team-slug default flagged in §7

server/proliferate/db/models/analytics.py          ClientDailyActivity ORM model (pre-existing)
server/proliferate/db/store/analytics.py           upsert_client_daily_activity (pre-existing write path)
server/proliferate/server/analytics/
  api.py                                           POST /analytics/client-daily-activity (pre-existing)
  service.py                                        record_client_daily_activity (pre-existing)
  models.py                                         request/response schemas (pre-existing)

server/proliferate/config.py                       agent_gateway_enabled default (line 348) — §8
server/proliferate/main.py                         starts the usage-import loop (line 213) — §8
server/proliferate/server/cloud/agent_gateway/worker.py  gates the loop on agent_gateway_enabled — §8
server/litellm/config.yaml                          LiteLLM proxy's Bedrock model routing config

server/infra/analytics/
  README.md                                        operational writeup: why Metabase Cloud, the
                                                    metabase_readonly constraint, secrets, schedule,
                                                    E2B cookie refresh chore, AWS cost accounting note
  metabase-dashboards.md                            catalog of all 5 dashboards + which analytics.*
                                                    object backs each card
  bootstrap.sql                                     idempotent DDL applied directly to prod 2026-07-05
                                                    (slightly stale economics_daily vs. the migration)
  ecs-taskdef.json                                  Fargate task def for the ingestion job
  iam-task-role-policy.json                         Cost Explorer read + scoped Secrets Manager read
  iam-scheduler-policy.json                          ecs:RunTask + iam:PassRole for the scheduler role
  eventbridge-target.json                            EventBridge Scheduler's ECS RunTask target config

server/scripts/
  mint_pro_promo_codes.py                          existing example of the server/scripts/ convention
                                                    that provider_ingest.py should move to follow (§7)
  provision_password_auth_user.py                  another existing example of the same convention

specs/tbd/dashboards-analytics-ingestion.md          original design-record spec (superseded/expanded
                                                    by this document; kept as historical record)
specs/tbd/issue-autofix-system-v1.md                 §10 of that spec is the coordination source for §9
                                                    of this document (not modified here)
```
