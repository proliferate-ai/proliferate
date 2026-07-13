"""metabase analytics storage v1

Revision ID: a9b0c1d2e3f4
Revises: e7f8a9b0c1d2
Create Date: 2026-05-20 09:00:00.000000

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a9b0c1d2e3f4"
down_revision: str | Sequence[str] | None = "e7f8a9b0c1d2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_table(table_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return table_name in set(inspector.get_table_names())


def _has_index(table_name: str, index_name: str) -> bool:
    if not _has_table(table_name):
        return False
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return index_name in {index["name"] for index in inspector.get_indexes(table_name)}


def _has_column(table_name: str, column_name: str) -> bool:
    if not _has_table(table_name):
        return False
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return column_name in {column["name"] for column in inspector.get_columns(table_name)}


def _create_index_once(
    index_name: str,
    table_name: str,
    columns: list[str],
    *,
    unique: bool = False,
    postgresql_where: sa.TextClause | None = None,
) -> None:
    if not _has_index(table_name, index_name):
        op.create_index(
            index_name,
            table_name,
            columns,
            unique=unique,
            postgresql_where=postgresql_where,
        )


def _drop_index_once(index_name: str, table_name: str) -> None:
    if _has_index(table_name, index_name):
        op.drop_index(index_name, table_name=table_name)


def _create_analytics_views() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS analytics")

    op.execute(
        """
        CREATE OR REPLACE VIEW analytics.daily_client_activity AS
        SELECT
            activity_date,
            surface,
            count(*) AS activity_rows,
            count(DISTINCT actor_user_id)
                FILTER (WHERE actor_user_id IS NOT NULL) AS authenticated_users,
            count(DISTINCT anonymous_install_uuid)
                FILTER (
                    WHERE actor_user_id IS NULL
                    AND anonymous_install_uuid IS NOT NULL
                ) AS anonymous_installs,
            count(DISTINCT anonymous_install_uuid)
                FILTER (WHERE anonymous_install_uuid IS NOT NULL) AS distinct_installs,
            coalesce(sum(received_count), 0) AS pings_received,
            min(created_at) AS first_seen_at,
            max(last_seen_at) AS last_seen_at
        FROM client_daily_activity
        GROUP BY activity_date, surface
        """
    )

    op.execute(
        """
        CREATE OR REPLACE VIEW analytics.daily_desktop_installs AS
        SELECT
            (first_seen_at AT TIME ZONE 'UTC')::date AS activity_date,
            last_telemetry_mode AS telemetry_mode,
            coalesce(nullif(last_platform, ''), 'unknown') AS platform,
            count(*) AS new_desktop_installs,
            min(first_seen_at) AS first_seen_at,
            max(last_seen_at) AS last_seen_at
        FROM anonymous_telemetry_install
        WHERE surface = 'desktop'
        GROUP BY
            (first_seen_at AT TIME ZONE 'UTC')::date,
            last_telemetry_mode,
            coalesce(nullif(last_platform, ''), 'unknown')
        """
    )

    op.execute(
        """
        CREATE OR REPLACE VIEW analytics.daily_anonymous_usage AS
        SELECT
            (received_at AT TIME ZONE 'UTC')::date AS activity_date,
            surface,
            telemetry_mode,
            coalesce(sum((payload_json ->> 'sessions_started')::bigint), 0)::bigint
                AS sessions_started,
            coalesce(sum((payload_json ->> 'prompts_submitted')::bigint), 0)::bigint
                AS prompts_submitted,
            coalesce(sum((payload_json ->> 'workspaces_created_local')::bigint), 0)::bigint
                AS workspaces_created_local,
            coalesce(sum((payload_json ->> 'workspaces_created_cloud')::bigint), 0)::bigint
                AS workspaces_created_cloud,
            coalesce(sum((payload_json ->> 'credentials_synced')::bigint), 0)::bigint
                AS credentials_synced,
            coalesce(sum((payload_json ->> 'connectors_installed')::bigint), 0)::bigint
                AS connectors_installed,
            count(*) AS usage_records,
            count(DISTINCT install_uuid) AS reporting_installs
        FROM anonymous_telemetry_event
        WHERE record_type = 'USAGE'
        GROUP BY (received_at AT TIME ZONE 'UTC')::date, surface, telemetry_mode
        """
    )

    op.execute(
        """
        CREATE OR REPLACE VIEW analytics.daily_new_users AS
        SELECT
            (created_at AT TIME ZONE 'UTC')::date AS activity_date,
            count(*) AS new_users
        FROM "user"
        GROUP BY (created_at AT TIME ZONE 'UTC')::date
        """
    )

    op.execute(
        """
        CREATE OR REPLACE VIEW analytics.daily_cloud_workspaces AS
        SELECT
            activity_date,
            owner_scope,
            sum(new_cloud_workspaces)::bigint AS new_cloud_workspaces,
            sum(archived_cloud_workspaces)::bigint AS archived_cloud_workspaces
        FROM (
            SELECT
                (created_at AT TIME ZONE 'UTC')::date AS activity_date,
                owner_scope,
                count(*) AS new_cloud_workspaces,
                0::bigint AS archived_cloud_workspaces
            FROM cloud_workspace
            GROUP BY (created_at AT TIME ZONE 'UTC')::date, owner_scope
            UNION ALL
            SELECT
                (archived_at AT TIME ZONE 'UTC')::date AS activity_date,
                owner_scope,
                0::bigint AS new_cloud_workspaces,
                count(*) AS archived_cloud_workspaces
            FROM cloud_workspace
            WHERE archived_at IS NOT NULL
            GROUP BY (archived_at AT TIME ZONE 'UTC')::date, owner_scope
        ) daily
        GROUP BY activity_date, owner_scope
        """
    )

    op.execute(
        """
        CREATE OR REPLACE VIEW analytics.daily_cloud_sessions AS
        SELECT
            (created_at AT TIME ZONE 'UTC')::date AS activity_date,
            coalesce(nullif(source_agent_kind, ''), 'unknown') AS agent_harness,
            status,
            count(*) AS sessions
        FROM cloud_sessions
        GROUP BY
            (created_at AT TIME ZONE 'UTC')::date,
            coalesce(nullif(source_agent_kind, ''), 'unknown'),
            status
        """
    )

    op.execute(
        """
        CREATE OR REPLACE VIEW analytics.daily_sandboxes AS
        SELECT
            (created_at AT TIME ZONE 'UTC')::date AS activity_date,
            provider,
            status,
            count(*) FILTER (WHERE external_sandbox_id IS NOT NULL) AS provisioned_sandboxes,
            count(*) AS sandbox_records
        FROM cloud_sandbox
        GROUP BY (created_at AT TIME ZONE 'UTC')::date, provider, status
        """
    )

    automation_target_column = None
    if _has_column("automation", "execution_target") and _has_column(
        "automation_run",
        "execution_target",
    ):
        automation_target_column = "execution_target"
    elif _has_column("automation", "target_mode") and _has_column(
        "automation_run",
        "target_mode",
    ):
        automation_target_column = "target_mode"

    if automation_target_column is not None:
        op.execute(
            f"""
            CREATE OR REPLACE VIEW analytics.daily_automation_activity AS
            SELECT
                activity_date,
                {automation_target_column} AS execution_target,
                status,
                trigger_kind,
                sum(created_automations)::bigint AS created_automations,
                sum(automation_runs)::bigint AS automation_runs
            FROM (
                SELECT
                    (created_at AT TIME ZONE 'UTC')::date AS activity_date,
                    {automation_target_column},
                    CASE WHEN enabled THEN 'enabled' ELSE 'paused' END AS status,
                    NULL::text AS trigger_kind,
                    count(*) AS created_automations,
                    0::bigint AS automation_runs
                FROM automation
                GROUP BY (created_at AT TIME ZONE 'UTC')::date,
                         {automation_target_column},
                         enabled
                UNION ALL
                SELECT
                    (created_at AT TIME ZONE 'UTC')::date AS activity_date,
                    {automation_target_column},
                    status,
                    trigger_kind,
                    0::bigint AS created_automations,
                    count(*) AS automation_runs
                FROM automation_run
                GROUP BY
                    (created_at AT TIME ZONE 'UTC')::date,
                    {automation_target_column},
                    status,
                    trigger_kind
            ) daily
            GROUP BY activity_date, {automation_target_column}, status, trigger_kind
            """
        )

    op.execute(
        """
        CREATE OR REPLACE VIEW analytics.daily_mcp_activity AS
        SELECT
            (occurred_at AT TIME ZONE 'UTC')::date AS activity_date,
            catalog_entry_id,
            event_type,
            count(*) AS event_count,
            count(*) FILTER (WHERE event_type = 'connection_created') AS connected_count,
            count(*) FILTER (WHERE event_type = 'auth_ready') AS auth_ready_count,
            count(*) FILTER (WHERE event_type = 'disabled') AS disabled_count,
            count(*) FILTER (WHERE event_type = 'deleted') AS deleted_count,
            count(*) FILTER (WHERE event_type = 'auth_failed') AS failed_count
        FROM cloud_mcp_connection_event
        GROUP BY (occurred_at AT TIME ZONE 'UTC')::date, catalog_entry_id, event_type
        """
    )

    op.execute(
        """
        CREATE OR REPLACE VIEW analytics.daily_mobility_activity AS
        SELECT
            (occurred_at AT TIME ZONE 'UTC')::date AS activity_date,
            direction,
            event_type,
            count(*) AS event_count,
            count(*) FILTER (WHERE event_type = 'handoff_started') AS migration_starts,
            count(*) FILTER (WHERE event_type = 'cleanup_completed') AS migration_completions,
            count(*) FILTER (
                WHERE event_type IN ('handoff_failed', 'handoff_stale')
            ) AS migration_failures,
            count(*) FILTER (WHERE event_type = 'phase_changed') AS phase_transitions
        FROM cloud_workspace_mobility_event
        GROUP BY (occurred_at AT TIME ZONE 'UTC')::date, direction, event_type
        """
    )


def _drop_analytics_views() -> None:
    op.execute("DROP VIEW IF EXISTS analytics.daily_mobility_activity")
    op.execute("DROP VIEW IF EXISTS analytics.daily_mcp_activity")
    op.execute("DROP VIEW IF EXISTS analytics.daily_automation_activity")
    op.execute("DROP VIEW IF EXISTS analytics.daily_sandboxes")
    op.execute("DROP VIEW IF EXISTS analytics.daily_cloud_sessions")
    op.execute("DROP VIEW IF EXISTS analytics.daily_cloud_workspaces")
    op.execute("DROP VIEW IF EXISTS analytics.daily_new_users")
    op.execute("DROP VIEW IF EXISTS analytics.daily_anonymous_usage")
    op.execute("DROP VIEW IF EXISTS analytics.daily_desktop_installs")
    op.execute("DROP VIEW IF EXISTS analytics.daily_client_activity")
    op.execute("DROP SCHEMA IF EXISTS analytics")


def upgrade() -> None:
    """Upgrade schema."""
    if not _has_table("client_daily_activity"):
        op.create_table(
            "client_daily_activity",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("activity_date", sa.Date(), nullable=False),
            sa.Column("surface", sa.String(length=32), nullable=False),
            sa.Column("actor_user_id", sa.Uuid(), nullable=True),
            sa.Column("anonymous_install_uuid", sa.Uuid(), nullable=True),
            sa.Column("telemetry_mode", sa.String(length=32), nullable=True),
            sa.Column("app_version", sa.String(length=255), nullable=True),
            sa.Column("platform", sa.String(length=64), nullable=True),
            sa.Column("route_or_screen", sa.String(length=128), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("received_count", sa.Integer(), nullable=False),
            sa.CheckConstraint(
                "surface IN ('desktop', 'web', 'mobile')",
                name="ck_client_daily_activity_surface",
            ),
            sa.CheckConstraint(
                "actor_user_id IS NOT NULL OR anonymous_install_uuid IS NOT NULL",
                name="ck_client_daily_activity_identity_present",
            ),
            sa.PrimaryKeyConstraint("id"),
        )
    _create_index_once(
        "uq_client_daily_activity_actor_day_surface",
        "client_daily_activity",
        ["activity_date", "surface", "actor_user_id"],
        unique=True,
        postgresql_where=sa.text("actor_user_id IS NOT NULL"),
    )
    _create_index_once(
        "uq_client_daily_activity_install_day_surface",
        "client_daily_activity",
        ["activity_date", "surface", "anonymous_install_uuid"],
        unique=True,
        postgresql_where=sa.text(
            "actor_user_id IS NULL AND anonymous_install_uuid IS NOT NULL"
        ),
    )
    _create_index_once(
        "ix_client_daily_activity_date_surface",
        "client_daily_activity",
        ["activity_date", "surface"],
    )
    _create_index_once(
        "ix_client_daily_activity_actor_user_id",
        "client_daily_activity",
        ["actor_user_id"],
    )
    _create_index_once(
        "ix_client_daily_activity_anonymous_install_uuid",
        "client_daily_activity",
        ["anonymous_install_uuid"],
    )

    if not _has_table("cloud_mcp_connection_event"):
        op.create_table(
            "cloud_mcp_connection_event",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("user_id", sa.Uuid(), nullable=False),
            sa.Column("org_id", sa.Uuid(), nullable=True),
            sa.Column("connection_id", sa.String(length=255), nullable=False),
            sa.Column("catalog_entry_id", sa.String(length=255), nullable=False),
            sa.Column("event_type", sa.String(length=64), nullable=False),
            sa.Column("auth_kind", sa.String(length=32), nullable=True),
            sa.Column("auth_status", sa.String(length=32), nullable=True),
            sa.Column("enabled", sa.Boolean(), nullable=True),
            sa.Column("failure_code", sa.String(length=64), nullable=True),
            sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )
    _create_index_once(
        "ix_cloud_mcp_connection_event_user_day",
        "cloud_mcp_connection_event",
        ["user_id", "occurred_at"],
    )
    _create_index_once(
        "ix_cloud_mcp_connection_event_connection",
        "cloud_mcp_connection_event",
        ["connection_id", "occurred_at"],
    )
    _create_index_once(
        "ix_cloud_mcp_connection_event_type",
        "cloud_mcp_connection_event",
        ["event_type", "occurred_at"],
    )
    _create_index_once(
        "ix_cloud_mcp_connection_event_user_id",
        "cloud_mcp_connection_event",
        ["user_id"],
    )
    _create_index_once(
        "ix_cloud_mcp_connection_event_org_id",
        "cloud_mcp_connection_event",
        ["org_id"],
    )

    if not _has_table("cloud_workspace_mobility_event"):
        op.create_table(
            "cloud_workspace_mobility_event",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("user_id", sa.Uuid(), nullable=False),
            sa.Column("cloud_workspace_id", sa.Uuid(), nullable=True),
            sa.Column("handoff_op_id", sa.Uuid(), nullable=True),
            sa.Column("event_type", sa.String(length=64), nullable=False),
            sa.Column("direction", sa.String(length=32), nullable=True),
            sa.Column("source_owner", sa.String(length=32), nullable=True),
            sa.Column("target_owner", sa.String(length=32), nullable=True),
            sa.Column("from_phase", sa.String(length=32), nullable=True),
            sa.Column("to_phase", sa.String(length=32), nullable=True),
            sa.Column("failure_code", sa.String(length=64), nullable=True),
            sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )
    _create_index_once(
        "ix_cloud_workspace_mobility_event_user_day",
        "cloud_workspace_mobility_event",
        ["user_id", "occurred_at"],
    )
    _create_index_once(
        "ix_cloud_workspace_mobility_event_workspace",
        "cloud_workspace_mobility_event",
        ["cloud_workspace_id", "occurred_at"],
    )
    _create_index_once(
        "ix_cloud_workspace_mobility_event_handoff",
        "cloud_workspace_mobility_event",
        ["handoff_op_id", "occurred_at"],
    )
    _create_index_once(
        "ix_cloud_workspace_mobility_event_type",
        "cloud_workspace_mobility_event",
        ["event_type", "occurred_at"],
    )
    _create_index_once(
        "ix_cloud_workspace_mobility_event_user_id",
        "cloud_workspace_mobility_event",
        ["user_id"],
    )
    _create_index_once(
        "ix_cloud_workspace_mobility_event_cloud_workspace_id",
        "cloud_workspace_mobility_event",
        ["cloud_workspace_id"],
    )
    _create_index_once(
        "ix_cloud_workspace_mobility_event_handoff_op_id",
        "cloud_workspace_mobility_event",
        ["handoff_op_id"],
    )

    _create_analytics_views()
    # Billing/MRR views are intentionally deferred until billing has a durable ledger.


def downgrade() -> None:
    """Downgrade schema."""
    _drop_analytics_views()

    if _has_table("cloud_workspace_mobility_event"):
        _drop_index_once(
            "ix_cloud_workspace_mobility_event_handoff_op_id",
            "cloud_workspace_mobility_event",
        )
        _drop_index_once(
            "ix_cloud_workspace_mobility_event_cloud_workspace_id",
            "cloud_workspace_mobility_event",
        )
        _drop_index_once(
            "ix_cloud_workspace_mobility_event_user_id",
            "cloud_workspace_mobility_event",
        )
        _drop_index_once(
            "ix_cloud_workspace_mobility_event_type",
            "cloud_workspace_mobility_event",
        )
        _drop_index_once(
            "ix_cloud_workspace_mobility_event_handoff",
            "cloud_workspace_mobility_event",
        )
        _drop_index_once(
            "ix_cloud_workspace_mobility_event_workspace",
            "cloud_workspace_mobility_event",
        )
        _drop_index_once(
            "ix_cloud_workspace_mobility_event_user_day",
            "cloud_workspace_mobility_event",
        )
        op.drop_table("cloud_workspace_mobility_event")

    if _has_table("cloud_mcp_connection_event"):
        _drop_index_once("ix_cloud_mcp_connection_event_org_id", "cloud_mcp_connection_event")
        _drop_index_once("ix_cloud_mcp_connection_event_user_id", "cloud_mcp_connection_event")
        _drop_index_once("ix_cloud_mcp_connection_event_type", "cloud_mcp_connection_event")
        _drop_index_once(
            "ix_cloud_mcp_connection_event_connection",
            "cloud_mcp_connection_event",
        )
        _drop_index_once("ix_cloud_mcp_connection_event_user_day", "cloud_mcp_connection_event")
        op.drop_table("cloud_mcp_connection_event")

    if _has_table("client_daily_activity"):
        _drop_index_once(
            "ix_client_daily_activity_anonymous_install_uuid",
            "client_daily_activity",
        )
        _drop_index_once("ix_client_daily_activity_actor_user_id", "client_daily_activity")
        _drop_index_once("ix_client_daily_activity_date_surface", "client_daily_activity")
        _drop_index_once(
            "uq_client_daily_activity_install_day_surface",
            "client_daily_activity",
        )
        _drop_index_once("uq_client_daily_activity_actor_day_surface", "client_daily_activity")
        op.drop_table("client_daily_activity")
