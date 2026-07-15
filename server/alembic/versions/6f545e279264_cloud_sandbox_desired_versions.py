"""cloud sandbox target-scoped desired runtime versions

Revision ID: 6f545e279264
Revises: ecffa1106847
Create Date: 2026-07-15 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "6f545e279264"
down_revision: str | Sequence[str] | None = "f3d7a1b9c2e5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "cloud_sandbox",
        sa.Column("desired_anyharness_version", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "cloud_sandbox",
        sa.Column("desired_worker_version", sa.String(length=64), nullable=True),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("cloud_sandbox", "desired_worker_version")
    op.drop_column("cloud_sandbox", "desired_anyharness_version")
