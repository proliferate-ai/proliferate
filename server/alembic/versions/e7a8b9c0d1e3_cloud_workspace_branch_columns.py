"""ensure cloud workspace branch columns

Revision ID: e7a8b9c0d1e3
Revises: e6a7b8c9d0e2
Create Date: 2026-07-01 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "e7a8b9c0d1e3"
down_revision: str | Sequence[str] | None = "e6a7b8c9d0e2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


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


def _add_column_once(table_name: str, column: sa.Column[object]) -> None:
    if not _has_column(table_name, column.name):
        op.add_column(table_name, column)


def _drop_column_once(table_name: str, column_name: str) -> None:
    if _has_column(table_name, column_name):
        op.drop_column(table_name, column_name)


def _drop_index_once(index_name: str, table_name: str) -> None:
    if _has_index(table_name, index_name):
        op.drop_index(index_name, table_name=table_name)


def upgrade() -> None:
    if not _has_table("cloud_workspace"):
        return

    _add_column_once(
        "cloud_workspace",
        sa.Column("git_branch", sa.String(length=255), nullable=True),
    )
    _add_column_once(
        "cloud_workspace",
        sa.Column("git_base_branch", sa.String(length=255), nullable=True),
    )
    if _has_column("cloud_workspace", "anyharness_workspace_id"):
        op.alter_column(
            "cloud_workspace",
            "anyharness_workspace_id",
            existing_type=sa.String(length=255),
            nullable=True,
        )

    if _has_column("cloud_workspace", "git_branch"):
        op.execute(
            """
            UPDATE cloud_workspace
            SET git_branch = COALESCE(
              NULLIF(git_branch, ''),
              NULLIF(display_name, ''),
              'workspace-' || substring(id::text from 1 for 8)
            )
            WHERE git_branch IS NULL
               OR git_branch = ''
            """
        )
        op.alter_column(
            "cloud_workspace",
            "git_branch",
            existing_type=sa.String(length=255),
            nullable=False,
        )

    if (
        _has_column("cloud_workspace", "owner_user_id")
        and _has_column("cloud_workspace", "repo_environment_id")
        and _has_column("cloud_workspace", "git_branch")
    ):
        _drop_index_once("ux_cloud_workspace_active_repo_environment_branch", "cloud_workspace")
        op.create_index(
            "ux_cloud_workspace_active_repo_environment_branch",
            "cloud_workspace",
            ["owner_user_id", "repo_environment_id", "git_branch"],
            unique=True,
            postgresql_where=sa.text("archived_at IS NULL"),
        )


def downgrade() -> None:
    if not _has_table("cloud_workspace"):
        return

    _drop_index_once("ux_cloud_workspace_active_repo_environment_branch", "cloud_workspace")
    _drop_column_once("cloud_workspace", "git_base_branch")
    _drop_column_once("cloud_workspace", "git_branch")
