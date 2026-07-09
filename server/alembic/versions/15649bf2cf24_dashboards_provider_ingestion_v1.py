"""dashboards provider ingestion v1

Adds the `analytics` schema objects backing the provider-cost / support /
retention dashboards:

  * Provider snapshot tables (written by ``server/scripts/analytics_ingest.py``):
    stripe_revenue_daily, stripe_mrr_snapshot, aws_cost_daily, e2b_cost_daily,
    sentry_errors_daily.
  * Derived views over existing raw tables: support_reports_daily,
    user_activity_daily, retention_weekly_cohorts, economics_daily,
    llm_cost_daily.
  * Read-only grants for the ``metabase_readonly`` role (best-effort; the role
    may not exist in local/dev environments).

Revision ID: 15649bf2cf24
Revises: ff9344886948
Create Date: 2026-07-06 00:00:00.000000

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "15649bf2cf24"
down_revision: str | Sequence[str] | None = "ff9344886948"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_table(table_name: str, schema: str | None = None) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return table_name in set(inspector.get_table_names(schema=schema))


# --------------------------------------------------------------------------
# Provider snapshot tables (base tables written by the ingestion job)
# --------------------------------------------------------------------------


def _create_provider_snapshot_tables() -> None:
    if not _has_table("stripe_revenue_daily", schema="analytics"):
        op.create_table(
            "stripe_revenue_daily",
            sa.Column("activity_date", sa.Date(), nullable=False),
            sa.Column(
                "gross_collected_cents",
                sa.BigInteger(),
                nullable=False,
                server_default="0",
            ),
            sa.Column(
                "paid_invoice_count",
                sa.Integer(),
                nullable=False,
                server_default="0",
            ),
            sa.Column(
                "currency",
                sa.String(length=8),
                nullable=False,
                server_default="usd",
            ),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("activity_date"),
            schema="analytics",
        )

    if not _has_table("stripe_mrr_snapshot", schema="analytics"):
        op.create_table(
            "stripe_mrr_snapshot",
            sa.Column("captured_date", sa.Date(), nullable=False),
            sa.Column("mrr_cents", sa.BigInteger(), nullable=False, server_default="0"),
            sa.Column("arr_cents", sa.BigInteger(), nullable=False, server_default="0"),
            sa.Column(
                "active_subscriptions",
                sa.Integer(),
                nullable=False,
                server_default="0",
            ),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("captured_date"),
            schema="analytics",
        )

    if not _has_table("aws_cost_daily", schema="analytics"):
        op.create_table(
            "aws_cost_daily",
            sa.Column("activity_date", sa.Date(), nullable=False),
            sa.Column("service", sa.String(length=128), nullable=False),
            sa.Column(
                "cost_usd",
                sa.Numeric(18, 6),
                nullable=False,
                server_default="0",
            ),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("activity_date", "service"),
            schema="analytics",
        )

    if not _has_table("e2b_cost_daily", schema="analytics"):
        op.create_table(
            "e2b_cost_daily",
            sa.Column("activity_date", sa.Date(), nullable=False),
            sa.Column(
                "cpu_hours",
                sa.Numeric(18, 6),
                nullable=False,
                server_default="0",
            ),
            sa.Column(
                "ram_gib_hours",
                sa.Numeric(18, 6),
                nullable=False,
                server_default="0",
            ),
            sa.Column(
                "price_cpu_usd",
                sa.Numeric(18, 6),
                nullable=False,
                server_default="0",
            ),
            sa.Column(
                "price_ram_usd",
                sa.Numeric(18, 6),
                nullable=False,
                server_default="0",
            ),
            sa.Column(
                "sandbox_count",
                sa.Integer(),
                nullable=False,
                server_default="0",
            ),
            sa.Column(
                "total_cost_usd",
                sa.Numeric(18, 6),
                nullable=False,
                server_default="0",
            ),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("activity_date"),
            schema="analytics",
        )

    if not _has_table("sentry_errors_daily", schema="analytics"):
        op.create_table(
            "sentry_errors_daily",
            sa.Column("activity_date", sa.Date(), nullable=False),
            sa.Column("project", sa.String(length=128), nullable=False),
            sa.Column("surface", sa.String(length=64), nullable=True),
            sa.Column(
                "release",
                sa.String(length=255),
                nullable=False,
                server_default="",
            ),
            sa.Column(
                "error_count",
                sa.BigInteger(),
                nullable=False,
                server_default="0",
            ),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("activity_date", "project", "release"),
            schema="analytics",
        )


def _drop_provider_snapshot_tables() -> None:
    for table_name in (
        "sentry_errors_daily",
        "e2b_cost_daily",
        "aws_cost_daily",
        "stripe_mrr_snapshot",
        "stripe_revenue_daily",
    ):
        if _has_table(table_name, schema="analytics"):
            op.drop_table(table_name, schema="analytics")


# --------------------------------------------------------------------------
# Derived views over raw tables
# --------------------------------------------------------------------------


def _create_derived_views() -> None:
    op.execute(
        """
        CREATE OR REPLACE VIEW analytics.support_reports_daily AS
        SELECT
            (created_at AT TIME ZONE 'UTC')::date AS activity_date,
            kind,
            count(*) FILTER (WHERE status IN ('uploading', 'completed'))
                AS submitted_count,
            count(*) FILTER (
                WHERE status = 'completed'
                AND (
                    tracker_status = 'completed'
                    OR github_status = 'completed'
                    OR linear_status = 'completed'
                )
            ) AS resolved_count
        FROM support_report
        GROUP BY (created_at AT TIME ZONE 'UTC')::date, kind
        """
    )

    op.execute(
        """
        CREATE OR REPLACE VIEW analytics.user_activity_daily AS
        SELECT DISTINCT
            actor_user_id,
            activity_date
        FROM client_daily_activity
        WHERE actor_user_id IS NOT NULL
        """
    )

    op.execute(
        """
        CREATE OR REPLACE VIEW analytics.retention_weekly_cohorts AS
        WITH cohorts AS (
            SELECT
                id AS user_id,
                date_trunc('week', created_at)::date AS cohort_week
            FROM "user"
        ),
        activity_weeks AS (
            SELECT DISTINCT
                actor_user_id AS user_id,
                date_trunc('week', activity_date)::date AS activity_week
            FROM client_daily_activity
            WHERE actor_user_id IS NOT NULL
        ),
        cohort_sizes AS (
            SELECT cohort_week, count(*) AS cohort_size
            FROM cohorts
            GROUP BY cohort_week
        ),
        weekly_activity AS (
            SELECT
                cohorts.cohort_week,
                floor(
                    (activity_weeks.activity_week - cohorts.cohort_week) / 7.0
                )::int AS weeks_since,
                count(DISTINCT cohorts.user_id) AS active_users
            FROM cohorts
            JOIN activity_weeks ON activity_weeks.user_id = cohorts.user_id
            WHERE activity_weeks.activity_week >= cohorts.cohort_week
            GROUP BY
                cohorts.cohort_week,
                floor(
                    (activity_weeks.activity_week - cohorts.cohort_week) / 7.0
                )
        )
        SELECT
            weekly_activity.cohort_week,
            weekly_activity.weeks_since,
            weekly_activity.active_users,
            cohort_sizes.cohort_size,
            CASE
                WHEN cohort_sizes.cohort_size > 0
                    THEN round(
                        100.0 * weekly_activity.active_users / cohort_sizes.cohort_size,
                        2
                    )
                ELSE 0
            END AS retention_pct
        FROM weekly_activity
        JOIN cohort_sizes ON cohort_sizes.cohort_week = weekly_activity.cohort_week
        WHERE weekly_activity.weeks_since >= 0
        """
    )

    op.execute(
        """
        CREATE OR REPLACE VIEW analytics.llm_cost_daily AS
        SELECT
            (occurred_at AT TIME ZONE 'UTC')::date AS activity_date,
            provider,
            model,
            coalesce(sum(cost_usd), 0) AS cost_usd,
            coalesce(sum(total_tokens), 0)::bigint AS tokens,
            count(*) AS requests
        FROM agent_llm_usage_event
        GROUP BY (occurred_at AT TIME ZONE 'UTC')::date, provider, model
        """
    )

    # AWS UnblendedCost folds promotional credits in as negative service lines
    # (e.g. a -$135 credit booked against "AWS Data Transfer" cancels the
    # compute). Summing everything nets to ~$0, which hides the true cost of
    # serving. So economics_daily reports GROSS AWS cost (cost_usd > 0) as the
    # cost-of-serving driver and surfaces credits/net separately.
    op.execute(
        """
        CREATE OR REPLACE VIEW analytics.economics_daily AS
        WITH stripe_daily AS (
            SELECT activity_date, gross_collected_cents
            FROM analytics.stripe_revenue_daily
        ),
        aws_daily AS (
            SELECT
                activity_date,
                sum(cost_usd) FILTER (WHERE cost_usd > 0) AS aws_gross_usd,
                sum(cost_usd) FILTER (WHERE cost_usd < 0) AS aws_credits_usd,
                sum(cost_usd) AS aws_net_usd
            FROM analytics.aws_cost_daily
            GROUP BY activity_date
        ),
        e2b_daily AS (
            SELECT activity_date, total_cost_usd AS e2b_cost_usd
            FROM analytics.e2b_cost_daily
        ),
        llm_daily AS (
            SELECT
                (occurred_at AT TIME ZONE 'UTC')::date AS activity_date,
                sum(cost_usd) AS llm_cost_usd
            FROM agent_llm_usage_event
            GROUP BY (occurred_at AT TIME ZONE 'UTC')::date
        ),
        all_dates AS (
            SELECT activity_date FROM stripe_daily
            UNION
            SELECT activity_date FROM aws_daily
            UNION
            SELECT activity_date FROM e2b_daily
            UNION
            SELECT activity_date FROM llm_daily
        )
        SELECT
            all_dates.activity_date,
            coalesce(stripe_daily.gross_collected_cents, 0) AS stripe_gross_collected_cents,
            coalesce(aws_daily.aws_gross_usd, 0) AS aws_cost_usd,
            coalesce(aws_daily.aws_credits_usd, 0) AS aws_credits_usd,
            coalesce(aws_daily.aws_net_usd, 0) AS aws_net_usd,
            coalesce(e2b_daily.e2b_cost_usd, 0) AS e2b_cost_usd,
            coalesce(llm_daily.llm_cost_usd, 0) AS llm_cost_usd,
            coalesce(aws_daily.aws_gross_usd, 0)
                + coalesce(e2b_daily.e2b_cost_usd, 0)
                + coalesce(llm_daily.llm_cost_usd, 0) AS total_cost_usd,
            coalesce(stripe_daily.gross_collected_cents, 0)
                - (
                    (
                        coalesce(aws_daily.aws_gross_usd, 0)
                        + coalesce(e2b_daily.e2b_cost_usd, 0)
                        + coalesce(llm_daily.llm_cost_usd, 0)
                    ) * 100
                ) AS net_cents
        FROM all_dates
        LEFT JOIN stripe_daily ON stripe_daily.activity_date = all_dates.activity_date
        LEFT JOIN aws_daily ON aws_daily.activity_date = all_dates.activity_date
        LEFT JOIN e2b_daily ON e2b_daily.activity_date = all_dates.activity_date
        LEFT JOIN llm_daily ON llm_daily.activity_date = all_dates.activity_date
        """
    )


def _drop_derived_views() -> None:
    op.execute("DROP VIEW IF EXISTS analytics.economics_daily")
    op.execute("DROP VIEW IF EXISTS analytics.llm_cost_daily")
    op.execute("DROP VIEW IF EXISTS analytics.retention_weekly_cohorts")
    op.execute("DROP VIEW IF EXISTS analytics.user_activity_daily")
    op.execute("DROP VIEW IF EXISTS analytics.support_reports_daily")


# --------------------------------------------------------------------------
# Read-only grants for metabase_readonly (best-effort; role may not exist)
# --------------------------------------------------------------------------


def _grant_metabase_readonly() -> None:
    bind = op.get_bind()
    role_exists = bind.execute(
        sa.text("SELECT 1 FROM pg_roles WHERE rolname = 'metabase_readonly'")
    ).scalar()
    if not role_exists:
        return
    op.execute("GRANT USAGE ON SCHEMA analytics TO metabase_readonly")
    op.execute("GRANT SELECT ON ALL TABLES IN SCHEMA analytics TO metabase_readonly")
    op.execute(
        "ALTER DEFAULT PRIVILEGES IN SCHEMA analytics GRANT SELECT ON TABLES TO metabase_readonly"
    )


def upgrade() -> None:
    """Upgrade schema."""
    op.execute("CREATE SCHEMA IF NOT EXISTS analytics")

    _create_provider_snapshot_tables()
    _create_derived_views()
    _grant_metabase_readonly()


def downgrade() -> None:
    """Downgrade schema."""
    _drop_derived_views()
    _drop_provider_snapshot_tables()
