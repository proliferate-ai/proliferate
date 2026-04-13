"""cloud repo default branch

Revision ID: e3f4a5b6c7d8
Revises: d9e0f1a2b3c4
Create Date: 2026-04-13 12:30:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e3f4a5b6c7d8"
down_revision: str | Sequence[str] | None = "d9e0f1a2b3c4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_column(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return column_name in {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    """Upgrade schema."""
    if not _has_column("cloud_repo_config", "default_branch"):
        op.add_column(
            "cloud_repo_config",
            sa.Column("default_branch", sa.String(length=255), nullable=True),
        )


def downgrade() -> None:
    """Downgrade schema."""
    if _has_column("cloud_repo_config", "default_branch"):
        op.drop_column("cloud_repo_config", "default_branch")
