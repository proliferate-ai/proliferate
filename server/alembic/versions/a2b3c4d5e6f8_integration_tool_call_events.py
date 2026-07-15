"""integration gateway tool-call audit events

Adds ``cloud_integration_tool_call_event``: one row per ``integrations.call_tool``
proxied through the integration gateway (success or failure), giving queryable
evidence a provider tool call happened, who ran it, and how it went.

Revision ID: a2b3c4d5e6f8
Revises: e1f2a3b4c5d6
Create Date: 2026-07-09 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "a2b3c4d5e6f8"
down_revision: str | Sequence[str] | None = "e1f2a3b4c5d6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _inspector() -> sa.Inspector:
    return sa.inspect(op.get_bind())


def _has_table(table_name: str) -> bool:
    return table_name in _inspector().get_table_names()


def upgrade() -> None:
    if _has_table("cloud_integration_tool_call_event"):
        return
    op.create_table(
        "cloud_integration_tool_call_event",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("organization_id", sa.Uuid(), nullable=True),
        sa.Column("runtime_worker_id", sa.Uuid(), nullable=True),
        sa.Column("integration_namespace", sa.String(length=64), nullable=False),
        sa.Column("tool_name", sa.String(length=255), nullable=False),
        sa.Column("ok", sa.Boolean(), nullable=False),
        sa.Column("error_code", sa.String(length=128), nullable=True),
        sa.Column("latency_ms", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(
            ["organization_id"], ["organization.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["runtime_worker_id"], ["cloud_runtime_worker.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_cloud_integration_tool_call_event_org_created",
        "cloud_integration_tool_call_event",
        ["organization_id", "created_at"],
    )
    op.create_index(
        "ix_cloud_integration_tool_call_event_user_created",
        "cloud_integration_tool_call_event",
        ["user_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_cloud_integration_tool_call_event_user_created",
        table_name="cloud_integration_tool_call_event",
    )
    op.drop_index(
        "ix_cloud_integration_tool_call_event_org_created",
        table_name="cloud_integration_tool_call_event",
    )
    op.drop_table("cloud_integration_tool_call_event")
