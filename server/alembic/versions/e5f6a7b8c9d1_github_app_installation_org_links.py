"""github app installation org links

Revision ID: e5f6a7b8c9d1
Revises: d4e6f8a0b2c4
Create Date: 2026-06-29 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "e5f6a7b8c9d1"
down_revision: str | Sequence[str] | None = "d4e6f8a0b2c4"
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


def _has_foreign_key(table_name: str, constraint_name: str) -> bool:
    if not _has_table(table_name):
        return False
    return constraint_name in {fk["name"] for fk in _inspector().get_foreign_keys(table_name)}


def _add_column_once(table_name: str, column: sa.Column[object]) -> None:
    if not _has_column(table_name, column.name):
        op.add_column(table_name, column)


def _drop_column_once(table_name: str, column_name: str) -> None:
    if _has_column(table_name, column_name):
        op.drop_column(table_name, column_name)


def _create_index_once(index_name: str, table_name: str, columns: list[str]) -> None:
    if not _has_index(table_name, index_name):
        op.create_index(index_name, table_name, columns)


def _drop_index_once(index_name: str, table_name: str) -> None:
    if _has_index(table_name, index_name):
        op.drop_index(index_name, table_name=table_name)


def _create_foreign_key_once(
    constraint_name: str,
    source_table: str,
    referent_table: str,
    local_cols: list[str],
    remote_cols: list[str],
    *,
    ondelete: str,
) -> None:
    if not _has_foreign_key(source_table, constraint_name):
        op.create_foreign_key(
            constraint_name,
            source_table,
            referent_table,
            local_cols,
            remote_cols,
            ondelete=ondelete,
        )


def _drop_foreign_key_once(table_name: str, constraint_name: str) -> None:
    if _has_foreign_key(table_name, constraint_name):
        op.drop_constraint(constraint_name, table_name, type_="foreignkey")


def upgrade() -> None:
    if not _has_table("github_app_installations"):
        return
    _add_column_once("github_app_installations", sa.Column("organization_id", sa.Uuid()))
    _add_column_once("github_app_installations", sa.Column("installed_by_user_id", sa.Uuid()))
    _create_foreign_key_once(
        "fk_github_app_installations_organization_id",
        "github_app_installations",
        "organization",
        ["organization_id"],
        ["id"],
        ondelete="SET NULL",
    )
    _create_foreign_key_once(
        "fk_github_app_installations_installed_by_user_id",
        "github_app_installations",
        "user",
        ["installed_by_user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    _create_index_once(
        "ix_github_app_installations_organization_id",
        "github_app_installations",
        ["organization_id"],
    )
    _create_index_once(
        "ix_github_app_installations_installed_by_user_id",
        "github_app_installations",
        ["installed_by_user_id"],
    )
    _create_index_once(
        "ix_github_app_installations_organization",
        "github_app_installations",
        ["organization_id", "deleted_at"],
    )


def downgrade() -> None:
    if not _has_table("github_app_installations"):
        return
    _drop_index_once("ix_github_app_installations_organization", "github_app_installations")
    _drop_index_once(
        "ix_github_app_installations_installed_by_user_id", "github_app_installations"
    )
    _drop_index_once("ix_github_app_installations_organization_id", "github_app_installations")
    _drop_foreign_key_once(
        "github_app_installations",
        "fk_github_app_installations_installed_by_user_id",
    )
    _drop_foreign_key_once(
        "github_app_installations",
        "fk_github_app_installations_organization_id",
    )
    _drop_column_once("github_app_installations", "installed_by_user_id")
    _drop_column_once("github_app_installations", "organization_id")
