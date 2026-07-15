"""repo config commit instructions

Revision ID: ecffa1106847
Revises: e7f8a9b0c1d3
Create Date: 2026-07-14 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "ecffa1106847"
down_revision: str | Sequence[str] | None = "e7f8a9b0c1d3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_column(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return column_name in {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    """Upgrade schema."""
    if not _has_column("repo_config", "commit_instructions"):
        op.add_column(
            "repo_config",
            sa.Column("commit_instructions", sa.Text(), nullable=False, server_default=""),
        )
        op.alter_column("repo_config", "commit_instructions", server_default=None)


def downgrade() -> None:
    """Downgrade schema."""
    if _has_column("repo_config", "commit_instructions"):
        op.drop_column("repo_config", "commit_instructions")
