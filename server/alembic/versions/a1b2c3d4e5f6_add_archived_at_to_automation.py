"""add_archived_at_to_automation

Revision ID: a1b2c3d4e5f6
Revises: ff9344886948
Create Date: 2026-07-05 10:00:00.000000

"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "a1b2c3d4e5f6"
down_revision: str | Sequence[str] | None = "ff9344886948"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_table(table_name: str) -> bool:
    return table_name in sa.inspect(op.get_bind()).get_table_names()


def _has_column(table_name: str, column_name: str) -> bool:
    if not _has_table(table_name):
        return False
    return column_name in {
        column["name"] for column in sa.inspect(op.get_bind()).get_columns(table_name)
    }


def upgrade() -> None:
    if _has_table("automation") and not _has_column("automation", "archived_at"):
        op.add_column(
            "automation",
            sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        )


def downgrade() -> None:
    if _has_table("automation") and _has_column("automation", "archived_at"):
        op.drop_column("automation", "archived_at")
