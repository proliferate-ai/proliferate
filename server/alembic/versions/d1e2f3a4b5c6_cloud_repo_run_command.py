"""cloud repo run command

Revision ID: d1e2f3a4b5c6
Revises: c0d1e2f3a4b5
Create Date: 2026-04-22 10:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d1e2f3a4b5c6"
down_revision: str | Sequence[str] | None = "c0d1e2f3a4b5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_column(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return column_name in {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    """Upgrade schema."""
    if not _has_column("cloud_repo_config", "run_command"):
        op.add_column(
            "cloud_repo_config",
            sa.Column("run_command", sa.Text(), nullable=False, server_default=""),
        )
        op.alter_column("cloud_repo_config", "run_command", server_default=None)


def downgrade() -> None:
    """Downgrade schema."""
    if _has_column("cloud_repo_config", "run_command"):
        op.drop_column("cloud_repo_config", "run_command")
