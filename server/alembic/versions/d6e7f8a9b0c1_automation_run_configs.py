"""Automation run configs.

Revision ID: d6e7f8a9b0c1
Revises: b2c3d4e5f6a7
Create Date: 2026-05-21 12:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "d6e7f8a9b0c1"
down_revision: str | None = "b2c3d4e5f6a7"
branch_labels: str | None = None
depends_on: str | None = None


def _inspector() -> sa.Inspector:
    return sa.inspect(op.get_bind())


def _has_table(table_name: str) -> bool:
    return table_name in _inspector().get_table_names()


def _has_column(table_name: str, column_name: str) -> bool:
    if not _has_table(table_name):
        return False
    return column_name in {column["name"] for column in _inspector().get_columns(table_name)}


def _has_index(table_name: str, index_name: str) -> bool:
    if not _has_table(table_name):
        return False
    return index_name in {index["name"] for index in _inspector().get_indexes(table_name)}


def _create_index_once(
    index_name: str,
    table_name: str,
    columns: list[str],
    *,
    unique: bool = False,
    postgresql_where: sa.TextClause | None = None,
) -> None:
    if _has_table(table_name) and not _has_index(table_name, index_name):
        op.create_index(
            index_name,
            table_name,
            columns,
            unique=unique,
            postgresql_where=postgresql_where,
        )


def _add_column_once(table_name: str, column: sa.Column) -> None:
    if _has_table(table_name) and not _has_column(table_name, column.name):
        op.add_column(table_name, column)


def _drop_column_once(table_name: str, column_name: str) -> None:
    if _has_table(table_name) and _has_column(table_name, column_name):
        op.drop_column(table_name, column_name)


def _drop_daily_automation_activity_view() -> None:
    op.execute("DROP VIEW IF EXISTS analytics.daily_automation_activity")


def _create_daily_automation_activity_view() -> None:
    if (
        not _has_table("automation")
        or not _has_table("automation_run")
        or not _has_column("automation", "target_mode")
        or not _has_column("automation_run", "target_mode")
    ):
        return
    op.execute("CREATE SCHEMA IF NOT EXISTS analytics")
    op.execute(
        """
        CREATE OR REPLACE VIEW analytics.daily_automation_activity AS
        SELECT
            activity_date,
            target_mode AS execution_target,
            status,
            trigger_kind,
            sum(created_automations)::bigint AS created_automations,
            sum(automation_runs)::bigint AS automation_runs
        FROM (
            SELECT
                (created_at AT TIME ZONE 'UTC')::date AS activity_date,
                target_mode,
                CASE WHEN enabled THEN 'enabled' ELSE 'paused' END AS status,
                NULL::text AS trigger_kind,
                count(*) AS created_automations,
                0::bigint AS automation_runs
            FROM automation
            GROUP BY (created_at AT TIME ZONE 'UTC')::date, target_mode, enabled
            UNION ALL
            SELECT
                (created_at AT TIME ZONE 'UTC')::date AS activity_date,
                target_mode,
                status,
                trigger_kind,
                0::bigint AS created_automations,
                count(*) AS automation_runs
            FROM automation_run
            GROUP BY
                (created_at AT TIME ZONE 'UTC')::date,
                target_mode,
                status,
                trigger_kind
        ) daily
        GROUP BY activity_date, target_mode, status, trigger_kind
        """
    )


def _backfill_automation_agent_run_configs() -> None:
    required_columns = {
        "id",
        "owner_user_id",
        "created_by_user_id",
        "title",
        "agent_kind",
        "model_id",
        "mode_id",
        "reasoning_effort",
        "cloud_agent_run_config_id",
        "created_at",
        "updated_at",
    }
    if not _has_table("automation") or not _has_table("cloud_agent_run_config"):
        return
    if not all(_has_column("automation", column_name) for column_name in required_columns):
        return

    op.execute(
        sa.text(
            """
            WITH legacy AS (
              SELECT
                id AS automation_id,
                owner_user_id,
                created_by_user_id,
                LEFT(
                  'Legacy automation config: ' || COALESCE(NULLIF(title, ''), id::text),
                  255
                ) AS config_name,
                CASE
                  WHEN lower(NULLIF(agent_kind, '')) IN (
                    'claude',
                    'codex',
                    'opencode',
                    'gemini',
                    'cursor'
                  )
                    THEN lower(NULLIF(agent_kind, ''))
                  ELSE 'claude'
                END AS normalized_agent_kind,
                NULLIF(model_id, '') AS legacy_model_id,
                NULLIF(mode_id, '') AS legacy_mode_id,
                NULLIF(reasoning_effort, '') AS legacy_reasoning_effort,
                COALESCE(created_at, now()) AS created_at,
                COALESCE(updated_at, now()) AS updated_at
              FROM automation
              WHERE cloud_agent_run_config_id IS NULL
            ),
            legacy_configs AS (
              SELECT
                automation_id,
                gen_random_uuid() AS config_id,
                owner_user_id,
                created_by_user_id,
                config_name,
                normalized_agent_kind,
                COALESCE(
                  legacy_model_id,
                  CASE normalized_agent_kind
                    WHEN 'claude' THEN 'us.anthropic.claude-sonnet-4-6'
                    WHEN 'codex' THEN 'gpt-5.5'
                    WHEN 'opencode' THEN 'opencode/big-pickle'
                    WHEN 'gemini' THEN 'auto-gemini-2.5'
                    WHEN 'cursor' THEN 'composer-2-fast'
                    ELSE 'us.anthropic.claude-sonnet-4-6'
                  END
                ) AS model_id,
                jsonb_strip_nulls(
                  jsonb_build_object(
                    'mode', legacy_mode_id,
                    'effort', legacy_reasoning_effort
                  )
                ) AS control_values_json,
                created_at,
                updated_at
              FROM legacy
            ),
            inserted AS (
              INSERT INTO cloud_agent_run_config (
                id,
                owner_scope,
                owner_user_id,
                organization_id,
                created_by_user_id,
                name,
                agent_kind,
                model_id,
                control_values_json,
                usable_in_personal_sandboxes,
                usable_in_shared_sandboxes,
                seed_key,
                system_default_rank,
                status,
                archived_at,
                created_at,
                updated_at
              )
              SELECT
                config_id,
                'personal',
                owner_user_id,
                NULL,
                created_by_user_id,
                config_name,
                normalized_agent_kind,
                model_id,
                control_values_json,
                true,
                false,
                NULL,
                NULL,
                'active',
                NULL,
                created_at,
                updated_at
              FROM legacy_configs
              RETURNING id
            )
            UPDATE automation AS automation_row
            SET cloud_agent_run_config_id = inserted.id
            FROM legacy_configs
            JOIN inserted ON inserted.id = legacy_configs.config_id
            WHERE automation_row.id = legacy_configs.automation_id
            """
        )
    )


def _backfill_automation_run_agent_snapshots() -> None:
    required_columns = {
        "agent_run_config_snapshot_json",
        "agent_kind_snapshot",
        "model_id_snapshot",
        "mode_id_snapshot",
        "reasoning_effort_snapshot",
    }
    if (
        not _has_table("automation_run")
        or not _has_table("automation")
        or not _has_table("cloud_agent_run_config")
    ):
        return
    if not all(_has_column("automation_run", column_name) for column_name in required_columns):
        return
    if not _has_column("automation", "cloud_agent_run_config_id"):
        return

    op.execute(
        sa.text(
            """
            UPDATE automation_run AS run
            SET agent_run_config_snapshot_json = jsonb_strip_nulls(
              jsonb_build_object(
                'config_id', config.id::text,
                'config_name', config.name,
                'agent_kind', COALESCE(NULLIF(run.agent_kind_snapshot, ''), config.agent_kind),
                'model_id', COALESCE(NULLIF(run.model_id_snapshot, ''), config.model_id),
                'control_values', jsonb_strip_nulls(
                  jsonb_build_object(
                    'mode', NULLIF(run.mode_id_snapshot, ''),
                    'effort', NULLIF(run.reasoning_effort_snapshot, '')
                  )
                ),
                'owner_scope_at_snapshot', config.owner_scope
              )
            )
            FROM automation
            JOIN cloud_agent_run_config AS config
              ON config.id = automation.cloud_agent_run_config_id
            WHERE run.automation_id = automation.id
              AND run.agent_run_config_snapshot_json IS NULL
            """
        )
    )


def _create_agent_run_config_tables() -> None:
    if not _has_table("cloud_agent_run_config"):
        op.create_table(
            "cloud_agent_run_config",
            sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
            sa.Column("owner_scope", sa.String(length=32), nullable=False),
            sa.Column("owner_user_id", sa.Uuid(), nullable=True),
            sa.Column("organization_id", sa.Uuid(), nullable=True),
            sa.Column("created_by_user_id", sa.Uuid(), nullable=False),
            sa.Column("name", sa.String(length=255), nullable=False),
            sa.Column("agent_kind", sa.String(length=32), nullable=False),
            sa.Column("model_id", sa.String(length=255), nullable=False),
            sa.Column(
                "control_values_json",
                postgresql.JSONB(astext_type=sa.Text()),
                server_default=sa.text("'{}'::jsonb"),
                nullable=False,
            ),
            sa.Column(
                "usable_in_personal_sandboxes",
                sa.Boolean(),
                server_default=sa.text("true"),
                nullable=False,
            ),
            sa.Column(
                "usable_in_shared_sandboxes",
                sa.Boolean(),
                server_default=sa.text("false"),
                nullable=False,
            ),
            sa.Column("seed_key", sa.String(length=128), nullable=True),
            sa.Column("system_default_rank", sa.Integer(), nullable=True),
            sa.Column(
                "status",
                sa.String(length=32),
                server_default=sa.text("'active'"),
                nullable=False,
            ),
            sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.CheckConstraint(
                "owner_scope IN ('system', 'personal', 'organization')",
                name="ck_cloud_agent_run_config_owner_scope",
            ),
            sa.CheckConstraint(
                "((owner_scope = 'system' AND owner_user_id IS NULL "
                "AND organization_id IS NULL) OR "
                "(owner_scope = 'personal' AND owner_user_id IS NOT NULL "
                "AND organization_id IS NULL) OR "
                "(owner_scope = 'organization' AND organization_id IS NOT NULL "
                "AND owner_user_id IS NULL))",
                name="ck_cloud_agent_run_config_owner_fields",
            ),
            sa.CheckConstraint(
                "agent_kind IN ('claude', 'codex', 'opencode', 'gemini', 'cursor')",
                name="ck_cloud_agent_run_config_agent_kind",
            ),
            sa.CheckConstraint(
                "status IN ('active', 'archived')",
                name="ck_cloud_agent_run_config_status",
            ),
            sa.CheckConstraint(
                "((owner_scope = 'system' AND seed_key IS NOT NULL) OR "
                "(owner_scope != 'system' AND seed_key IS NULL "
                "AND system_default_rank IS NULL))",
                name="ck_cloud_agent_run_config_seed_fields",
            ),
            sa.ForeignKeyConstraint(["owner_user_id"], ["user.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["organization_id"], ["organization.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["created_by_user_id"], ["user.id"], ondelete="CASCADE"),
        )
    _create_index_once(
        "ix_cloud_agent_run_config_owner_user",
        "cloud_agent_run_config",
        ["owner_user_id"],
    )
    _create_index_once(
        "ix_cloud_agent_run_config_organization",
        "cloud_agent_run_config",
        ["organization_id"],
    )
    _create_index_once(
        "ix_cloud_agent_run_config_agent_kind",
        "cloud_agent_run_config",
        ["agent_kind"],
    )
    _create_index_once(
        "ux_cloud_agent_run_config_system_seed",
        "cloud_agent_run_config",
        ["agent_kind", "seed_key"],
        unique=True,
        postgresql_where=sa.text("owner_scope = 'system'"),
    )

    if not _has_table("cloud_agent_run_config_default"):
        op.create_table(
            "cloud_agent_run_config_default",
            sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
            sa.Column("owner_scope", sa.String(length=32), nullable=False),
            sa.Column("owner_user_id", sa.Uuid(), nullable=True),
            sa.Column("organization_id", sa.Uuid(), nullable=True),
            sa.Column("agent_kind", sa.String(length=32), nullable=False),
            sa.Column("config_id", sa.Uuid(), nullable=False),
            sa.Column("created_by_user_id", sa.Uuid(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.CheckConstraint(
                "owner_scope IN ('personal', 'organization')",
                name="ck_cloud_agent_run_config_default_owner_scope",
            ),
            sa.CheckConstraint(
                "((owner_scope = 'personal' AND owner_user_id IS NOT NULL "
                "AND organization_id IS NULL) OR "
                "(owner_scope = 'organization' AND organization_id IS NOT NULL "
                "AND owner_user_id IS NULL))",
                name="ck_cloud_agent_run_config_default_owner_fields",
            ),
            sa.CheckConstraint(
                "agent_kind IN ('claude', 'codex', 'opencode', 'gemini', 'cursor')",
                name="ck_cloud_agent_run_config_default_agent_kind",
            ),
            sa.ForeignKeyConstraint(["owner_user_id"], ["user.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["organization_id"], ["organization.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(
                ["config_id"],
                ["cloud_agent_run_config.id"],
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(["created_by_user_id"], ["user.id"], ondelete="CASCADE"),
        )
    _create_index_once(
        "ux_cloud_agent_run_config_default_user",
        "cloud_agent_run_config_default",
        ["owner_user_id", "agent_kind"],
        unique=True,
        postgresql_where=sa.text("owner_scope = 'personal'"),
    )
    _create_index_once(
        "ux_cloud_agent_run_config_default_org",
        "cloud_agent_run_config_default",
        ["organization_id", "agent_kind"],
        unique=True,
        postgresql_where=sa.text("owner_scope = 'organization'"),
    )


def _upgrade_automation_tables() -> None:
    automation_already_modern = (
        _has_table("automation")
        and _has_column("automation", "owner_scope")
        and _has_column("automation", "cloud_agent_run_config_id")
        and not _has_column("automation", "user_id")
        and not _has_column("automation", "execution_target")
    )
    automation_run_already_modern = (
        _has_table("automation_run")
        and _has_column("automation_run", "owner_scope")
        and _has_column("automation_run", "agent_run_config_snapshot_json")
        and not _has_column("automation_run", "user_id")
        and not _has_column("automation_run", "execution_target")
    )
    if automation_already_modern and automation_run_already_modern:
        _create_daily_automation_activity_view()
        return

    _drop_daily_automation_activity_view()
    if _has_table("automation"):
        _add_column_once(
            "automation",
            sa.Column("owner_scope", sa.String(length=32), nullable=True),
        )
        _add_column_once("automation", sa.Column("owner_user_id", sa.Uuid(), nullable=True))
        _add_column_once("automation", sa.Column("organization_id", sa.Uuid(), nullable=True))
        _add_column_once("automation", sa.Column("created_by_user_id", sa.Uuid(), nullable=True))
        _add_column_once(
            "automation",
            sa.Column("target_mode", sa.String(length=32), nullable=True),
        )
        _add_column_once(
            "automation",
            sa.Column("cloud_agent_run_config_id", sa.Uuid(), nullable=True),
        )
        op.execute(
            sa.text(
                """
                UPDATE automation
                SET
                  owner_scope = COALESCE(owner_scope, 'personal'),
                  owner_user_id = COALESCE(owner_user_id, user_id),
                  organization_id = NULL,
                  created_by_user_id = COALESCE(created_by_user_id, user_id),
                  target_mode = COALESCE(
                    target_mode,
                    CASE WHEN execution_target = 'local' THEN 'local' ELSE 'personal_cloud' END
                  )
                WHERE owner_scope IS NULL
                   OR owner_user_id IS NULL
                   OR created_by_user_id IS NULL
                   OR target_mode IS NULL
                """
            )
        )
        _backfill_automation_agent_run_configs()
        _drop_column_once("automation", "execution_target")
        _drop_column_once("automation", "cloud_target_id")
        _drop_column_once("automation", "cloud_target_kind_snapshot")
        _drop_column_once("automation", "agent_kind")
        _drop_column_once("automation", "model_id")
        _drop_column_once("automation", "mode_id")
        _drop_column_once("automation", "reasoning_effort")
        _drop_column_once("automation", "user_id")
        op.alter_column("automation", "owner_scope", nullable=False)
        op.alter_column("automation", "created_by_user_id", nullable=False)
        op.alter_column("automation", "target_mode", nullable=False)
        op.alter_column("automation", "cloud_agent_run_config_id", nullable=False)
        op.create_check_constraint(
            "ck_automation_owner_scope",
            "automation",
            "owner_scope IN ('personal', 'organization')",
        )
        op.create_check_constraint(
            "ck_automation_owner_fields",
            "automation",
            "((owner_scope = 'personal' AND owner_user_id IS NOT NULL "
            "AND organization_id IS NULL) OR "
            "(owner_scope = 'organization' AND organization_id IS NOT NULL "
            "AND owner_user_id IS NULL))",
        )
        op.create_check_constraint(
            "ck_automation_target_mode",
            "automation",
            "target_mode IN ('local', 'personal_cloud', 'shared_cloud')",
        )
        op.create_check_constraint(
            "ck_automation_target_mode_owner",
            "automation",
            "((owner_scope = 'personal' AND target_mode IN ('local', 'personal_cloud')) "
            "OR (owner_scope = 'organization' AND target_mode = 'shared_cloud'))",
        )
        _create_index_once("ix_automation_owner_user_id", "automation", ["owner_user_id"])
        _create_index_once("ix_automation_organization_id", "automation", ["organization_id"])
        _create_index_once(
            "ix_automation_created_by_user_id",
            "automation",
            ["created_by_user_id"],
        )
        _create_index_once(
            "ix_automation_cloud_agent_run_config_id",
            "automation",
            ["cloud_agent_run_config_id"],
        )
        op.create_foreign_key(
            "fk_automation_owner_user_id",
            "automation",
            "user",
            ["owner_user_id"],
            ["id"],
            ondelete="CASCADE",
        )
        op.create_foreign_key(
            "fk_automation_organization_id",
            "automation",
            "organization",
            ["organization_id"],
            ["id"],
            ondelete="CASCADE",
        )
        op.create_foreign_key(
            "fk_automation_created_by_user_id",
            "automation",
            "user",
            ["created_by_user_id"],
            ["id"],
            ondelete="CASCADE",
        )
        op.create_foreign_key(
            "fk_automation_cloud_agent_run_config_id",
            "automation",
            "cloud_agent_run_config",
            ["cloud_agent_run_config_id"],
            ["id"],
            ondelete="RESTRICT",
        )

    if _has_table("automation_run"):
        _add_column_once(
            "automation_run",
            sa.Column("owner_scope", sa.String(length=32), nullable=True),
        )
        _add_column_once("automation_run", sa.Column("owner_user_id", sa.Uuid(), nullable=True))
        _add_column_once("automation_run", sa.Column("organization_id", sa.Uuid(), nullable=True))
        _add_column_once(
            "automation_run",
            sa.Column("created_by_user_id", sa.Uuid(), nullable=True),
        )
        _add_column_once(
            "automation_run",
            sa.Column("target_mode", sa.String(length=32), nullable=True),
        )
        _add_column_once(
            "automation_run",
            sa.Column("sandbox_profile_id", sa.Uuid(), nullable=True),
        )
        _add_column_once(
            "automation_run",
            sa.Column("cloud_workspace_exposure_id", sa.Uuid(), nullable=True),
        )
        _add_column_once(
            "automation_run",
            sa.Column(
                "agent_run_config_snapshot_json",
                postgresql.JSONB(astext_type=sa.Text()),
                nullable=True,
            ),
        )
        _add_column_once(
            "automation_run",
            sa.Column(
                "cascade_attempt",
                sa.Integer(),
                server_default=sa.text("0"),
                nullable=False,
            ),
        )
        _add_column_once(
            "automation_run",
            sa.Column("last_cascade_command_id", sa.Uuid(), nullable=True),
        )
        _add_column_once(
            "automation_run",
            sa.Column("last_cascade_reason", sa.String(length=64), nullable=True),
        )
        op.execute(
            sa.text(
                """
                UPDATE automation_run
                SET
                  owner_scope = COALESCE(owner_scope, 'personal'),
                  owner_user_id = COALESCE(owner_user_id, user_id),
                  organization_id = NULL,
                  created_by_user_id = COALESCE(created_by_user_id, user_id),
                  target_mode = COALESCE(
                    target_mode,
                    CASE WHEN execution_target = 'local' THEN 'local' ELSE 'personal_cloud' END
                  )
                WHERE owner_scope IS NULL
                   OR owner_user_id IS NULL
                   OR created_by_user_id IS NULL
                   OR target_mode IS NULL
                """
            )
        )
        _backfill_automation_run_agent_snapshots()
        _drop_column_once("automation_run", "execution_target")
        _drop_column_once("automation_run", "agent_kind_snapshot")
        _drop_column_once("automation_run", "model_id_snapshot")
        _drop_column_once("automation_run", "mode_id_snapshot")
        _drop_column_once("automation_run", "reasoning_effort_snapshot")
        _drop_column_once("automation_run", "user_id")
        op.alter_column("automation_run", "owner_scope", nullable=False)
        op.alter_column("automation_run", "created_by_user_id", nullable=False)
        op.alter_column("automation_run", "target_mode", nullable=False)
        op.create_check_constraint(
            "ck_automation_run_owner_scope",
            "automation_run",
            "owner_scope IN ('personal', 'organization')",
        )
        op.create_check_constraint(
            "ck_automation_run_owner_fields",
            "automation_run",
            "((owner_scope = 'personal' AND owner_user_id IS NOT NULL "
            "AND organization_id IS NULL) OR "
            "(owner_scope = 'organization' AND organization_id IS NOT NULL "
            "AND owner_user_id IS NULL))",
        )
        op.create_check_constraint(
            "ck_automation_run_target_mode",
            "automation_run",
            "target_mode IN ('local', 'personal_cloud', 'shared_cloud')",
        )
        _create_index_once(
            "ix_automation_run_owner_user_id",
            "automation_run",
            ["owner_user_id"],
        )
        _create_index_once(
            "ix_automation_run_organization_id",
            "automation_run",
            ["organization_id"],
        )
        _create_index_once(
            "ix_automation_run_created_by_user_id",
            "automation_run",
            ["created_by_user_id"],
        )
        _create_index_once(
            "ix_automation_run_sandbox_profile_id",
            "automation_run",
            ["sandbox_profile_id"],
        )
        _create_index_once(
            "ix_automation_run_cloud_workspace_exposure_id",
            "automation_run",
            ["cloud_workspace_exposure_id"],
        )
        op.create_foreign_key(
            "fk_automation_run_owner_user_id",
            "automation_run",
            "user",
            ["owner_user_id"],
            ["id"],
            ondelete="CASCADE",
        )
        op.create_foreign_key(
            "fk_automation_run_organization_id",
            "automation_run",
            "organization",
            ["organization_id"],
            ["id"],
            ondelete="CASCADE",
        )
        op.create_foreign_key(
            "fk_automation_run_created_by_user_id",
            "automation_run",
            "user",
            ["created_by_user_id"],
            ["id"],
            ondelete="CASCADE",
        )
        op.create_foreign_key(
            "fk_automation_run_sandbox_profile_id",
            "automation_run",
            "sandbox_profile",
            ["sandbox_profile_id"],
            ["id"],
            ondelete="SET NULL",
        )
        op.create_foreign_key(
            "fk_automation_run_cloud_workspace_exposure_id",
            "automation_run",
            "cloud_workspace_exposure",
            ["cloud_workspace_exposure_id"],
            ["id"],
            ondelete="SET NULL",
        )
    _create_daily_automation_activity_view()


def upgrade() -> None:
    _create_agent_run_config_tables()
    _upgrade_automation_tables()


def downgrade() -> None:
    raise RuntimeError("Downgrade is not supported for automation run config migration.")
