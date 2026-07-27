"""add cloud workspace lost timestamp

Revision ID: 7f3a9b2c4d5e
Revises: 35fa0038d703
Create Date: 2026-07-26 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "7f3a9b2c4d5e"
down_revision: str | Sequence[str] | None = "35fa0038d703"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "cloud_workspace",
        sa.Column("lost_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("cloud_workspace", "lost_at")
