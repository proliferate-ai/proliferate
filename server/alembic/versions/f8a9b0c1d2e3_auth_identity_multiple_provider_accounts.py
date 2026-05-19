"""allow multiple auth identities per provider per user

Revision ID: f8a9b0c1d2e3
Revises: f7a8b9c0d1e2
Create Date: 2026-05-19 00:00:00.000000

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f8a9b0c1d2e3"
down_revision: str | Sequence[str] | None = "f7a8b9c0d1e2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.drop_constraint(
        "uq_auth_identity_user_provider",
        "auth_identity",
        type_="unique",
    )
    op.create_index(
        "ix_auth_identity_user_provider",
        "auth_identity",
        ["user_id", "provider"],
        unique=False,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_auth_identity_user_provider", table_name="auth_identity")
    op.create_unique_constraint(
        "uq_auth_identity_user_provider",
        "auth_identity",
        ["user_id", "provider"],
    )
