"""Slot-fence agent gateway runtime grants.

Revision ID: f1a2b3c4d5e6
Revises: f0a1b2c3d4e5
Create Date: 2026-05-20 13:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision: str = "f1a2b3c4d5e6"
down_revision: str | None = "f0a1b2c3d4e5"
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


def _index_exists(table_name: str, index_name: str) -> bool:
    if not _has_table(table_name):
        return False
    return index_name in {
        index["name"] for index in sa.inspect(op.get_bind()).get_indexes(table_name)
    }


def upgrade() -> None:
    if not _has_column("agent_gateway_runtime_grant", "cloud_sandbox_id"):
        op.add_column(
            "agent_gateway_runtime_grant",
            sa.Column("cloud_sandbox_id", sa.Uuid(), nullable=True),
        )
        op.create_foreign_key(
            "fk_agent_gateway_runtime_grant_cloud_sandbox_id_cloud_sandbox",
            "agent_gateway_runtime_grant",
            "cloud_sandbox",
            ["cloud_sandbox_id"],
            ["id"],
            ondelete="CASCADE",
        )
    if not _has_column("agent_gateway_runtime_grant", "slot_generation"):
        op.add_column(
            "agent_gateway_runtime_grant",
            sa.Column("slot_generation", sa.Integer(), nullable=True),
        )
    if not _index_exists(
        "agent_gateway_runtime_grant",
        "ix_agent_gateway_runtime_grant_cloud_sandbox_id",
    ):
        op.create_index(
            "ix_agent_gateway_runtime_grant_cloud_sandbox_id",
            "agent_gateway_runtime_grant",
            ["cloud_sandbox_id"],
        )
    if not _index_exists("agent_gateway_runtime_grant", "ix_agent_gateway_runtime_grant_slot"):
        op.create_index(
            "ix_agent_gateway_runtime_grant_slot",
            "agent_gateway_runtime_grant",
            ["cloud_sandbox_id", "slot_generation"],
        )


def downgrade() -> None:
    if _index_exists("agent_gateway_runtime_grant", "ix_agent_gateway_runtime_grant_slot"):
        op.drop_index(
            "ix_agent_gateway_runtime_grant_slot",
            table_name="agent_gateway_runtime_grant",
        )
    if _index_exists(
        "agent_gateway_runtime_grant",
        "ix_agent_gateway_runtime_grant_cloud_sandbox_id",
    ):
        op.drop_index(
            "ix_agent_gateway_runtime_grant_cloud_sandbox_id",
            table_name="agent_gateway_runtime_grant",
        )
    if _has_column("agent_gateway_runtime_grant", "cloud_sandbox_id"):
        op.drop_constraint(
            "fk_agent_gateway_runtime_grant_cloud_sandbox_id_cloud_sandbox",
            "agent_gateway_runtime_grant",
            type_="foreignkey",
        )
        op.drop_column("agent_gateway_runtime_grant", "cloud_sandbox_id")
    if _has_column("agent_gateway_runtime_grant", "slot_generation"):
        op.drop_column("agent_gateway_runtime_grant", "slot_generation")
