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


def upgrade() -> None:
    _create_agent_run_config_tables()
    _upgrade_automation_tables()


def downgrade() -> None:
    raise RuntimeError("Downgrade is not supported for automation run config migration.")
