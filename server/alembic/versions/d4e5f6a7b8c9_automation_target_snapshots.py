"""Add automation cloud target snapshots.

Revision ID: d4e5f6a7b8c9
Revises: d3e4f5a6b7c8
Create Date: 2026-05-14 20:20:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "d4e5f6a7b8c9"
down_revision: str | None = "d3e4f5a6b7c8"
branch_labels: str | None = None
depends_on: str | None = None


def _has_column(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return column_name in {column["name"] for column in inspector.get_columns(table_name)}


def _has_index(table_name: str, index_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return index_name in {index["name"] for index in inspector.get_indexes(table_name)}


def _has_foreign_key(table_name: str, constraint_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return constraint_name in {
        constraint["name"] for constraint in inspector.get_foreign_keys(table_name)
    }


def _add_column_once(table_name: str, column: sa.Column) -> None:
    if not _has_column(table_name, column.name):
        op.add_column(table_name, column)


def _create_index_once(index_name: str, table_name: str, columns: list[str]) -> None:
    if not _has_index(table_name, index_name):
        op.create_index(index_name, table_name, columns)


def _drop_column_once(table_name: str, column_name: str) -> None:
    if _has_column(table_name, column_name):
        op.drop_column(table_name, column_name)


def _drop_index_once(index_name: str, table_name: str) -> None:
    if _has_index(table_name, index_name):
        op.drop_index(index_name, table_name=table_name)


def _drop_foreign_key_once(constraint_name: str, table_name: str) -> None:
    if _has_foreign_key(table_name, constraint_name):
        op.drop_constraint(constraint_name, table_name, type_="foreignkey")


def upgrade() -> None:
    _add_column_once(
        "automation",
        sa.Column("cloud_target_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    _add_column_once(
        "automation",
        sa.Column("cloud_target_kind_snapshot", sa.String(length=32), nullable=True),
    )
    if not _has_foreign_key("automation", "fk_automation_cloud_target_id_cloud_targets"):
        op.create_foreign_key(
            "fk_automation_cloud_target_id_cloud_targets",
            "automation",
            "cloud_targets",
            ["cloud_target_id"],
            ["id"],
            ondelete="SET NULL",
        )
    _create_index_once("ix_automation_cloud_target_id", "automation", ["cloud_target_id"])

    _add_column_once(
        "automation_run",
        sa.Column("cloud_target_id_snapshot", postgresql.UUID(as_uuid=True), nullable=True),
    )
    _add_column_once(
        "automation_run",
        sa.Column("cloud_target_kind_snapshot", sa.String(length=32), nullable=True),
    )
    if not _has_foreign_key(
        "automation_run",
        "fk_automation_run_cloud_target_id_snapshot_cloud_targets",
    ):
        op.create_foreign_key(
            "fk_automation_run_cloud_target_id_snapshot_cloud_targets",
            "automation_run",
            "cloud_targets",
            ["cloud_target_id_snapshot"],
            ["id"],
            ondelete="SET NULL",
        )
    _create_index_once(
        "ix_automation_run_cloud_target_id_snapshot",
        "automation_run",
        ["cloud_target_id_snapshot"],
    )


def downgrade() -> None:
    _drop_index_once("ix_automation_run_cloud_target_id_snapshot", "automation_run")
    _drop_foreign_key_once(
        "fk_automation_run_cloud_target_id_snapshot_cloud_targets",
        "automation_run",
    )
    _drop_column_once("automation_run", "cloud_target_kind_snapshot")
    _drop_column_once("automation_run", "cloud_target_id_snapshot")

    _drop_index_once("ix_automation_cloud_target_id", "automation")
    _drop_foreign_key_once(
        "fk_automation_cloud_target_id_cloud_targets",
        "automation",
    )
    _drop_column_once("automation", "cloud_target_kind_snapshot")
    _drop_column_once("automation", "cloud_target_id")
