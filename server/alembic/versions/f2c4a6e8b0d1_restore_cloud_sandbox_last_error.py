"""restore cloud sandbox recovery state

Revision ID: f2c4a6e8b0d1
Revises: e94a7c1d6b20
Create Date: 2026-07-17 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "f2c4a6e8b0d1"
down_revision: str | Sequence[str] | None = "e94a7c1d6b20"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("cloud_sandbox", sa.Column("last_error", sa.Text(), nullable=True))
    op.add_column(
        "cloud_sandbox",
        sa.Column(
            "materialization_attempt",
            sa.Integer(),
            server_default="0",
            nullable=False,
        ),
    )
    op.add_column(
        "cloud_sandbox",
        sa.Column("provider_observed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.execute(
        sa.text(
            "UPDATE cloud_sandbox "
            "SET provider_observed_at = updated_at "
            "WHERE provider_observed_at IS NULL"
        )
    )
    op.alter_column(
        "cloud_sandbox",
        "provider_observed_at",
        existing_type=sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.text("now()"),
    )


def downgrade() -> None:
    op.drop_column("cloud_sandbox", "provider_observed_at")
    op.drop_column("cloud_sandbox", "materialization_attempt")
    op.drop_column("cloud_sandbox", "last_error")
