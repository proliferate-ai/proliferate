"""cloud workspace origin

Revision ID: c1d2e3f4a5b6
Revises: 9a0b1c2d3e4f
Create Date: 2026-04-20 09:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c1d2e3f4a5b6"
down_revision: str | Sequence[str] | None = "9a0b1c2d3e4f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_column(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return column_name in {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    """Upgrade schema."""
    if not _has_column("cloud_workspace", "origin_json"):
        op.add_column("cloud_workspace", sa.Column("origin_json", sa.Text(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    if _has_column("cloud_workspace", "origin_json"):
        op.drop_column("cloud_workspace", "origin_json")
