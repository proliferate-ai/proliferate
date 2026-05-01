"""user github profile

Revision ID: f6a7b8c9d0e1
Revises: e2f3a4b5c6d7
Create Date: 2026-04-30 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f6a7b8c9d0e1"
down_revision: str | Sequence[str] | None = "e2f3a4b5c6d7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_column(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return column_name in {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    """Upgrade schema."""
    if not _has_column("user", "github_login"):
        op.add_column("user", sa.Column("github_login", sa.String(length=255), nullable=True))
    if not _has_column("user", "avatar_url"):
        op.add_column("user", sa.Column("avatar_url", sa.Text(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    if _has_column("user", "avatar_url"):
        op.drop_column("user", "avatar_url")
    if _has_column("user", "github_login"):
        op.drop_column("user", "github_login")
