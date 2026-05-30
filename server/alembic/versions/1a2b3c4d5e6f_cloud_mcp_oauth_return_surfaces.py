"""Cloud MCP OAuth return surfaces.

Revision ID: 1a2b3c4d5e6f
Revises: 0f1e2d3c4b5a
Create Date: 2026-05-30 12:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision: str = "1a2b3c4d5e6f"
down_revision: str | None = "0f1e2d3c4b5a"
branch_labels: str | None = None
depends_on: str | None = None


def _has_table(table_name: str) -> bool:
    return table_name in sa.inspect(op.get_bind()).get_table_names()


def _has_column(table_name: str, column_name: str) -> bool:
    if not _has_table(table_name):
        return False
    return column_name in {
        column["name"] for column in sa.inspect(op.get_bind()).get_columns(table_name)
    }


def _has_constraint(table_name: str, constraint_name: str) -> bool:
    if not _has_table(table_name):
        return False
    inspector = sa.inspect(op.get_bind())
    names = {constraint["name"] for constraint in inspector.get_check_constraints(table_name)}
    names.update(constraint["name"] for constraint in inspector.get_foreign_keys(table_name))
    names.update(constraint["name"] for constraint in inspector.get_unique_constraints(table_name))
    return constraint_name in names


def _foreign_key_names(
    table_name: str,
    *,
    constrained_columns: tuple[str, ...],
    referred_table: str,
) -> set[str]:
    if not _has_table(table_name):
        return set()
    return {
        fk["name"]
        for fk in sa.inspect(op.get_bind()).get_foreign_keys(table_name)
        if fk["name"]
        and tuple(fk.get("constrained_columns") or ()) == constrained_columns
        and fk.get("referred_table") == referred_table
    }


def _add_column_once(table_name: str, column: sa.Column) -> None:
    if not _has_column(table_name, column.name):
        op.add_column(table_name, column)


def _drop_column_once(table_name: str, column_name: str) -> None:
    if _has_column(table_name, column_name):
        op.drop_column(table_name, column_name)


def _create_check_once(table_name: str, constraint_name: str, condition: str) -> None:
    if not _has_constraint(table_name, constraint_name):
        op.create_check_constraint(constraint_name, table_name, condition)


def _drop_constraint_once(table_name: str, constraint_name: str) -> None:
    if _has_constraint(table_name, constraint_name):
        op.drop_constraint(constraint_name, table_name, type_="check")


def _drop_foreign_keys_once(
    table_name: str,
    *,
    constrained_columns: tuple[str, ...],
    referred_table: str,
) -> None:
    for constraint_name in _foreign_key_names(
        table_name,
        constrained_columns=constrained_columns,
        referred_table=referred_table,
    ):
        op.drop_constraint(constraint_name, table_name, type_="foreignkey")


def _create_foreign_key_once(
    constraint_name: str,
    source_table: str,
    referent_table: str,
    local_cols: list[str],
    remote_cols: list[str],
    *,
    ondelete: str,
) -> None:
    if not _has_constraint(source_table, constraint_name):
        op.create_foreign_key(
            constraint_name,
            source_table,
            referent_table,
            local_cols,
            remote_cols,
            ondelete=ondelete,
        )


def upgrade() -> None:
    _add_column_once(
        "cloud_mcp_oauth_flow",
        sa.Column(
            "callback_surface",
            sa.String(length=32),
            nullable=False,
            server_default="desktop",
        ),
    )
    _add_column_once(
        "cloud_mcp_oauth_flow",
        sa.Column(
            "final_surface",
            sa.String(length=32),
            nullable=False,
            server_default="desktop",
        ),
    )
    _add_column_once(
        "cloud_mcp_oauth_flow",
        sa.Column("return_path", sa.Text(), nullable=True),
    )
    _create_check_once(
        "cloud_mcp_oauth_flow",
        "ck_cloud_mcp_oauth_flow_callback_surface",
        "callback_surface IN ('desktop', 'web')",
    )
    _create_check_once(
        "cloud_mcp_oauth_flow",
        "ck_cloud_mcp_oauth_flow_final_surface",
        "final_surface IN ('desktop', 'web')",
    )
    _drop_foreign_keys_once(
        "cloud_mcp_oauth_flow",
        constrained_columns=("connection_db_id",),
        referred_table="cloud_mcp_connection",
    )
    op.alter_column(
        "cloud_mcp_oauth_flow",
        "connection_db_id",
        existing_type=sa.Uuid(),
        nullable=True,
    )
    _create_foreign_key_once(
        "fk_cloud_mcp_oauth_flow_connection_db_id",
        "cloud_mcp_oauth_flow",
        "cloud_mcp_connection",
        ["connection_db_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    _drop_foreign_keys_once(
        "cloud_mcp_oauth_flow",
        constrained_columns=("connection_db_id",),
        referred_table="cloud_mcp_connection",
    )
    op.execute("DELETE FROM cloud_mcp_oauth_flow WHERE connection_db_id IS NULL")
    op.alter_column(
        "cloud_mcp_oauth_flow",
        "connection_db_id",
        existing_type=sa.Uuid(),
        nullable=False,
    )
    _create_foreign_key_once(
        "fk_cloud_mcp_oauth_flow_connection_db_id",
        "cloud_mcp_oauth_flow",
        "cloud_mcp_connection",
        ["connection_db_id"],
        ["id"],
        ondelete="CASCADE",
    )
    _drop_constraint_once("cloud_mcp_oauth_flow", "ck_cloud_mcp_oauth_flow_final_surface")
    _drop_constraint_once("cloud_mcp_oauth_flow", "ck_cloud_mcp_oauth_flow_callback_surface")
    _drop_column_once("cloud_mcp_oauth_flow", "return_path")
    _drop_column_once("cloud_mcp_oauth_flow", "final_surface")
    _drop_column_once("cloud_mcp_oauth_flow", "callback_surface")
