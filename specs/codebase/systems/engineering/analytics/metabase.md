# Metabase And Durable Analytics Views

Status: current system contract

Metabase is an optional read-only presentation layer over durable analytics
facts in Postgres. Repository law is the checked-in schema, views, ingestion
code, and infrastructure inputs. A dashboard, card, connection, or freshness
state visible in a live Metabase project is operator evidence, not code law.

## Applicability And Data Contract

| Concern | Current behavior |
| --- | --- |
| Deployment modes | Analytics schema migrations apply to local, self-managed, and hosted Server databases. Proliferate's scheduled provider ingestion and Metabase service are hosted operations; self-hosters may attach their own read-only BI client. |
| Source components | Alembic revisions `a9b0c1d2e3f4` and `15649bf2cf24`, `server/scripts/analytics_ingest.py`, and checked-in artifacts under `server/infra/analytics/`. |
| Identity and data | Daily aggregate product activity; anonymous install counts; user UUID activity/cohorts; workspace/session/sandbox/automation/MCP/mobility aggregates; support counts; provider cost/revenue/error snapshots. |
| Destination | The `analytics` Postgres schema, then an operator-configured BI client using a schema-scoped read-only role. |
| Enable, disable, or no-op | Migrations create views wherever their source tables exist. Grants are best effort when `metabase_readonly` exists. Provider ingestion runs only when explicitly scheduled/invoked and skips a provider whose configuration is absent or unavailable. |
| Privacy and replay | Analytics views must not expose prompts, transcripts, repo names, file paths, raw URLs, terminal text, raw errors, access/refresh tokens, or secrets. Metabase does not collect replay. |
| Known gap | Dashboard/card definitions are not checked in, so repository state cannot prove live dashboard presence, correct filters, connection health, or freshness. E2B cost ingestion currently depends on a short-lived dashboard session cookie and an unofficial endpoint. Sentry ingestion does not group by release, so its stored `release` value is currently empty. |

## Durable Product Views

Revision `a9b0c1d2e3f4` owns these views:

```text
analytics.daily_client_activity
analytics.daily_desktop_installs
analytics.daily_anonymous_usage
analytics.daily_new_users
analytics.daily_cloud_workspaces
analytics.daily_cloud_sessions
analytics.daily_sandboxes
analytics.daily_automation_activity
analytics.daily_mcp_activity
analytics.daily_mobility_activity
```

`daily_automation_activity` is created only when the migration recognizes the
current execution-target columns in both automation tables.

Revision `15649bf2cf24` owns provider snapshot tables and derived views:

```text
analytics.stripe_revenue_daily
analytics.stripe_mrr_snapshot
analytics.aws_cost_daily
analytics.e2b_cost_daily
analytics.sentry_errors_daily
analytics.support_reports_daily
analytics.user_activity_daily
analytics.retention_weekly_cohorts
analytics.llm_cost_daily
analytics.economics_daily
```

`economics_daily` treats positive AWS `UnblendedCost` lines as gross cost,
reports negative lines separately as credits, and retains AWS net cost as a
separate value. This prevents credits from hiding cost of serving.

## Provider Ingestion

`server/scripts/analytics_ingest.py` is hosted-company operations code. It
fetches Stripe revenue/subscription facts, AWS Cost Explorer data, E2B usage,
and Sentry daily error counts. Each provider is run and committed
independently; an absent credential or provider failure is logged and does not
stop later providers.

The script writes aggregates only. Stripe aggregation is USD-only; non-USD
invoices are skipped with a warning. Sentry storage is daily count by project
and surface; its current query does not group by release and writes an empty
release value. E2B storage contains aggregate resource use, sandbox count, and
cost.

## Read-Only Boundary

When the `metabase_readonly` role exists, migrations grant it only:

```text
USAGE on schema analytics
SELECT on current tables/views in schema analytics
default SELECT on later tables/views in schema analytics
```

Do not grant the BI role access to raw application schemas merely to make a
card convenient. Add or revise an analytics view when a durable question needs
new data, and preserve the privacy rules above.

See the [Metabase operating procedure](../../../../developing/operating/analytics/metabase.md)
for read-only discovery and freshness verification.
