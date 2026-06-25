"""Allow multiple active organization memberships.

Revision ID: b9c3d4e5f6a7
Revises: b8f2c6d7e9a0
Create Date: 2026-06-24 15:30:00.000000

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "b9c3d4e5f6a7"
down_revision: str | Sequence[str] | None = "b8f2c6d7e9a0"
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
    if _has_index("organization_membership", "uq_organization_membership_active_user"):
        op.drop_index(
            "uq_organization_membership_active_user",
            table_name="organization_membership",
        )


def downgrade() -> None:
    if not _has_table("organization_membership"):
        return
    if _has_index("organization_membership", "uq_organization_membership_active_user"):
        return
    op.create_index(
        "uq_organization_membership_active_user",
        "organization_membership",
        ["user_id"],
        unique=True,
        postgresql_where=sa.text("status = 'active'"),
    )
