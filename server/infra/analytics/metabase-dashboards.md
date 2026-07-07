# Metabase dashboards

These 5 dashboards are built in Metabase Cloud (`steep-moor.metabaseapp.com`,
database "Proliferate Analytics", id `34`) against the `analytics` schema.
Their configuration lives in Metabase itself (cards/collections), not in
this repo — this file is a catalog of what exists and which `analytics.*`
object backs each card, so the mapping survives outside Metabase's UI.

The pre-existing **"Proliferate Operating Dashboard"** (27 cards, users/
activity metrics) already covered general product usage and was left as-is
— none of the 5 dashboards below duplicate it.

## 1. Proliferate — At a Glance (overview)

Scalar tiles:

| Tile | Source |
| --- | --- |
| New Users 7d | `analytics.user_activity_daily` (or underlying `"user"`) |
| Weekly Active Users | `analytics.user_activity_daily` |
| New Cloud Workspaces 7d | existing usage views (product-usage schema, not part of this PR) |
| New Desktop Installs 7d | existing usage views |
| Errors 7d | `analytics.sentry_errors_daily` |
| Open Bugs | `analytics.support_reports_daily` (`kind='bug'`) |
| MRR | `analytics.stripe_mrr_snapshot` |
| Cash Collected 90d | `analytics.stripe_revenue_daily` |
| Cost of Serving 30d | `analytics.economics_daily` (`total_cost_usd`) |
| Net 30d | `analytics.economics_daily` (`net_cents`) |
| Submit-a-Prompt submitted | `analytics.support_reports_daily` (`kind='feature'`) |

Trend lines: New Users (daily), Cost of Serving by Provider (daily, from
`economics_daily`'s `aws_cost_usd`/`e2b_cost_usd`/`llm_cost_usd`), Weekly
Active Users.

## 2. Economics — Revenue & Cost of Serving

Scalars: Cash Collected 90d, MRR, ARR, Active Subscriptions (all
`analytics.stripe_mrr_snapshot` / `stripe_revenue_daily`), Cost of Serving
30d, AWS Cost of Serving 30d (gross — `economics_daily.aws_cost_usd`), E2B
Cost 30d (`e2b_cost_daily.total_cost_usd`), LLM Cost 30d
(`llm_cost_daily.cost_usd`), AWS Credits Applied 30d
(`economics_daily.aws_credits_usd`).

Charts: Daily Cost of Serving by Provider, E2B Daily Cost, AWS Cost by
Service (gross — `aws_cost_daily` filtered to `cost_usd > 0`), MRR Over
Time.

Note: AWS figures throughout use **gross** cost (`cost_usd > 0`), not net —
see the cost-accounting note in `README.md`. Net/credits are broken out
separately, never blended silently into "cost of serving."

## 3. Support & Submit-a-Prompt

Scalars: Bugs Submitted, Bugs Resolved, Bug Resolution Rate, Submit-a-Prompt
Submitted, Submit-a-Prompt Resolved — all from
`analytics.support_reports_daily`, split by `kind` (`'bug'` vs `'feature'`,
the latter being Submit-a-Prompt).

Charts: trend line (submitted vs. resolved over time) and a by-kind bar
chart.

## 4. Retention & Cohorts

Weekly Retention Curve and Retention Cohorts table:
`analytics.retention_weekly_cohorts` (`cohort_week`, `weeks_since`,
`active_users`, `cohort_size`, `retention_pct`).

New Users by Week, Weekly Active Users: `analytics.user_activity_daily`.

## 5. Errors (Sentry)

Errors 7d, Errors by Day, by Project, by Release — all from
`analytics.sentry_errors_daily`.

**This dashboard is empty until a real-org Sentry token is configured.**
The ingestion job's Sentry step needs `SENTRY_ANALYTICS_TOKEN` and
`SENTRY_ORG` in the `proliferate/prod/analytics-ingest` secret; neither is
set yet, so `ingest_sentry()` logs a warning and skips every run (the job
as a whole still succeeds). Once a token exists for the real Sentry org,
add both keys to the secret and the dashboard will populate on the next
nightly run — no other change needed.
