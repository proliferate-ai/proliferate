"""Add free cloud allocation guard.

Revision ID: f9a0b1c2d3e4
Revises: e8f9a0b1c2d3
Create Date: 2026-05-21 12:00:00.000000

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f9a0b1c2d3e4"
down_revision: str | Sequence[str] | None = "e8f9a0b1c2d3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "free_cloud_allocation",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("allocation_kind", sa.String(length=64), nullable=False),
        sa.Column("github_provider_user_id", sa.Text(), nullable=False),
        sa.Column("billing_subject_id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("issued_billing_grant_id", sa.UUID(), nullable=True),
        sa.Column("period_key", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "allocation_kind",
            "github_provider_user_id",
            "period_key",
            name="uq_free_cloud_allocation_github_period",
        ),
        sa.UniqueConstraint(
            "issued_billing_grant_id",
            name="uq_free_cloud_allocation_billing_grant",
        ),
    )
    op.create_index(
        "ix_free_cloud_allocation_allocation_kind",
        "free_cloud_allocation",
        ["allocation_kind"],
    )
    op.create_index(
        "ix_free_cloud_allocation_billing_subject_id",
        "free_cloud_allocation",
        ["billing_subject_id"],
    )
    op.create_index(
        "ix_free_cloud_allocation_issued_billing_grant_id",
        "free_cloud_allocation",
        ["issued_billing_grant_id"],
    )
    op.create_index(
        "ix_free_cloud_allocation_status",
        "free_cloud_allocation",
        ["status"],
    )
    op.create_index(
        "ix_free_cloud_allocation_user_id",
        "free_cloud_allocation",
        ["user_id"],
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_free_cloud_allocation_user_id", table_name="free_cloud_allocation")
    op.drop_index("ix_free_cloud_allocation_status", table_name="free_cloud_allocation")
    op.drop_index(
        "ix_free_cloud_allocation_issued_billing_grant_id",
        table_name="free_cloud_allocation",
    )
    op.drop_index(
        "ix_free_cloud_allocation_billing_subject_id",
        table_name="free_cloud_allocation",
    )
    op.drop_index(
        "ix_free_cloud_allocation_allocation_kind",
        table_name="free_cloud_allocation",
    )
    op.drop_table("free_cloud_allocation")
