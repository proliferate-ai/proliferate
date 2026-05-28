"""allow one managed provider key per budget subject provider

Revision ID: 0f1e2d3c4b5a
Revises: fa0b1c2d3e4f
Create Date: 2026-05-27 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0f1e2d3c4b5a"
down_revision: str | Sequence[str] | None = "fa0b1c2d3e4f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_table(table_name: str) -> bool:
    return table_name in sa.inspect(op.get_bind()).get_table_names()


def _has_index(table_name: str, index_name: str) -> bool:
    if not _has_table(table_name):
        return False
    return index_name in {
        index["name"] for index in sa.inspect(op.get_bind()).get_indexes(table_name)
    }


def _drop_index_once(table_name: str, index_name: str) -> None:
    if _has_index(table_name, index_name):
        op.drop_index(index_name, table_name=table_name)


def upgrade() -> None:
    if not _has_table("agent_gateway_router_materialization"):
        return

    _drop_index_once(
        "agent_gateway_router_materialization",
        "uq_agent_gateway_router_materialization_budget_object",
    )
    op.create_index(
        "uq_agent_gateway_router_materialization_budget_object",
        "agent_gateway_router_materialization",
        [
            "router_kind",
            "router_object_kind",
            "object_scope",
            "budget_subject_id",
            "router_object_id",
        ],
        unique=True,
        postgresql_where=sa.text("object_scope = 'budget_subject' AND status != 'revoked'"),
    )


def downgrade() -> None:
    if not _has_table("agent_gateway_router_materialization"):
        return

    _drop_index_once(
        "agent_gateway_router_materialization",
        "uq_agent_gateway_router_materialization_budget_object",
    )
    op.create_index(
        "uq_agent_gateway_router_materialization_budget_object",
        "agent_gateway_router_materialization",
        ["router_kind", "router_object_kind", "object_scope", "budget_subject_id"],
        unique=True,
        postgresql_where=sa.text("object_scope = 'budget_subject' AND status != 'revoked'"),
    )
