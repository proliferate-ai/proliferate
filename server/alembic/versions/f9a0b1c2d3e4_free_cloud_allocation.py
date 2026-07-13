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


def _has_table(table_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return table_name in inspector.get_table_names()


def _has_index(table_name: str, index_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return index_name in {index["name"] for index in inspector.get_indexes(table_name)}


def _create_index_once(index_name: str, columns: list[str]) -> None:
    if _has_table("free_cloud_allocation") and not _has_index(
        "free_cloud_allocation", index_name
    ):
        op.create_index(index_name, "free_cloud_allocation", columns)


def upgrade() -> None:
    """Upgrade schema."""
    if not _has_table("free_cloud_allocation"):
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
    _create_index_once("ix_free_cloud_allocation_allocation_kind", ["allocation_kind"])
    _create_index_once("ix_free_cloud_allocation_billing_subject_id", ["billing_subject_id"])
    _create_index_once(
        "ix_free_cloud_allocation_issued_billing_grant_id",
        ["issued_billing_grant_id"],
    )
    _create_index_once("ix_free_cloud_allocation_status", ["status"])
    _create_index_once("ix_free_cloud_allocation_user_id", ["user_id"])


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
