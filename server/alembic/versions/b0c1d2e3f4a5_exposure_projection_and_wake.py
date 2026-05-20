"""Exposure projection and wake metadata.

Revision ID: b0c1d2e3f4a5
Revises: a9b8c7d6e5f4
Create Date: 2026-05-20 14:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "b0c1d2e3f4a5"
down_revision: str | None = "a9b8c7d6e5f4"
branch_labels: str | None = None
depends_on: str | None = None

_ORIGINS = (
    "manual_desktop",
    "manual_web",
    "manual_mobile",
    "automation",
    "slack",
    "cowork_api",
)
_EXPOSURE_VISIBILITIES = ("private", "shared_unclaimed", "claimed", "archived")
_EXPOSURE_PROJECTION_LEVELS = ("index_only", "session_summaries", "transcript", "live")
_SESSION_PROJECTION_LEVELS = ("session_summaries", "transcript", "live")
_EXPOSURE_STATUSES = ("active", "paused", "stale", "revoked")


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


def _has_constraint(table_name: str, constraint_name: str) -> bool:
    if not _has_table(table_name):
        return False
    inspector = _inspector()
    names = {constraint["name"] for constraint in inspector.get_check_constraints(table_name)}
    names.update(constraint["name"] for constraint in inspector.get_foreign_keys(table_name))
    names.update(constraint["name"] for constraint in inspector.get_unique_constraints(table_name))
    return constraint_name in names


def _in_constraint(column_name: str, values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"{column_name} IN ({quoted})"


def _add_column_once(table_name: str, column: sa.Column) -> None:
    if _has_table(table_name) and not _has_column(table_name, column.name):
        op.add_column(table_name, column)


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


def _create_check_once(table_name: str, constraint_name: str, condition: str) -> None:
    if _has_table(table_name) and not _has_constraint(table_name, constraint_name):
        op.create_check_constraint(constraint_name, table_name, condition)


def _create_fk_once(
    constraint_name: str,
    table_name: str,
    referent_table: str,
    local_cols: list[str],
    remote_cols: list[str],
    *,
    ondelete: str,
) -> None:
    if _has_table(table_name) and not _has_constraint(table_name, constraint_name):
        op.create_foreign_key(
            constraint_name,
            table_name,
            referent_table,
            local_cols,
            remote_cols,
            ondelete=ondelete,
        )


def upgrade() -> None:
    _upgrade_cloud_workspace_origin()
    _create_workspace_exposures()
    _upgrade_session_projections()


def downgrade() -> None:
    raise RuntimeError(
        "Downgrade for exposure projection metadata is unsupported; restore from backup "
        "or migrate forward."
    )


def _upgrade_cloud_workspace_origin() -> None:
    _add_column_once(
        "cloud_workspace",
        sa.Column(
            "origin",
            sa.String(length=32),
            nullable=False,
            server_default=sa.text("'manual_desktop'"),
        ),
    )
    if _has_column("cloud_workspace", "origin"):
        op.execute(
            """
            UPDATE cloud_workspace
            SET origin = CASE
              WHEN origin_json ~* '"kind"\\s*:\\s*"automation"' THEN 'automation'
              WHEN origin_json ~* '"kind"\\s*:\\s*"slack"' THEN 'slack'
              WHEN origin_json ~* '"entrypoint"\\s*:\\s*"cowork"' THEN 'cowork_api'
              WHEN origin_json ~* '"entrypoint"\\s*:\\s*"cloud"' THEN 'manual_web'
              WHEN origin_json ~* '"entrypoint"\\s*:\\s*"desktop"' THEN 'manual_desktop'
              ELSE COALESCE(origin, 'manual_desktop')
            END
            WHERE origin IS NULL OR origin = 'manual_desktop'
            """
        )
        op.alter_column(
            "cloud_workspace",
            "origin",
            existing_type=sa.String(length=32),
            nullable=False,
            server_default=sa.text("'manual_desktop'"),
        )
    _create_check_once(
        "cloud_workspace",
        "ck_cloud_workspace_origin",
        _in_constraint("origin", _ORIGINS),
    )


def _create_workspace_exposures() -> None:
    if not _has_table("cloud_workspace_exposure"):
        op.create_table(
            "cloud_workspace_exposure",
            sa.Column(
                "id",
                sa.Uuid(),
                nullable=False,
                server_default=sa.text("gen_random_uuid()"),
            ),
            sa.Column("target_id", sa.Uuid(), nullable=False),
            sa.Column("cloud_workspace_id", sa.Uuid(), nullable=False),
            sa.Column("anyharness_workspace_id", sa.Text(), nullable=True),
            sa.Column("owner_scope", sa.String(length=32), nullable=False),
            sa.Column("owner_user_id", sa.Uuid(), nullable=True),
            sa.Column("organization_id", sa.Uuid(), nullable=True),
            sa.Column(
                "visibility",
                sa.String(length=32),
                nullable=False,
                server_default="private",
            ),
            sa.Column("claimed_by_user_id", sa.Uuid(), nullable=True),
            sa.Column(
                "default_projection_level",
                sa.String(length=32),
                nullable=False,
                server_default="live",
            ),
            sa.Column(
                "commandable",
                sa.Boolean(),
                nullable=False,
                server_default=sa.true(),
            ),
            sa.Column(
                "status",
                sa.String(length=32),
                nullable=False,
                server_default="active",
            ),
            sa.Column(
                "revision",
                sa.Integer(),
                nullable=False,
                server_default=sa.text("1"),
            ),
            sa.Column("last_projected_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("origin", sa.String(length=32), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
            sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(["target_id"], ["cloud_targets.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(
                ["cloud_workspace_id"],
                ["cloud_workspace.id"],
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(["owner_user_id"], ["user.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(
                ["organization_id"],
                ["organization.id"],
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(
                ["claimed_by_user_id"],
                ["user.id"],
                ondelete="SET NULL",
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.CheckConstraint(
                "((owner_scope = 'personal' AND owner_user_id IS NOT NULL "
                "AND organization_id IS NULL) OR "
                "(owner_scope = 'organization' AND organization_id IS NOT NULL "
                "AND owner_user_id IS NULL))",
                name="ck_cloud_workspace_exposure_owner_fields",
            ),
            sa.CheckConstraint(
                _in_constraint("visibility", _EXPOSURE_VISIBILITIES),
                name="ck_cloud_workspace_exposure_visibility",
            ),
            sa.CheckConstraint(
                _in_constraint("default_projection_level", _EXPOSURE_PROJECTION_LEVELS),
                name="ck_cloud_workspace_exposure_projection_level",
            ),
            sa.CheckConstraint(
                "claimed_by_user_id IS NULL OR visibility = 'claimed'",
                name="ck_cloud_workspace_exposure_claimed_user",
            ),
            sa.CheckConstraint(
                _in_constraint("status", _EXPOSURE_STATUSES),
                name="ck_cloud_workspace_exposure_status",
            ),
            sa.CheckConstraint(
                f"origin IS NULL OR {_in_constraint('origin', _ORIGINS)}",
                name="ck_cloud_workspace_exposure_origin",
            ),
        )

    _create_index_once(
        "ix_cloud_workspace_exposure_target",
        "cloud_workspace_exposure",
        ["target_id"],
    )
    _create_index_once(
        "ix_cloud_workspace_exposure_workspace",
        "cloud_workspace_exposure",
        ["cloud_workspace_id"],
    )
    _create_index_once(
        "ix_cloud_workspace_exposure_owner_user",
        "cloud_workspace_exposure",
        ["owner_user_id"],
    )
    _create_index_once(
        "ix_cloud_workspace_exposure_organization",
        "cloud_workspace_exposure",
        ["organization_id"],
    )
    _create_index_once(
        "ux_cloud_workspace_exposure_active",
        "cloud_workspace_exposure",
        ["target_id", "cloud_workspace_id"],
        unique=True,
        postgresql_where=sa.text("archived_at IS NULL"),
    )


def _upgrade_session_projections() -> None:
    _add_column_once("cloud_sessions", sa.Column("exposure_id", sa.Uuid(), nullable=True))
    _add_column_once(
        "cloud_sessions",
        sa.Column(
            "projection_level",
            sa.String(length=32),
            nullable=False,
            server_default=sa.text("'live'"),
        ),
    )
    _add_column_once(
        "cloud_sessions",
        sa.Column(
            "commandable",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
    )
    _add_column_once("cloud_sessions", sa.Column("gap_state_json", sa.Text(), nullable=True))
    _add_column_once("cloud_sessions", sa.Column("last_uploaded_seq", sa.Integer(), nullable=True))
    _add_column_once(
        "cloud_sessions",
        sa.Column(
            "agent_run_config_snapshot_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
    )
    if _has_column("cloud_sessions", "projection_level"):
        op.execute(
            "UPDATE cloud_sessions SET projection_level = 'live' WHERE projection_level IS NULL"
        )
        op.alter_column(
            "cloud_sessions",
            "projection_level",
            existing_type=sa.String(length=32),
            nullable=False,
            server_default=sa.text("'live'"),
        )
    if _has_column("cloud_sessions", "commandable"):
        op.execute("UPDATE cloud_sessions SET commandable = true WHERE commandable IS NULL")
        op.alter_column(
            "cloud_sessions",
            "commandable",
            existing_type=sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        )
    _create_fk_once(
        "fk_cloud_sessions_exposure_id_cloud_workspace_exposure",
        "cloud_sessions",
        "cloud_workspace_exposure",
        ["exposure_id"],
        ["id"],
        ondelete="SET NULL",
    )
    _create_index_once("ix_cloud_sessions_exposure", "cloud_sessions", ["exposure_id"])
    _create_check_once(
        "cloud_sessions",
        "ck_cloud_sessions_projection_level",
        _in_constraint("projection_level", _SESSION_PROJECTION_LEVELS),
    )
