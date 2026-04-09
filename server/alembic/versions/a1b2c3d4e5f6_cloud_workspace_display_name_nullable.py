"""cloud workspace display_name nullable

Revision ID: a1b2c3d4e5f6
Revises: f3c4d2a1b9e0
Create Date: 2026-04-09 21:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f6"
down_revision: str | Sequence[str] | None = "f3c4d2a1b9e0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.alter_column(
        "cloud_workspace",
        "display_name",
        existing_type=sa.String(length=255),
        nullable=True,
    )
    # Pre-launch cleanup: previously the desktop client + server both
    # auto-filled display_name with "owner/repo" at creation, even though the
    # sidebar ignored the field entirely. Going forward, display_name is a
    # true user-provided override (NULL = use the default branch/repo
    # derivation). Null out rows that hold the stale auto-default so they
    # render the same as before.
    op.execute(
        """
        UPDATE cloud_workspace
        SET display_name = NULL
        WHERE display_name IS NOT NULL
          AND display_name = git_owner || '/' || git_repo_name
        """
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.alter_column(
        "cloud_workspace",
        "display_name",
        existing_type=sa.String(length=255),
        nullable=False,
    )
