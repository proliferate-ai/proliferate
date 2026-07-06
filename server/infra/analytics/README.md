# Analytics ingestion — provisioned production infra

AWS account `157466816238`, region `us-east-1`. This directory documents the
already-provisioned stack backing the Metabase dashboards; the JSON/SQL files
here are the actual artifacts used to provision it (kept for audit/replay,
not consumed by IaC tooling).

## Purpose

A nightly job pulls provider revenue/cost data — Stripe, AWS Cost Explorer,
E2B, Sentry — into the `analytics.*` Postgres schema (see alembic revision
`15649bf2cf24` and `server/scripts/analytics_ingest.py`). Metabase
Cloud reads that schema through a read-only Postgres role and renders the
dashboards described in `metabase-dashboards.md`. The ingestion script lives
under `server/scripts/` (not the installed `proliferate` package) because it
is Proliferate-the-company's own ops tooling, not part of the shipped product
that self-hosters run.

## IMPORTANT: activation caveat

**The nightly schedule is live now, but the job will fail until this PR is
merged and deployed.** The scheduled ECS task runs the *prod server image*
with command `python /app/scripts/analytics_ingest.py` — that script is only
copied into the image once this PR ships (the Dockerfile's
`COPY server/scripts/ scripts/` line and the script itself are both in this
PR). Until then, EventBridge fires on schedule and the task exits non-zero
because the script isn't present.

Data was bootstrapped once manually on 2026-07-05 (see "Bootstrap" below) so
the dashboards aren't empty while this lands.

## Why Metabase Cloud (not self-hosted)

We reused the existing Metabase Cloud instance —
`steep-moor.metabaseapp.com`, database "Proliferate Analytics" (id `34`) —
rather than standing up a self-hosted Metabase on ECS, because it was
already live and already had the operating dashboard for this org. It
connects to prod RDS via the existing SSH tunnel EC2 instance
`proliferate-prod-metabase-cloud-tunnel` (`i-01137399d0c9fbdfa`); no new
network path was built.

## The `metabase_readonly` constraint

Metabase's Postgres user can only read the `analytics` schema — never raw
application tables. This means every metric that a dashboard needs must be
exposed as an `analytics.*` table or view. The migration both creates those
objects and grants `metabase_readonly` `USAGE` on the schema, `SELECT` on
all current objects, and default `SELECT` privileges for anything created in
`analytics` later (best-effort: it's a no-op if the role doesn't exist,
e.g. local dev).

## Ingestion compute

- **ECS Fargate task family**: `proliferate-analytics-ingest` (see
  `ecs-taskdef.json`), cluster `proliferate-prod`.
- **Task role**: `proliferate-prod-analytics-ingest-task` — Cost Explorer
  read (`ce:GetCostAndUsage`, `ce:GetCostForecast`) + Secrets Manager read
  scoped to the three secret prefixes below (see
  `iam-task-role-policy.json`).
- **Command**: `python /app/scripts/analytics_ingest.py` (the image pins
  `proliferate-server:latest`; re-provisioning always picks up the current
  image with the script present).

### Secrets (AWS Secrets Manager)

| Secret | Keys | Notes |
| --- | --- | --- |
| `proliferate/prod/analytics-ingest` | `E2B_SESSION_COOKIE`, `E2B_TEAM_SLUG` | analytics-specific; `E2B_TEAM_SLUG` is required (the job skips E2B if unset — no hardcoded default); cookie needs periodic manual refresh, see below. |
| `proliferate/prod/database` | `DATABASE_URL` | shared with the app. |
| `proliferate/prod/server-app` | `JWT_SECRET`, `STRIPE_SECRET_KEY` | shared with the app; `JWT_SECRET` is pulled in only because `proliferate.config.Settings` requires it to construct, not because the job uses it. |

## Schedule

- **EventBridge Scheduler**: `proliferate-analytics-ingest-nightly`,
  `cron(0 9 * * ? *)` UTC (9am UTC nightly).
- **Scheduler role**: `proliferate-analytics-ingest-scheduler` — `ecs:RunTask`
  on the task definition + `iam:PassRole` for the execution and task roles
  (see `iam-scheduler-policy.json`).
- **Target**: ECS `RunTask` on cluster `proliferate-prod` (see
  `eventbridge-target.json`) — Fargate, subnets
  `subnet-09207f5ce65ea006c` / `subnet-0608c451bf16b6913`, security group
  `sg-043efce5792a8ce80`.

## Known operational chore: E2B session cookie expiry

E2B has no real billing API for our account tier, so `ingest_e2b()` calls the
E2B dashboard's internal tRPC endpoint (`billing.getUsage`) using a captured
browser session cookie (`E2B_SESSION_COOKIE`). **This cookie expires every
few hours to a few days.** When it does, the job logs a warning, skips the
E2B provider, and continues with the others — it never fails the whole run.

To refresh manually:

1. Log into the E2B dashboard (e2b.dev) in a browser as the account tied to
   the `E2B_TEAM_SLUG` team (Proliferate's own E2B team; there is no default —
   the value is set in the secret).
2. Capture the full `e2b_session` cookie value from devtools (Application →
   Cookies) or the request headers of a `billing.getUsage` call.
3. Update the secret:

   ```
   aws secretsmanager put-secret-value \
     --secret-id proliferate/prod/analytics-ingest \
     --secret-string '{"E2B_SESSION_COOKIE":"<cookie>","E2B_TEAM_SLUG":"<team-slug>"}'
   ```

There is no automated refresh; this is a known manual chore until E2B ships
a real billing API or we get a longer-lived token.

Sentry ingestion has the same "missing config → skip, don't fail" pattern
but is currently unconfigured (no `SENTRY_ANALYTICS_TOKEN`/`SENTRY_ORG` in
the secret) — see `metabase-dashboards.md` for the dashboard-level note.

## AWS cost accounting note

AWS Cost Explorer's `UnblendedCost` folds promotional credits in as negative
service line items (e.g. a `-$135` credit booked against "AWS Data
Transfer" can cancel out real compute spend if you just sum everything).
`analytics.economics_daily` reports **gross** AWS cost (`cost_usd > 0`) as
the cost-of-serving driver, and surfaces `aws_credits_usd` / `aws_net_usd`
separately so credits stay visible without hiding the true serving cost.

## Bootstrap

`bootstrap.sql` is the idempotent DDL that was applied directly to prod on
2026-07-05 to stand up the `analytics` schema objects (tables, views,
grants) ahead of this migration landing, so the dashboards had real data to
show immediately. It mirrors the alembic migration's `upgrade()`.

**Divergence note:** the `bootstrap.sql` in this PR is the corrected version,
matching the migration's `economics_daily` (with the `aws_credits_usd` /
`aws_net_usd` gross/credits/net split). The version *originally* applied to
prod on 2026-07-05 predated that split and lacked those two columns, so the
Economics dashboard's credit/net cards errored on prod until the corrected
view was re-applied. The migration's `economics_daily` is a
`DROP VIEW ... CREATE VIEW` (not `CREATE OR REPLACE`) precisely because the
column set changed — so when this PR deploys, `alembic upgrade head` cleanly
replaces whatever view shape is currently on prod. Applying `bootstrap.sql`
again is also safe (it `DROP VIEW IF EXISTS` first). Keep this file and the
migration's `_create_derived_views` in sync when either changes.

## Re-provisioning from scratch

1. Schema objects: run `alembic upgrade head` (via a normal deploy) or apply
   `bootstrap.sql` directly — either is idempotent.
2. IAM: create `proliferate-prod-analytics-ingest-task` with
   `iam-task-role-policy.json` and `proliferate-analytics-ingest-scheduler`
   with `iam-scheduler-policy.json`.
3. Secrets: create `proliferate/prod/analytics-ingest` with
   `E2B_SESSION_COOKIE` + `E2B_TEAM_SLUG` (see refresh steps above); confirm
   `proliferate/prod/database` and `proliferate/prod/server-app` already
   exist (they do, shared with the app).
4. ECS task definition: register `ecs-taskdef.json` (`aws ecs
   register-task-definition --cli-input-json file://ecs-taskdef.json`).
5. EventBridge Scheduler: create `proliferate-analytics-ingest-nightly`
   targeting the task def with `eventbridge-target.json`, cron
   `0 9 * * ? *` UTC.
6. Metabase: point a Metabase Cloud database connection at prod RDS through
   the `proliferate-prod-metabase-cloud-tunnel` SSH tunnel EC2, using the
   `metabase_readonly` Postgres role.

## Run the job manually

```
aws ecs run-task \
  --cluster proliferate-prod \
  --task-definition proliferate-analytics-ingest \
  --launch-type FARGATE \
  --network-configuration '{"awsvpcConfiguration":{"subnets":["subnet-09207f5ce65ea006c","subnet-0608c451bf16b6913"],"securityGroups":["sg-043efce5792a8ce80"],"assignPublicIp":"ENABLED"}}'
```

Tail logs in CloudWatch under `/ecs/proliferate-analytics-ingest`.
