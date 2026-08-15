"""agent gateway enrollment key verification verdict

Revision ID: e7f1a3c9d20b
Revises: da8a01b4ad7a
Create Date: 2026-08-15 00:00:00.000000

Adds the nullable per-key gateway-enablement verification columns
(agent-auth.md FR-3): ``verification_status``, ``verification_delta`` (a small
JSON string), and ``verified_at``. All nullable — a never-verified key carries
no verdict.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e7f1a3c9d20b"
down_revision: str | Sequence[str] | None = "da8a01b4ad7a"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "agent_gateway_enrollment_key"


def _has_column(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return column_name in {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    """Upgrade schema."""
    if not _has_column(_TABLE, "verification_status"):
        op.add_column(
            _TABLE,
            sa.Column("verification_status", sa.String(length=32), nullable=True),
        )
    if not _has_column(_TABLE, "verification_delta"):
        op.add_column(
            _TABLE,
            sa.Column("verification_delta", sa.Text(), nullable=True),
        )
    if not _has_column(_TABLE, "verified_at"):
        op.add_column(
            _TABLE,
            sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
        )


def downgrade() -> None:
    """Downgrade schema."""
    if _has_column(_TABLE, "verified_at"):
        op.drop_column(_TABLE, "verified_at")
    if _has_column(_TABLE, "verification_delta"):
        op.drop_column(_TABLE, "verification_delta")
    if _has_column(_TABLE, "verification_status"):
        op.drop_column(_TABLE, "verification_status")
