"""organization integration catalog policy

Revision ID: b4c5d6e7f8a9
Revises: a3f9c7e21b40
Create Date: 2026-06-23 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "b4c5d6e7f8a9"
down_revision: str | Sequence[str] | None = "a3f9c7e21b40"
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


def upgrade() -> None:
    if not _has_table("cloud_organization_integration_policy"):
        op.create_table(
            "cloud_organization_integration_policy",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("organization_id", sa.Uuid(), nullable=False),
            sa.Column("catalog_entry_id", sa.String(length=255), nullable=False),
            sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("updated_by_user_id", sa.Uuid(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["organization_id"],
                ["organization.id"],
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(
                ["updated_by_user_id"],
                ["user.id"],
                ondelete="SET NULL",
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "organization_id",
                "catalog_entry_id",
                name="uq_cloud_org_integration_policy_entry",
            ),
        )
    if not _has_index(
        "cloud_organization_integration_policy",
        "ix_cloud_org_integration_policy_organization_id",
    ):
        op.create_index(
            "ix_cloud_org_integration_policy_organization_id",
            "cloud_organization_integration_policy",
            ["organization_id"],
            unique=False,
        )


def downgrade() -> None:
    if _has_index(
        "cloud_organization_integration_policy",
        "ix_cloud_org_integration_policy_organization_id",
    ):
        op.drop_index(
            "ix_cloud_org_integration_policy_organization_id",
            table_name="cloud_organization_integration_policy",
        )
    if _has_table("cloud_organization_integration_policy"):
        op.drop_table("cloud_organization_integration_policy")
