"""usage_segment organization_id for org compute budget enforcement

Revision ID: d10c0a11e5ef
Revises: 75e8009a52c7
Create Date: 2026-07-08 12:00:00.000000

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "d10c0a11e5ef"
down_revision: str | Sequence[str] | None = "75e8009a52c7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_column(table_name: str, column_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return any(column["name"] == column_name for column in inspector.get_columns(table_name))


def upgrade() -> None:
    if _has_column("usage_segment", "organization_id"):
        return
    op.add_column(
        "usage_segment",
        sa.Column("organization_id", sa.Uuid(), nullable=True),
    )
    op.create_index(
        op.f("ix_usage_segment_organization_id"),
        "usage_segment",
        ["organization_id"],
        unique=False,
    )


def downgrade() -> None:
    if not _has_column("usage_segment", "organization_id"):
        return
    op.drop_index(
        op.f("ix_usage_segment_organization_id"),
        table_name="usage_segment",
    )
    op.drop_column("usage_segment", "organization_id")
