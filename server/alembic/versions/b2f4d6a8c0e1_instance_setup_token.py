"""instance setup token for the first-run claim

Revision ID: b2f4d6a8c0e1
Revises: a1c2e3f4b5d6
Create Date: 2026-07-02 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "b2f4d6a8c0e1"
down_revision: str | Sequence[str] | None = "a1c2e3f4b5d6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE_NAME = "instance_setup_token"


def _has_table(table_name: str) -> bool:
    return table_name in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if _has_table(_TABLE_NAME):
        return

    # Singleton table holding the SHA-256 hash of the first-run setup token.
    # The plaintext never touches the database; the row is removed once the
    # instance is claimed.
    op.create_table(
        _TABLE_NAME,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("token_hash", sa.String(length=128), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("id = 1", name="ck_instance_setup_token_singleton"),
    )


def downgrade() -> None:
    if _has_table(_TABLE_NAME):
        op.drop_table(_TABLE_NAME)
