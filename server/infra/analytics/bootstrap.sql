CREATE SCHEMA IF NOT EXISTS analytics;

CREATE TABLE IF NOT EXISTS analytics.stripe_revenue_daily (
    activity_date DATE NOT NULL,
    gross_collected_cents BIGINT NOT NULL DEFAULT 0,
    paid_invoice_count INTEGER NOT NULL DEFAULT 0,
    currency VARCHAR(8) NOT NULL DEFAULT 'usd',
    updated_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (activity_date)
);
CREATE TABLE IF NOT EXISTS analytics.stripe_mrr_snapshot (
    captured_date DATE NOT NULL,
    mrr_cents BIGINT NOT NULL DEFAULT 0,
    arr_cents BIGINT NOT NULL DEFAULT 0,
    active_subscriptions INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (captured_date)
);
CREATE TABLE IF NOT EXISTS analytics.aws_cost_daily (
    activity_date DATE NOT NULL,
    service VARCHAR(128) NOT NULL,
    cost_usd NUMERIC(18,6) NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (activity_date, service)
);
CREATE TABLE IF NOT EXISTS analytics.e2b_cost_daily (
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
CREATE TABLE IF NOT EXISTS analytics.sentry_errors_daily (
    activity_date DATE NOT NULL,
    project VARCHAR(128) NOT NULL,
    surface VARCHAR(64),
    release VARCHAR(255) NOT NULL DEFAULT '',
    error_count BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (activity_date, project, release)
);

CREATE OR REPLACE VIEW analytics.support_reports_daily AS
SELECT (created_at AT TIME ZONE 'UTC')::date AS activity_date, kind,
    count(*) FILTER (WHERE status IN ('uploading','completed')) AS submitted_count,
    count(*) FILTER (WHERE status='completed' AND (tracker_status='completed' OR github_status='completed' OR linear_status='completed')) AS resolved_count
FROM support_report
GROUP BY (created_at AT TIME ZONE 'UTC')::date, kind;

CREATE OR REPLACE VIEW analytics.user_activity_daily AS
SELECT DISTINCT actor_user_id, activity_date FROM client_daily_activity WHERE actor_user_id IS NOT NULL;

CREATE OR REPLACE VIEW analytics.retention_weekly_cohorts AS
WITH cohorts AS (SELECT id AS user_id, date_trunc('week', created_at)::date AS cohort_week FROM "user"),
activity_weeks AS (SELECT DISTINCT actor_user_id AS user_id, date_trunc('week', activity_date)::date AS activity_week FROM client_daily_activity WHERE actor_user_id IS NOT NULL),
cohort_sizes AS (SELECT cohort_week, count(*) AS cohort_size FROM cohorts GROUP BY cohort_week),
weekly_activity AS (
    SELECT cohorts.cohort_week, floor((activity_weeks.activity_week - cohorts.cohort_week) / 7.0)::int AS weeks_since, count(DISTINCT cohorts.user_id) AS active_users
    FROM cohorts JOIN activity_weeks ON activity_weeks.user_id = cohorts.user_id
    WHERE activity_weeks.activity_week >= cohorts.cohort_week
    GROUP BY cohorts.cohort_week, floor((activity_weeks.activity_week - cohorts.cohort_week) / 7.0))
SELECT weekly_activity.cohort_week, weekly_activity.weeks_since, weekly_activity.active_users, cohort_sizes.cohort_size,
    CASE WHEN cohort_sizes.cohort_size > 0 THEN round(100.0 * weekly_activity.active_users / cohort_sizes.cohort_size, 2) ELSE 0 END AS retention_pct
FROM weekly_activity JOIN cohort_sizes ON cohort_sizes.cohort_week = weekly_activity.cohort_week
WHERE weekly_activity.weeks_since >= 0;

CREATE OR REPLACE VIEW analytics.llm_cost_daily AS
SELECT (occurred_at AT TIME ZONE 'UTC')::date AS activity_date, provider, model,
    coalesce(sum(cost_usd),0) AS cost_usd, coalesce(sum(total_tokens),0)::bigint AS tokens, count(*) AS requests
FROM agent_llm_usage_event GROUP BY (occurred_at AT TIME ZONE 'UTC')::date, provider, model;

-- AWS UnblendedCost folds promotional credits in as negative service lines
-- (e.g. a -$135 credit booked against "AWS Data Transfer" cancels the compute).
-- Summing everything nets to ~$0 and hides the true cost of serving, so
-- economics_daily reports GROSS AWS cost (cost_usd > 0) as the cost-of-serving
-- driver and surfaces credits/net separately. DROP first: adding the
-- aws_credits_usd / aws_net_usd columns changes the view's column set, which
-- CREATE OR REPLACE VIEW cannot do. Must stay in sync with the economics_daily
-- definition in alembic 15649bf2cf24 (_create_derived_views).
DROP VIEW IF EXISTS analytics.economics_daily;
CREATE VIEW analytics.economics_daily AS
WITH stripe_daily AS (SELECT activity_date, gross_collected_cents FROM analytics.stripe_revenue_daily),
aws_daily AS (
    SELECT activity_date,
        sum(cost_usd) FILTER (WHERE cost_usd > 0) AS aws_gross_usd,
        sum(cost_usd) FILTER (WHERE cost_usd < 0) AS aws_credits_usd,
        sum(cost_usd) AS aws_net_usd
    FROM analytics.aws_cost_daily GROUP BY activity_date),
e2b_daily AS (SELECT activity_date, total_cost_usd AS e2b_cost_usd FROM analytics.e2b_cost_daily),
llm_daily AS (SELECT (occurred_at AT TIME ZONE 'UTC')::date AS activity_date, sum(cost_usd) AS llm_cost_usd FROM agent_llm_usage_event GROUP BY (occurred_at AT TIME ZONE 'UTC')::date),
all_dates AS (SELECT activity_date FROM stripe_daily UNION SELECT activity_date FROM aws_daily UNION SELECT activity_date FROM e2b_daily UNION SELECT activity_date FROM llm_daily)
SELECT all_dates.activity_date,
    coalesce(stripe_daily.gross_collected_cents,0) AS stripe_gross_collected_cents,
    coalesce(aws_daily.aws_gross_usd,0) AS aws_cost_usd,
    coalesce(aws_daily.aws_credits_usd,0) AS aws_credits_usd,
    coalesce(aws_daily.aws_net_usd,0) AS aws_net_usd,
    coalesce(e2b_daily.e2b_cost_usd,0) AS e2b_cost_usd,
    coalesce(llm_daily.llm_cost_usd,0) AS llm_cost_usd,
    coalesce(aws_daily.aws_gross_usd,0)+coalesce(e2b_daily.e2b_cost_usd,0)+coalesce(llm_daily.llm_cost_usd,0) AS total_cost_usd,
    coalesce(stripe_daily.gross_collected_cents,0) - ((coalesce(aws_daily.aws_gross_usd,0)+coalesce(e2b_daily.e2b_cost_usd,0)+coalesce(llm_daily.llm_cost_usd,0))*100) AS net_cents
FROM all_dates
LEFT JOIN stripe_daily ON stripe_daily.activity_date=all_dates.activity_date
LEFT JOIN aws_daily ON aws_daily.activity_date=all_dates.activity_date
LEFT JOIN e2b_daily ON e2b_daily.activity_date=all_dates.activity_date
LEFT JOIN llm_daily ON llm_daily.activity_date=all_dates.activity_date;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='metabase_readonly') THEN
    GRANT USAGE ON SCHEMA analytics TO metabase_readonly;
    GRANT SELECT ON ALL TABLES IN SCHEMA analytics TO metabase_readonly;
    ALTER DEFAULT PRIVILEGES IN SCHEMA analytics GRANT SELECT ON TABLES TO metabase_readonly;
  END IF;
END $$;
