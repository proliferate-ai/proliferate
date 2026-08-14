"""repo environment archiving knobs

Revision ID: da8a01b4ad7a
Revises: b5d7f9a1c3e5
Create Date: 2026-08-13 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "da8a01b4ad7a"
down_revision: str | Sequence[str] | None = "b5d7f9a1c3e5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_column(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return column_name in {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    """Upgrade schema."""
    if not _has_column("repo_environment", "archive_script"):
        op.add_column(
            "repo_environment",
            sa.Column("archive_script", sa.Text(), nullable=False, server_default=""),
        )
    if not _has_column("repo_environment", "rerun_setup_on_unarchive"):
        op.add_column(
            "repo_environment",
            sa.Column(
                "rerun_setup_on_unarchive",
                sa.Boolean(),
                nullable=False,
                server_default=sa.true(),
            ),
        )


def downgrade() -> None:
    """Downgrade schema."""
    if _has_column("repo_environment", "rerun_setup_on_unarchive"):
        op.drop_column("repo_environment", "rerun_setup_on_unarchive")
    if _has_column("repo_environment", "archive_script"):
        op.drop_column("repo_environment", "archive_script")
